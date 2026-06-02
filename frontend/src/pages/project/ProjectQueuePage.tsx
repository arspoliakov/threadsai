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
      setTasks(tasksResult);
      setAccountStates(dashboardResult.account_states);
      if (!silent) {
        toast.success("Очередь обновлена");
      }
    } catch {
      toast.error("Не удалось загрузить очередь публикаций");
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
        loading: "Отменяем задачу...",
        success: "Задача отменена",
        error: "Не удалось отменить задачу",
      });
      await loadTasks({ silent: true });
    } finally {
      setCancellingId(null);
    }
  }

  async function handlePublishNow(taskId: number) {
    const task = tasks.find((item) => item.id === taskId);
    if (task && isTaskAccountSessionDead(task, accountStates)) {
      toast.error("Публикация недоступна: сессия аккаунта Threads истекла или заблокирована");
      return;
    }

    setPublishingId(taskId);

    try {
      await toast.promise(publishTaskNow(taskId), {
        loading: "Запускаем публикацию...",
        success: "Публикация запущена",
        error: "Не удалось запустить публикацию сейчас",
      });
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
        success: "Текст задачи сохранен",
        error: "Не удалось сохранить текст",
      });
      const updatedTask = await updatePromise;
      setTasks((current) => current.map((task) => (task.id === taskId ? updatedTask : task)));
    } finally {
      setSavingId(null);
    }
  }

  async function handleRegenerateTask(taskId: number) {
    setRegeneratingId(taskId);

    try {
      const regeneratePromise = regenerateTask(taskId);
      toast.promise(regeneratePromise, {
        loading: "Перегенерируем пост...",
        success: "Пост перегенерирован",
        error: "Не удалось перегенерировать пост",
      });
      const regeneratedTask = await regeneratePromise;
      setTasks((current) => current.map((task) => (task.id === taskId ? regeneratedTask : task)));
      setExpandedTaskIds((current) => new Set(current).add(taskId));
    } finally {
      setRegeneratingId(null);
    }
  }

  return (
    <section className="space-y-8">
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-5xl leading-none">Очередь</h1>
          <p className="mt-6 max-w-2xl text-sm leading-6 text-[#66645d]">
            Задачи публикации проекта: текст, статус, время запуска, ошибки Selenium
            и сохраненная логика генерации.
          </p>
        </div>
      </header>

      {isLoading ? (
        <TaskSkeleton />
      ) : tasks.length === 0 ? (
        <EmptyState
          title="Очередь пуста"
          description="Автономный планировщик создаст задачи, когда подойдет окно генерации."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
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
    <article className={`rounded-3xl border border-[#deded7] bg-white p-6 shadow-sm transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:shadow-md ${isRegenerating ? "animate-pulse" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#e7e5de] pb-5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77766f]">
            Задача #{task.id}
          </p>
          <div className="mt-3 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.12em] text-[#333]">
            <StatusDot status={task.status} />
            {formatStatus(task.status)}
          </div>
          {task.account_username ? (
            <div className="mt-3 inline-flex rounded-2xl border border-[#d8d8d2] bg-[#fbfaf5] px-3 py-1.5 text-xs text-[#55534c]">
              @{task.account_username}
            </div>
          ) : null}
        </div>
        <div className="rounded-2xl border border-[#d8d8d2] px-4 py-3 text-right">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#77766f]">
            Запланировано
          </p>
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
            <ActionButton
              variant="dark"
              onClick={handleSaveEdit}
              disabled={isBusy}
              isLoading={isSaving}
            >
              Сохранить
            </ActionButton>
            <ActionButton
              onClick={handleCancelEdit}
              disabled={isBusy}
              isLoading={false}
            >
              Отмена
            </ActionButton>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          className="mt-5 w-full text-left text-sm leading-6 text-[#252525] transition-all duration-200 ease-in-out hover:text-[#000]"
        >
          {isRegenerating ? "Генератор переписывает пост..." : isExpanded ? task.content_text : truncate(task.content_text, 240)}
        </button>
      )}

      {isExpanded && !isEditing ? <GenerationMetadataBlock task={task} /> : null}

      {task.error_message ? (
        <div className="mt-5 rounded-2xl border border-[#e0b4ae] bg-[#fff8f6] px-4 py-3 text-xs leading-5 text-[#8a2d25]">
          {truncate(task.error_message, 260)}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {task.status === "queued" ? (
          <>
            <ActionButton
              variant="dark"
              onClick={onPublishNow}
              disabled={isBusy || isEditing || isSessionDead}
              isLoading={isPublishing}
              title={
                isSessionDead
                  ? "Сессия аккаунта Threads истекла или аккаунт заблокирован. Обновите cookies в настройках проекта."
                  : undefined
              }
            >
              Опубликовать сейчас
            </ActionButton>
            <ActionButton
              onClick={() => setIsEditing(true)}
              disabled={isBusy || isEditing || !canEdit}
              isLoading={false}
            >
              Редактировать
            </ActionButton>
            <ActionButton
              onClick={onRegenerate}
              disabled={isBusy || isEditing || !canEdit}
              isLoading={isRegenerating}
            >
              Перегенерировать
            </ActionButton>
            <ActionButton
              onClick={onCancel}
              disabled={isBusy || isEditing}
              isLoading={isCancelling}
            >
              Отменить
            </ActionButton>
          </>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#77766f]">
            {terminalStatuses.includes(task.status) ? "закрыто" : "заблокировано"}
          </span>
        )}
      </div>
    </article>
  );
}

function GenerationMetadataBlock({ task }: { task: PostingTask }) {
  const metadata = task.generation_metadata;

  if (!metadata) {
    return (
      <div className="mt-5 rounded-2xl border border-[#e1e1dc] bg-[#fbfaf5] p-4 text-xs leading-5 text-[#77766f]">
        Анализ не сохранен
      </div>
    );
  }

  return (
    <div className="mt-5 grid gap-3 rounded-2xl border border-[#e1e1dc] bg-[#fbfaf5] p-4 text-xs leading-5 text-[#55534c]">
      <MetadataLine label="Угол подачи" value={metadata.applied_angle} />
      <MetadataLine label="Механика хука" value={metadata.hook_mechanic} />
      <MetadataLine label="Структура" value={metadata.structure_pattern} />
      <MetadataLine label="Тон и ритм" value={metadata.tone_and_rhythm} />
    </div>
  );
}

function MetadataLine({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#8d8b84]">
        {label}
      </div>
      <div className="mt-1 text-[#333]">{value || "Анализ не сохранен"}</div>
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
      className={`flex items-center gap-2 rounded-2xl border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] transition-all duration-200 ease-in-out disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
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
    <div className="grid gap-4 xl:grid-cols-2">
      {[1, 2, 3, 4].map((item) => (
        <div key={item} className="h-64 animate-pulse rounded-3xl border border-[#deded7] bg-white p-6 shadow-sm">
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
    <div className="overflow-hidden rounded-3xl border border-dashed border-[#c9c9c3] bg-white/70 shadow-sm">
      <div className="grid items-center gap-6 p-6 text-center sm:p-8 lg:grid-cols-[1fr_24rem] lg:text-left">
        <div>
          <p className="font-display text-4xl leading-none text-[#151515]">{title}</p>
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

function formatStatus(status: PostingTaskStatus) {
  if (status === "success") {
    return "готово";
  }

  if (status === "partial_success") {
    return "частично";
  }

  if (status === "queued") {
    return "в очереди";
  }

  if (status === "running") {
    return "в работе";
  }

  if (status === "failed") {
    return "ошибка";
  }

  if (status === "cancelled") {
    return "отменено";
  }

  return "черновик";
}

function formatDate(value: string | null) {
  if (!value) {
    return "не запланировано";
  }

  return new Date(value).toLocaleString("ru-RU");
}

function isTaskAccountSessionDead(task: PostingTask, accountStates: ProjectAccountState[]) {
  if (task.account_id === null) {
    return false;
  }

  const account = accountStates.find((item) => item.id === task.account_id);
  return account?.status === "cookies_expired" || account?.status === "blocked" || account?.status === "proxy_error";
}
