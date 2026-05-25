import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import {
  getActiveGlobalPrompts,
  getLatestProjectOperation,
  getProjectDashboard,
  getProjectOperations,
  triggerGeneration,
  triggerScraping,
  updateProject,
  type Project,
  type ProjectAccountState,
  type ProjectDashboard,
  type ProjectOperation,
} from "../../api/client";

type RunningAction = "scraping" | "generation" | null;

const DESCRIPTION_HINT =
  "Внимание: заполняйте максимально подробно. Укажите суть, боли ЦА и Tone of Voice. ИИ использует этот текст как ядро для генерации всех постов.";

export default function ProjectOverviewPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const [dashboard, setDashboard] = useState<ProjectDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [runningAction, setRunningAction] = useState<RunningAction>(null);
  const [latestScrapingOperation, setLatestScrapingOperation] = useState<ProjectOperation | null>(null);
  const [operations, setOperations] = useState<ProjectOperation[]>([]);
  const [hasGlobalPrompt, setHasGlobalPrompt] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadDashboard() {
    setIsLoading(true);
    setError(null);

    try {
      const [dashboardResult, operationsResult, promptsResult] = await Promise.all([
        getProjectDashboard(projectId),
        getProjectOperations(projectId, 12),
        getActiveGlobalPrompts(),
      ]);
      setDashboard(dashboardResult);
      setOperations(operationsResult);
      setHasGlobalPrompt(promptsResult.some((prompt) => prompt.is_active && prompt.body.trim().length > 0));
    } catch {
      toast.error("Не удалось загрузить сводку проекта");
      setError("Не удалось загрузить сводку проекта.");
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshScrapingOperation() {
    const operation = await getLatestProjectOperation(projectId, "scraping");
    setLatestScrapingOperation(operation);
    void getProjectOperations(projectId, 12).then(setOperations).catch(() => undefined);

    if (operation?.status === "running") {
      setRunningAction("scraping");
      setError(null);
      setStatusMessage(operation.message || "Анализ трендов выполняется в фоне.");
      return operation;
    }

    setRunningAction((current) => (current === "scraping" ? null : current));

    if (operation?.status === "success") {
      const saved = operation.result_json?.saved_trends_count;
      setError(null);
      setStatusMessage(
        typeof saved === "number"
          ? `Анализ трендов завершен: сохранено ${saved}.`
          : operation.message || "Анализ трендов завершен.",
      );
    }

    if (operation?.status === "failed") {
      setError(operation.message || "Анализ трендов завершился ошибкой.");
    }

    return operation;
  }

  useEffect(() => {
    if (!Number.isFinite(projectId)) {
      return;
    }

    void loadDashboard();
    void refreshScrapingOperation();
  }, [projectId]);

  useEffect(() => {
    if (latestScrapingOperation?.status !== "running") {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshScrapingOperation().then((operation) => {
        if (operation?.status !== "running") {
          void loadDashboard();
        }
      });
    }, 3500);

    return () => window.clearInterval(intervalId);
  }, [latestScrapingOperation?.status, projectId]);

  async function handleTriggerScraping() {
    setRunningAction("scraping");
    setStatusMessage(null);
    setError(null);

    try {
      const result = await triggerScraping(projectId);
      setStatusMessage(result.message || "Анализ трендов запущен в фоне.");
      toast.success("Анализ трендов запущен в фоне");
      await refreshScrapingOperation();
      await loadDashboard();
    } catch {
      toast.error("Не удалось запустить анализ трендов");
      setError("Не удалось запустить анализ трендов.");
      setRunningAction(null);
    }
  }

  async function handleTriggerGeneration() {
    setRunningAction("generation");
    setStatusMessage(null);
    setError(null);

    try {
      const result = await triggerGeneration(projectId);
      setStatusMessage(`Пост сгенерирован и поставлен в очередь: задача #${result.task_id}.`);
      toast.success(`Пост сгенерирован: задача #${result.task_id}`);
      await loadDashboard();
    } catch {
      toast.error("Не удалось сгенерировать пост");
      setError("Не удалось сгенерировать пост.");
    } finally {
      setRunningAction(null);
    }
  }

  return (
    <section className="space-y-8">
      <header className="grid gap-6 border border-[#c9c9c3] bg-white p-8 md:grid-cols-[1fr_auto]">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[#77766f]">
            Project control room
          </p>
          <h1 className="mt-4 font-display text-5xl leading-none">
            {dashboard?.project.name || "Сводка"}
          </h1>
          <p className="mt-6 max-w-2xl text-sm leading-6 text-[#66645d]">
            Ручной запуск основных процессов проекта: сбор трендов, генерация поста
            и контроль последнего состояния перед боевым прогоном.
          </p>
        </div>
        {dashboard ? (
          <button
            type="button"
            onClick={() => setIsEditOpen(true)}
            className="h-11 self-end border border-[#151515] px-5 font-mono text-xs uppercase tracking-[0.16em] transition hover:bg-[#151515] hover:text-white"
          >
            Редактировать проект
          </button>
        ) : null}
      </header>

      <div className="grid gap-px border border-[#c9c9c3] bg-[#c9c9c3] md:grid-cols-2">
        <ActionPanel
          title="Анализ трендов"
          description="Принудительно собрать ленту, очистить старые тренды проекта и сохранить свежие паттерны."
          buttonText="Запустить анализ трендов"
          isLoading={runningAction === "scraping"}
          isDisabled={runningAction !== null || isLoading}
          onClick={() => void handleTriggerScraping()}
        />
        <ActionPanel
          title="Генерация"
          description="Взять последние тренды, выбрать подходящий паттерн и создать задачу публикации."
          buttonText="Сгенерировать пост сейчас"
          isLoading={runningAction === "generation"}
          isDisabled={runningAction !== null || isLoading}
          onClick={() => void handleTriggerGeneration()}
        />
      </div>

      {dashboard ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
          <SystemStatusCard
            dashboard={dashboard}
            operations={operations}
            latestScrapingOperation={latestScrapingOperation}
          />
          <ReadinessChecklist
            dashboard={dashboard}
            hasGlobalPrompt={hasGlobalPrompt}
            projectId={projectId}
          />
        </div>
      ) : null}

      {latestScrapingOperation?.status === "running" ? (
        <Notice tone="neutral">
          Анализ трендов идет в фоне. Можно перейти в настройки или очередь: статус сохранен на бэкенде и восстановится при возврате.
        </Notice>
      ) : null}
      {statusMessage ? <Notice tone="neutral">{statusMessage}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <section className="overflow-hidden rounded-[2rem] border border-[#dfe4dc] bg-white shadow-sm">
        <header className="border-b border-[#c9c9c3] px-5 py-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77766f]">
            Журнал действий
          </p>
          <h2 className="mt-2 font-display text-3xl">Что система делала в проекте</h2>
        </header>

        {isLoading ? (
          <EmptyLine text="Загрузка сводки" />
        ) : dashboard ? (
          <ActivityLog operations={operations} dashboard={dashboard} latestScrapingOperation={latestScrapingOperation} />
        ) : (
          <EmptyLine text="Нет данных" />
        )}
      </section>

      {isEditOpen && dashboard ? (
        <EditProjectPanel
          project={dashboard.project}
          onClose={() => setIsEditOpen(false)}
          onSaved={async () => {
            setIsEditOpen(false);
            await loadDashboard();
          }}
        />
      ) : null}
    </section>
  );
}

function SystemStatusCard({
  dashboard,
  operations,
  latestScrapingOperation,
}: {
  dashboard: ProjectDashboard;
  operations: ProjectOperation[];
  latestScrapingOperation: ProjectOperation | null;
}) {
  const activeAccounts = dashboard.account_states.filter((account) => account.status === "active").length;
  const failedAccounts = dashboard.account_states.filter(
    (account) => account.status === "cookies_expired" || account.status === "blocked" || account.status === "error",
  ).length;
  const runningOperation = operations.find((operation) => operation.status === "running") || latestScrapingOperation;
  const queuedCount = dashboard.posting_tasks_by_status.queued ?? 0;
  const status = getProjectSystemStatus({
    runningOperation,
    activeAccounts,
    failedAccounts,
    trendsCount: dashboard.saved_trends_count,
    queuedCount,
    recentErrorsCount: dashboard.recent_errors.length,
  });

  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-[#dfe4dc] bg-[#07100e] p-6 text-white shadow-sm">
      <div className="absolute right-[-6rem] top-[-7rem] h-64 w-64 rounded-full bg-[#70ff35]/18 blur-[80px]" />
      <div className="absolute bottom-[-8rem] left-[10%] h-64 w-64 rounded-full bg-[#0076ff]/18 blur-[90px]" />
      <div className="relative">
        <div className="flex items-center gap-3">
          <span className={`relative flex h-3 w-3 ${status.pulse ? "" : "opacity-90"}`}>
            {status.pulse ? <span className={`absolute h-full w-full animate-ping rounded-full ${status.dotClass} opacity-60`} /> : null}
            <span className={`relative h-3 w-3 rounded-full ${status.dotClass}`} />
          </span>
          <p className="text-sm font-medium text-white/80">Сейчас система</p>
        </div>
        <h2 className="mt-6 font-display text-5xl leading-[0.9] tracking-[-0.05em]">
          {status.title}
        </h2>
        <p className="mt-5 max-w-xl text-sm leading-7 text-white/58">{status.description}</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <MiniMetric label="Активные аккаунты" value={String(activeAccounts)} />
          <MiniMetric label="Тренды" value={String(dashboard.saved_trends_count)} />
          <MiniMetric label="В очереди" value={String(queuedCount)} />
        </div>
      </div>
    </section>
  );
}

function ReadinessChecklist({
  dashboard,
  hasGlobalPrompt,
  projectId,
}: {
  dashboard: ProjectDashboard;
  hasGlobalPrompt: boolean;
  projectId: number;
}) {
  const activeAccounts = dashboard.account_states.filter((account) => account.status === "active").length;
  const checklist = [
    {
      title: "Описание проекта",
      done: Boolean(dashboard.project.description && dashboard.project.description.length >= 30),
      hint: "Нужно описать продукт, аудиторию и тон.",
      to: `/app/projects/${projectId}/settings`,
    },
    {
      title: "Глобальный стиль",
      done: hasGlobalPrompt,
      hint: "Общий голос для всех ваших проектов.",
      to: "/app/settings",
    },
    {
      title: "Threads-аккаунт",
      done: activeAccounts > 0,
      hint: "Нужен хотя бы один активный профиль.",
      to: `/app/projects/${projectId}/settings`,
    },
    {
      title: "Тренды проекта",
      done: dashboard.saved_trends_count > 0,
      hint: "Запустите анализ, чтобы генерация опиралась на свежую ленту.",
      to: `/app/projects/${projectId}/trends`,
    },
    {
      title: "Расписание",
      done: Boolean(dashboard.project.posts_per_day && dashboard.project.active_hours_start && dashboard.project.active_hours_end),
      hint: "Сколько постов в день и в какое окно выпускать.",
      to: `/app/projects/${projectId}/settings`,
    },
  ];
  const completed = checklist.filter((item) => item.done).length;

  if (completed === checklist.length) {
    return null;
  }

  return (
    <section className="rounded-[2rem] border border-[#dfe4dc] bg-white p-6 shadow-sm xl:sticky xl:top-28">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77766f]">Готовность</p>
          <h2 className="mt-2 font-display text-3xl">Перед большим запуском</h2>
        </div>
        <span className="rounded-full bg-[#eef4ec] px-4 py-2 text-sm text-[#4f584f]">
          {completed}/{checklist.length} готово
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-[#687168]">
        Чек-лист исчезнет сам, когда основные шаги будут закрыты. Прокси здесь не обязательны,
        но для запуска большого числа аккаунтов мы рекомендуем подключить их отдельно.
      </p>

      <div className="mt-5 grid gap-2">
        {checklist.map((item) => (
          <Link
            key={item.title}
            to={item.to}
            className="flex items-start gap-3 rounded-2xl border border-[#e3e7df] bg-[#fbfcf7] p-4 transition hover:border-[#07100e] hover:bg-white"
          >
            <span
              className={[
                "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs",
                item.done ? "bg-[#70ff35] text-[#07100e]" : "bg-[#eef0ea] text-[#687168]",
              ].join(" ")}
            >
              {item.done ? "✓" : "•"}
            </span>
            <span>
              <span className="block text-sm font-medium text-[#07100e]">{item.title}</span>
              <span className="mt-1 block text-xs leading-5 text-[#687168]">{item.hint}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function ActivityLog({
  operations,
  dashboard,
  latestScrapingOperation,
}: {
  operations: ProjectOperation[];
  dashboard: ProjectDashboard;
  latestScrapingOperation: ProjectOperation | null;
}) {
  const visibleOperations = operations.length > 0 ? operations : latestScrapingOperation ? [latestScrapingOperation] : [];

  return (
    <div className="divide-y divide-[#e1e1dc]">
      {visibleOperations.length === 0 ? (
        <EmptyLine text="Действий пока не было" />
      ) : (
        visibleOperations.map((operation) => (
          <div key={operation.id} className="grid gap-3 px-5 py-5 md:grid-cols-[190px_1fr_auto] md:items-start">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#77766f]">
                {operation.action_type === "scraping" ? "Анализ трендов" : "Генерация"}
              </span>
              <p className="mt-2 text-xs text-[#77766f]">{formatDate(operation.started_at)}</p>
            </div>
            <p className={operation.status === "failed" ? "text-sm leading-6 text-[#8a2d25]" : "text-sm leading-6 text-[#252525]"}>
              {formatOperation(operation)}
            </p>
            <OperationBadge status={operation.status} />
          </div>
        ))
      )}

      <LogRow label="Аккаунты" value={formatAccountStates(dashboard.account_states)} />
      <LogRow label="Задачи по статусам" value={formatTaskStatuses(dashboard.posting_tasks_by_status)} />
      <LogRow
        label="Последняя ошибка"
        value={dashboard.recent_errors[0] || "Ошибок нет"}
        isError={dashboard.recent_errors.length > 0}
      />
    </div>
  );
}

function OperationBadge({ status }: { status: ProjectOperation["status"] }) {
  const className =
    status === "running"
      ? "bg-[#e8f1ff] text-[#124e91]"
      : status === "success"
        ? "bg-[#edf8e8] text-[#25551f]"
        : "bg-[#fff1ee] text-[#8a2d25]";
  const label = status === "running" ? "в процессе" : status === "success" ? "готово" : "ошибка";

  return <span className={`w-fit rounded-full px-3 py-1 text-xs ${className}`}>{label}</span>;
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
      <p className="font-display text-3xl leading-none">{value}</p>
      <p className="mt-2 text-xs leading-4 text-white/42">{label}</p>
    </div>
  );
}

function ActionPanel({
  title,
  description,
  buttonText,
  isLoading,
  isDisabled,
  onClick,
}: {
  title: string;
  description: string;
  buttonText: string;
  isLoading: boolean;
  isDisabled: boolean;
  onClick: () => void;
}) {
  return (
    <article className="bg-white p-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77766f]">
        Manual trigger
      </p>
      <h2 className="mt-3 font-display text-3xl">{title}</h2>
      <p className="mt-4 min-h-12 text-sm leading-6 text-[#66645d]">{description}</p>
      <button
        type="button"
        onClick={onClick}
        disabled={isDisabled}
        className="mt-8 flex w-full items-center justify-center gap-3 border border-[#151515] bg-[#151515] px-5 py-4 font-mono text-xs uppercase tracking-[0.16em] text-white transition-all duration-200 ease-in-out hover:bg-transparent hover:text-[#151515] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isLoading ? <Spinner /> : null}
        {isLoading ? "Выполняется" : buttonText}
      </button>
    </article>
  );
}

function EditProjectPanel({
  project,
  onClose,
  onSaved,
}: {
  project: Project;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      await updateProject(project.id, {
        name,
        description: description || null,
      });
      toast.success("Проект сохранен");
      await onSaved();
    } catch {
      toast.error("Не удалось сохранить проект");
      setError("Не удалось сохранить проект.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45">
      <aside className="ml-auto flex h-full w-full max-w-xl flex-col border-l border-black bg-[#f6f6f2]">
        <header className="flex items-center justify-between border-b border-[#c9c9c3] px-7 py-6">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[#77766f]">
              Project edit
            </p>
            <h2 className="mt-2 font-display text-3xl">Редактировать проект</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-[#151515] px-3 py-2 font-mono text-xs uppercase transition hover:bg-[#151515] hover:text-white"
          >
            Закрыть
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col px-7 py-8">
          <label className="grid gap-2">
            <span className="field-label">Название</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              className="border-0 border-b border-[#151515] bg-transparent px-0 py-3 text-lg outline-none focus:border-[#77766f]"
            />
          </label>

          <label className="mt-8 grid gap-2">
            <span className="field-label">Описание</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={6}
              className="resize-none border border-[#c9c9c3] bg-transparent p-3 outline-none focus:border-[#151515]"
            />
            <span className="text-xs leading-5 text-[#77766f]">{DESCRIPTION_HINT}</span>
          </label>

          {error ? <div className="mt-6 border-l-2 border-[#b42318] px-4 py-3 text-sm text-[#61140e]">{error}</div> : null}

          <div className="mt-auto border-t border-[#d4d4ce] pt-6">
            <button
              type="submit"
              disabled={isSaving}
              className="flex w-full items-center justify-center gap-3 border border-[#151515] bg-[#151515] px-5 py-4 font-mono text-xs uppercase tracking-[0.16em] text-white transition-all duration-200 ease-in-out hover:bg-transparent hover:text-[#151515] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSaving ? <Spinner /> : null}
              {isSaving ? "Сохранение" : "Сохранить"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function LogRow({
  label,
  value,
  isError = false,
}: {
  label: string;
  value: string;
  isError?: boolean;
}) {
  return (
    <div className="grid gap-3 px-5 py-5 md:grid-cols-[220px_1fr]">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#77766f]">
        {label}
      </span>
      <span className={isError ? "text-sm leading-6 text-[#8a2d25]" : "text-sm leading-6 text-[#252525]"}>
        {value}
      </span>
    </div>
  );
}

function Notice({ children, tone }: { children: string; tone: "neutral" | "error" }) {
  const className =
    tone === "error"
      ? "border-l-2 border-[#b42318] bg-white px-5 py-4 text-sm text-[#61140e]"
      : "border-l-2 border-[#151515] bg-white px-5 py-4 text-sm text-[#252525]";

  return <div className={className}>{children}</div>;
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="px-5 py-16 text-center font-mono text-xs uppercase tracking-[0.18em] text-[#77766f]">
      {text}
    </div>
  );
}

function Spinner() {
  return <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />;
}

function formatAccountStates(accounts: ProjectAccountState[]) {
  if (accounts.length === 0) {
    return "Нет привязанных аккаунтов";
  }

  return accounts
    .map((account) => {
      const lastError = account.last_error ? `, ошибка: ${account.last_error}` : "";
      return `${account.username} / ${account.platform} / ${account.status}${lastError}`;
    })
    .join("; ");
}

function formatTaskStatuses(statuses: Record<string, number>) {
  const entries = Object.entries(statuses);

  if (entries.length === 0) {
    return "Задач пока нет";
  }

  return entries.map(([status, count]) => `${status}: ${count}`).join("; ");
}

function formatOperation(operation: ProjectOperation | null) {
  if (!operation) {
    return "Еще не запускался";
  }

  const started = new Date(operation.started_at).toLocaleString("ru-RU");
  const finished = operation.finished_at ? new Date(operation.finished_at).toLocaleString("ru-RU") : "в процессе";
  const collected = operation.result_json?.collected_posts_count;
  const saved = operation.result_json?.saved_trends_count;
  const status =
    operation.status === "running"
      ? "идет сбор"
      : operation.status === "success"
        ? "завершено"
        : "ошибка";
  const result =
    typeof saved === "number" || typeof collected === "number"
      ? `Найдено постов: ${String(collected ?? "неизвестно")}. Новых трендов сохранено: ${String(saved ?? 0)}.`
      : "";

  return `${status}; старт: ${started}; финиш: ${finished}. ${result} ${operation.message || ""}`.trim();
}

function formatDate(value: string | null) {
  if (!value) {
    return "Генераций еще не было";
  }

  return new Date(value).toLocaleString("ru-RU");
}

function getProjectSystemStatus({
  runningOperation,
  activeAccounts,
  failedAccounts,
  trendsCount,
  queuedCount,
  recentErrorsCount,
}: {
  runningOperation: ProjectOperation | null;
  activeAccounts: number;
  failedAccounts: number;
  trendsCount: number;
  queuedCount: number;
  recentErrorsCount: number;
}) {
  if (runningOperation?.status === "running") {
    return {
      title: runningOperation.action_type === "scraping" ? "собирает тренды" : "генерирует пост",
      description:
        runningOperation.action_type === "scraping"
          ? "Система смотрит ленту Threads, отбирает свежие сигналы и готовит паттерны для генерации."
          : "ИИ собирает контекст проекта, тренды и историю публикаций, чтобы подготовить новый черновик.",
      dotClass: "bg-[#70ff35]",
      pulse: true,
    };
  }

  if (failedAccounts > 0 || recentErrorsCount > 0) {
    return {
      title: "ждет проверки",
      description:
        "Есть проблема с аккаунтом или последней публикацией. Проверьте cookies, ошибки и привязанные Threads-профили.",
      dotClass: "bg-[#ffb020]",
      pulse: true,
    };
  }

  if (activeAccounts === 0) {
    return {
      title: "ждет аккаунт",
      description: "Проекту нужен хотя бы один активный Threads-профиль, иначе генерация есть, а публикация невозможна.",
      dotClass: "bg-[#9aa39a]",
      pulse: false,
    };
  }

  if (trendsCount === 0) {
    return {
      title: "готов к анализу",
      description: "Аккаунт подключен. Следующий логичный шаг — собрать тренды, чтобы посты опирались на живую ленту.",
      dotClass: "bg-[#0076ff]",
      pulse: false,
    };
  }

  if (queuedCount > 0) {
    return {
      title: "ведет очередь",
      description: "Черновики уже стоят в расписании. Можно проверять тексты, публиковать вручную или ждать планировщик.",
      dotClass: "bg-[#70ff35]",
      pulse: true,
    };
  }

  return {
    title: "готов к генерации",
    description: "Тренды собраны, аккаунт активен. Можно создать следующий пост вручную или дождаться автогенерации.",
    dotClass: "bg-[#70ff35]",
    pulse: false,
  };
}
