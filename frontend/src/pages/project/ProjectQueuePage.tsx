import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { apiClient, cancelTask, createManualTask, getApiErrorMessage, getProjectDashboard, getProjectTasks,
  publishTaskNow, triggerGeneration, updateTask, type PostingTask, type PostingTaskStatus, type ProjectAccountState } from "../../api/client";
import { TaskPlanningControls, TaskRewriteControls, WeekPlanBuilder } from "../../components/ContentStudioControls";
import { WeekCalendar, getTaskCalendarDate, localDay } from "../../components/WeekCalendar";
import { PostComposer } from "../../components/PostComposer";
import { PostEditor } from "../../components/PostEditor";
import { trackSeoEvent } from "../../components/SeoAnalytics";

const terminalStatuses: PostingTaskStatus[] = ["success", "partial_success", "failed", "cancelled"];
const THREADS_POST_CHAR_LIMIT = 500;
type PostFilter = "review" | "scheduled" | "published" | "actions" | "cancelled";
const filters: { id: PostFilter; label: string }[] = [
  { id: "review", label: "На проверке" }, { id: "scheduled", label: "Запланированы" },
  { id: "published", label: "Опубликованы" }, { id: "actions", label: "Нужны действия" },
];
function matchesFilter(task: PostingTask, filter: PostFilter) {
  if (task.generation_metadata?.publication_confirmation_pending) return filter === "actions";
  if (filter === "review") return task.status === "draft";
  if (filter === "scheduled") return task.status === "queued" || task.status === "running";
  if (filter === "published") return task.status === "success" || task.status === "partial_success";
  if (filter === "actions") return task.status === "failed";
  return task.status === "cancelled";
}
function queryFilter(value: string | null): PostFilter | null {
  if (value === "attention") return "actions";
  return value === "review" || value === "scheduled" || value === "published" || value === "actions" || value === "cancelled" ? value : null;
}

export default function ProjectQueuePage() {
  const { id } = useParams();
  const projectId = Number(id);
  const [search, setSearch] = useSearchParams();
  const [tasks, setTasks] = useState<PostingTask[]>([]);
  const [filter, setFilter] = useState<PostFilter>("review");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerDirty, setComposerDirty] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editorId, setEditorId] = useState<number | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorControlBusy, setEditorControlBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [accountStates, setAccountStates] = useState<ProjectAccountState[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const initialLoad = useRef(true);
  const previousTaskStates = useRef<string | null>(null);
  const createLock = useRef(false);
  const mutationLock = useRef(false);
  const activeProjectId = useRef(projectId);
  activeProjectId.current = projectId;

  async function loadTasks({ silent = false }: { silent?: boolean } = {}) {
    if (activeProjectId.current !== projectId) return null;
    const sequence = ++loadSequence.current;
    if (!silent) setIsLoading(true);
    setLoadError(null);
    try {
      const [items, dashboard] = await Promise.all([getProjectTasks(projectId), getProjectDashboard(projectId)]);
      if (sequence !== loadSequence.current || activeProjectId.current !== projectId) return null;
      setTasks(sortTasks(items)); setAccountStates(dashboard.account_states);
      const taskStates = items.map(task => `${task.id}:${task.status}:${Boolean(task.generation_metadata?.publication_confirmation_pending)}`).sort().join("|");
      if (previousTaskStates.current !== null && previousTaskStates.current !== taskStates) window.dispatchEvent(new Event("threadsgo:project-updated"));
      previousTaskStates.current = taskStates;
      if (initialLoad.current) {
        initialLoad.current = false;
        setFilter(queryFilter(search.get("filter")) || (items.some(task => matchesFilter(task, "scheduled")) ? "scheduled" : items.some(task => matchesFilter(task, "review")) ? "review" : items.some(task => matchesFilter(task, "actions")) ? "actions" : "published"));
      }
      return items;
    } catch (error) {
      if (sequence !== loadSequence.current) return null;
      const message = getApiErrorMessage(error, "Не удалось загрузить посты.");
      if (!silent || !tasks.length) setLoadError(message);
      if (!silent) toast.error(message);
      return null;
    } finally { if (sequence === loadSequence.current) setIsLoading(false); }
  }
  useEffect(() => {
    setTasks([]); setIsLoading(true); setSelectedDay(null); setComposerOpen(false); setComposerDirty(false); setEditorId(null);
    setEditorDirty(false); setEditorControlBusy(false); initialLoad.current = true; previousTaskStates.current = null;
    if (Number.isInteger(projectId) && projectId > 0) void loadTasks({ silent: true });
    else { setLoadError("Проект не найден"); setIsLoading(false); }
    return () => { loadSequence.current++; };
  }, [projectId]);
  useEffect(() => {
    const requestedFilter = queryFilter(search.get("filter"));
    if (requestedFilter) { setFilter(requestedFilter); setSelectedDay(null); }
  }, [search]);
  useEffect(() => {
    const compose = search.get("compose");
    if (compose === "ai" || compose === "own" || search.get("create") === "1") { setEditorId(null); setComposerOpen(true); return; }
    const taskId = Number(search.get("task"));
    if (taskId > 0 && tasks.some(task => task.id === taskId) && editorId !== taskId) { setEditorId(taskId); setEditorDirty(false); }
  }, [search, tasks]);
  useEffect(() => {
    if (!tasks.some(task => task.status === "running" || task.generation_metadata?.publication_confirmation_pending)) return;
    const timer = window.setInterval(() => void loadTasks({ silent: true }), 15000);
    return () => window.clearInterval(timer);
  }, [projectId, tasks.some(task => task.status === "running" || task.generation_metadata?.publication_confirmation_pending)]);

  function openEditor(taskId: number) {
    setEditorDirty(false); setEditorControlBusy(false); setEditorId(taskId);
    const next = new URLSearchParams(search); next.delete("compose"); next.delete("create"); next.set("task", String(taskId)); setSearch(next, { replace: true });
  }
  function closeComposer() {
    setComposerOpen(false); setComposerDirty(false);
    if (search.has("compose") || search.has("create")) { const next = new URLSearchParams(search); next.delete("compose"); next.delete("create"); setSearch(next, { replace: true }); }
  }
  function closeEditor() {
    setEditorId(null); setEditorDirty(false); setEditorControlBusy(false);
    if (search.has("task")) { const next = new URLSearchParams(search); next.delete("task"); setSearch(next, { replace: true }); }
  }
  async function createOwnPost(text: string) {
    if (!text || createLock.current) return false;
    createLock.current = true; setCreating(true);
    try {
      const created = await createManualTask(projectId, text);
      if (activeProjectId.current !== projectId) return true;
      setTasks(current => sortTasks([created, ...current])); setFilter("review"); setSelectedDay(null);
      window.dispatchEvent(new Event("threadsgo:project-updated"));
      setComposerOpen(false); openEditor(created.id); toast.success("Пост сохранён. Выберите аккаунт и время публикации."); return true;
    } catch (error) { toast.error(getApiErrorMessage(error, "Не удалось сохранить пост. Текст остался в редакторе.")); return false; }
    finally { createLock.current = false; setCreating(false); }
  }
  async function generatePost() {
    if (createLock.current) return;
    createLock.current = true; setCreating(true);
    try {
      const result = await triggerGeneration(projectId);
      if (activeProjectId.current !== projectId) return;
      window.dispatchEvent(new Event("threadsgo:project-updated"));
      const refreshed = await loadTasks({ silent: true }); setFilter("review"); setSelectedDay(null); closeComposer();
      if (!refreshed?.some(task => task.id === result.task_id)) {
        setLoadError("Текст подготовлен, но список постов не загрузился. Нажмите «Попробовать снова», чтобы открыть созданный пост."); return;
      }
      openEditor(result.task_id);
      trackSeoEvent("draft_generated", { project_id: projectId, task_id: result.task_id }); toast.success("Текст готов. Проверьте факты и выберите время.");
    } catch (error) { toast.error(getApiErrorMessage(error, "Не удалось подготовить текст. Попробуйте позже.")); }
    finally { createLock.current = false; setCreating(false); }
  }
  async function handleCancel(taskId: number) {
    if (mutationLock.current) return;
    mutationLock.current = true; setCancellingId(taskId);
    try { onTaskUpdated(await cancelTask(taskId)); toast.success("Публикация отменена"); }
    catch (error) { toast.error(getApiErrorMessage(error, "Не удалось отменить публикацию.")); }
    finally { mutationLock.current = false; setCancellingId(null); }
  }
  async function handlePublishNow(taskId: number) {
    const task = tasks.find(item => item.id === taskId);
    if (!task || task.generation_metadata?.publication_confirmation_pending || mutationLock.current) return;
    if (isTaskAccountSessionDead(task, accountStates)) { toast.error(getAccountBlockMessage(task, accountStates)); return; }
    mutationLock.current = true; setPublishingId(taskId);
    try { await publishTaskNow(taskId); trackSeoEvent("publication_requested", { project_id: projectId, task_id: taskId }); toast.success("Публикация запущена"); await loadTasks({ silent: true }); }
    catch (error) { toast.error(getApiErrorMessage(error, "Не удалось запустить публикацию.")); }
    finally { mutationLock.current = false; setPublishingId(null); }
  }
  async function handleSaveTask(taskId: number, content: string[], expected: string[]) {
    if (mutationLock.current) return false;
    mutationLock.current = true; setSavingId(taskId);
    try { const updated = await updateTask(taskId, content, expected); onTaskUpdated(updated); trackSeoEvent("draft_edited", { project_id: projectId, task_id: taskId }); toast.success("Текст сохранён. Перед публикацией выберите время."); return true; }
    catch (error) { toast.error(getApiErrorMessage(error, "Не удалось сохранить текст. Изменения остались в редакторе.")); return false; }
    finally { mutationLock.current = false; setSavingId(null); }
  }
  function onTaskUpdated(updated: PostingTask) {
    if (updated.project_id !== activeProjectId.current) return;
    setTasks(current => sortTasks(current.map(task => task.id === updated.id ? updated : task)));
    window.dispatchEvent(new Event("threadsgo:project-updated"));
    if (updated.id === editorId) {
      setSelectedDay(null);
      const nextFilter = filters.find(item => matchesFilter(updated, item.id));
      if (nextFilter) {
        setFilter(nextFilter.id);
        if (search.has("filter")) { const next = new URLSearchParams(search); next.set("filter", nextFilter.id); setSearch(next, { replace: true }); }
      }
    }
  }
  const filteredTasks = tasks.filter(task => matchesFilter(task, filter));
  const visibleTasks = filteredTasks.filter(task => view === "list" || !selectedDay || getTaskCalendarDate(task) && localDay(new Date(getTaskCalendarDate(task)!)) === selectedDay);
  const editedTask = tasks.find(task => task.id === editorId);
  const editorBusy = editorControlBusy || cancellingId !== null || publishingId !== null || savingId !== null;
  return <section className="workspace-page space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="font-display text-4xl">Посты</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--workspace-muted)]">Все тексты проекта: от первой идеи до публикации в Threads.</p></div>
      <button type="button" className="rounded-full bg-[var(--workspace-accent)] px-5 py-3 text-sm text-[var(--workspace-accent-ink)]" onClick={() => { setComposerDirty(false); setComposerOpen(true); }}>Создать пост</button></header>
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2" aria-label="Статусы постов">
      {filters.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} className={`rounded-full border border-[var(--workspace-border)] px-4 py-2 text-sm ${filter === item.id ? "bg-[var(--workspace-accent)] text-[var(--workspace-accent-ink)]" : "bg-[var(--workspace-panel)]"}`}
        onClick={() => { setFilter(item.id); setSelectedDay(null); }}>{item.label} · {tasks.filter(task => matchesFilter(task, item.id)).length}</button>)}</div>
      <div className="flex rounded-full border border-[var(--workspace-border)] p-1" aria-label="Вид постов">{(["list", "calendar"] as const).map(value => <button key={value} type="button" aria-pressed={view === value}
        className={`rounded-full px-3 py-2 text-sm ${view === value ? "bg-[var(--workspace-soft)]" : ""}`} onClick={() => { setView(value); setSelectedDay(null); }}>{value === "list" ? "Список" : "Календарь"}</button>)}</div></div>
    {view === "calendar" && !isLoading && !loadError && <><WeekCalendar tasks={filteredTasks} selected={selectedDay} onSelect={setSelectedDay} showDraftFilter={false} />
      {filteredTasks.some(task => !getTaskCalendarDate(task)) && <p className="text-xs text-[var(--workspace-muted)]">Посты без назначенной даты показаны ниже. Выберите время в редакторе, чтобы добавить их в календарь.</p>}</>}
    {isLoading ? <TaskSkeleton /> : loadError ? <EmptyState title="Посты пока не загрузились" description={loadError} actionLabel="Попробовать снова" onAction={() => void loadTasks()} /> :
      visibleTasks.length ? <div className="grid gap-3 xl:grid-cols-2">{visibleTasks.map(task => <button key={task.id} type="button" onClick={() => openEditor(task.id)}
        className="rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-panel)] p-5 text-left transition hover:border-[var(--workspace-accent)]">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--workspace-muted)]"><span>{task.generation_metadata?.publication_confirmation_pending ? "Проверяем результат отправки" : formatStatus(task.status)}</span><span>{task.account_username ? `@${task.account_username}` : "Аккаунт не выбран"}</span></div>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{truncate(task.content_text, 180)}</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--workspace-muted)]"><span>{formatDate(task.finished_at || task.scheduled_at)}</span><span>Открыть пост →</span></div></button>)}</div> :
      <EmptyState title={selectedDay ? "В этот день постов нет" : filter === "review" ? "Нет постов на проверке" : filter === "scheduled" ? "Нет запланированных постов" : filter === "published" ? "Публикаций пока нет" : filter === "actions" ? "Всё в порядке" : "Отменённых постов нет"}
        description={filter === "actions" ? "Если для публикации понадобится ваше действие, пост появится здесь." : "Создайте текст с ИИ или напишите свой. Затем откройте пост и выберите время публикации."}
        actionLabel={filter === "actions" || selectedDay ? undefined : "Создать пост"} onAction={() => setComposerOpen(true)} />}
    <details className="rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-panel)] p-4"><summary className="cursor-pointer text-sm">Подготовить несколько постов</summary>
      <div className="mt-4"><WeekPlanBuilder key={projectId} projectId={projectId} onCreated={() => { setFilter("review"); setSelectedDay(null); void loadTasks({ silent: true }); }} /></div></details>
    {tasks.some(task => task.status === "cancelled") && <button type="button" className="text-xs text-[var(--workspace-muted)] underline" onClick={() => { setFilter("cancelled"); setSelectedDay(null); }}>Отменённые посты · {tasks.filter(task => matchesFilter(task, "cancelled")).length}</button>}
    {composerOpen && <PostEditor title="Создать пост" busy={creating} hasUnsaved={composerDirty} onClose={closeComposer}><PostComposer busy={creating} onGenerate={generatePost} onSave={createOwnPost} onDirtyChange={setComposerDirty} initialMode={search.get("compose") === "own" ? "own" : "ai"} /></PostEditor>}
    {editedTask && <PostEditor title={`Пост #${editedTask.id}`} busy={editorBusy} hasUnsaved={editorDirty} onClose={closeEditor}><TaskCard key={editedTask.id} task={editedTask} accounts={accountStates} onUpdated={onTaskUpdated}
      isCancelling={cancellingId === editedTask.id} isPublishing={publishingId === editedTask.id} isSaving={savingId === editedTask.id}
      isSessionDead={isTaskAccountSessionDead(editedTask, accountStates)} accountBlockMessage={getAccountBlockMessage(editedTask, accountStates)}
      onDirtyChange={setEditorDirty} onBusyChange={setEditorControlBusy} onCancel={() => void handleCancel(editedTask.id)} onPublishNow={() => void handlePublishNow(editedTask.id)} onSave={(content, expected) => handleSaveTask(editedTask.id, content, expected)} /></PostEditor>}
  </section>;
}

function TaskCard({
  task,
  accounts,
  onUpdated,
  isCancelling,
  isPublishing,
  isSaving,
  isSessionDead,
  accountBlockMessage,
  onCancel,
  onPublishNow,
  onSave,
  onDirtyChange,
  onBusyChange,
}: {
  task: PostingTask;
  accounts: ProjectAccountState[];
  onUpdated: (task: PostingTask) => void;
  isCancelling: boolean;
  isPublishing: boolean;
  isSaving: boolean;
  isSessionDead: boolean;
  accountBlockMessage: string;
  onCancel: () => void;
  onPublishNow: () => void;
  onSave: (contentText: string[], expectedPostsChain: string[]) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftParts, setDraftParts] = useState(task.posts_chain.length > 0 ? task.posts_chain : [task.content_text]);
  const editSource = useRef(task.posts_chain.length ? [...task.posts_chain] : [task.content_text]);
  const [controlBusy, setControlBusy] = useState<"rewrite" | "planning" | "history" | null>(null);
  const externalBusy = isCancelling || isPublishing || isSaving;
  const isBusy = externalBusy || controlBusy !== null;
  const canChange = task.status !== "running" && task.status !== "success" && task.status !== "partial_success"
    && !task.generation_metadata?.publication_confirmation_pending;
  const canEdit = canChange;
  const dirty = isEditing && JSON.stringify(draftParts) !== JSON.stringify(editSource.current);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(controlBusy !== null); }, [controlBusy, onBusyChange]);

  useEffect(() => {
    if (!isEditing) {
      setDraftParts(task.posts_chain.length > 0 ? task.posts_chain : [task.content_text]);
      editSource.current = task.posts_chain.length ? [...task.posts_chain] : [task.content_text];
    }
  }, [task.content_text, task.posts_chain, isEditing]);

  function handleCancelEdit() {
    setDraftParts(task.posts_chain.length > 0 ? task.posts_chain : [task.content_text]);
    setIsEditing(false);
  }

  async function handleSaveEdit() {
    const normalizedText = draftParts.map((part) => part.trim());
    if (normalizedText.some((part) => !part)) {
      toast.error("Каждый пост цепочки должен содержать текст");
      return;
    }
    if (normalizedText.some((part) => part.length > THREADS_POST_CHAR_LIMIT)) {
      toast.error(`Сократите каждый пост до ${THREADS_POST_CHAR_LIMIT} символов`);
      return;
    }

    if (await onSave(normalizedText, editSource.current)) setIsEditing(false);
  }

  return (
    <article className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e7e5de] pb-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77766f]">Публикация #{task.id}</p>
          <div className="mt-3 flex items-center gap-2 text-xs text-[#333]">
            <StatusDot status={task.status} />
            {task.generation_metadata?.publication_confirmation_pending ? "Результат отправки пока неизвестен" : formatStatus(task.status)}
          </div>
          {task.account_username ? (
            <div className="mt-3 inline-flex rounded-2xl border border-[#d8d8d2] bg-[#fbfaf5] px-3 py-1.5 text-xs text-[#55534c]">
              @{task.account_username}
            </div>
          ) : null}
        </div>
        <div className="rounded-2xl border border-[#d8d8d2] px-3 py-2 text-right">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#77766f]">{getScheduleLabel(task.status)}</p>
          <p className="mt-1 text-sm text-[#24231f]">{formatDate(task.finished_at || task.scheduled_at)}</p>
        </div>
      </div>

      {isEditing ? (
        <div className="mt-5">
          <div className="grid gap-4">
            {draftParts.map((part, index) => (
              <label key={index} className="grid gap-2">
                <span className="text-xs font-medium text-[#55534c]">{draftParts.length > 1 ? `Пост ${index + 1} из ${draftParts.length}` : "Текст поста"}</span>
                <textarea disabled={isBusy} value={part} onChange={(event) => setDraftParts((current) => current.map((text, partIndex) => partIndex === index ? event.target.value : text))}
                  rows={draftParts.length > 1 ? 5 : 8}
                  className="w-full resize-y rounded-2xl border border-[#d8d8d2] bg-[#fbfaf5] p-4 text-sm leading-6 text-[#252525] outline-none transition-all duration-200 ease-in-out focus:border-[#151515]" />
                <span className={part.trim().length > THREADS_POST_CHAR_LIMIT ? "text-xs font-semibold text-[#b42318]" : "text-xs text-[#77766f]"}>
                  {part.trim().length}/{THREADS_POST_CHAR_LIMIT} символов
                </span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton variant="dark" onClick={handleSaveEdit} disabled={isBusy || draftParts.some((part) => !part.trim() || part.trim().length > THREADS_POST_CHAR_LIMIT)} isLoading={isSaving}>
              {task.status === "draft" ? "Сохранить черновик" : "Сохранить"}
            </ActionButton>
            <ActionButton onClick={handleCancelEdit} disabled={isBusy} isLoading={false}>
              Отмена
            </ActionButton>
          </div>
        </div>
      ) : (
        <p className="mt-4 w-full break-words whitespace-pre-line text-sm leading-6 text-[#252525]">
          {task.posts_chain.length > 1 ? task.posts_chain.map((text, index) => `${index + 1}. ${text}`).join("\n\n") : task.content_text}
        </p>
      )}

      {!isEditing && task.generation_metadata?.applied_angle ? <details className="mt-4"><summary className="cursor-pointer text-xs text-[#77766f]">Как ИИ написал этот текст</summary><GenerationMetadataBlock task={task} /></details> : null}

      {task.status === "draft" ? (
        <p className="mt-4 text-xs leading-5 text-[#77766f]">Это черновик: сохранение текста не запускает публикацию. Проверьте факты, затем выберите профиль и время кнопкой «Запланировать публикацию».</p>
      ) : null}
      {task.posts_chain.length > 1 && task.status === "queued" ? (
        <p className="mt-4 text-xs leading-5 text-[#77766f]">Цепочка из {task.posts_chain.length} постов. Кнопка «Редактировать» позволяет изменить отдельные части.</p>
      ) : null}

      {task.generation_metadata?.publication_confirmation_pending ? <div role="status" className="rounded-2xl border border-[var(--workspace-warning-border)] bg-[var(--workspace-warning-bg)] p-4 text-sm leading-6 text-[var(--workspace-warning-ink)]">
        Связь оборвалась во время отправки. Проверяем, появился ли пост в Threads. Повторная публикация недоступна, чтобы не создать дубль.
        <p className="mt-2">Если проверка долго не завершается, обратитесь в поддержку. Текст сохранён.</p>
      </div> : null}
      {task.error_message && !task.generation_metadata?.publication_confirmation_pending ? (
        <div className="mt-5 rounded-2xl border border-[#e0b4ae] bg-[#fff8f6] px-4 py-3 text-xs leading-5 text-[#8a2d25]">
          <p className="font-medium">Публикация не прошла, но текст сохранён.</p>
          <p className="mt-1 text-[#8a4a44]">Проверьте подключение Threads. Если оно работает, обратитесь в поддержку.</p>
          <Link className="mt-2 inline-block underline" to={`/app/projects/${task.project_id}/settings#profiles`}>Проверить подключение</Link>
          <details className="mt-2">
            <summary className="cursor-pointer text-[#7a625f]">Техническая информация для поддержки</summary>
            <p className="mt-2 break-words text-[#7a625f]">{truncate(task.error_message, 500)}</p>
          </details>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {task.status === "queued" && canChange ? (
          <>
            <ActionButton
              variant="dark"
              onClick={onPublishNow}
              disabled={isBusy || isEditing || isSessionDead}
              isLoading={isPublishing}
              title={isSessionDead ? accountBlockMessage : undefined}
            >
              Опубликовать сейчас
            </ActionButton>
            <ActionButton onClick={() => { editSource.current = task.posts_chain.length ? [...task.posts_chain] : [task.content_text]; setIsEditing(true); }} disabled={isBusy || isEditing || !canEdit} isLoading={false}>
              Редактировать
            </ActionButton>
            <ActionButton onClick={onCancel} disabled={isBusy || isEditing} isLoading={isCancelling}>
              Отменить
            </ActionButton>
          </>
        ) : task.status === "draft" && canChange ? (
          <>
            <ActionButton onClick={() => { editSource.current = task.posts_chain.length ? [...task.posts_chain] : [task.content_text]; setIsEditing(true); }} disabled={isBusy || isEditing || !canEdit} isLoading={false}>
              Редактировать черновик
            </ActionButton>

          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs leading-5 text-[#77766f]">{getClosedTaskHint(task.status)}</span>
            {task.external_post_url ? (
              <a
                href={task.external_post_url}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-[#151515] px-4 py-2 text-xs text-[#151515] transition hover:bg-[#151515] hover:text-white"
              >
                Открыть в Threads
              </a>
            ) : null}
          </div>
        )}
      </div>
      {canChange && (task.status === "draft" || task.status === "queued") && <>
        <div hidden={isEditing}><TaskRewriteControls task={task} onUpdated={onUpdated} disabled={externalBusy || isEditing || controlBusy !== null && controlBusy !== "rewrite"} onBusyChange={busy => setControlBusy(busy ? "rewrite" : null)} />
        <TaskPlanningControls task={task} accounts={accounts} onUpdated={onUpdated} disabled={externalBusy || isEditing || controlBusy !== null && controlBusy !== "planning"} onBusyChange={busy => setControlBusy(busy ? "planning" : null)} /></div>
      </>}
      <TaskRevisionHistory task={task} onUpdated={onUpdated} canRestore={canChange} disabled={externalBusy || isEditing || controlBusy !== null}
        onBusyChange={busy => setControlBusy(busy ? "history" : null)} />
      {task.generation_metadata?.rubric && <p className="mt-3 text-xs text-[#67786e]">Рубрика: {String(task.generation_metadata.rubric)}</p>}
    </article>
  );
}

type TaskRevision = { id: number; task_id: number; posts_chain: string[]; reason: string; created_at: string };
function TaskRevisionHistory({ task, onUpdated, canRestore, disabled, onBusyChange }: {
  task: PostingTask; onUpdated: (task: PostingTask) => void; canRestore: boolean; disabled: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<TaskRevision[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const actionLock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError(null);
    void apiClient.get<TaskRevision[]>(`/api/v1/tasks/${task.id}/revisions`).then(response => {
      if (active) setItems(response.data);
    }).catch(failure => { if (active) setError(getApiErrorMessage(failure, "Не удалось загрузить историю текста.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, task.id, task.updated_at, reload]);
  async function restore(revision: TaskRevision) {
    if (actionLock.current || disabled || !canRestore) return;
    actionLock.current = true; setRestoring(revision.id); onBusyChange(true);
    try {
      const response = await apiClient.post<PostingTask>(`/api/v1/tasks/${task.id}/revisions/${revision.id}/restore`, {
        expected_posts_chain: task.posts_chain.length ? task.posts_chain : [task.content_text],
      });
      if (!alive.current) return;
      onUpdated(response.data); setReload(value => value + 1); toast.success("Версия восстановлена. Пост сохранён на проверку.");
    } catch (failure) { if (alive.current) toast.error(getApiErrorMessage(failure, "Не удалось восстановить версию. Обновите пост и попробуйте снова.")); }
    finally { actionLock.current = false; if (alive.current) { setRestoring(null); onBusyChange(false); } }
  }
  const reasons: Record<string, string> = { created: "Первая версия", initial: "Первая версия", generated: "Текст ИИ", edited: "Правка текста", edit: "Правка текста", rewrite: "Правка ИИ", restored: "Восстановление", restore: "Восстановление", manual: "Ваш текст", regenerate: "Новый вариант ИИ", baseline: "Сохранённая версия" };
  return <section className="mt-5 border-t border-[var(--workspace-border)] pt-4">
    <button type="button" className="text-sm underline" aria-expanded={open} onClick={() => setOpen(value => !value)}>История текста</button>
    {open && <div className="mt-3 space-y-3">
      <p className="text-xs leading-5 text-[var(--workspace-muted)]">Версии сохраняются в сервисе. Восстановленный текст возвращается на проверку: время публикации нужно выбрать снова.</p>
      {loading ? <p className="text-sm">Загружаем версии…</p> : error ? <div className="text-sm"><p role="alert">{error}</p><button type="button" className="mt-2 underline" onClick={() => setReload(value => value + 1)}>Попробовать снова</button></div> :
        !items.length ? <p className="text-sm text-[var(--workspace-muted)]">История появится после первого сохранения или изменения текста.</p> : items.map(revision => {
          const isCurrent = JSON.stringify(revision.posts_chain) === JSON.stringify(task.posts_chain.length ? task.posts_chain : [task.content_text]);
          return <details key={revision.id} className="rounded-xl border border-[var(--workspace-border)] p-3">
            <summary className="cursor-pointer text-sm">{formatDate(revision.created_at)} · {reasons[revision.reason] || "Сохранение текста"}{isCurrent ? " · текущий текст" : ""}</summary>
            <div className="mt-3 space-y-3">{revision.posts_chain.map((text, index) => <p key={index} className="whitespace-pre-wrap break-words text-sm leading-6">{text}</p>)}
              {canRestore && (!isCurrent || task.status !== "draft") && <button type="button" className="rounded-full border px-3 py-2 text-xs disabled:opacity-50" disabled={disabled || restoring !== null} onClick={() => void restore(revision)}>
                {restoring === revision.id ? "Восстанавливаем…" : isCurrent ? "Вернуть текст на проверку" : "Восстановить эту версию"}</button>}
            </div></details>;
        })}
    </div>}
  </section>;
}

function GenerationMetadataBlock({ task }: { task: PostingTask }) {
  const metadata = task.generation_metadata;

  if (!metadata) {
    return <div className="mt-5 rounded-2xl border border-[#e1e1dc] bg-[#fbfaf5] p-4 text-xs leading-5 text-[#77766f]">Пояснение еще не сохранено</div>;
  }

  return (
    <div className="mt-5 grid gap-3 rounded-2xl border border-[#e1e1dc] bg-[#fbfaf5] p-4 text-xs leading-5 text-[#55534c]">
      <MetadataLine label="Почему так написано" value={metadata.applied_angle} />
      <MetadataLine label="Что должно зацепить" value={metadata.hook_mechanic} />
      <MetadataLine label="Как устроен пост" value={metadata.structure_pattern} />
      <MetadataLine label="Тон и ритм" value={metadata.tone_and_rhythm} />
    </div>
  );
}

function MetadataLine({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#8d8b84]">{label}</div>
      <div className="mt-1 text-[#333]">{value || "Пояснение еще не сохранено"}</div>
    </div>
  );
}

function ActionButton({
  children,
  disabled,
  isLoading,
  onClick,
  variant = "light",
  title,
}: {
  children: string;
  disabled: boolean;
  isLoading: boolean;
  onClick: () => void;
  variant?: "light" | "dark";
  title?: string;
}) {
  const className =
    variant === "dark"
      ? "border-[#151515] bg-[#151515] text-white hover:bg-transparent hover:text-[#151515]"
      : "border-[#151515] bg-transparent text-[#151515] hover:bg-[#151515] hover:text-white";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center gap-2 rounded-2xl border px-4 py-2 text-xs transition-all duration-200 ease-in-out disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {isLoading ? <Spinner /> : null}
      {children}
    </button>
  );
}

function StatusDot({ status }: { status: PostingTaskStatus }) {
  const color =
    status === "failed"
      ? "bg-[#b42318]"
      : status === "success"
        ? "bg-[#6f7564]"
        : status === "partial_success"
          ? "bg-[#d88a35]"
          : status === "running"
            ? "bg-[#151515]"
            : status === "cancelled"
              ? "bg-[#c9c9c3]"
              : "bg-transparent border border-[#151515]";

  return <span className={`h-2 w-2 rounded-full ${color}`} />;
}

function TaskSkeleton() {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {[1, 2, 3, 4].map((item) => (
        <div key={item} className="h-56 animate-pulse rounded-[24px] border border-[#deded7] bg-white p-5 shadow-sm">
          <div className="h-3 w-24 rounded-full bg-[#deded7]" />
          <div className="mt-8 h-4 w-full rounded-full bg-[#deded7]" />
          <div className="mt-3 h-4 w-2/3 rounded-full bg-[#deded7]" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-dashed border-[#c9c9c3] bg-white/70 shadow-sm">
      <div className="grid items-center gap-5 p-5 text-center sm:p-6 lg:grid-cols-[1fr_20rem] lg:text-left">
        <div>
          <p className="font-display text-3xl leading-none text-[#151515]">{title}</p>
          <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-[#66645d] lg:mx-0">{description}</p>
          {actionLabel && onAction ? (
            <button type="button" onClick={onAction} className="mt-5 h-11 rounded-full bg-[#151515] px-5 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e]">
              {actionLabel}
            </button>
          ) : null}
        </div>
        <img src="/interface/empty-queue.webp" alt="" className="hidden w-full rounded-[2rem] object-cover lg:block" />
      </div>
    </div>
  );
}

function Spinner() {
  return <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />;
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trim()}...`;
}

function sortTasks(tasks: PostingTask[]) {
  return [...tasks].sort((first, second) => {
    const firstTerminal = terminalStatuses.includes(first.status) ? 1 : 0;
    const secondTerminal = terminalStatuses.includes(second.status) ? 1 : 0;
    if (firstTerminal !== secondTerminal) {
      return firstTerminal - secondTerminal;
    }
    return new Date(first.scheduled_at || 0).getTime() - new Date(second.scheduled_at || 0).getTime();
  });
}

function formatStatus(status: PostingTaskStatus) {
  const labels: Record<PostingTaskStatus, string> = {
    draft: "черновик",
    queued: "ждет своей очереди",
    running: "публикуется",
    success: "опубликован",
    partial_success: "частично опубликован",
    failed: "не опубликован",
    cancelled: "отменено",
  };

  return labels[status] ?? status;
}

function formatDate(value: string | null) {
  if (!value) {
    return "не запланировано";
  }

  const date = new Date(value);
  const day = date.toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const time = date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `в ${time} ${day}`;
}

function isTaskAccountSessionDead(task: PostingTask, accountStates: ProjectAccountState[]) {
  if (task.account_id === null) {
    return true;
  }

  const account = accountStates.find((item) => item.id === task.account_id);
  return !account || account.ready_for_ideas !== true;
}

function getScheduleLabel(status: PostingTaskStatus) {
  if (status === "draft") return "Черновик";
  if (status === "success" || status === "partial_success") {
    return "Опубликован";
  }
  if (status === "failed" || status === "cancelled") {
    return "Был запланирован";
  }
  return "Выйдет";
}

function getClosedTaskHint(status: PostingTaskStatus) {
  const hints: Partial<Record<PostingTaskStatus, string>> = {
    success: "Публикация завершена",
    partial_success: "Опубликована часть цепочки; остальной текст сохранён",
    failed: "Текст сохранён — проблему можно исправить без потери черновика",
    cancelled: "Убрано из расписания",
  };
  return hints[status] || "Система завершает действие";
}

function getAccountBlockMessage(task: PostingTask, accountStates: ProjectAccountState[]) {
  const account = accountStates.find((item) => item.id === task.account_id);
  if (account?.status === "proxy_error") {
    return "Публикация на паузе: прокси временно не отвечает. Система сама перепроверит порт.";
  }

  return "Публикация недоступна: выберите рабочий аккаунт Threads или восстановите подключение в настройках проекта.";
}
