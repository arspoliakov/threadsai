import { FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

import {
  getProjectDashboard,
  triggerGeneration,
  triggerScraping,
  updateProject,
  type Project,
  type ProjectAccountState,
  type ProjectDashboard,
} from "../../api/client";

type RunningAction = "scraping" | "generation" | null;

const DESCRIPTION_HINT =
  "Внимание: заполняйте максимально подробно. Укажите суть, боли ЦА и Tone of Voice. ИИ использует этот текст как ядро для генерации всех постов.";

export default function ProjectOverviewPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const [dashboard, setDashboard] = useState<ProjectDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [runningAction, setRunningAction] = useState<RunningAction>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadDashboard() {
    setIsLoading(true);
    setError(null);

    try {
      setDashboard(await getProjectDashboard(projectId));
    } catch {
      toast.error("Не удалось загрузить сводку проекта");
      setError("Не удалось загрузить сводку проекта.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (Number.isFinite(projectId)) {
      void loadDashboard();
    }
  }, [projectId]);

  async function handleTriggerScraping() {
    setRunningAction("scraping");
    setStatusMessage(null);
    setError(null);

    try {
      const result = await triggerScraping(projectId);
      setStatusMessage(
        `Анализ трендов завершен: собрано ${result.collected_posts_count}, сохранено ${result.saved_trends_count}.`,
      );
      toast.success(`Анализ трендов завершен: сохранено ${result.saved_trends_count}`);
      await loadDashboard();
    } catch {
      toast.error("Не удалось запустить анализ трендов");
      setError("Не удалось запустить анализ трендов.");
    } finally {
      setRunningAction(null);
    }
  }

  async function handleTriggerGeneration() {
    setRunningAction("generation");
    setStatusMessage(null);
    setError(null);

    try {
      const result = await triggerGeneration(projectId);
      setStatusMessage(`Пост сгенерирован и поставлен в очередь: задача #${result.task_id}.`);
      toast.success(`Пост сгенерирован: задача #${result.task_id}`);
      await loadDashboard();
    } catch {
      toast.error("Не удалось сгенерировать пост");
      setError("Не удалось сгенерировать пост.");
    } finally {
      setRunningAction(null);
    }
  }

  return (
    <section className="space-y-8">
      <header className="grid gap-6 border border-[#c9c9c3] bg-white p-8 md:grid-cols-[1fr_auto]">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[#77766f]">
            Project control room
          </p>
          <h1 className="mt-4 font-display text-5xl leading-none">
            {dashboard?.project.name || "Сводка"}
          </h1>
          <p className="mt-6 max-w-2xl text-sm leading-6 text-[#66645d]">
            Ручной запуск основных процессов проекта: сбор трендов, генерация поста
            и контроль последнего состояния перед боевым прогоном.
          </p>
        </div>
        {dashboard ? (
          <button
            type="button"
            onClick={() => setIsEditOpen(true)}
            className="h-11 self-end border border-[#151515] px-5 font-mono text-xs uppercase tracking-[0.16em] transition hover:bg-[#151515] hover:text-white"
          >
            Редактировать проект
          </button>
        ) : null}
      </header>

      <div className="grid gap-px border border-[#c9c9c3] bg-[#c9c9c3] md:grid-cols-2">
        <ActionPanel
          title="Анализ трендов"
          description="Принудительно собрать ленту, очистить старые тренды проекта и сохранить свежие паттерны."
          buttonText="Запустить анализ трендов"
          isLoading={runningAction === "scraping"}
          isDisabled={runningAction !== null || isLoading}
          onClick={() => void handleTriggerScraping()}
        />
        <ActionPanel
          title="Генерация"
          description="Взять последние тренды, выбрать подходящий паттерн и создать задачу публикации."
          buttonText="Сгенерировать пост сейчас"
          isLoading={runningAction === "generation"}
          isDisabled={runningAction !== null || isLoading}
          onClick={() => void handleTriggerGeneration()}
        />
      </div>

      {statusMessage ? <Notice tone="neutral">{statusMessage}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <section className="border border-[#c9c9c3] bg-white">
        <header className="border-b border-[#c9c9c3] px-5 py-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77766f]">
            Last state log
          </p>
          <h2 className="mt-2 font-display text-3xl">Лог последнего состояния</h2>
        </header>

        {isLoading ? (
          <EmptyLine text="Загрузка сводки" />
        ) : dashboard ? (
          <div className="divide-y divide-[#e1e1dc]">
            <LogRow label="Проект" value={dashboard.project.name} />
            <LogRow label="Описание" value={dashboard.project.description || "Описание не заполнено"} />
            <LogRow label="Аккаунты" value={formatAccountStates(dashboard.account_states)} />
            <LogRow label="Последняя генерация" value={formatDate(dashboard.last_generation_at)} />
            <LogRow label="Тренды в базе" value={String(dashboard.saved_trends_count)} />
            <LogRow label="Задачи по статусам" value={formatTaskStatuses(dashboard.posting_tasks_by_status)} />
            <LogRow label="Последняя ошибка" value={dashboard.recent_errors[0] || "Ошибок нет"} isError={dashboard.recent_errors.length > 0} />
          </div>
        ) : (
          <EmptyLine text="Нет данных" />
        )}
      </section>

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

function ActionPanel({
  title,
  description,
  buttonText,
  isLoading,
  isDisabled,
  onClick,
}: {
  title: string;
  description: string;
  buttonText: string;
  isLoading: boolean;
  isDisabled: boolean;
  onClick: () => void;
}) {
  return (
    <article className="bg-white p-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77766f]">
        Manual trigger
      </p>
      <h2 className="mt-3 font-display text-3xl">{title}</h2>
      <p className="mt-4 min-h-12 text-sm leading-6 text-[#66645d]">{description}</p>
      <button
        type="button"
        onClick={onClick}
        disabled={isDisabled}
        className="mt-8 flex w-full items-center justify-center gap-3 border border-[#151515] bg-[#151515] px-5 py-4 font-mono text-xs uppercase tracking-[0.16em] text-white transition-all duration-200 ease-in-out hover:bg-transparent hover:text-[#151515] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isLoading ? <Spinner /> : null}
        {isLoading ? "Выполняется" : buttonText}
      </button>
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
    } catch {
      toast.error("Не удалось сохранить проект");
      setError("Не удалось сохранить проект.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45">
      <aside className="ml-auto flex h-full w-full max-w-xl flex-col border-l border-black bg-[#f6f6f2]">
        <header className="flex items-center justify-between border-b border-[#c9c9c3] px-7 py-6">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[#77766f]">
              Project edit
            </p>
            <h2 className="mt-2 font-display text-3xl">Редактировать проект</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-[#151515] px-3 py-2 font-mono text-xs uppercase transition hover:bg-[#151515] hover:text-white"
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
              className="flex w-full items-center justify-center gap-3 border border-[#151515] bg-[#151515] px-5 py-4 font-mono text-xs uppercase tracking-[0.16em] text-white transition-all duration-200 ease-in-out hover:bg-transparent hover:text-[#151515] disabled:cursor-not-allowed disabled:opacity-40"
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
    return "Нет привязанных аккаунтов";
  }

  return accounts
    .map((account) => {
      const lastError = account.last_error ? `, ошибка: ${account.last_error}` : "";
      return `${account.username} / ${account.platform} / ${account.status}${lastError}`;
    })
    .join("; ");
}

function formatTaskStatuses(statuses: Record<string, number>) {
  const entries = Object.entries(statuses);

  if (entries.length === 0) {
    return "Задач пока нет";
  }

  return entries.map(([status, count]) => `${status}: ${count}`).join("; ");
}

function formatDate(value: string | null) {
  if (!value) {
    return "Генераций еще не было";
  }

  return new Date(value).toLocaleString("ru-RU");
}
