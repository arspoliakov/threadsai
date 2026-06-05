import { FormEvent, useEffect, useMemo, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import {
  createProject,
  deleteProject,
  getDashboardSummary,
  type DashboardProjectSummary,
  type DashboardSummary,
} from "../api/client";
import { BotStatusCard } from "../components/BotStatusCard";
import { DismissibleTip } from "../components/DismissibleTip";

export default function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<number | null>(null);

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

  async function handleCreateProject(payload: { name: string; description: string }) {
    await toast.promise(
      createProject({
        name: payload.name,
        slug: createSlug(payload.name),
        description: payload.description || null,
        is_active: true,
      }),
      {
        loading: "Создаем проект...",
        success: "Проект создан",
        error: "Не удалось создать проект",
      },
    );

    setIsCreateOpen(false);
    await loadSummary({ silent: true });
  }

  async function handleDeleteProject(project: DashboardProjectSummary) {
    const confirmed = window.confirm(
      `Удалить проект «${project.name}»?\n\nОчередь, тренды и настройки проекта будут удалены. Аккаунты Threads останутся в общем пуле.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingProjectId(project.id);

    try {
      await toast.promise(deleteProject(project.id), {
        loading: "Удаляем проект...",
        success: "Проект удален. Аккаунты вернулись в общий пул.",
        error: "Не удалось удалить проект.",
      });
      await loadSummary({ silent: true });
    } finally {
      setDeletingProjectId(null);
    }
  }

  const totalPublished = useMemo(
    () => summary?.projects.reduce((sum, project) => sum + project.published_count, 0) ?? 0,
    [summary],
  );
  const nextProject = useMemo(() => getNextProject(summary), [summary]);

  return (
    <section className="space-y-4 sm:space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-4xl leading-[0.95] tracking-[-0.045em] text-[#111] sm:text-5xl">
            Проекты
          </h1>
        </div>

        <div className="grid gap-3 sm:flex sm:items-center">
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex h-12 w-full items-center justify-center gap-3 rounded-full bg-[#141815] px-5 text-sm text-white shadow-sm transition hover:bg-[#70ff35] hover:text-[#07100e] sm:w-fit"
          >
            <PlusIcon />
            Создать проект
          </button>
          <button
            type="button"
            onClick={() => void loadSummary()}
            disabled={isLoading}
            className="inline-flex h-12 w-full items-center justify-center gap-3 rounded-full border border-[#141815] bg-white px-5 text-sm text-[#141815] shadow-sm transition hover:bg-[#141815] hover:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-fit"
          >
            {isLoading ? <Spinner /> : <RefreshIcon />}
            Обновить
          </button>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-4">
        <BotStatusCard
          nextTrendCheck={nextProject?.next_post_time ?? summary?.next_trend_check ?? null}
          currentAction={getCurrentAction(summary, isLoading)}
          nextActionLabel={nextProject ? `Следующий пост: «${nextProject.name}»` : "следующий сбор идей"}
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

      <DismissibleTip
        storageKey="threadsgo.dashboard-start-tip"
        title="С чего начать"
        action={
          <Link
            to="/app/how-it-works"
            className="inline-flex h-10 items-center justify-center rounded-full border border-[#141815] px-4 text-sm text-[#141815] transition hover:bg-[#141815] hover:text-white"
          >
            Как нейросеть пишет посты
          </Link>
        }
      >
        Начните за 3 шага: создайте проект → опишите, что будете публиковать → подключите аккаунт Threads.
        Система сама составит план постов, а вам останется только быстро проверить тексты перед выходом.
      </DismissibleTip>

      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {isLoading ? (
          <SkeletonProjects />
        ) : !summary || summary.projects.length === 0 ? (
          <EmptyProjects onCreate={() => setIsCreateOpen(true)} />
        ) : (
          summary.projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isDeleting={deletingProjectId === project.id}
              onDelete={() => void handleDeleteProject(project)}
            />
          ))
        )}
      </div>

      {isCreateOpen ? (
        <CreateProjectModal onClose={() => setIsCreateOpen(false)} onSubmit={handleCreateProject} />
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
          new Date(first.next_post_time || 0).getTime() - new Date(second.next_post_time || 0).getTime(),
      )[0] ?? null
  );
}

function getCurrentAction(summary: DashboardSummary | null, isLoading: boolean) {
  if (isLoading) {
    return "Проверяем систему";
  }

  if (!summary || summary.projects.length === 0) {
    return "Ждем первый проект";
  }

  return "Автопостинг активен";
}

function CreateProjectModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (payload: { name: string; description: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!name.trim()) {
      toast.error("Введите название проекта");
      return;
    }

    setIsSaving(true);
    try {
      await onSubmit({ name: name.trim(), description: description.trim() });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-[#070909]/55 p-3 backdrop-blur-sm sm:place-items-center sm:p-5">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-xl overflow-hidden rounded-[32px] border border-[#dfe4dc] bg-[#fbfcf7] shadow-[0_30px_120px_rgba(0,0,0,0.30)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#e3e7df] p-6">
          <div>
            <h2 className="font-display text-4xl leading-none tracking-[-0.04em] text-[#111]">Новый проект</h2>
            <p className="mt-3 text-sm leading-6 text-[#667066]">
              Проект хранит свой стиль, аккаунты, очередь публикаций и актуальные темы.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-[#dfe4dc] bg-white text-[#141815] transition hover:bg-[#141815] hover:text-white"
            aria-label="Закрыть"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="space-y-5 p-6">
          <label className="block">
            <span className="text-sm text-[#3f463f]">Название</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Например: проект для эксперта"
              className="mt-2 h-12 w-full rounded-2xl border border-[#dfe4dc] bg-white px-4 text-base outline-none transition focus:border-[#141815]"
              disabled={isSaving}
            />
          </label>

          <label className="block">
            <span className="text-sm text-[#3f463f]">Описание</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Коротко опишите продукт, аудиторию, задачу и желаемый тон."
              rows={7}
              className="mt-2 w-full resize-y rounded-2xl border border-[#dfe4dc] bg-white p-4 text-base leading-6 outline-none transition focus:border-[#141815]"
              disabled={isSaving}
            />
            <span className="mt-2 block text-xs leading-5 text-[#7a8179]">
              Чем понятнее описание, тем меньше абстрактных постов получится на выходе.
            </span>
          </label>
        </div>

        <footer className="grid gap-3 border-t border-[#e3e7df] p-6 sm:flex sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="h-12 rounded-full border border-[#cfd5cc] px-5 text-sm text-[#323832] transition hover:border-[#141815] hover:bg-[#141815] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex h-12 items-center justify-center gap-3 rounded-full bg-[#141815] px-6 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? <Spinner /> : <PlusIcon />}
            {isSaving ? "Создаем" : "Создать"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function StatsWidget({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <article className="rounded-[24px] border border-[#dfe4dc] bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#eef4ec] text-[#111]">{icon}</div>
      <p className="mt-5 font-display text-4xl leading-none text-[#111]">{value}</p>
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
    <article className="group relative overflow-hidden rounded-[24px] border border-[#dfe4dc] bg-[#fbfcf7] p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#141815] hover:shadow-md">
      <div className="absolute right-[-70px] top-[-70px] h-44 w-44 rounded-full bg-[#70ff35]/12 blur-3xl transition group-hover:bg-[#0076ff]/16" />
      <div className="relative flex min-h-40 flex-col justify-between gap-5">
        <div className="flex items-start justify-between gap-5">
          <Link to={`/app/projects/${project.id}`} className="min-w-0 flex-1">
            <h2 className="font-display text-3xl leading-none tracking-[-0.035em] text-[#111]">{project.name}</h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-[#667066]">
              Нажмите, чтобы зайти в проект и управлять очередью публикаций, трендами и настройками.
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
              className="grid h-11 w-11 place-items-center rounded-2xl bg-[#101413] text-white transition group-hover:bg-[#70ff35] group-hover:text-[#07100e]"
              aria-label={`Открыть проект ${project.name}`}
            >
              <ArrowIcon />
            </Link>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Metric icon={<SendIcon />} label="Вышло постов" value={String(project.published_count)} />
          <Metric icon={<ClockIcon />} label="Следующий пост" value={formatDateTime(project.next_post_time)} />
        </div>
      </div>
    </article>
  );
}

function handleDeleteClick(event: MouseEvent<HTMLButtonElement>, onDelete: () => void) {
  event.preventDefault();
  event.stopPropagation();
  onDelete();
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
        <div key={item} className="min-h-40 animate-pulse rounded-[24px] border border-[#dfe4dc] bg-white/70 p-5 shadow-sm">
          <div className="h-10 w-10 rounded-2xl bg-[#dfe4dc]" />
          <div className="mt-8 h-8 w-3/4 rounded-full bg-[#dfe4dc]" />
          <div className="mt-12 h-3 w-1/2 rounded-full bg-[#dfe4dc]" />
        </div>
      ))}
    </>
  );
}

function EmptyProjects({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-dashed border-[#c9d1c7] bg-white/70 shadow-sm lg:col-span-2 2xl:col-span-3">
      <div className="grid items-center gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_20rem]">
        <div className="text-center lg:text-left">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#eef4ec] lg:mx-0">
            <FolderIcon />
          </div>
          <p className="mt-5 font-display text-3xl text-[#111]">Проектов пока нет</p>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#667066] lg:mx-0">
            Создайте первый проект, подключите Threads-профиль и запустите сбор актуальных идей.
          </p>
          <button
            type="button"
            onClick={onCreate}
            className="mt-6 inline-flex h-12 items-center justify-center gap-3 rounded-full bg-[#141815] px-6 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e]"
          >
            <PlusIcon />
            Создать проект
          </button>
        </div>
        <img
          src="/interface/empty-projects.webp"
          alt=""
          className="mx-auto hidden w-full max-w-sm rounded-[2rem] object-cover opacity-95 lg:block"
        />
      </div>
    </div>
  );
}

function createSlug(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return `${base || "project"}-${Date.now().toString(36)}`;
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

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Не запланировано";
  }

  return new Date(value).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border border-current border-t-transparent" />;
}

function RefreshIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.3-5.7M20 5v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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

function ArrowIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 4h6M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
