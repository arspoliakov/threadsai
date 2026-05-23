import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { getDashboardSummary, type DashboardProjectSummary, type DashboardSummary } from "../api/client";

export default function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function loadSummary({ silent = false }: { silent?: boolean } = {}) {
    setIsLoading(true);

    try {
      setSummary(await getDashboardSummary());
      if (!silent) {
        toast.success("Телеметрия обновлена");
      }
    } catch {
      toast.error("Не удалось загрузить телеметрию. Проверьте backend и авторизацию.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadSummary({ silent: true });
  }, []);

  const totalPublished = useMemo(
    () => summary?.projects.reduce((sum, project) => sum + project.published_count, 0) ?? 0,
    [summary],
  );

  return (
    <section className="space-y-8">
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#77766f]">
            Bento telemetry
          </p>
          <h1 className="mt-3 font-display text-5xl leading-none tracking-tight text-[#151515]">
            Главный дашборд
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void loadSummary()}
          disabled={isLoading}
          className="flex h-11 w-fit items-center gap-3 rounded-2xl border border-[#151515] px-5 font-mono text-xs uppercase tracking-[0.16em] transition-all duration-200 ease-in-out hover:bg-[#151515] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? <Spinner /> : null}
          Обновить
        </button>
      </header>

      <div className="grid auto-rows-[minmax(170px,auto)] gap-4 lg:grid-cols-4">
        <SystemWidget
          nextTrendCheck={summary?.next_trend_check ?? null}
          isLoading={isLoading}
          className="lg:col-span-2"
        />
        <StatsWidget
          label="Проектов"
          value={isLoading ? "..." : String(summary?.projects.length ?? 0)}
        />
        <StatsWidget label="Опубликовано" value={isLoading ? "..." : String(totalPublished)} />

        {isLoading ? (
          <SkeletonProjects />
        ) : !summary || summary.projects.length === 0 ? (
          <EmptyProjects />
        ) : (
          summary.projects.map((project, index) => (
            <ProjectCard key={project.id} project={project} priority={index} />
          ))
        )}
      </div>
    </section>
  );
}

function SystemWidget({
  nextTrendCheck,
  isLoading,
  className = "",
}: {
  nextTrendCheck: string | null;
  isLoading: boolean;
  className?: string;
}) {
  return (
    <article
      className={`relative overflow-hidden rounded-[28px] border border-[#262626] bg-[#101010] p-7 text-white shadow-[0_24px_80px_rgba(10,10,10,0.18)] ${className}`}
    >
      <div className="absolute right-[-90px] top-[-90px] h-56 w-56 rounded-full bg-[#d8f36a]/10 blur-2xl" />
      <div className="relative flex h-full flex-col justify-between gap-10">
        <div>
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#8cff68] opacity-70" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-[#8cff68]" />
            </span>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#d8d8cf]">
              System: Online
            </p>
          </div>
          <h2 className="mt-7 max-w-xl font-display text-4xl leading-[0.95] tracking-tight">
            Автономный контур активен
          </h2>
        </div>

        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8f8f86]">
            Следующий сбор трендов
          </p>
          <p className="mt-2 text-xl text-[#f4f1e8]">
            {isLoading ? "Загрузка" : formatDateTime(nextTrendCheck)}
          </p>
        </div>
      </div>
    </article>
  );
}

function StatsWidget({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-[28px] border border-[#deded7] bg-white p-7 shadow-sm transition-all duration-200 ease-in-out hover:shadow-md">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#77766f]">{label}</p>
      <p className="mt-8 font-display text-6xl leading-none text-[#151515]">{value}</p>
    </article>
  );
}

function ProjectCard({ project, priority }: { project: DashboardProjectSummary; priority: number }) {
  const isLarge = priority === 0;

  return (
    <Link
      to={`/projects/${project.id}`}
      className={`group rounded-[28px] border border-[#deded7] bg-[#fbfaf5] p-7 shadow-sm transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:border-[#151515] hover:shadow-md ${
        isLarge ? "lg:col-span-2" : ""
      }`}
    >
      <div className="flex h-full min-h-44 flex-col justify-between gap-10">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#77766f]">
            Project #{project.id}
          </p>
          <h2 className="mt-4 font-display text-4xl leading-none tracking-tight text-[#151515]">
            {project.name}
          </h2>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Metric label="Опубликовано" value={String(project.published_count)} />
          <Metric label="Ближайший пост" value={formatDateTime(project.next_post_time)} />
        </div>
      </div>
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8d8b84]">{label}</p>
      <p className="mt-2 text-sm leading-5 text-[#302f2b]">{value}</p>
    </div>
  );
}

function SkeletonProjects() {
  return (
    <>
      {[1, 2, 3].map((item) => (
        <div
          key={item}
          className="min-h-44 animate-pulse rounded-[28px] border border-[#deded7] bg-white/70 p-7 shadow-sm"
        >
          <div className="h-3 w-24 rounded-full bg-[#deded7]" />
          <div className="mt-6 h-8 w-3/4 rounded-full bg-[#deded7]" />
          <div className="mt-12 h-3 w-1/2 rounded-full bg-[#deded7]" />
        </div>
      ))}
    </>
  );
}

function EmptyProjects() {
  return (
    <div className="rounded-[28px] border border-dashed border-[#c9c9c3] bg-white/70 p-10 text-center shadow-sm lg:col-span-4">
      <p className="font-display text-3xl text-[#151515]">Активных проектов пока нет</p>
      <p className="mt-3 text-sm text-[#66645d]">Создайте проект, чтобы запустить контентный контур.</p>
    </div>
  );
}

function Spinner() {
  return <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Не запланировано";
  }

  return new Date(value).toLocaleString("ru-RU");
}
