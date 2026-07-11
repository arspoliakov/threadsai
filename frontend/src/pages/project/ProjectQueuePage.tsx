import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

import {
  cancelTask,
  getProjectDashboard,
  getProjectTasks,
  publishTaskNow,
  regenerateTask,
  updateTask,
  type PostingTask,
  type PostingTaskStatus,
  type ProjectAccountState,
} from "../../api/client";
import { DismissibleTip } from "../../components/DismissibleTip";
import { trackSeoEvent } from "../../components/SeoAnalytics";

const terminalStatuses: PostingTaskStatus[] = ["success", "partial_success", "failed", "cancelled"];

export default function ProjectQueuePage() {
  const { id } = useParams();
  const projectId = Number(id);
  const [tasks, setTasks] = useState<PostingTask[]>([]);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [accountStates, setAccountStates] = useState<ProjectAccountState[]>([]);

  async function loadTasks({ silent = false }: { silent?: boolean } = {}) {
    setIsLoading(true);

    try {
      const [tasksResult, dashboardResult] = await Promise.all([
        getProjectTasks(projectId),
        getProjectDashboard(projectId),
      ]);
      setTasks(sortTasks(tasksResult));
      setAccountStates(dashboardResult.account_states);
      if (!silent) {
        toast.success("Расписание постов обновлено");
      }
    } catch {
      toast.error("Не удалось загрузить расписание постов");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (Number.isFinite(projectId)) {
      void loadTasks({ silent: true });
    }
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
      await toast.promise(cancelTask(taskId), {
        loading: "Отменяем публикацию...",
        success: "Публикация отменена",
        error: "Не удалось отменить публикацию",
      });
      await loadTasks({ silent: true });
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
      await toast.promise(publishTaskNow(taskId), {
        loading: "Запускаем публикацию...",
        success: "Публикация запущена",
        error: "Не удалось запустить публикацию сейчас",
      });
      trackSeoEvent("publication_requested", { project_id: projectId, task_id: taskId });
      await loadTasks({ silent: true });
    } finally {
      setPublishingId(null);
    }
  }

  async function handleSaveTask(taskId: number, contentText: string) {
    setSavingId(taskId);

    try {
      const updatePromise = updateTask(taskId, contentText);
      toast.promise(updatePromise, {
        loading: "Сохраняем текст...",
        success: "Текст публикации сохранен",
        error: "Не удалось сохранить текст",
      });
      const updatedTask = await updatePromise;
      trackSeoEvent("draft_approved", { project_id: projectId, task_id: taskId });
      setTasks((current) => sortTasks(current.map((task) => (task.id === taskId ? updatedTask : task))));
    } finally {
      setSavingId(null);
    }
  }

  async function handleRegenerateTask(taskId: number) {
    setRegeneratingId(taskId);

    try {
      const regeneratePromise = regenerateTask(taskId);
      toast.promise(regeneratePromise, {
        loading: "Переписываем пост...",
        success: "Пост переписан",
        error: "Не удалось переписать пост",
      });
      const regeneratedTask = await regeneratePromise;
      trackSeoEvent("draft_regenerated", { project_id: projectId, task_id: taskId });
      setTasks((current) => sortTasks(current.map((task) => (task.id === taskId ? regeneratedTask : task))));
      setExpandedTaskIds((current) => new Set(current).add(taskId));
    } finally {
      setRegeneratingId(null);
    }
  }

  return (
    <section className="space-y-5">
      <header>
        <h1 className="font-display text-4xl leading-none">Расписание будущих постов</h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-[#66645d]">
          Здесь собраны посты, которые выйдут в ближайшее время. Можно посмотреть текст, профиль и время выхода,
          быстро отредактировать публикацию или попросить систему переписать её заново.
        </p>
      </header>

      <DismissibleTip storageKey="threadsgo.queue-tip" title="Это план будущих публикаций">
        Сначала смотрите ближайшие посты. Ошибки и отмененные публикации уходят вниз списка, чтобы не мешать
        проверять то, что еще должно выйти.
      </DismissibleTip>

      {isLoading ? (
        <TaskSkeleton />
      ) : tasks.length === 0 ? (
        <EmptyState
          title="Публикаций пока нет"
          description="Когда проект будет готов, система подготовит посты на ближайшие дни. Первый пост можно создать кнопкой на обзоре проекта."
        />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              isExpanded={expandedTaskIds.has(task.id)}
              isCancelling={cancellingId === task.id}
              isPublishing={publishingId === task.id}
              isRegenerating={regeneratingId === task.id}
              isSaving={savingId === task.id}
              isSessionDead={isTaskAccountSessionDead(task, accountStates)}
              accountBlockMessage={getAccountBlockMessage(task, accountStates)}
              onToggle={() => toggleExpanded(task.id)}
              onCancel={() => void handleCancel(task.id)}
              onPublishNow={() => void handlePublishNow(task.id)}
              onSave={(contentText) => void handleSaveTask(task.id, contentText)}
              onRegenerate={() => void handleRegenerateTask(task.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TaskCard({
  task,
  isExpanded,
  isCancelling,
  isPublishing,
  isRegenerating,
  isSaving,
  isSessionDead,
  accountBlockMessage,
  onToggle,
  onCancel,
  onPublishNow,
  onSave,
  onRegenerate,
}: {
  task: PostingTask;
  isExpanded: boolean;
  isCancelling: boolean;
  isPublishing: boolean;
  isRegenerating: boolean;
  isSaving: boolean;
  isSessionDead: boolean;
  accountBlockMessage: string;
  onToggle: () => void;
  onCancel: () => void;
  onPublishNow: () => void;
  onSave: (contentText: string) => void;
  onRegenerate: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState(task.content_text);
  const isBusy = isCancelling || isPublishing || isRegenerating || isSaving;
  const canEdit = task.status !== "running" && task.status !== "success";

  useEffect(() => {
    setDraftText(task.content_text);
  }, [task.content_text]);

  function handleCancelEdit() {
    setDraftText(task.content_text);
    setIsEditing(false);
  }

  function handleSaveEdit() {
    const normalizedText = draftText.trim();
    if (!normalizedText) {
      toast.error("Текст поста не может быть пустым");
      return;
    }

    onSave(normalizedText);
    setIsEditing(false);
  }

  return (
    <article className={`rounded-[24px] border border-[#deded7] bg-white p-5 shadow-sm transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:shadow-md ${isRegenerating ? "animate-pulse" : ""}`}>
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
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#77766f]">Выйдет</p>
          <p className="mt-1 text-sm text-[#24231f]">{formatDate(task.scheduled_at)}</p>
        </div>
      </div>

      {isEditing ? (
        <div className="mt-5">
          <textarea
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            rows={8}
            className="w-full resize-y rounded-2xl border border-[#d8d8d2] bg-[#fbfaf5] p-4 text-sm leading-6 text-[#252525] outline-none transition-all duration-200 ease-in-out focus:border-[#151515]"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton variant="dark" onClick={handleSaveEdit} disabled={isBusy} isLoading={isSaving}>
              Сохранить
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
          className="mt-4 w-full whitespace-pre-line text-left text-sm leading-6 text-[#252525] transition-all duration-200 ease-in-out hover:text-[#000]"
        >
          {isRegenerating ? "Переписываем пост..." : isExpanded ? task.content_text : truncate(task.content_text, 240)}
        </button>
      )}

      {isExpanded && !isEditing ? <GenerationMetadataBlock task={task} /> : null}

      {task.error_message ? (
        <div className="mt-5 rounded-2xl border border-[#e0b4ae] bg-[#fff8f6] px-4 py-3 text-xs leading-5 text-[#8a2d25]">
          {truncate(task.error_message, 260)}
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
            <ActionButton onClick={() => setIsEditing(true)} disabled={isBusy || isEditing || !canEdit} isLoading={false}>
              Редактировать
            </ActionButton>
            <ActionButton onClick={onRegenerate} disabled={isBusy || isEditing || !canEdit} isLoading={isRegenerating}>
              Переписать
            </ActionButton>
            <ActionButton onClick={onCancel} disabled={isBusy || isEditing} isLoading={isCancelling}>
              Отменить
            </ActionButton>
          </>
        ) : (
          <span className="text-xs text-[#77766f]">{terminalStatuses.includes(task.status) ? "закрыто" : "заблокировано"}</span>
        )}
      </div>
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

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-dashed border-[#c9c9c3] bg-white/70 shadow-sm">
      <div className="grid items-center gap-5 p-5 text-center sm:p-6 lg:grid-cols-[1fr_20rem] lg:text-left">
        <div>
          <p className="font-display text-3xl leading-none text-[#151515]">{title}</p>
          <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-[#66645d] lg:mx-0">{description}</p>
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
    running: "в работе",
    success: "готово",
    partial_success: "частично готово",
    failed: "ошибка",
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

function getAccountBlockMessage(task: PostingTask, accountStates: ProjectAccountState[]) {
  const account = accountStates.find((item) => item.id === task.account_id);
  if (account?.status === "proxy_error") {
    return "Публикация на паузе: прокси временно не отвечает. Система сама перепроверит порт.";
  }

  return "Публикация недоступна: доступ к профилю Threads истек или профиль заблокирован.";
}
