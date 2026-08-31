import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

import {
  getApiErrorMessage,
  getProjectDashboard,
  getLatestProjectOperation,
  getProjectTrends,
  triggerScraping,
  type ProjectDashboard,
  type ProjectOperation,
  type SavedTrend,
} from "../../api/client";
import { DismissibleTip } from "../../components/DismissibleTip";
import { trackSeoEvent } from "../../components/SeoAnalytics";

export default function ProjectTrendsPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const [trends, setTrends] = useState<SavedTrend[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCollecting, setIsCollecting] = useState(false);
  const [collectionOperation, setCollectionOperation] = useState<ProjectOperation | null>(null);
  const [dashboard, setDashboard] = useState<ProjectDashboard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasThreadsProfile = dashboard?.account_states.some((account) => account.status === "active") ?? false;

  async function loadTrends({ silent = false }: { silent?: boolean } = {}) {
    if (trends.length === 0) {
      setIsLoading(true);
    }
    setLoadError(null);

    try {
      setTrends(await getProjectTrends(projectId));
      if (!silent) {
        toast.success("Подборка идей обновлена");
      }
    } catch (error) {
      const message = getApiErrorMessage(error, "Не удалось загрузить актуальные идеи проекта.");
      setLoadError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (Number.isFinite(projectId)) {
      void loadTrends({ silent: true });
      void loadDashboard();
      void refreshCollectionStatus();
    }
  }, [projectId]);

  useEffect(() => {
    if (collectionOperation?.status !== "queued" && collectionOperation?.status !== "running") {
      return;
    }

    const intervalId = window.setInterval(() => void refreshCollectionStatus(), 3500);
    return () => window.clearInterval(intervalId);
  }, [collectionOperation?.status, projectId]);

  async function refreshCollectionStatus() {
    try {
      const operation = await getLatestProjectOperation(projectId, "scraping");
      const wasRunning = isCollecting || collectionOperation?.status === "queued" || collectionOperation?.status === "running";
      setCollectionOperation(operation);
      const running = operation?.status === "queued" || operation?.status === "running";
      setIsCollecting(Boolean(running));

      if (wasRunning && operation?.status === "success") {
        await loadTrends({ silent: true });
        toast.success("Новая подборка идей готова");
      } else if (wasRunning && operation?.status === "failed") {
        toast.error("Подборка не обновилась. Ошибка уже отправлена команде.");
      }
    } catch {
      // Existing ideas remain available even if status polling is temporarily unavailable.
    }
  }

  async function loadDashboard() {
    try {
      setDashboard(await getProjectDashboard(projectId));
    } catch {
      // Ideas remain readable even if project readiness is temporarily unavailable.
    }
  }

  async function handleCollectTrends() {
    if (!hasThreadsProfile) {
      toast.error("Сначала подключите рабочий профиль Threads. После этого можно будет собрать идеи.");
      return;
    }

    setIsCollecting(true);

    try {
      const result = await triggerScraping(projectId);
      trackSeoEvent("trend_collection_started", {
        action: "scraping",
        project_id: projectId,
        source: "project_trends",
      });
      setCollectionOperation({
        id: result.operation_id,
        project_id: result.project_id,
        action_type: "scraping",
        status: result.status,
        message: result.message,
        result_json: null,
        started_at: new Date().toISOString(),
        finished_at: null,
      });
      toast.success("Сбор идей запущен. Можно перейти в другой раздел.");
      void refreshCollectionStatus();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Не удалось запустить сбор идей."));
      setIsCollecting(false);
    }
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-4xl leading-none">Актуальные идеи для постов</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[#66645d]">
            Здесь собраны свежие идеи из ленты Threads, которые сейчас интересны аудитории. Мы анализируем,
            как лучше начать пост, какую эмоцию передать и как удержать внимание читателей. Система обновляет
            подборку автоматически раз в 3 дня, но вы можете собрать новые идеи прямо сейчас.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleCollectTrends()}
          disabled={isLoading || isCollecting || !hasThreadsProfile}
          title={!hasThreadsProfile ? "Сначала подключите рабочий профиль Threads" : undefined}
          className="flex h-12 w-full items-center justify-center gap-3 rounded-full border border-[#151515] bg-white px-5 text-sm transition-all duration-200 ease-in-out hover:bg-[#151515] hover:text-white disabled:cursor-not-allowed disabled:opacity-50 md:w-fit"
        >
          {isCollecting ? <Spinner /> : null}
          {isCollecting
            ? "Собираем идеи"
            : hasThreadsProfile
              ? "Обновить подборку идей"
              : "Сначала подключите профиль"}
        </button>
      </header>

      {isCollecting ? (
        <div className="flex items-start gap-3 rounded-[20px] border border-[#b9d5ee] bg-[#f1f8ff] p-4 text-sm leading-6 text-[#31516d]">
          <Spinner />
          <p>
            Система изучает ленту Threads в фоне. Обычно это занимает несколько минут. Можно спокойно перейти в
            другой раздел или закрыть страницу — работа не остановится.
          </p>
        </div>
      ) : null}

      <DismissibleTip storageKey="threadsgo.trends-tip" title="Идеи — это не темы для копирования">
        Система смотрит, как устроены живые посты: с чего они начинаются, где возникает напряжение и какой у них
        ритм. Потом эти паттерны помогают писать свои тексты, а не повторять чужие.
      </DismissibleTip>

      <div className="grid gap-3 md:grid-cols-2">
        <MetricCard label="Найдено свежих идей" value={isLoading ? "..." : String(trends.length)} />
        <MetricCard label="Последнее обновление" value={getLatestTrendDate(trends)} />
      </div>

      {isLoading ? (
        <TrendSkeleton />
      ) : loadError && trends.length === 0 ? (
        <EmptyState title="Идеи пока не загрузились" description={loadError} />
      ) : trends.length === 0 ? (
        <EmptyState
          title="Актуальные идеи еще не собраны"
          description="Нажмите «Обновить подборку идей» или дождитесь автоматического сбора. Он проходит раз в 3 дня."
        />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {trends.map((trend, index) => (
            <TrendCard key={trend.id} trend={trend} index={index} />
          ))}
        </div>
      )}
    </section>
  );
}

function TrendCard({ trend, index }: { trend: SavedTrend; index: number }) {
  return (
    <article className="rounded-[24px] border border-[#deded7] bg-white p-5 shadow-sm transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-5 border-b border-[#e7e5de] pb-4">
        <h2 className="font-display text-2xl leading-tight">Идея №{index + 1}</h2>
      </div>

      <div className="mt-4 grid gap-3">
        <InfoBlock title="Как цепляет" value={trend.hook_mechanic || trend.hook_analysis} />
        <InfoBlock title="Как устроен пост" value={trend.structure_pattern} />
        <InfoBlock title="Тон и ритм" value={trend.tone_and_rhythm} />
      </div>

      <footer className="mt-4 flex flex-wrap gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#77766f]">
        <span className="rounded-full border border-[#d8d8d2] px-3 py-2">{formatDate(trend.created_at)}</span>
      </footer>
    </article>
  );
}

function InfoBlock({ title, value }: { title: string; value?: string | null }) {
  return (
    <div className="rounded-2xl border border-[#e1e1dc] bg-[#fbfaf5] p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#77766f]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[#333]">{value || "—"}</p>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-[#deded7] bg-white p-5 shadow-sm">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77766f]">{label}</p>
      <p className="mt-3 font-display text-3xl leading-none">{value}</p>
    </div>
  );
}

function TrendSkeleton() {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {[1, 2, 3, 4].map((item) => (
        <div key={item} className="h-64 animate-pulse rounded-[24px] border border-[#deded7] bg-white p-5 shadow-sm">
          <div className="h-3 w-24 rounded-full bg-[#deded7]" />
          <div className="mt-8 h-7 w-2/3 rounded-full bg-[#deded7]" />
          <div className="mt-10 h-20 rounded-2xl bg-[#f1f0ea]" />
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
        <img src="/interface/empty-trends.webp" alt="" className="hidden w-full rounded-[2rem] object-cover lg:block" />
      </div>
    </div>
  );
}

function Spinner() {
  return <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />;
}

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getLatestTrendDate(trends: SavedTrend[]) {
  if (trends.length === 0) {
    return "Ещё не было";
  }

  const latest = [...trends].sort(
    (first, second) => new Date(second.created_at).getTime() - new Date(first.created_at).getTime(),
  )[0];
  const date = new Date(latest.created_at);
  const today = new Date();
  const day = date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long" });
  const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === today.toDateString() ? `Сегодня в ${time}` : `${day} в ${time}`;
}
