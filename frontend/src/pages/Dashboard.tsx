import { useEffect, useMemo, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import {
  deleteProject,
  getApiErrorMessage,
  getDashboardSummary,
  getCurrentUser,
  getAccounts,
  type DashboardProjectSummary,
  type DashboardSummary,
} from "../api/client";
import { BotStatusCard } from "../components/BotStatusCard";
import { JourneyNextStep } from "../components/JourneyNextStep";
import "./dashboard-polish.css";

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [hasSubscription, setHasSubscription] = useState<boolean | null>(null);
  const [preferredProjectId, setPreferredProjectId] = useState<number | null>(null);
  const [hasAccounts, setHasAccounts] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [projectToDelete, setProjectToDelete] =
    useState<DashboardProjectSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<number | null>(
    null,
  );

  async function loadSummary({ silent = false }: { silent?: boolean } = {}) {
    setIsLoading(true);
    setLoadError(null);

    try {
      setSummary(await getDashboardSummary());
      if (!silent) {
        toast.success("Данные обновлены");
      }
    } catch (error) {
      const message = getApiErrorMessage(
        error,
        "Не удалось загрузить проекты. Попробуйте ещё раз.",
      );
      setLoadError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadSummary({ silent: true });
    let cancelled = false;
    void Promise.all([getCurrentUser(), getAccounts()]).then(([user, accounts]) => {
      if (!cancelled) { setHasSubscription(user.subscription_status); setHasAccounts(accounts.length > 0); try { setPreferredProjectId(Number(window.sessionStorage.getItem(`threadsgo.current-project.${user.id}`)) || null); } catch { /* Select first project when storage is unavailable. */ } }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (isLoading || !summary || hasSubscription === null || new URLSearchParams(location.search).has("manage") || new URLSearchParams(location.search).has("profile")) return;
    if (summary.projects.length === 0) navigate("/app/setup", { replace: true });
    else { const selected = summary.projects.find(project => project.id === preferredProjectId) ?? summary.projects[0]; navigate(`/app/projects/${selected.id}`, { replace: true }); }
  }, [isLoading, summary, hasSubscription, preferredProjectId, location.search, navigate]);

  async function handleDeleteProject(project: DashboardProjectSummary) {
    setDeletingProjectId(project.id);

    try {
      const deletion = deleteProject(project.id);
      toast.promise(deletion, {
        loading: "Удаляем проект...",
        success: "Проект удалён. Аккаунты можно добавить в другой проект.",
        error: (error) =>
          getApiErrorMessage(error, "Не удалось удалить проект."),
      });
      await deletion;
      setProjectToDelete(null);
      await loadSummary({ silent: true });
    } catch {
      // The promise toast displays the error; keep the dialog open for retry.
    } finally {
      setDeletingProjectId(null);
    }
  }

  const totalPublished = useMemo(
    () =>
      summary?.projects.reduce(
        (sum, project) => sum + project.published_count,
        0,
      ) ?? 0,
    [summary],
  );
  const nextProject = useMemo(() => getNextProject(summary), [summary]);

  return (
    <section className="dashboard-view space-y-4 sm:space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-4xl leading-[0.95] tracking-[-0.045em] text-[#111] sm:text-5xl">
            Ваши проекты
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#67786e]">
            Нейросеть пишет посты по настройкам проекта. Вы выбираете тему, стиль и время публикации.
          </p>
        </div>

        {summary?.projects.length !== 0 ? (
          <div className="grid gap-3 sm:flex sm:items-center">
            <button
              type="button"
              onClick={() => navigate("/app/setup?new=1")}
              className="tg-action inline-flex h-12 w-full items-center justify-center gap-3 rounded-full bg-[#141815] px-5 text-sm text-white shadow-sm transition hover:bg-[#70ff35] hover:text-[#07100e] sm:w-fit"
            >
              <PlusIcon />
              Создать проект
            </button>
            <button
              type="button"
              onClick={() => void loadSummary()}
              disabled={isLoading}
              className="tg-action inline-flex h-12 w-full items-center justify-center gap-3 rounded-full border border-[#141815] bg-white px-5 text-sm text-[#141815] shadow-sm transition hover:bg-[#141815] hover:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-fit"
            >
              {isLoading ? <Spinner /> : <RefreshIcon />}
              Обновить
            </button>
          </div>
        ) : null}
      </header>

      {!isLoading && summary && summary.projects.length > 0 ? (() => {
        const attentionProject = summary.projects.find((project) => project.is_active && project.ready_accounts_count === 0)
          || summary.projects.find((project) => project.is_active && !project.next_post_time);
        return attentionProject ? <div className="dashboard-next-step tg-reveal" key={attentionProject.id}><JourneyNextStep title={`Продолжите настройку «${attentionProject.name}»`}
          description={attentionProject.ready_accounts_count === 0 ? "Проверьте подключение аккаунта Threads, чтобы публиковать посты." : "Ближайший пост пока не запланирован. Откройте проект, чтобы проверить режим работы или подготовить текст."}
          action="Продолжить" to={`/app/projects/${attentionProject.id}`} /></div> : null;
      })() : null}

      {summary?.projects.length !== 0 ? (
        <div className="grid gap-3 lg:grid-cols-4">
          <BotStatusCard
            nextTrendCheck={nextProject?.next_post_time ?? null}
            currentAction={getCurrentAction(summary, isLoading)}
            nextActionLabel={
              nextProject
                ? `Следующий пост: «${nextProject.name}»`
                : "Следующий пост"
            }
            compact
            className="lg:col-span-2"
          />
          <StatsWidget
            icon={<FolderIcon />}
            label={formatProjectCountLabel(summary?.projects.length ?? 0)}
            value={isLoading ? "..." : String(summary?.projects.length ?? 0)}
          />
          <StatsWidget
            icon={<SendIcon />}
            label={formatPublishedCountLabel(totalPublished)}
            value={isLoading ? "..." : String(totalPublished)}
          />
        </div>
      ) : null}

      <div className="dashboard-project-grid grid gap-3 lg:grid-cols-2 2xl:grid-cols-3" aria-busy={isLoading}>
        {isLoading ? (
          <SkeletonProjects />
        ) : loadError ? (
          <LoadError
            message={loadError}
            onRetry={() => void loadSummary({ silent: true })}
          />
        ) : !summary || summary.projects.length === 0 ? (
          <EmptyProjects onCreate={() => navigate("/app/setup?new=1")} />
        ) : (
          summary.projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isDeleting={deletingProjectId === project.id}
              onDelete={() => setProjectToDelete(project)}
            />
          ))
        )}
      </div>

      {projectToDelete ? (
        <DeleteProjectDialog
          project={projectToDelete}
          isDeleting={deletingProjectId === projectToDelete.id}
          onClose={() => setProjectToDelete(null)}
          onConfirm={() => void handleDeleteProject(projectToDelete)}
        />
      ) : null}
    </section>
  );
}

function getNextProject(summary: DashboardSummary | null) {
  if (!summary) {
    return null;
  }

  return (
    summary.projects
      .filter((project) => Boolean(project.next_post_time))
      .sort(
        (first, second) =>
          new Date(first.next_post_time || 0).getTime() -
          new Date(second.next_post_time || 0).getTime(),
      )[0] ?? null
  );
}

function getCurrentAction(
  summary: DashboardSummary | null,
  isLoading: boolean,
) {
  if (isLoading) {
    return "Загружаем проекты";
  }

  if (!summary || summary.projects.length === 0) {
    return "Ждем первый проект";
  }

  const activeAccounts = summary.projects.reduce(
    (sum, project) => sum + project.ready_accounts_count,
    0,
  );
  const pausedAccounts = summary.projects.reduce(
    (sum, project) => sum + project.paused_accounts_count,
    0,
  );

  if (activeAccounts === 0) {
    return pausedAccounts > 0 ? "Аккаунты на паузе" : "Нужно подключить аккаунт";
  }

  if (pausedAccounts > 0) {
    return "Часть профилей на паузе";
  }

  if (!summary.projects.some((project) => project.next_post_time)) {
    return "Публикации пока не запланированы";
  }

  return "Следим за публикациями";
}

function StatsWidget({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <article className="tg-interactive-card rounded-[24px] border border-[#dfe4dc] bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#eef4ec] text-[#111]">
        {icon}
      </div>
      <p className="mt-5 font-display text-4xl leading-none text-[#111]">
        {value}
      </p>
      <p className="mt-3 text-base text-[#151815]">{label}</p>
    </article>
  );
}

function ProjectCard({
  project,
  isDeleting,
  onDelete,
}: {
  project: DashboardProjectSummary;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  return (
    <article className="tg-reveal tg-interactive-card group relative overflow-hidden rounded-[24px] border border-[#dfe4dc] bg-[#fbfcf7] p-5 shadow-sm transition hover:border-[#141815] hover:shadow-md">
      <div className="absolute right-[-70px] top-[-70px] h-44 w-44 rounded-full bg-[#70ff35]/12 blur-3xl transition group-hover:bg-[#0076ff]/16" />
      <div className="relative flex min-h-40 flex-col justify-between gap-5">
        <div className="flex items-start justify-between gap-5">
          <Link to={`/app/projects/${project.id}`} className="min-w-0 flex-1">
            <h2 className="font-display text-3xl leading-none tracking-[-0.035em] text-[#111]">
              {project.name}
            </h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-[#667066]">
              {project.is_active === false ? "Проект на паузе. Откройте настройки, чтобы продолжить работу."
                : project.ready_accounts_count === 0 ? "Для публикации нужен рабочий аккаунт Threads."
                : !project.next_post_time ? "Постов в расписании пока нет. Откройте проект, чтобы выбрать следующий шаг."
                : "Посты запланированы. В проекте можно посмотреть ближайший текст и время выхода."}
            </p>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={(event) => handleDeleteClick(event, onDelete)}
              disabled={isDeleting}
              className="grid h-11 w-11 place-items-center rounded-2xl border border-[#e2e6df] bg-white/70 text-[#7a2d2d] transition hover:border-[#7a2d2d] hover:bg-[#fff1f1] disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={`Удалить проект ${project.name}`}
              title="Удалить проект"
            >
              {isDeleting ? <Spinner /> : <TrashIcon />}
            </button>
            <Link
              to={`/app/projects/${project.id}`}
              className="tg-action grid h-11 w-11 place-items-center rounded-2xl bg-[#101413] text-white transition group-hover:bg-[#70ff35] group-hover:text-[#07100e]"
              aria-label={`Открыть проект ${project.name}`}
            >
              <ArrowIcon />
            </Link>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Metric
            icon={<SendIcon />}
            label={formatProjectPublishedLabel(project.published_count)}
          />
          <Metric
            icon={<ClockIcon />}
            label="Следующий пост:"
            value={formatDateTime(project.next_post_time)}
          />
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span
            className={`rounded-full px-3 py-1.5 ${project.active_accounts_count > 0 ? "bg-[#edf8e8] text-[#25551f]" : "bg-[#fff4df] text-[#8a4b00]"}`}
          >
            {project.active_accounts_count > 0
              ? `Рабочих профилей: ${project.active_accounts_count}`
              : "Нет рабочего профиля"}
          </span>
          {project.paused_accounts_count > 0 ? (
            <span className="rounded-full bg-[#fff4df] px-3 py-1.5 text-[#8a4b00]">
              На паузе: {project.paused_accounts_count}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function handleDeleteClick(
  event: MouseEvent<HTMLButtonElement>,
  onDelete: () => void,
) {
  event.preventDefault();
  event.stopPropagation();
  onDelete();
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
}) {
  return (
    <div className="rounded-2xl border border-[#e2e6df] bg-white/70 p-4">
      <div className="flex items-center gap-2 text-[#5e675e]">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      {value ? (
        <p className="mt-2 text-sm leading-5 text-[#252a25]">{value}</p>
      ) : null}
    </div>
  );
}

function SkeletonProjects() {
  return (
    <>
      <p className="sr-only" role="status">Загружаем проекты…</p>
      {[1, 2, 3].map((item) => (
        <div
          key={item}
          aria-hidden="true"
          className="min-h-40 animate-pulse motion-reduce:animate-none rounded-[24px] border border-[#dfe4dc] bg-white/70 p-5 shadow-sm"
        >
          <div className="h-10 w-10 rounded-2xl bg-[#dfe4dc]" />
          <div className="mt-8 h-8 w-3/4 rounded-full bg-[#dfe4dc]" />
          <div className="mt-12 h-3 w-1/2 rounded-full bg-[#dfe4dc]" />
        </div>
      ))}
    </>
  );
}

function EmptyProjects({ onCreate }: { onCreate: () => void }) {
  return <div className="rounded-2xl border border-dashed border-[var(--workspace-border)] p-6"><h2 className="text-xl font-semibold">Первый проект пока не создан</h2><p className="mt-3 text-sm opacity-70">Расскажите о своей теме, выберите стиль и посмотрите пробный пост.</p><button type="button" onClick={onCreate} className="mt-4 min-h-11 rounded-full bg-[#151515] px-5 text-sm text-white">Начать настройку</button></div>;
}

function LoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="tg-reveal rounded-[24px] border border-[#e8c7c2] bg-[#fff7f5] p-6 lg:col-span-2 2xl:col-span-3">
      <p className="font-display text-3xl text-[#111]">
        Проекты пока не загрузились
      </p>
      <p className="mt-3 max-w-xl text-sm leading-6 text-[#665d5a]">
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="tg-action mt-5 h-11 rounded-full bg-[#141815] px-5 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e]"
      >
        Попробовать снова
      </button>
    </div>
  );
}

function DeleteProjectDialog({
  project,
  isDeleting,
  onClose,
  onConfirm,
}: {
  project: DashboardProjectSummary;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-end bg-[#070909]/55 p-3 backdrop-blur-sm sm:place-items-center sm:p-5">
      <section className="w-full max-w-lg rounded-[28px] border border-[#e3d5d1] bg-[#fbfcf7] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.30)] sm:p-7">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#fff0ed] text-[#9c3329]">
          <TrashIcon />
        </div>
        <h2 className="mt-5 font-display text-4xl leading-none text-[#111]">
          Удалить «{project.name}»?
        </h2>
        <p className="mt-4 text-sm leading-6 text-[#667066]">
          Посты, собранные идеи и настройки проекта будут удалены без
          возможности восстановления. Подключённые профили Threads сохранятся и
          вернутся в общий пул.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="h-12 rounded-full border border-[#cfd5cc] bg-white px-5 text-sm transition hover:border-[#141815] disabled:opacity-50"
          >
            Оставить проект
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#9c3329] px-5 text-sm text-white transition hover:bg-[#7f241c] disabled:opacity-50"
          >
            {isDeleting ? <Spinner /> : null}
            {isDeleting ? "Удаляем" : "Удалить навсегда"}
          </button>
        </div>
      </section>
    </div>
  );
}

function formatProjectCountLabel(count: number) {
  if (count === 1) {
    return "проект в работе";
  }
  return "проектов в работе";
}

function formatPublishedCountLabel(count: number) {
  if (count === 1) {
    return "пост опубликован";
  }
  return "постов опубликовано";
}

function formatProjectPublishedLabel(count: number) {
  const remainder100 = count % 100;
  const remainder10 = count % 10;
  const word =
    remainder100 >= 11 && remainder100 <= 14
      ? "постов"
      : remainder10 === 1
        ? "пост"
        : remainder10 >= 2 && remainder10 <= 4
          ? "поста"
          : "постов";
  return `Вышло ${count} ${word}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Не запланировано";
  }

  const date = new Date(value);
  const day = date.toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const time = date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day} в ${time}`;
}

function Spinner() {
  return (
    <span aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none rounded-full border border-current border-t-transparent" />
  );
}

function RefreshIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 12a8 8 0 1 1-2.3-5.7M20 5v5h-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m7 7 10 10M17 7 7 17"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7.8A2.8 2.8 0 0 1 6.8 5h3l2 2h5.4A2.8 2.8 0 0 1 20 9.8v6.4a2.8 2.8 0 0 1-2.8 2.8H6.8A2.8 2.8 0 0 1 4 16.2V7.8Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m4 12 16-8-5 16-3-7-8-1Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 17 17 7M9 7h8v8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 4h6M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
