import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

import { getProjectTrends, triggerScraping, type SavedTrend } from "../../api/client";
import { DismissibleTip } from "../../components/DismissibleTip";

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
        toast.success("Подборка идей обновлена");
      }
    } catch {
      toast.error("Не удалось загрузить актуальные идеи проекта");
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
      toast.success("Сбор идей запущен");
      await loadTrends({ silent: true });
    } catch {
      toast.error("Не удалось запустить сбор идей");
    } finally {
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
          disabled={isLoading || isCollecting}
          className="flex h-11 w-fit items-center gap-3 rounded-2xl border border-[#151515] px-5 font-mono text-xs uppercase tracking-[0.16em] transition-all duration-200 ease-in-out hover:bg-[#151515] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isCollecting ? <Spinner /> : null}
          Обновить подборку идей
        </button>
      </header>

      <DismissibleTip storageKey="threadsgo.trends-tip" title="Идеи — это не темы для копирования">
        Система смотрит, как устроены живые посты: с чего они начинаются, где возникает напряжение и какой у них
        ритм. Потом эти паттерны помогают писать свои тексты, а не повторять чужие.
      </DismissibleTip>

      <div className="grid gap-3 md:grid-cols-2">
        <MetricCard label="Найдено свежих идей" value={isLoading ? "..." : String(trends.length)} />
      </div>

      {isLoading ? (
        <TrendSkeleton />
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
