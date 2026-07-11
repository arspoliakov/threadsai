import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import {
  getApiErrorMessage,
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
import { DismissibleTip } from "../../components/DismissibleTip";
import { trackSeoEvent } from "../../components/SeoAnalytics";

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
    } catch (loadError) {
      const message = getApiErrorMessage(loadError, "Не удалось загрузить проект. Попробуйте ещё раз.");
      toast.error(message);
      setError(message);
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
      setStatusMessage(operation.message || "Система обновляет идеи в фоне.");
      return operation;
    }

    setRunningAction((current) => (current === "scraping" ? null : current));

    if (operation?.status === "success") {
      const saved = operation.result_json?.saved_trends_count;
      setError(null);
      setStatusMessage(
        typeof saved === "number"
          ? `Подборка идей обновлена: сохранено ${saved}.`
          : operation.message || "Подборка идей обновлена.",
      );
    }

    if (operation?.status === "failed") {
      setError(operation.message || "Не удалось обновить идеи.");
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
      setStatusMessage(result.message || "Сбор идей запущен в фоне.");
      toast.success("Сбор идей запущен в фоне");
      await refreshScrapingOperation();
      await loadDashboard();
    } catch (scrapingError) {
      const message = getApiErrorMessage(scrapingError, "Не удалось запустить сбор идей.");
      toast.error(message);
      setError(message);
      setRunningAction(null);
    }
  }

  async function handleTriggerGeneration() {
    setRunningAction("generation");
    setStatusMessage(null);
    setError(null);

    try {
      const result = await triggerGeneration(projectId);
      trackSeoEvent("draft_created", { project_id: projectId, task_id: result.task_id });
      setStatusMessage(`Пост готов и добавлен в расписание: публикация #${result.task_id}.`);
      toast.success(`Пост добавлен в расписание: #${result.task_id}`);
      await loadDashboard();
    } catch (generationError) {
      const message = getApiErrorMessage(generationError, "Не удалось подготовить пост.");
      toast.error(message);
      setError(message);
    } finally {
      setRunningAction(null);
    }
  }

  return (
    <section className="space-y-5">
      <header className="grid gap-4 rounded-[24px] border border-[#dfe4dc] bg-white p-5 shadow-sm md:grid-cols-[1fr_auto] sm:p-6">
        <div>
          <h1 className="font-display text-4xl leading-none">
            {dashboard?.project.name || "Обзор проекта"}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[#66645d]">
            Здесь вы управляете всем процессом. Проверьте: подключен ли профиль, собраны ли свежие идеи
            для постов и составлено ли расписание публикаций на ближайшие дни.
          </p>
        </div>
        {dashboard ? (
          <button
            type="button"
            onClick={() => setIsEditOpen(true)}
            className="h-11 self-end rounded-full border border-[#151515] px-5 text-sm transition hover:bg-[#151515] hover:text-white"
          >
            Редактировать проект
          </button>
        ) : null}
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        <ActionPanel
          title="Обновить идеи для постов"
          description="Нейросеть изучит, о чем сейчас говорят в ленте Threads, и подберет актуальные темы. На их основе мы будем создавать ваши посты."
          buttonText="Обновить идеи для постов"
          isLoading={runningAction === "scraping"}
          isDisabled={runningAction !== null || isLoading || !hasActiveAccount(dashboard)}
          disabledReason={!hasActiveAccount(dashboard) ? "Сначала подключите рабочий профиль Threads" : undefined}
          onClick={() => void handleTriggerScraping()}
        />
        <ActionPanel
          title="Добавить пост"
          description="Нейросеть создаст новый пост, опираясь на вашу тему, выбранный стиль и актуальные идеи. Пост сразу добавится в расписание публикаций."
          buttonText="Добавить новый пост в план"
          isLoading={runningAction === "generation"}
          isDisabled={runningAction !== null || isLoading || !hasActiveAccount(dashboard)}
          disabledReason={!hasActiveAccount(dashboard) ? "Сначала подключите рабочий профиль Threads" : undefined}
          onClick={() => void handleTriggerGeneration()}
        />
      </div>

      {dashboard ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
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
          Сбор идей идет в фоне. Можно перейти в настройки или расписание постов: система продолжит работу сама.
        </Notice>
      ) : null}
      {statusMessage ? <Notice tone="neutral">{statusMessage}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <section className="overflow-hidden rounded-[2rem] border border-[#dfe4dc] bg-white shadow-sm">
        <header className="border-b border-[#c9c9c3] px-5 py-5">
          <h2 className="font-display text-3xl">Что система успела сделать</h2>
        </header>

        {isLoading ? (
          <EmptyLine text="Загрузка сводки" />
        ) : dashboard ? (
          <ActivityLog operations={operations} dashboard={dashboard} latestScrapingOperation={latestScrapingOperation} />
        ) : (
          <EmptyLine text="Нет данных" />
        )}
      </section>

      <ContentFormulaNote />

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
    (account) => account.status === "cookies_expired" || account.status === "blocked" || account.status === "error" || account.status === "proxy_error",
  ).length;
  const runningOperation =
    operations.find((operation) => operation.status === "running" || operation.status === "queued")
    || latestScrapingOperation;
  const queuedCount = dashboard.posting_tasks_by_status.queued ?? 0;
  const status = getProjectSystemStatus({
    runningOperation,
    activeAccounts,
    failedAccounts,
    trendsCount: dashboard.saved_trends_count,
    queuedCount,
  });

  return (
    <section className="relative overflow-hidden rounded-[24px] border border-[#dfe4dc] bg-[#07100e] p-5 text-white shadow-sm">
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
        <h2 className="mt-5 font-display text-4xl leading-[0.95] tracking-[-0.04em]">
          {status.title}
        </h2>
        <p className="mt-4 max-w-xl text-sm leading-6 text-white/58">{status.description}</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <MiniMetric label="Активные профили" value={String(activeAccounts)} />
          <MiniMetric label="Идеи" value={String(dashboard.saved_trends_count)} />
          <MiniMetric label="В плане" value={String(queuedCount)} />
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
      title: "Опишите проект",
      done: Boolean(dashboard.project.description && dashboard.project.description.length >= 30),
      hint: "Что предлагаете, кому это нужно и как должен звучать профиль.",
      to: `/app/projects/${projectId}/settings`,
    },
    {
      title: "Выберите общий стиль",
      done: hasGlobalPrompt,
      hint: "Спокойный, дерзкий, экспертный или свой тон для всех проектов.",
      to: "/app/settings",
    },
    {
      title: "Подключите Threads-профиль",
      done: activeAccounts > 0,
      hint: "Пароль не нужен. Достаточно cookies от готового профиля.",
      to: `/app/projects/${projectId}/settings`,
    },
    {
      title: "Обновите идеи",
      done: dashboard.saved_trends_count > 0,
      hint: "Так посты будут собираться не из воздуха, а из живой механики ленты.",
      to: `/app/projects/${projectId}/trends`,
    },
    {
      title: "Настройте расписание",
      done: Boolean(dashboard.project.posts_per_day && dashboard.project.active_hours_start && dashboard.project.active_hours_end),
      hint: "Сколько постов в день выпускать по каждому профилю и в какие часы.",
      to: `/app/projects/${projectId}/settings`,
    },
  ];
  const completed = checklist.filter((item) => item.done).length;

  if (completed === checklist.length) {
    return null;
  }

  return (
    <section className="rounded-[24px] border border-[#dfe4dc] bg-white p-5 shadow-sm xl:sticky xl:top-28">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77766f]">Готовность</p>
          <h2 className="mt-2 font-display text-3xl">Что сделать дальше</h2>
        </div>
        <span className="rounded-full bg-[#eef4ec] px-4 py-2 text-sm text-[#4f584f]">
          {completed}/{checklist.length} готово
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-[#687168]">
        Закройте эти шаги один раз. После этого система сама будет готовить посты,
        ждать времени публикации и следить за техническими паузами.
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

function ContentFormulaNote() {
  return (
    <DismissibleTip
      storageKey="threadsgo.project-post-style-tip"
      title="Какие посты пишет нейросеть?"
      action={
        <Link
          to="/app/how-it-works"
          className="inline-flex h-10 items-center justify-center rounded-full border border-[#141815] px-4 text-sm text-[#141815] transition hover:bg-[#141815] hover:text-white"
        >
          Подробнее
        </Link>
      }
    >
      Обычно это короткие заметки для ленты: мысль, сцена, вопрос или маленькое напряжение. Прямой увод в био или закреп
      появляется не в каждом посте, чтобы профиль не выглядел как реклама.
    </DismissibleTip>
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
        <EmptyLine text="Система еще ничего не запускала" />
      ) : (
        visibleOperations.map((operation) => (
          <div key={operation.id} className="grid gap-3 px-5 py-5 md:grid-cols-[190px_1fr_auto] md:items-start">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#77766f]">
                {operation.action_type === "scraping" ? "Сбор идей" : "Создание поста"}
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

      <LogRow label="Профили" value={formatAccountStates(dashboard.account_states)} />
      <LogRow label="Публикации" value={formatTaskStatuses(dashboard.posting_tasks_by_status)} />
      <LogRow
        label="Последняя ошибка"
        value={dashboard.recent_errors[0] ? formatUserFacingError(dashboard.recent_errors[0]) : "Ошибок нет"}
        isError={dashboard.recent_errors.length > 0}
      />
    </div>
  );
}

function OperationBadge({ status }: { status: ProjectOperation["status"] }) {
  const className =
    status === "queued"
      ? "bg-[#fff7dc] text-[#76520f]"
      : status === "running"
        ? "bg-[#e8f1ff] text-[#124e91]"
        : status === "success"
          ? "bg-[#edf8e8] text-[#25551f]"
          : "bg-[#fff1ee] text-[#8a2d25]";
  const label = status === "running" ? "в процессе" : status === "success" ? "готово" : "ошибка";

  const displayLabel = status === "queued" ? "в очереди" : label;

  return <span className={`w-fit rounded-full px-3 py-1 text-xs ${className}`}>{displayLabel}</span>;
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
  disabledReason,
  onClick,
}: {
  title: string;
  description: string;
  buttonText: string;
  isLoading: boolean;
  isDisabled: boolean;
  disabledReason?: string;
  onClick: () => void;
}) {
  return (
    <article className="rounded-[24px] border border-[#dfe4dc] bg-white p-5 shadow-sm sm:p-6">
      <h2 className="font-display text-3xl">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-[#66645d]">{description}</p>
      <button
        type="button"
        onClick={onClick}
        disabled={isDisabled}
        className="mt-5 flex min-h-12 w-full items-center justify-center gap-3 rounded-full border border-[#151515] bg-[#151515] px-5 py-3 text-sm text-white transition-all duration-200 ease-in-out hover:bg-[#70ff35] hover:text-[#07100e] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isLoading ? <Spinner /> : null}
        {isLoading ? "Идет" : buttonText}
      </button>
      {disabledReason ? (
        <p className="mt-3 text-center text-xs leading-5 text-[#7a8179]">{disabledReason}</p>
      ) : null}
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
    } catch (saveError) {
      const message = getApiErrorMessage(saveError, "Не удалось сохранить проект.");
      toast.error(message);
      setError(message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm">
      <aside className="ml-auto flex h-full w-full max-w-xl flex-col border-l border-[#dfe4dc] bg-[#f6f6f2] shadow-[0_0_80px_rgba(0,0,0,0.22)]">
        <header className="flex items-center justify-between border-b border-[#c9c9c3] px-7 py-6">
          <div>
            <h2 className="font-display text-3xl">Редактировать проект</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#151515] px-4 py-2 text-xs transition hover:bg-[#151515] hover:text-white"
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
              className="flex w-full items-center justify-center gap-3 rounded-full border border-[#151515] bg-[#151515] px-5 py-4 text-sm text-white transition-all duration-200 ease-in-out hover:bg-[#70ff35] hover:text-[#07100e] disabled:cursor-not-allowed disabled:opacity-40"
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
    return "Нет подключенных профилей";
  }

  const statusLabels: Record<string, string> = {
    active: "готов к работе",
    cookies_expired: "нужно обновить вход",
    blocked: "временно недоступен",
    error: "нужна проверка",
    proxy_error: "подключение восстанавливается",
  };

  return accounts
    .map((account) => {
      const statusLabel = statusLabels[account.status] || account.status;
      return `${account.username} / ${statusLabel}`;
    })
    .join("; ");
}

function formatTaskStatuses(statuses: Record<string, number>) {
  const entries = Object.entries(statuses);

  if (entries.length === 0) {
    return "Задач пока нет";
  }

  const statusLabels: Record<string, string> = {
    queued: "запланировано",
    running: "публикуется",
    success: "опубликовано",
    failed: "не опубликовано",
    cancelled: "отменена",
    draft: "черновик",
  };

  return entries.map(([status, count]) => `${statusLabels[status] || status}: ${count}`).join("; ");
}

function formatOperation(operation: ProjectOperation | null) {
  if (!operation) {
    return "Еще не запускался";
  }

  const started = new Date(operation.started_at).toLocaleString("ru-RU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const finished = operation.finished_at ? new Date(operation.finished_at).toLocaleString("ru-RU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "в процессе";
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
      ? `Найдено постов: ${String(collected ?? "неизвестно")}. Новых идей сохранено: ${String(saved ?? 0)}.`
      : "";

  let message = operation.message || "";
  if (message.startsWith("Trend analysis completed")) {
    message = "";
  } else if (message.startsWith("Trend scraping is running")) {
    message = "Сбор идей запущен.";
  } else if (message.startsWith("Trend analysis failed:")) {
    message = message.replace("Trend analysis failed:", "Ошибка сбора идей:");
  }

  return `${status}; старт: ${started}; финиш: ${finished}. ${result} ${formatUserFacingError(message)}`.trim();
}

function hasActiveAccount(dashboard: ProjectDashboard | null) {
  return dashboard?.account_states.some((account) => account.status === "active") ?? false;
}

function formatUserFacingError(message: string) {
  if (!message) {
    return "";
  }

  const normalized = message.toLowerCase();
  if (normalized.includes("proxy") || normalized.includes("ip polling") || normalized.includes("exit node")) {
    return "Подключение временно недоступно. Система проверит его снова автоматически.";
  }
  if (normalized.includes("cookie") || normalized.includes("session")) {
    return "Доступ к профилю нужно обновить в настройках проекта.";
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return "Операция заняла слишком много времени. Система попробует снова.";
  }
  if (normalized.includes("selenium") || normalized.includes("webdriver") || normalized.includes("chrome")) {
    return "Публикация временно не прошла. Система попробует снова.";
  }

  return "Операция не завершилась. Подробности уже отправлены команде, повторять действие прямо сейчас не нужно.";
}

function formatDate(value: string | null) {
  if (!value) {
    return "Генераций еще не было";
  }

  return new Date(value).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getProjectSystemStatus({
  runningOperation,
  activeAccounts,
  failedAccounts,
  trendsCount,
  queuedCount,
}: {
  runningOperation: ProjectOperation | null;
  activeAccounts: number;
  failedAccounts: number;
  trendsCount: number;
  queuedCount: number;
}) {
  if (runningOperation?.status === "queued") {
    return {
      title: "ждет своей очереди",
      description: "Система запустит действие автоматически, когда профиль будет свободен.",
      dotClass: "bg-[#ffcb45]",
      pulse: true,
    };
  }

  if (runningOperation?.status === "running") {
    return {
      title: runningOperation.action_type === "scraping" ? "обновляет идеи" : "готовит пост",
      description:
        runningOperation.action_type === "scraping"
          ? "Система смотрит ленту Threads и сохраняет идеи, которые помогут писать нативные посты."
          : "Система берет описание проекта, стиль и актуальные идеи, чтобы подготовить новый пост.",
      dotClass: "bg-[#70ff35]",
      pulse: true,
    };
  }

  if (failedAccounts > 0) {
    return {
      title: "нужно проверить профиль",
      description:
        "Откройте настройки проекта и посмотрите статус профиля. Если нужен повторный вход — обновите данные доступа. После сетевой автопаузы система попробует вернуть профиль сама.",
      dotClass: "bg-[#ffb020]",
      pulse: true,
    };
  }

  if (activeAccounts === 0) {
    return {
      title: "ждет профиль",
      description: "Подключите хотя бы один Threads-профиль. Без него система может готовить тексты, но не сможет их публиковать.",
      dotClass: "bg-[#9aa39a]",
      pulse: false,
    };
  }

  if (trendsCount === 0) {
    return {
      title: "готов к анализу",
      description: "Профиль подключен. Теперь обновите идеи, чтобы посты опирались на живую ленту.",
      dotClass: "bg-[#0076ff]",
      pulse: false,
    };
  }

  if (queuedCount > 0) {
    return {
      title: "расписание постов готово",
      description: "Все посты уже запланированы. Можно проверить тексты или просто ждать публикации по расписанию.",
      dotClass: "bg-[#70ff35]",
      pulse: true,
    };
  }

  return {
    title: "готов к генерации",
    description: "Идеи собраны, профиль активен. Можно создать пост сейчас или дождаться, пока система сделает это сама.",
    dotClass: "bg-[#70ff35]",
    pulse: false,
  };
}
