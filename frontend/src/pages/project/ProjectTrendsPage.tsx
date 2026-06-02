import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

import { getProjectTrends, triggerScraping, type SavedTrend } from "../../api/client";

export default function ProjectTrendsPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const [trends, setTrends] = useState<SavedTrend[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCollecting, setIsCollecting] = useState(false);

  async function loadTrends({ silent = false }: { silent?: boolean } = {}) {
    setIsLoading(true);

    try {
      setTrends(await getProjectTrends(projectId));
      if (!silent) {
        toast.success("База трендов обновлена");
      }
    } catch {
      toast.error("Не удалось загрузить базу трендов проекта");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (Number.isFinite(projectId)) {
      void loadTrends({ silent: true });
    }
  }, [projectId]);

  async function handleCollectTrends() {
    setIsCollecting(true);

    try {
      await triggerScraping(projectId);
      toast.success("Сбор трендов поставлен в очередь");
      await loadTrends({ silent: true });
    } catch {
      toast.error("Не удалось запустить сбор трендов");
    } finally {
      setIsCollecting(false);
    }
  }

  const topScore = useMemo(
    () => trends.reduce((max, trend) => Math.max(max, Number(trend.virality_score ?? 0)), 0),
    [trends],
  );

  return (
    <section className="space-y-8">
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[#77766f]">
            Trend intelligence
          </p>
          <h1 className="mt-4 font-display text-5xl leading-none">Тренды</h1>
          <p className="mt-6 max-w-2xl text-sm leading-6 text-[#66645d]">
            Разобранные паттерны из ленты: механика хука, структура, ритм и оценка
            виральности.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleCollectTrends()}
          disabled={isLoading || isCollecting}
          className="flex h-11 w-fit items-center gap-3 rounded-2xl border border-[#151515] px-5 font-mono text-xs uppercase tracking-[0.16em] transition-all duration-200 ease-in-out hover:bg-[#151515] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isCollecting ? <Spinner /> : null}
          Собрать тренды
        </button>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <MetricCard label="Собрано трендов" value={isLoading ? "..." : String(trends.length)} />
        <MetricCard label="Лучший score" value={isLoading ? "..." : String(topScore || "нет")} />
      </div>

      {isLoading ? (
        <TrendSkeleton />
      ) : trends.length === 0 ? (
        <EmptyState
          title="Тренды еще не собраны"
          description="Запустите анализ трендов на сводке проекта или дождитесь ежедневного джоба."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {trends.map((trend) => (
            <TrendCard key={trend.id} trend={trend} />
          ))}
        </div>
      )}
    </section>
  );
}

function TrendCard({ trend }: { trend: SavedTrend }) {
  return (
    <article className="rounded-3xl border border-[#deded7] bg-white p-6 shadow-sm transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-6 border-b border-[#e7e5de] pb-5">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#77766f]">
            #{trend.id} / {trend.platform}
          </p>
          <h2 className="mt-3 max-w-xl font-display text-2xl leading-tight">
            {trend.author_handle || "лента"}
          </h2>
        </div>
        <div className="rounded-2xl border border-[#151515] px-4 py-3 text-right font-mono">
          <p className="text-[10px] uppercase tracking-[0.14em] text-[#77766f]">Score</p>
          <p className="text-2xl leading-none">{trend.virality_score ?? "—"}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        <InfoBlock title="Hook Mechanic" value={trend.hook_mechanic || trend.hook_analysis} />
        <InfoBlock title="Structure Pattern" value={trend.structure_pattern} />
        <InfoBlock title="Tone & Rhythm" value={trend.tone_and_rhythm} />
      </div>

      <footer className="mt-5 flex flex-wrap gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#77766f]">
        <span className="rounded-full border border-[#d8d8d2] px-3 py-2">
          ER: {formatMetric(trend.metrics_json?.engagement_rate)}
        </span>
        <span className="rounded-full border border-[#d8d8d2] px-3 py-2">
          {formatDate(trend.created_at)}
        </span>
      </footer>
    </article>
  );
}

function InfoBlock({ title, value }: { title: string; value?: string | null }) {
  return (
    <div className="rounded-2xl border border-[#e1e1dc] bg-[#fbfaf5] p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#77766f]">
        {title}
      </p>
      <p className="mt-2 text-sm leading-6 text-[#333]">{value || "—"}</p>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-[#deded7] bg-white p-6 shadow-sm">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77766f]">{label}</p>
      <p className="mt-4 font-display text-4xl leading-none">{value}</p>
    </div>
  );
}

function TrendSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {[1, 2, 3, 4].map((item) => (
        <div key={item} className="h-80 animate-pulse rounded-3xl border border-[#deded7] bg-white p-6 shadow-sm">
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
    <div className="overflow-hidden rounded-3xl border border-dashed border-[#c9c9c3] bg-white/70 shadow-sm">
      <div className="grid items-center gap-6 p-6 text-center sm:p-8 lg:grid-cols-[1fr_24rem] lg:text-left">
        <div>
          <p className="font-display text-4xl leading-none text-[#151515]">{title}</p>
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

function formatMetric(value: unknown) {
  return typeof value === "number" ? value.toFixed(4) : "—";
}

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString("ru-RU");
}
