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
    const slug = createSlug(payload.name);

    await toast.promise(
      createProject({
        name: payload.name,
        slug,
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
    <section className="space-y-6 sm:space-y-7">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-5xl leading-[0.9] tracking-[-0.055em] text-[#111] sm:text-6xl lg:text-7xl">
            Проекты
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-[#626961] sm:text-lg">
            Главный экран: ближайший сбор трендов, опубликованные посты и проекты,
            которые сейчас ждут публикацию.
          </p>
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

      <div className="grid gap-4 lg:grid-cols-4">
        <BotStatusCard
          nextTrendCheck={summary?.next_trend_check ?? null}
          currentAction={getCurrentAction(summary, nextProject, isLoading)}
          nextActionLabel={nextProject ? `ближайший пост: ${nextProject.name}` : "следующий сбор трендов"}
          className="lg:col-span-2"
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
      </div>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
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
        <CreateProjectModal
          onClose={() => setIsCreateOpen(false)}
          onSubmit={handleCreateProject}
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
  nextProject: DashboardProjectSummary | null,
  isLoading: boolean,
) {
  if (isLoading) {
    return "Проверяем систему";
  }

  if (!summary || summary.projects.length === 0) {
    return "Ждем первый проект";
  }

  if (nextProject) {
    return "Очередь готова";
  }

  return "Контур активен";
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
            <h2 className="font-display text-4xl leading-none tracking-[-0.04em] text-[#111]">
              Новый проект
            </h2>
            <p className="mt-3 text-sm leading-6 text-[#667066]">
              Проект хранит свой стиль, аккаунты, очередь публикаций и тренды.
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
              placeholder="Например: MosRiders"
              className="mt-2 h-12 w-full rounded-2xl border border-[#dfe4dc] bg-white px-4 text-base outline-none transition focus:border-[#141815]"
              disabled={isSaving}
            />
          </label>

          <label className="block">
            <span className="text-sm text-[#3f463f]">Описание</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Опишите суть проекта, аудиторию, продукт, боли ЦА и желаемый Tone of Voice."
              rows={7}
              className="mt-2 w-full resize-y rounded-2xl border border-[#dfe4dc] bg-white p-4 text-base leading-6 outline-none transition focus:border-[#141815]"
              disabled={isSaving}
            />
            <span className="mt-2 block text-xs leading-5 text-[#7a8179]">
              Чем подробнее описание, тем лучше ИИ попадет в голос проекта и не будет писать абстрактный текст.
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
      className={`relative min-h-[21rem] overflow-hidden rounded-[32px] border border-[#151b17] bg-[#080d0b] p-6 text-white shadow-[0_24px_90px_rgba(10,10,10,0.20)] sm:p-7 ${className}`}
    >
      <div className="absolute right-[-70px] top-[-100px] h-64 w-64 rounded-full bg-[#70ff35]/16 blur-3xl" />
      <div className="absolute bottom-[-100px] left-[30%] h-64 w-64 rounded-full bg-[#0076ff]/20 blur-3xl" />
      <div className="relative flex h-full min-h-[17rem] flex-col justify-between gap-8">
        <div>
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#70ff35] opacity-70" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-[#70ff35]" />
            </span>
            <span className="text-sm text-white/68">Система онлайн</span>
          </div>
          <h2 className="mt-7 max-w-xl font-display text-4xl leading-[0.92] tracking-[-0.055em] sm:text-5xl">
            Автономный контур активен
          </h2>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-5">
          <div className="flex items-center gap-3 text-white/62">
            <RadarIcon />
            <span className="text-sm">Следующий сбор трендов</span>
          </div>
          <p className="mt-3 text-xl text-white sm:text-2xl">
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
    <article className="rounded-[32px] border border-[#dfe4dc] bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:p-7">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#eef4ec] text-[#111]">
        {icon}
      </div>
      <p className="mt-8 font-display text-6xl leading-none text-[#111]">{value}</p>
      <p className="mt-4 text-lg text-[#151815]">{label}</p>
      <p className="mt-2 text-sm leading-6 text-[#6b716a]">{description}</p>
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
    <article className="group relative overflow-hidden rounded-[32px] border border-[#dfe4dc] bg-[#fbfcf7] p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-[#141815] hover:shadow-md sm:p-7">
      <div className="absolute right-[-70px] top-[-70px] h-44 w-44 rounded-full bg-[#70ff35]/12 blur-3xl transition group-hover:bg-[#0076ff]/16" />
      <div className="relative flex min-h-48 flex-col justify-between gap-8">
        <div className="flex items-start justify-between gap-5">
          <Link to={`/app/projects/${project.id}`} className="min-w-0 flex-1">
            <h2 className="font-display text-4xl leading-none tracking-[-0.04em] text-[#111]">
              {project.name}
            </h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-[#667066]">
              Откройте проект, чтобы управлять очередью, трендами, аккаунтами и настройками.
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
          <Metric icon={<SendIcon />} label="Опубликовано" value={String(project.published_count)} />
          <Metric icon={<ClockIcon />} label="Ближайший пост" value={formatDateTime(project.next_post_time)} />
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

function EmptyProjects({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-[32px] border border-dashed border-[#c9d1c7] bg-white/70 p-8 text-center shadow-sm lg:col-span-2 2xl:col-span-3">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#eef4ec]">
        <FolderIcon />
      </div>
      <p className="mt-5 font-display text-4xl text-[#111]">Проектов пока нет</p>
      <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#667066]">
        Создайте первый проект, подключите Threads-профиль и запустите сбор трендов.
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
  );
}

function createSlug(name: string) {
  const translitMap: Record<string, string> = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "e",
    ж: "zh",
    з: "z",
    и: "i",
    й: "y",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "h",
    ц: "c",
    ч: "ch",
    ш: "sh",
    щ: "sch",
    ы: "y",
    э: "e",
    ю: "yu",
    я: "ya",
  };

  const base = name
    .toLowerCase()
    .split("")
    .map((char) => translitMap[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return `${base || "project"}-${Date.now().toString(36)}`;
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

function TrashIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 4h6M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
