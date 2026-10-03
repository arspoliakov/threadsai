import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import {
  getApiErrorMessage,
  getCurrentUser,
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
import { trackSeoEvent, trackSeoEventOnce } from "../../components/SeoAnalytics";
import { JourneyNextStep } from "../../components/JourneyNextStep";

type RunningAction = "scraping" | "generation" | null;

const DESCRIPTION_HINT =
  "Расскажите, о чём ваш проект, для кого вы пишете и как хотите звучать. Чем понятнее описание, тем точнее ИИ попадёт в ваш стиль.";

export default function ProjectOverviewPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const [dashboard, setDashboard] = useState<ProjectDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [runningAction, setRunningAction] = useState<RunningAction>(null);
  const [latestScrapingOperation, setLatestScrapingOperation] = useState<ProjectOperation | null>(null);
  const [operations, setOperations] = useState<ProjectOperation[]>([]);
  const [subscriptionActive, setSubscriptionActive] = useState<boolean | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadDashboard() {
    setIsLoading(true);
    setError(null);

    try {
      const [dashboardResult, operationsResult] = await Promise.all([
        getProjectDashboard(projectId),
        getProjectOperations(projectId, 12),
      ]);
      setDashboard(dashboardResult);
      setOperations(operationsResult);
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

    if (operation?.status === "queued" || operation?.status === "running") {
      setRunningAction("scraping");
      setError(null);
      setStatusMessage(null);
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
    let active = true;
    void getCurrentUser().then(user => { if (active) setSubscriptionActive(user.subscription_status); }).catch(() => undefined);
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    if (latestScrapingOperation?.status !== "running" && latestScrapingOperation?.status !== "queued") {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshScrapingOperation().then((operation) => {
        if (operation?.status !== "running" && operation?.status !== "queued") {
          void loadDashboard();
        }
      });
    }, 3500);

    return () => window.clearInterval(intervalId);
  }, [latestScrapingOperation?.status, projectId]);

  async function handleTriggerScraping() {
    if (!hasActiveAccount(dashboard)) {
      toast.error("Подключите рабочий профиль Threads в настройках проекта.");
      return;
    }
    setRunningAction("scraping");
    setStatusMessage(null);
    setError(null);

    try {
      const result = await triggerScraping(projectId);
      trackSeoEvent("trend_collection_started", {
        action: "scraping",
        project_id: projectId,
        source: "project_overview",
      });
      setStatusMessage(result.message || "Сбор идей добавлен в очередь.");
      toast.success("Сбор идей добавлен в очередь");
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
      trackSeoEvent("first_generation_started", {
        action: "generation",
        project_id: projectId,
        source: "project_overview",
      });
      const result = await triggerGeneration(projectId);
      trackSeoEvent("draft_created", { project_id: projectId, task_id: result.task_id });
      const queued = result.status === "queued" && Boolean(result.scheduled_at);
      if (queued) trackSeoEventOnce("first_post_queued", {
        project_id: projectId, task_id: result.task_id, source: "project_overview",
      });
      const message = queued ? `Пост добавлен в расписание: #${result.task_id}` : `Черновик готов: #${result.task_id}. Проверьте текст и добавьте его в расписание.`;
      setStatusMessage(message);
      toast.success(message);
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
    <section className="workspace-page space-y-5">
      <header className="grid gap-4 rounded-[24px] border border-[#dfe4dc] bg-white p-5 shadow-sm md:grid-cols-[1fr_auto] sm:p-6">
        <div>
          <h1 className="font-display text-4xl leading-none">
            {dashboard?.project.name || "Обзор проекта"}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[#66645d]">
            Тема, стиль и расписание — в настройках. Готовые тексты и время их выхода — в разделе «Посты».
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

      {dashboard && !isLoading ? (
        <ProjectNextStep dashboard={dashboard} projectId={projectId} runningAction={runningAction}
          subscriptionActive={subscriptionActive} onGenerate={() => void handleTriggerGeneration()} />
      ) : null}

      {dashboard ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#dfe4dc] bg-white px-5 py-4 text-sm">
          <span>Режим: <strong>{dashboard.project.auto_generate ? "ИИ пишет и публикует сам" : "Вы проверяете и планируете посты"}</strong></span>
          <Link className="underline underline-offset-4" to={`/app/projects/${projectId}/settings#publication-mode`}>Изменить режим</Link>
        </div>
      ) : null}

      <details className="rounded-2xl border border-[#dfe4dc] bg-white p-5">
        <summary className="cursor-pointer text-sm font-medium">Дополнительно: отдельный пост и идеи из ленты</summary>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <ActionPanel
          title="Обновить идеи для постов"
          description="Дополнительно: найдём удачные приёмы в ленте вашего аккаунта. ИИ умеет писать и без этой подборки."
          buttonText="Обновить идеи для постов"
          isLoading={runningAction === "scraping"}
          isDisabled={runningAction !== null || isLoading || !hasActiveAccount(dashboard)}
          disabledReason={!hasActiveAccount(dashboard) ? "Сначала подключите рабочий аккаунт Threads" : undefined}
          onClick={() => void handleTriggerScraping()}
        />
        <ActionPanel
          title="Отдельный пост с ИИ"
          description="Подготовим один текст по теме проекта. Он останется черновиком, пока вы не выберете время публикации."
          buttonText="Подготовить текст"
          isLoading={runningAction === "generation"}
          isDisabled={runningAction !== null || isLoading}
          disabledReason={undefined}
          onClick={() => void handleTriggerGeneration()}
        />
      </div>
      </details>

      {dashboard ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
          <SystemStatusCard
            dashboard={dashboard}
            operations={operations}
            latestScrapingOperation={latestScrapingOperation}
          />
          <ReadinessChecklist
            dashboard={dashboard}
            projectId={projectId}
          />
        </div>
      ) : null}

      {hasActiveAccount(dashboard) && (latestScrapingOperation?.status === "running" || latestScrapingOperation?.status === "queued") ? (
        <Notice tone="neutral">
          {latestScrapingOperation?.status === "queued" ? "Сбор идей ждёт своей очереди. Лента пока не читается." : "Читаем ленту и собираем идеи. Можно закрыть страницу — работа продолжится."}
        </Notice>
      ) : null}
      {statusMessage ? <Notice tone="neutral">{statusMessage}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <details className="overflow-hidden rounded-2xl border border-[#dfe4dc] bg-white shadow-sm">
        <summary className="cursor-pointer px-5 py-5 text-sm font-medium">История работы и ошибки</summary>

        {isLoading ? (
          <EmptyLine text="Загрузка сводки" />
        ) : dashboard ? (
          <ActivityLog operations={operations} dashboard={dashboard} latestScrapingOperation={latestScrapingOperation} />
        ) : (
          <EmptyLine text="Нет данных" />
        )}
      </details>

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

function ProjectNextStep({ dashboard, projectId, runningAction, onGenerate, subscriptionActive = null }: {
  dashboard: ProjectDashboard; projectId: number; runningAction: RunningAction;
  onGenerate: () => void;
  subscriptionActive?: boolean | null;
}) {
  if (subscriptionActive === false) {
    return <JourneyNextStep title="Для публикаций нужна подписка" description="Проект и тексты сохранены. Посмотрите тарифы или проверьте уже оплаченную подписку."
      action="Проверить подписку" to="/app/billing" />;
  }
  if (dashboard.project.is_active === false) {
    return <JourneyNextStep title="Проект на паузе" description="Новые автоматические посты сейчас не готовятся. Настройки и тексты сохранены."
      action="Открыть настройки" to={`/app/projects/${projectId}/settings`} />;
  }
  if (!(dashboard.project.global_context || dashboard.project.description || "").trim()) {
    return <JourneyNextStep title="Расскажите, о чём писать" description="Опишите вашу тему, аудиторию и пользу. Это основа текстов; остальные настройки можно уточнить позже."
      action="Описать проект" to={`/app/projects/${projectId}/settings`} />;
  }
  const queued = dashboard.posting_tasks_by_status.queued ?? 0;
  const drafts = dashboard.posting_tasks_by_status.draft ?? 0;
  if (dashboard.project.auto_generate && !hasActiveAccount(dashboard)) {
    return <JourneyNextStep title="Подключите аккаунт для автоматических постов" description="Сейчас ИИ не может публиковать. Добавьте аккаунт Threads в проект или проверьте его вход."
      action="Проверить аккаунты" to={`/app/projects/${projectId}/settings#profiles`} />;
  }
  if (dashboard.project.auto_generate && hasActiveAccount(dashboard)) {
    return <JourneyNextStep title="Автоматическая публикация включена"
      description={queued > 0 ? "Посты уже в календаре. Они отправятся по расписанию при действующей подписке и рабочем аккаунте. Текст и время можно изменить." : "ИИ будет готовить новые посты по расписанию при действующей подписке и рабочем аккаунте. Отдельный черновик создавать не обязательно."}
      action="Открыть календарь" to={`/app/projects/${projectId}/queue`} />;
  }
  if (queued > 0 || drafts > 0) {
    return <JourneyNextStep title={queued > 0 ? "Проверьте текст до публикации" : "Посмотрите подготовленный черновик"}
      description={queued > 0 ? "В расписании уже есть посты. Откройте ближайший: проверьте текст, профиль и время. Ненужный пост можно отменить до отправки." : "Черновик сохранён, но пока не запланирован. Откройте редактор, проверьте текст и назначьте время. Для публикации понадобится подключённый профиль. Отправка не начнётся сама."}
      action="Открыть черновики и календарь" to={`/app/projects/${projectId}/queue`} />;
  }
  return <JourneyNextStep title="Подготовьте первый черновик" description="Создайте текст по описанию проекта и вашему стилю. Профиль и идеи из ленты не обязательны. Затем откройте черновики: проверьте текст и выберите время публикации."
    action={runningAction === "generation" ? "Готовим текст…" : "Создать черновик"} onAction={onGenerate} disabled={runningAction !== null} />;
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
  const activeAccounts = dashboard.account_states.filter((account) => account.ready_for_ideas === true).length;
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
    queuedCount,
    autoGenerate: dashboard.project.auto_generate,
    projectActive: dashboard.project.is_active,
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
        <h2 className="mt-4 font-display text-2xl leading-tight">
          {status.title}
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-white/58">{status.description}</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <MiniMetric label="Готовые аккаунты" value={String(activeAccounts)} />
          <MiniMetric label="Идеи" value={String(dashboard.saved_trends_count)} />
          <MiniMetric label="В плане" value={String(queuedCount)} />
        </div>
      </div>
    </section>
  );
}

function ReadinessChecklist({
  dashboard,
  projectId,
}: {
  dashboard: ProjectDashboard;
  projectId: number;
}) {
  const activeAccounts = dashboard.account_states.filter((account) => account.ready_for_ideas === true).length;
  const checklist = [
    {
      title: "Опишите проект",
      done: Boolean((dashboard.project.global_context || dashboard.project.description || "").trim()),
      hint: "Что предлагаете, кому это нужно и какие темы раскрывать.",
      to: `/app/projects/${projectId}/settings`,
    },
    {
      title: "Подключите аккаунт Threads",
      done: activeAccounts > 0,
      hint: "Нужен для публикации и сбора ленты. Черновики можно готовить до подключения.",
      to: `/app/projects/${projectId}/settings#profiles`,
    },
    {
      title: "Настройте расписание",
      done: Boolean(dashboard.project.posts_per_day && dashboard.project.active_hours_start && dashboard.project.active_hours_end),
      hint: "Сколько постов в день выпускать с каждого аккаунта и в какие часы.",
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
          <h2 className="mt-2 font-display text-3xl">Настройка проекта</h2>
        </div>
        <span className="rounded-full bg-[#eef4ec] px-4 py-2 text-sm text-[#4f584f]">
          {completed}/{checklist.length} готово
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-[#687168]">
        Это основные настройки для публикаций. Стиль и идеи из ленты можно уточнить позже.
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

      <LogRow label="Аккаунты" value={formatAccountStates(dashboard.account_states)} />
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
  return dashboard?.account_states.some((account) => account.ready_for_ideas === true) ?? false;
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
  queuedCount,
  autoGenerate,
  projectActive,
}: {
  runningOperation: ProjectOperation | null;
  activeAccounts: number;
  failedAccounts: number;
  queuedCount: number;
  autoGenerate: boolean;
  projectActive: boolean;
}) {
  if (activeAccounts === 0 && runningOperation?.action_type === "scraping" && ["queued", "running"].includes(runningOperation.status)) {
    return { title: "нужен профиль для сбора идей", description: "Рабочий профиль не подключён. Лента не читается; можно подготовить текст по описанию проекта.", dotClass: "bg-[#9aa39a]", pulse: false };
  }
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
          ? "Читаем ленту Threads и сохраняем удачные приёмы для ваших постов."
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
      title: "нет рабочего аккаунта",
      description: "Публикация пока недоступна. Существующие тексты сохранены в разделе «Посты».",
      dotClass: "bg-[#9aa39a]",
      pulse: false,
    };
  }

  if (queuedCount > 0) {
    return {
      title: "расписание постов готово",
      description: "В расписании есть посты. Проверьте их тексты, профиль и время в календаре.",
      dotClass: "bg-[#70ff35]",
      pulse: true,
    };
  }

  if (!projectActive) {
    return { title: "проект на паузе", description: "Новые автоматические посты не готовятся. Тексты сохранены в разделе «Посты».", dotClass: "bg-[#9aa39a]", pulse: false };
  }
  if (autoGenerate) {
    return { title: "автоматический режим включён", description: "ИИ готовит посты по расписанию при действующей подписке и рабочем аккаунте. Сбор идей из ленты необязателен.", dotClass: "bg-[#70ff35]", pulse: false };
  }

  return {
    title: "готов к работе",
    description: "Подготовьте текст с ИИ или напишите свой в разделе «Посты». Для отправки выберите аккаунт и время.",
    dotClass: "bg-[#70ff35]",
    pulse: false,
  };
}
