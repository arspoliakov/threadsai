import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
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
        toast.success("Данные обновлены");
      }
    } catch {
      toast.error("Не удалось загрузить кабинет. Проверьте backend и авторизацию.");
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
    <section className="space-y-7">
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-5xl leading-[0.9] tracking-[-0.055em] text-[#111] sm:text-6xl">
            Проекты
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-[#626961]">
            Здесь видно, что происходит с контентом: когда следующий сбор трендов,
            сколько постов уже вышло и какой проект ждет ближайшую публикацию.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadSummary()}
          disabled={isLoading}
          className="inline-flex h-12 w-fit items-center gap-3 rounded-full border border-[#141815] bg-white px-5 text-sm text-[#141815] shadow-sm transition hover:bg-[#141815] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? <Spinner /> : <RefreshIcon />}
          Обновить
        </button>
      </header>

      <div className="grid auto-rows-[minmax(170px,auto)] gap-4 xl:grid-cols-4">
        <SystemWidget
          nextTrendCheck={summary?.next_trend_check ?? null}
          isLoading={isLoading}
          className="xl:col-span-2"
        />
        <StatsWidget
          icon={<FolderIcon />}
          label="Проекты"
          value={isLoading ? "..." : String(summary?.projects.length ?? 0)}
          description="активные рабочие контуры"
        />
        <StatsWidget
          icon={<SendIcon />}
          label="Опубликовано"
          value={isLoading ? "..." : String(totalPublished)}
          description="постов вышло через систему"
        />

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
      className={`relative overflow-hidden rounded-[32px] border border-[#151b17] bg-[#080d0b] p-7 text-white shadow-[0_24px_90px_rgba(10,10,10,0.20)] ${className}`}
    >
      <div className="absolute right-[-70px] top-[-100px] h-64 w-64 rounded-full bg-[#70ff35]/16 blur-3xl" />
      <div className="absolute bottom-[-100px] left-[30%] h-64 w-64 rounded-full bg-[#0076ff]/20 blur-3xl" />
      <div className="relative flex h-full flex-col justify-between gap-10">
        <div>
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#70ff35] opacity-70" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-[#70ff35]" />
            </span>
            <span className="text-sm text-white/68">Система онлайн</span>
          </div>
          <h2 className="mt-7 max-w-xl font-display text-5xl leading-[0.9] tracking-[-0.055em]">
            Автономный контур активен
          </h2>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-5">
          <div className="flex items-center gap-3 text-white/62">
            <RadarIcon />
            <span className="text-sm">Следующий сбор трендов</span>
          </div>
          <p className="mt-3 text-2xl text-white">
            {isLoading ? "Загрузка" : formatDateTime(nextTrendCheck)}
          </p>
        </div>
      </div>
    </article>
  );
}

function StatsWidget({
  icon,
  label,
  value,
  description,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  description: string;
}) {
  return (
    <article className="rounded-[32px] border border-[#dfe4dc] bg-white p-7 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#eef4ec] text-[#111]">
        {icon}
      </div>
      <p className="mt-8 font-display text-6xl leading-none text-[#111]">{value}</p>
      <p className="mt-4 text-lg text-[#151815]">{label}</p>
      <p className="mt-2 text-sm leading-6 text-[#6b716a]">{description}</p>
    </article>
  );
}

function ProjectCard({ project, priority }: { project: DashboardProjectSummary; priority: number }) {
  const isLarge = priority === 0;

  return (
    <Link
      to={`/app/projects/${project.id}`}
      className={`group relative overflow-hidden rounded-[32px] border border-[#dfe4dc] bg-[#fbfcf7] p-7 shadow-sm transition hover:-translate-y-0.5 hover:border-[#141815] hover:shadow-md ${
        isLarge ? "xl:col-span-2" : ""
      }`}
    >
      <div className="absolute right-[-70px] top-[-70px] h-44 w-44 rounded-full bg-[#70ff35]/12 blur-3xl transition group-hover:bg-[#0076ff]/16" />
      <div className="relative flex h-full min-h-48 flex-col justify-between gap-10">
        <div className="flex items-start justify-between gap-5">
          <div>
            <h2 className="font-display text-4xl leading-none tracking-[-0.04em] text-[#111]">
              {project.name}
            </h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-[#667066]">
              Нажмите, чтобы открыть очередь, тренды, аккаунты и настройки проекта.
            </p>
          </div>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#101413] text-white transition group-hover:bg-[#70ff35] group-hover:text-[#07100e]">
            <ArrowIcon />
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Metric icon={<SendIcon />} label="Опубликовано" value={String(project.published_count)} />
          <Metric icon={<ClockIcon />} label="Ближайший пост" value={formatDateTime(project.next_post_time)} />
        </div>
      </div>
    </Link>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#e2e6df] bg-white/70 p-4">
      <div className="flex items-center gap-2 text-[#5e675e]">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <p className="mt-2 text-sm leading-5 text-[#252a25]">{value}</p>
    </div>
  );
}

function SkeletonProjects() {
  return (
    <>
      {[1, 2, 3].map((item) => (
        <div
          key={item}
          className="min-h-48 animate-pulse rounded-[32px] border border-[#dfe4dc] bg-white/70 p-7 shadow-sm"
        >
          <div className="h-10 w-10 rounded-2xl bg-[#dfe4dc]" />
          <div className="mt-8 h-8 w-3/4 rounded-full bg-[#dfe4dc]" />
          <div className="mt-12 h-3 w-1/2 rounded-full bg-[#dfe4dc]" />
        </div>
      ))}
    </>
  );
}

function EmptyProjects() {
  return (
    <div className="rounded-[32px] border border-dashed border-[#c9d1c7] bg-white/70 p-10 text-center shadow-sm xl:col-span-4">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#eef4ec]">
        <FolderIcon />
      </div>
      <p className="mt-5 font-display text-4xl text-[#111]">Проектов пока нет</p>
      <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#667066]">
        Создайте первый проект, подключите Threads-профиль и запустите сбор трендов.
      </p>
    </div>
  );
}

function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border border-current border-t-transparent" />;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Не запланировано";
  }

  return new Date(value).toLocaleString("ru-RU");
}

function RefreshIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.3-5.7M20 5v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7.8A2.8 2.8 0 0 1 6.8 5h3l2 2h5.4A2.8 2.8 0 0 1 20 9.8v6.4a2.8 2.8 0 0 1-2.8 2.8H6.8A2.8 2.8 0 0 1 4 16.2V7.8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m4 12 16-8-5 16-3-7-8-1Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RadarIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 21a9 9 0 1 0-9-9M12 21v-4M12 21h4M12 12l6-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
