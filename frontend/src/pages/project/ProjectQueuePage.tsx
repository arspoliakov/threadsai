import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import {
  cancelTask,
  getApiErrorMessage,
  getProjectDashboard,
  getProjectTasks,
  publishTaskNow,
  updateTask,
  type PostingTask,
  type PostingTaskStatus,
  type ProjectAccountState,
} from "../../api/client";
import { TaskPlanningControls, TaskRewriteControls, WeekPlanBuilder } from "../../components/ContentStudioControls";
import { WeekCalendar, localDay } from "../../components/WeekCalendar";
import { DismissibleTip } from "../../components/DismissibleTip";
import { trackSeoEvent } from "../../components/SeoAnalytics";

const terminalStatuses: PostingTaskStatus[] = ["success", "partial_success", "failed", "cancelled"];
const THREADS_POST_CHAR_LIMIT = 500;

export default function ProjectQueuePage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const projectId = Number(id);
  const [tasks, setTasks] = useState<PostingTask[]>([]);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [accountStates, setAccountStates] = useState<ProjectAccountState[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const activeProjectId = useRef(projectId);
  activeProjectId.current = projectId;

  async function loadTasks({ silent = false }: { silent?: boolean } = {}) {
    if (activeProjectId.current !== projectId) return;
    const sequence = ++loadSequence.current;
    if (!silent) setIsLoading(true);
    setLoadError(null);

    try {
      const [tasksResult, dashboardResult] = await Promise.all([
        getProjectTasks(projectId),
        getProjectDashboard(projectId),
      ]);
      if (sequence !== loadSequence.current) return;
      setTasks(sortTasks(tasksResult));
      setAccountStates(dashboardResult.account_states);
      if (!silent) {
        toast.success("Расписание постов обновлено");
      }
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      const message = getApiErrorMessage(error, "Не удалось загрузить расписание постов.");
      if (!silent || !tasks.length) setLoadError(message);
      toast.error(message);
    } finally {
      if (sequence === loadSequence.current) setIsLoading(false);
    }
  }

  useEffect(() => {
    setIsLoading(true);
    setSelectedDay(null);
    setExpandedTaskIds(new Set());
    if (Number.isInteger(projectId) && projectId > 0) {
      void loadTasks({ silent: true });
    } else {
      setLoadError("Проект не найден"); setIsLoading(false);
    }
    return () => { loadSequence.current++; };
  }, [projectId]);

  function toggleExpanded(taskId: number) {
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }

  async function handleCancel(taskId: number) {
    setCancellingId(taskId);

    try {
      const action = cancelTask(taskId);
      toast.promise(action, {
        loading: "Отменяем публикацию...",
        success: "Публикация отменена",
        error: (error) => getApiErrorMessage(error, "Не удалось отменить публикацию."),
      });
      await action;
      await loadTasks({ silent: true });
    } catch {
      // The promise toast displays the error; leave the current state available for retry.
    } finally {
      setCancellingId(null);
    }
  }

  async function handlePublishNow(taskId: number) {
    const task = tasks.find((item) => item.id === taskId);
    if (task && isTaskAccountSessionDead(task, accountStates)) {
      toast.error(getAccountBlockMessage(task, accountStates));
      return;
    }

    setPublishingId(taskId);

    try {
      const action = publishTaskNow(taskId);
      toast.promise(action, {
        loading: "Запускаем публикацию...",
        success: "Публикация запущена",
        error: (error) => getApiErrorMessage(error, "Не удалось запустить публикацию сейчас."),
      });
      await action;
      trackSeoEvent("publication_requested", { project_id: projectId, task_id: taskId });
      await loadTasks({ silent: true });
    } catch {
      // The promise toast displays the error; leave the current state available for retry.
    } finally {
      setPublishingId(null);
    }
  }

  async function handleSaveTask(taskId: number, contentText: string[], expectedPostsChain: string[]) {
    setSavingId(taskId);

    try {
      const updatePromise = updateTask(taskId, contentText, expectedPostsChain);
      toast.promise(updatePromise, {
        loading: "Сохраняем текст...",
        success: "Текст сохранён. Для публикации согласуйте время.",
        error: (error) => getApiErrorMessage(error, "Не удалось сохранить текст."),
      });
      const updatedTask = await updatePromise;
      trackSeoEvent("draft_edited", { project_id: projectId, task_id: taskId });
      onTaskUpdated(updatedTask);
      return true;
    } catch {
      // Keep the editor and its text open when saving fails.
      return false;
    } finally {
      setSavingId(null);
    }
  }

  function onTaskUpdated(updated: PostingTask) {
    if (updated.project_id !== activeProjectId.current) return;
    setTasks(current => sortTasks(current.map(task => task.id === updated.id ? updated : task)));
    if (selectedDay && selectedDay !== "drafts" && updated.status === "draft") setSelectedDay("drafts");
    if (selectedDay === "drafts" && updated.status === "queued" && updated.scheduled_at) setSelectedDay(localDay(new Date(updated.scheduled_at)));
  }
  const visibleTasks = tasks.filter(task => !selectedDay || (selectedDay === "drafts" ? task.status === "draft" : task.status !== "draft" && task.status !== "cancelled" && task.scheduled_at && localDay(new Date(task.scheduled_at)) === selectedDay));

  return (
    <section className="space-y-5">
      <header>
        <h1 className="font-display text-4xl leading-none">Черновики и календарь</h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-[#66645d]">
          Здесь собраны посты, которые выйдут в ближайшее время. Можно посмотреть текст, профиль и время выхода,
          отредактировать текст или улучшить его с ИИ. После изменения запланированного текста нужно снова согласовать время.
        </p>
      </header>

      <DismissibleTip storageKey="threadsgo.queue-tip" title="Это план будущих публикаций">
        Сначала смотрите ближайшие посты. Ошибки и отмененные публикации уходят вниз списка, чтобы не мешать
        проверять то, что еще должно выйти.
      </DismissibleTip>

      <WeekPlanBuilder key={projectId} projectId={projectId} onCreated={() => { void loadTasks({ silent: true }); }} />
      {!isLoading && !loadError && <WeekCalendar tasks={tasks} selected={selectedDay} onSelect={setSelectedDay} />}
      {!isLoading && !loadError && tasks.length > 0 && visibleTasks.length === 0 && <p className="rounded-2xl border p-5 text-sm">На выбранный день постов нет. Выберите черновик и назначьте время.</p>}
      {isLoading ? (
        <TaskSkeleton />
      ) : loadError ? (
        <EmptyState
          title="Расписание пока не загрузилось"
          description={loadError}
          actionLabel="Попробовать снова"
          onAction={() => void loadTasks({ silent: true })}
        />
      ) : tasks.length === 0 ? (
        <EmptyState
          title="Публикаций пока нет"
          description="Создайте первый черновик на обзоре проекта или составьте план недели здесь. После проверки текста выберите профиль и время публикации."
          actionLabel="К следующему шагу"
          onAction={() => navigate(`/app/projects/${projectId}`)}
        />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {visibleTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              accounts={accountStates}
              onUpdated={onTaskUpdated}
              isExpanded={expandedTaskIds.has(task.id)}
              isCancelling={cancellingId === task.id}
              isPublishing={publishingId === task.id}
              isSaving={savingId === task.id}
              isSessionDead={isTaskAccountSessionDead(task, accountStates)}
              accountBlockMessage={getAccountBlockMessage(task, accountStates)}
              onToggle={() => toggleExpanded(task.id)}
              onCancel={() => void handleCancel(task.id)}
              onPublishNow={() => void handlePublishNow(task.id)}
              onSave={(contentText, expected) => handleSaveTask(task.id, contentText, expected)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TaskCard({
  task,
  accounts,
  onUpdated,
  isExpanded,
  isCancelling,
  isPublishing,
  isSaving,
  isSessionDead,
  accountBlockMessage,
  onToggle,
  onCancel,
  onPublishNow,
  onSave,
}: {
  task: PostingTask;
  accounts: ProjectAccountState[];
  onUpdated: (task: PostingTask) => void;
  isExpanded: boolean;
  isCancelling: boolean;
  isPublishing: boolean;
  isSaving: boolean;
  isSessionDead: boolean;
  accountBlockMessage: string;
  onToggle: () => void;
  onCancel: () => void;
  onPublishNow: () => void;
  onSave: (contentText: string[], expectedPostsChain: string[]) => Promise<boolean>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftParts, setDraftParts] = useState(task.posts_chain.length > 0 ? task.posts_chain : [task.content_text]);
  const editSource = useRef(task.posts_chain.length ? [...task.posts_chain] : [task.content_text]);
  const [controlBusy, setControlBusy] = useState<"rewrite" | "planning" | null>(null);
  const externalBusy = isCancelling || isPublishing || isSaving;
  const isBusy = externalBusy || controlBusy !== null;
  const canChange = task.status !== "running" && task.status !== "success" && task.status !== "partial_success"
    && !task.generation_metadata?.publication_confirmation_pending;
  const canEdit = canChange;

  useEffect(() => {
    if (!isEditing) setDraftParts(task.posts_chain.length > 0 ? task.posts_chain : [task.content_text]);
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
    <article className={`rounded-[24px] border border-[#deded7] bg-white p-5 shadow-sm transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:shadow-md`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e7e5de] pb-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77766f]">Публикация #{task.id}</p>
          <div className="mt-3 flex items-center gap-2 text-xs text-[#333]">
            <StatusDot status={task.status} />
            {formatStatus(task.status)}
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
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          className="mt-4 w-full break-words whitespace-pre-line text-left text-sm leading-6 text-[#252525] transition-all duration-200 ease-in-out hover:text-[#000]"
        >
          {isExpanded ? (task.posts_chain.length > 1 ? task.posts_chain.map((text, index) => `${index + 1}. ${text}`).join("\n\n") : task.content_text) : truncate(task.content_text, 240)}
        </button>
      )}

      {isExpanded && !isEditing ? <GenerationMetadataBlock task={task} /> : null}

      {task.status === "draft" ? (
        <p className="mt-4 text-xs leading-5 text-[#77766f]">Это черновик: сохранение текста не запускает публикацию. Проверьте факты, затем выберите профиль и время кнопкой «Согласовать и запланировать».</p>
      ) : null}
      {task.posts_chain.length > 1 && task.status === "queued" ? (
        <p className="mt-4 text-xs leading-5 text-[#77766f]">Цепочка из {task.posts_chain.length} постов. Нажмите на текст, чтобы увидеть её целиком, или «Редактировать», чтобы изменить отдельные части.</p>
      ) : null}

      {task.error_message ? (
        <div className="mt-5 rounded-2xl border border-[#e0b4ae] bg-[#fff8f6] px-4 py-3 text-xs leading-5 text-[#8a2d25]">
          <p className="font-medium">Публикация не прошла, но текст сохранён.</p>
          <p className="mt-1 text-[#8a4a44]">Проверьте состояние профиля в настройках проекта и обратитесь в поддержку.</p>
          <details className="mt-2">
            <summary className="cursor-pointer text-[#7a625f]">Техническая информация для поддержки</summary>
            <p className="mt-2 break-words text-[#7a625f]">{truncate(task.error_message, 500)}</p>
          </details>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {task.status === "queued" ? (
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
        ) : task.status === "draft" ? (
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
        <div hidden={isEditing}><TaskRewriteControls task={task} onUpdated={onUpdated} disabled={externalBusy || isEditing || controlBusy === "planning"} onBusyChange={busy => setControlBusy(busy ? "rewrite" : null)} />
        <TaskPlanningControls task={task} accounts={accounts} onUpdated={onUpdated} disabled={externalBusy || isEditing || controlBusy === "rewrite"} onBusyChange={busy => setControlBusy(busy ? "planning" : null)} /></div>
      </>}
      {task.generation_metadata?.rubric && <p className="mt-3 text-xs text-[#67786e]">Рубрика: {String(task.generation_metadata.rubric)}</p>}
    </article>
  );
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
    return false;
  }

  const account = accountStates.find((item) => item.id === task.account_id);
  return account?.status === "cookies_expired" || account?.status === "blocked" || account?.status === "error" || account?.status === "proxy_error";
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

  return "Публикация недоступна: доступ к профилю Threads истек или профиль заблокирован.";
}
