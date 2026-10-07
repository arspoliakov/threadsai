import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import {
  getApiErrorMessage,
  getLatestProjectOperation,
  getProjectDashboard,
  getProjectOperations,
  type ProjectAccountState,
  type ProjectDashboard,
  type ProjectOperation,
} from "../../api/client";
import { JourneyNextStep } from "../../components/JourneyNextStep";

export default function ProjectOverviewPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const activeProject = useRef(projectId);
  activeProject.current = projectId;
  const loadSequence = useRef(0);
  const [dashboard, setDashboard] = useState<ProjectDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [latestScrapingOperation, setLatestScrapingOperation] = useState<ProjectOperation | null>(null);
  const [operations, setOperations] = useState<ProjectOperation[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadDashboard() {
    const sequence = ++loadSequence.current;
    setIsLoading(true);
    setError(null);

    try {
      const [dashboardResult, operationsResult] = await Promise.all([
        getProjectDashboard(projectId),
        getProjectOperations(projectId, 12),
      ]);
      if (activeProject.current !== projectId || sequence !== loadSequence.current) return;
      setDashboard(dashboardResult);
      setOperations(operationsResult);
    } catch (loadError) {
      if (activeProject.current !== projectId || sequence !== loadSequence.current) return;
      const message = getApiErrorMessage(loadError, "Не удалось загрузить проект. Попробуйте ещё раз.");
      toast.error(message);
      setError(message);
    } finally {
      if (activeProject.current === projectId && sequence === loadSequence.current) setIsLoading(false);
    }
  }

  async function refreshScrapingOperation() {
    const operation = await getLatestProjectOperation(projectId, "scraping");
    if (activeProject.current !== projectId) return null;
    setLatestScrapingOperation(operation);
    void getProjectOperations(projectId, 12).then(items => { if (activeProject.current === projectId) setOperations(items); }).catch(() => undefined);

    if (operation?.status === "queued" || operation?.status === "running") {
      setError(null);
      setStatusMessage(null);
      return operation;
    }


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

    setDashboard(null); setOperations([]); setLatestScrapingOperation(null); setStatusMessage(null);
    void loadDashboard();
    void refreshScrapingOperation().catch(() => undefined);
    return () => { loadSequence.current++; };
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
      }).catch(() => undefined);
    }, 3500);

    return () => window.clearInterval(intervalId);
  }, [latestScrapingOperation?.status, projectId]);

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
      </header>

      {dashboard && !isLoading ? (
        <ProjectNextStep dashboard={dashboard} />
      ) : null}

      {dashboard && <div className="grid gap-3 sm:grid-cols-2">
        <Link className="rounded-2xl border border-[#dfe4dc] bg-white p-5 text-sm" to={`/app/projects/${projectId}/queue?create=1`}><strong>Создать отдельный пост →</strong><span className="mt-2 block text-[#66645d]">С помощью ИИ или собственным текстом.</span></Link>
        <Link className="rounded-2xl border border-[#dfe4dc] bg-white p-5 text-sm" to={`/app/projects/${projectId}/settings#content`}><strong>Тема и стиль →</strong><span className="mt-2 block text-[#66645d]">Изменения относятся только к этому проекту.</span></Link>
      </div>}

      {dashboard ? (
        <div className={`grid gap-4 ${dashboard.workflow && dashboard.workflow.blockers.length > 1 ? "xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start" : ""}`}>
          <WorkflowStatusCard dashboard={dashboard} />
          {dashboard.workflow && dashboard.workflow.blockers.length > 1 && <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-semibold">Что ещё нужно сделать</h2><div className="mt-3 space-y-3">{dashboard.workflow.blockers.slice(1).map(item=><Link className="block rounded-xl border p-3 text-sm" to={item.action_href} key={item.code}>{item.message}<span className="mt-1 block underline">{item.action_label}</span></Link>)}</div></section>}
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

    </section>
  );
}

function modeLabel(mode: string) {
  return mode === "auto" ? "ИИ пишет и публикует сам" : mode === "review" ? "ИИ готовит, вы проверяете" : "Пишу и планирую вручную";
}

function ProjectNextStep({ dashboard }: { dashboard: ProjectDashboard }) {
  const workflow = dashboard.workflow;
  if (!workflow) return null;
  const first = workflow.blockers[0];
  if (first) return <JourneyNextStep title="Нужно ваше действие" description={first.message} action={first.action_label} to={first.action_href} />;
  const action = workflow.next_action;
  if (!action) return null;
  const title = workflow.review_count > 0 ? `${workflow.review_count} постов ждут проверки`
    : workflow.running_jobs > 0 ? "Задания в работе"
    : workflow.publication_mode === "auto" ? "Автоматическая публикация включена"
    : workflow.publication_mode === "review" ? "ИИ готовит посты для вашей проверки" : "Создайте пост в удобном редакторе";
  const description = workflow.review_count > 0 ? "Откройте тексты, при необходимости поправьте их и выберите время. Без вашего решения черновики не отправятся."
    : workflow.running_jobs > 0 ? "Можно перейти в другой раздел. Статус обновится после завершения задания."
    : workflow.publication_mode === "auto" ? "Новые посты готовятся и выходят по расписанию. Отдельный текст можно добавить в разделе «Посты»."
    : workflow.publication_mode === "review" ? "Новые тексты появятся в разделе «На проверке». Вы решаете, какие опубликовать и когда."
    : "ИИ поможет написать текст или вы можете вставить свой. Сначала он сохранится черновиком.";
  return <JourneyNextStep title={title} description={description} action={action.label} to={action.href} />;
}

function WorkflowStatusCard({ dashboard }: { dashboard: ProjectDashboard }) {
  const workflow = dashboard.workflow;
  if (!workflow) return null;
  return <section className="rounded-2xl border border-[#dfe4dc] bg-[#07100e] p-5 text-white">
    <p className="text-sm text-white/70">{workflow.ready ? "Проект настроен" : "Требуется действие"}</p>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-2xl">Публикации проекта</h2><Link className="text-sm underline" to={`/app/projects/${dashboard.project.id}/settings#publication-mode`}>Изменить режим</Link></div><p className="mt-3 text-sm">{modeLabel(workflow.publication_mode)}</p>
    <p className="mt-3 text-sm text-white/70">Ближайший пост: {workflow.next_post_at ? formatDate(workflow.next_post_at) : "пока не запланирован"}</p>
    <div className="mt-5 grid grid-cols-3 gap-3"><MiniMetric label="На проверке" value={String(workflow.review_count)} /><MiniMetric label="В расписании" value={String(dashboard.posting_tasks_by_status.queued || 0)} /><MiniMetric label="Опубликовано" value={String((dashboard.posting_tasks_by_status.success || 0) + (dashboard.posting_tasks_by_status.partial_success || 0))} /></div>
  </section>;
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
    return "Подключение недоступно. Проверьте статус аккаунта в настройках проекта.";
  }
  if (normalized.includes("cookie") || normalized.includes("session")) {
    return "Доступ к профилю нужно обновить в настройках проекта.";
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return "Операция заняла слишком много времени. Проверьте результат в разделе «Посты» перед повторной отправкой.";
  }
  if (normalized.includes("selenium") || normalized.includes("webdriver") || normalized.includes("chrome")) {
    return "Браузер не завершил работу. Откройте пост и проверьте результат отправки.";
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
