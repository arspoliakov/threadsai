import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

import {
  checkAccountSession,
  getAccounts,
  getProjectDashboard,
  unlinkAccount,
  updateAccount,
  updateProject,
  type Account,
  type AccountStatus,
  type ConversionMode,
  type Project,
} from "../../api/client";

const timezoneOptions = [
  { value: "Europe/Moscow", label: "Москва — Europe/Moscow" },
  { value: "Europe/Istanbul", label: "Стамбул — Europe/Istanbul" },
  { value: "Europe/Berlin", label: "Берлин — Europe/Berlin" },
  { value: "Europe/Paris", label: "Париж — Europe/Paris" },
  { value: "Europe/London", label: "Лондон — Europe/London" },
  { value: "Europe/Madrid", label: "Мадрид — Europe/Madrid" },
  { value: "Europe/Rome", label: "Рим — Europe/Rome" },
  { value: "Asia/Dubai", label: "Дубай — Asia/Dubai" },
  { value: "Asia/Tbilisi", label: "Тбилиси — Asia/Tbilisi" },
  { value: "Asia/Yerevan", label: "Ереван — Asia/Yerevan" },
  { value: "Asia/Almaty", label: "Алматы — Asia/Almaty" },
  { value: "Asia/Bangkok", label: "Бангкок — Asia/Bangkok" },
  { value: "Asia/Tokyo", label: "Токио — Asia/Tokyo" },
  { value: "America/New_York", label: "Нью-Йорк — America/New_York" },
  { value: "America/Chicago", label: "Чикаго — America/Chicago" },
  { value: "America/Los_Angeles", label: "Лос-Анджелес — America/Los_Angeles" },
  { value: "UTC", label: "UTC" },
];

const timezoneOptionValues = new Set(timezoneOptions.map((option) => option.value));

export default function ProjectSettingsPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [globalContext, setGlobalContext] = useState("");
  const [targetActions, setTargetActions] = useState<string[]>([]);
  const [conversionMode, setConversionMode] = useState<ConversionMode>("bio_link");
  const [conversionTarget, setConversionTarget] = useState("");
  const [stopWords, setStopWords] = useState<string[]>([]);
  const [scheduleDraft, setScheduleDraft] = useState({
    posts_per_day: 3,
    active_hours_start: "09:00",
    active_hours_end: "21:00",
    timezone: "Europe/Moscow",
  });
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isBinding, setIsBinding] = useState(false);
  const [isSavingContext, setIsSavingContext] = useState(false);
  const [isSavingStopWords, setIsSavingStopWords] = useState(false);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [savingCookiesId, setSavingCookiesId] = useState<number | null>(null);
  const [checkingAccountId, setCheckingAccountId] = useState<number | null>(null);
  const [unlinkingAccountId, setUnlinkingAccountId] = useState<number | null>(null);

  async function loadSettings({ silent = false }: { silent?: boolean } = {}) {
    setIsLoading(true);

    try {
      const [accountsResult, dashboardResult] = await Promise.all([
        getAccounts(),
        getProjectDashboard(projectId),
      ]);
      setAccounts(accountsResult);
      setProject(dashboardResult.project);
      setGlobalContext(dashboardResult.project.global_context || dashboardResult.project.description || "");
      setTargetActions(normalizeTargetActions(dashboardResult.project.target_actions ?? []));
      setConversionMode(dashboardResult.project.conversion_mode ?? "bio_link");
      setConversionTarget(dashboardResult.project.conversion_target ?? "");
      setStopWords(dashboardResult.project.stop_words ?? []);
      setScheduleDraft({
        posts_per_day: dashboardResult.project.posts_per_day ?? 3,
        active_hours_start: dashboardResult.project.active_hours_start ?? "09:00",
        active_hours_end: dashboardResult.project.active_hours_end ?? "21:00",
        timezone: normalizeTimezone(dashboardResult.project.timezone),
      });
      if (!silent) {
        toast.success("Настройки обновлены");
      }
    } catch {
      toast.error("Не удалось загрузить настройки проекта");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (Number.isFinite(projectId)) {
      void loadSettings({ silent: true });
    }
  }, [projectId]);

  const projectAccounts = useMemo(
    () => accounts.filter((account) => account.project_id === projectId),
    [accounts, projectId],
  );
  const freeAccounts = useMemo(
    () => accounts.filter((account) => account.project_id === null),
    [accounts],
  );

  async function bindAccount() {
    if (!selectedAccountId) {
      toast.error("Выберите свободный аккаунт");
      return;
    }

    setIsBinding(true);

    try {
      await toast.promise(updateAccount(Number(selectedAccountId), { project_id: projectId }), {
        loading: "Привязываем аккаунт...",
        success: "Аккаунт привязан к проекту",
        error: "Не удалось привязать аккаунт",
      });
      setSelectedAccountId("");
      await loadSettings({ silent: true });
    } finally {
      setIsBinding(false);
    }
  }

  async function saveProjectContext() {
    if (!project) {
      toast.error("Проект еще не загружен");
      return;
    }

    setIsSavingContext(true);

    try {
      const normalizedActions = normalizeTargetActions(targetActions);
      const savePromise = updateProject(project.id, {
        global_context: globalContext.trim() || null,
        target_actions: normalizedActions,
        conversion_mode: conversionMode,
        conversion_target: conversionTarget.trim() || null,
      });
      toast.promise(savePromise, {
        loading: "Сохраняем настройки проекта...",
        success: "Контекст проекта сохранен",
        error: "Не удалось сохранить контекст проекта",
      });
      const savedProject = await savePromise;
      setProject(savedProject);
      setGlobalContext(savedProject.global_context || "");
      setTargetActions(normalizeTargetActions(savedProject.target_actions ?? []));
      setConversionMode(savedProject.conversion_mode ?? "bio_link");
      setConversionTarget(savedProject.conversion_target ?? "");
    } finally {
      setIsSavingContext(false);
    }
  }

  async function saveStopWords() {
    if (!project) {
      toast.error("Проект еще не загружен");
      return;
    }

    setIsSavingStopWords(true);

    try {
      const savePromise = updateProject(project.id, { stop_words: normalizeStopWords(stopWords) });
      toast.promise(savePromise, {
        loading: "Сохраняем стоп-слова...",
        success: "Стоп-слова сохранены",
        error: "Не удалось сохранить стоп-слова",
      });
      const savedProject = await savePromise;
      setProject(savedProject);
      setStopWords(savedProject.stop_words ?? []);
    } finally {
      setIsSavingStopWords(false);
    }
  }

  async function saveSchedule() {
    if (!project) {
      toast.error("Проект еще не загружен");
      return;
    }

    setIsSavingSchedule(true);

    try {
      const savePromise = updateProject(project.id, {
        posts_per_day: clampPostsPerDay(scheduleDraft.posts_per_day),
        active_hours_start: scheduleDraft.active_hours_start,
        active_hours_end: scheduleDraft.active_hours_end,
        timezone: normalizeTimezone(scheduleDraft.timezone),
      });
      toast.promise(savePromise, {
        loading: "Сохраняем расписание...",
        success: "Расписание сохранено",
        error: "Не удалось сохранить расписание",
      });
      const savedProject = await savePromise;
      setProject(savedProject);
      setScheduleDraft({
        posts_per_day: savedProject.posts_per_day,
        active_hours_start: savedProject.active_hours_start,
        active_hours_end: savedProject.active_hours_end,
        timezone: normalizeTimezone(savedProject.timezone),
      });
    } finally {
      setIsSavingSchedule(false);
    }
  }

  async function saveAccountCookies(accountId: number, cookies: string) {
    const normalizedCookies = cookies.trim();
    if (!normalizedCookies) {
      toast.error("Вставьте свежий JSON cookies");
      return;
    }

    setSavingCookiesId(accountId);

    try {
      const savePromise = updateAccount(accountId, {
        cookies_encrypted: normalizedCookies,
        status: "active",
        last_error: null,
      });
      toast.promise(savePromise, {
        loading: "Обновляем cookies...",
        success: "Cookies обновлены",
        error: "Не удалось обновить cookies",
      });
      await savePromise;
      await loadSettings({ silent: true });
    } finally {
      setSavingCookiesId(null);
    }
  }

  async function checkSession(accountId: number) {
    setCheckingAccountId(accountId);

    try {
      const checkPromise = checkAccountSession(accountId);
      toast.promise(checkPromise, {
        loading: "Проверяем сессию Threads...",
        success: (result) => result.message,
        error: "Не удалось проверить сессию",
      });
      await checkPromise;
      await loadSettings({ silent: true });
    } finally {
      setCheckingAccountId(null);
    }
  }

  async function unlinkFromProject(accountId: number) {
    setUnlinkingAccountId(accountId);

    try {
      await toast.promise(unlinkAccount(accountId), {
        loading: "Отвязываем аккаунт...",
        success: "Аккаунт отвязан от проекта",
        error: "Не удалось отвязать аккаунт",
      });
      await loadSettings({ silent: true });
    } finally {
      setUnlinkingAccountId(null);
    }
  }

  return (
    <section className="space-y-5">
      <header>
        <h1 className="font-display text-4xl leading-none">Настройки проекта</h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-[#66645d]">
          Настраивается здесь: стоп-слова, расписание, аккаунты и описание конкретного продукта. Это помогает ИИ писать не абстрактно, а под задачу проекта.
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-[24px] border border-[#deded7] bg-white p-5 shadow-sm xl:col-span-2">
          <div className="grid gap-5 lg:grid-cols-[1fr_480px]">
            <div>
              <h2 className="font-display text-3xl">Контекст и целевые действия</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#66645d]">
                Здесь задается локальная память проекта: кто вы, как говорите, что важно для аудитории
                и какие мягкие действия можно предлагать в финале постов.
              </p>
            </div>

            <div className="grid gap-4 rounded-2xl border border-[#e1e1dc] bg-[#fbfaf5] p-4">
              <label className="grid gap-2">
                <span className="field-label">Глобальный контекст проекта</span>
                <textarea
                  value={globalContext}
                  onChange={(event) => setGlobalContext(event.target.value)}
                  disabled={isLoading || isSavingContext}
                  rows={8}
                  placeholder="Опишите бренд, аудиторию, tone of voice, продукт, ограничения и факты, которые ИИ должен учитывать."
                  className="resize-y rounded-2xl border border-[#d8d8d2] bg-white p-4 text-sm leading-6 text-[#24231f] outline-none transition focus:border-[#151515] disabled:opacity-50"
                />
              </label>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="field-label">Целевые действия</span>
                  <button
                    type="button"
                    onClick={() => setTargetActions((current) => [...current, ""])}
                    disabled={isLoading || isSavingContext}
                    className="rounded-full border border-[#151515] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition hover:bg-[#151515] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    добавить
                  </button>
                </div>

                <div className="mt-3 grid gap-2">
                  {targetActions.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-[#d8d8d2] bg-white px-4 py-4 text-sm leading-6 text-[#77766f]">
                      Целевые действия пока не заданы. Можно добавить варианты: написать в личку, оставить комментарий,
                      перейти по ссылке, подписаться, забронировать место.
                    </p>
                  ) : (
                    targetActions.map((action, index) => (
                      <div key={index} className="grid gap-2 sm:grid-cols-[1fr_auto]">
                        <input
                          value={action}
                          onChange={(event) =>
                            setTargetActions((current) =>
                              current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)),
                            )
                          }
                          disabled={isLoading || isSavingContext}
                          placeholder="например: написать в комментариях, чтобы получить детали"
                          className="field-control disabled:opacity-50"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setTargetActions((current) => current.filter((_, itemIndex) => itemIndex !== index))
                          }
                          disabled={isLoading || isSavingContext}
                          className="rounded-2xl border border-[#b42318] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#8a2d25] transition hover:bg-[#b42318] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          удалить
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="grid gap-4 rounded-2xl border border-[#e1e1dc] bg-white p-4">
                <div>
                  <span className="field-label">Куда вести интерес</span>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <ConversionModeButton
                      label="Ссылка в био"
                      isActive={conversionMode === "bio_link"}
                      onClick={() => setConversionMode("bio_link")}
                      disabled={isLoading || isSavingContext}
                    />
                    <ConversionModeButton
                      label="Закрепленный пост"
                      isActive={conversionMode === "pinned_post"}
                      onClick={() => setConversionMode("pinned_post")}
                      disabled={isLoading || isSavingContext}
                    />
                    <ConversionModeButton
                      label="Без увода"
                      isActive={conversionMode === "none"}
                      onClick={() => setConversionMode("none")}
                      disabled={isLoading || isSavingContext}
                    />
                  </div>
                </div>

                {conversionMode !== "none" ? (
                  <label className="grid gap-2">
                    <span className="field-label">
                      {conversionMode === "bio_link" ? "Что находится по ссылке в био" : "Что находится в закрепленном посте"}
                    </span>
                    <textarea
                      value={conversionTarget}
                      onChange={(event) => setConversionTarget(event.target.value)}
                      disabled={isLoading || isSavingContext}
                      rows={4}
                      placeholder="Например: бесплатный разбор, форма заявки, подробная инструкция, кейс, каталог услуг."
                      className="field-control resize-y leading-6 disabled:opacity-50"
                    />
                  </label>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => void saveProjectContext()}
                disabled={isLoading || isSavingContext || !project}
                className="flex w-full items-center justify-center gap-3 rounded-2xl border border-[#151515] bg-[#151515] px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-white transition hover:bg-transparent hover:text-[#151515] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSavingContext ? <Spinner /> : null}
                {isSavingContext ? "Сохранение..." : "Сохранить контекст"}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border border-[#deded7] bg-white p-5 shadow-sm xl:col-span-2">
          <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
            <div>
              <h2 className="font-display text-3xl">Стоп-слова</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#66645d]">
                Эти слова запрещаются только для текущего проекта. Используйте их для локальных табу:
                неудачных терминов, старых мемов или слов, которые ломают тон.
              </p>
            </div>

            <div className="rounded-2xl border border-[#e1e1dc] bg-[#fbfaf5] p-4">
              <TagInput value={stopWords} onChange={setStopWords} disabled={isLoading || isSavingStopWords} />
              <button
                type="button"
                onClick={() => void saveStopWords()}
                disabled={isLoading || isSavingStopWords || !project}
                className="mt-4 flex w-full items-center justify-center gap-3 rounded-2xl border border-[#151515] bg-[#151515] px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-white transition hover:bg-transparent hover:text-[#151515] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSavingStopWords ? <Spinner /> : null}
                {isSavingStopWords ? "Сохранение..." : "Сохранить стоп-слова"}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border border-[#deded7] bg-white p-5 shadow-sm xl:col-span-2">
          <div className="grid gap-5 lg:grid-cols-[1fr_480px]">
            <div>
              <h2 className="font-display text-3xl">Расписание</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#66645d]">
                Управляет скоростью проекта: сколько постов выпускать в день на каждый аккаунт и в какое локальное окно можно публиковать.
              </p>
            </div>

            <div className="grid gap-4 rounded-2xl border border-[#e1e1dc] bg-[#fbfaf5] p-4">
              <label className="grid gap-2">
                <span className="field-label">Постов в день на аккаунт</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={scheduleDraft.posts_per_day}
                  onChange={(event) =>
                    setScheduleDraft((current) => ({
                      ...current,
                      posts_per_day: Number(event.target.value),
                    }))
                  }
                  className="field-control"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-2">
                  <span className="field-label">С</span>
                  <input
                    type="time"
                    value={scheduleDraft.active_hours_start}
                    onChange={(event) =>
                      setScheduleDraft((current) => ({
                        ...current,
                        active_hours_start: event.target.value,
                      }))
                    }
                    className="field-control"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="field-label">До</span>
                  <input
                    type="time"
                    value={scheduleDraft.active_hours_end}
                    onChange={(event) =>
                      setScheduleDraft((current) => ({
                        ...current,
                        active_hours_end: event.target.value,
                      }))
                    }
                    className="field-control"
                  />
                </label>
              </div>

              <label className="grid gap-2">
                <span className="field-label">Часовой пояс</span>
                <select
                  value={scheduleDraft.timezone}
                  onChange={(event) =>
                    setScheduleDraft((current) => ({
                      ...current,
                      timezone: event.target.value,
                    }))
                  }
                  className="field-control"
                >
                  {timezoneOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={() => void saveSchedule()}
                disabled={isLoading || isSavingSchedule || !project}
                className="flex w-full items-center justify-center gap-3 rounded-2xl border border-[#151515] bg-[#151515] px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-white transition hover:bg-transparent hover:text-[#151515] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSavingSchedule ? <Spinner /> : null}
                {isSavingSchedule ? "Сохранение..." : "Сохранить расписание"}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border border-[#deded7] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#e7e5de] pb-4">
            <div>
              <h2 className="font-display text-3xl">Аккаунты проекта</h2>
            </div>
          </div>

          <div className="mt-5">
            {isLoading ? (
              <AccountSkeleton />
            ) : projectAccounts.length === 0 ? (
              <EmptyState
                title="Аккаунты еще не привязаны"
                description="Выберите свободный аккаунт из общего пула справа."
              />
            ) : (
              <div className="grid gap-3">
                {projectAccounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    isSavingCookies={savingCookiesId === account.id}
                    isChecking={checkingAccountId === account.id}
                    isUnlinking={unlinkingAccountId === account.id}
                    onSaveCookies={(cookies) => void saveAccountCookies(account.id, cookies)}
                    onCheckSession={() => void checkSession(account.id)}
                    onUnlink={() => void unlinkFromProject(account.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[24px] border border-[#deded7] bg-white p-5 shadow-sm">
          <h2 className="font-display text-3xl">Привязать аккаунт</h2>
          <p className="mt-3 text-sm leading-6 text-[#66645d]">
            В списке только свободные аккаунты. Если список пуст, добавьте профиль в разделе “Аккаунты”.
          </p>

          <label className="mt-6 grid gap-2">
            <span className="field-label">Свободный аккаунт</span>
            <select
              value={selectedAccountId}
              onChange={(event) => setSelectedAccountId(event.target.value)}
              className="field-control"
            >
              <option value="">Выберите аккаунт</option>
              {freeAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {formatUsername(account.username)} / {statusLabels[account.status]}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={bindAccount}
            disabled={!selectedAccountId || isBinding}
            className="mt-4 flex w-full items-center justify-center gap-3 rounded-2xl border border-[#151515] bg-[#151515] px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-white transition hover:bg-transparent hover:text-[#151515] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isBinding ? <Spinner /> : null}
            {isBinding ? "Привязка..." : "Привязать"}
          </button>

          <div className="mt-6 rounded-2xl border border-[#e1e1dc] bg-[#fbfaf5] p-4">
            <p className="field-label">Пул</p>
            <p className="mt-2 text-sm text-[#333]">
              Свободно: {freeAccounts.length} / Всего: {accounts.length}
            </p>
          </div>
        </section>
      </div>
    </section>
  );
}

function AccountCard({
  account,
  isSavingCookies,
  isChecking,
  isUnlinking,
  onSaveCookies,
  onCheckSession,
  onUnlink,
}: {
  account: Account;
  isSavingCookies: boolean;
  isChecking: boolean;
  isUnlinking: boolean;
  onSaveCookies: (cookies: string) => void;
  onCheckSession: () => void;
  onUnlink: () => void;
}) {
  const [cookiesDraft, setCookiesDraft] = useState("");
  const proxyPaused = account.status === "proxy_error";
  const sessionNeedsUpdate = account.status === "cookies_expired" || account.status === "blocked" || account.status === "error";

  return (
    <article className={`rounded-2xl border p-4 transition hover:shadow-sm ${sessionNeedsUpdate ? "border-[#d88a35]/50 bg-[#fff4df]" : "border-[#e1e1dc] bg-[#fbfaf5] hover:border-[#151515]"}`}>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-center">
        <div>
          <p className="field-label">Профиль</p>
          <p className="mt-1 text-sm text-[#24231f]">{formatUsername(account.username)}</p>
        </div>
        <div>
          <p className="field-label">Статус</p>
          <StatusBadge status={account.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton onClick={onCheckSession} disabled={isChecking || isUnlinking}>
            {isChecking ? "проверка..." : "проверить cookies"}
          </ActionButton>
          <ActionButton danger onClick={onUnlink} disabled={isChecking || isUnlinking}>
            {isUnlinking ? "отвязка..." : "отвязать"}
          </ActionButton>
        </div>
      </div>

      {account.last_error ? (
        <p className="mt-4 rounded-2xl border border-[#f0c7c1] bg-[#fff6f4] px-4 py-3 text-xs leading-5 text-[#8a2d25]">
          {account.last_error}
        </p>
      ) : null}

      {proxyPaused ? (
        <div className="mt-4 rounded-2xl border border-[#f1d19a] bg-[#fff8e8] px-4 py-3 text-sm leading-6 text-[#6f4300]">
          Прокси-порт временно не отвечает. Система сама перепроверяет подключение и вернет аккаунт в работу, когда порт оживет. Cookies обновлять не нужно.
        </div>
      ) : null}

      {sessionNeedsUpdate ? (
        <div className="mt-4 border-t border-[#d88a35]/30 pt-4">
          <p className="text-sm leading-6 text-[#4a2b08]">
            Если сессия слетела, вставьте свежий Export JSON из Cookie-Editor и сохраните.
          </p>
          <textarea
            value={cookiesDraft}
            onChange={(event) => setCookiesDraft(event.target.value)}
            rows={5}
            placeholder="Вставьте свежий JSON cookies"
            className="mt-3 w-full resize-y rounded-2xl border border-[#d8d8d2] bg-white p-4 text-xs leading-5 text-[#24231f] outline-none transition focus:border-[#151515]"
          />
          <button
            type="button"
            onClick={() => onSaveCookies(cookiesDraft)}
            disabled={isSavingCookies}
            className="mt-3 flex items-center gap-2 rounded-2xl border border-[#4a2b08] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#4a2b08] transition hover:bg-[#4a2b08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSavingCookies ? <Spinner /> : null}
            Обновить cookies
          </button>
        </div>
      ) : null}
    </article>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  danger = false,
}: {
  children: string;
  onClick: () => void;
  disabled: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        danger
          ? "rounded-2xl border border-[#b42318] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#8a2d25] transition hover:bg-[#b42318] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          : "rounded-2xl border border-[#151515] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] transition hover:bg-[#151515] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      {children}
    </button>
  );
}

function ConversionModeButton({
  label,
  isActive,
  onClick,
  disabled,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        isActive
          ? "rounded-2xl border border-[#151515] bg-[#151515] px-3 py-3 text-left text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
          : "rounded-2xl border border-[#d8d8d2] bg-[#fbfaf5] px-3 py-3 text-left text-xs font-semibold text-[#24231f] transition hover:border-[#151515] disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status: AccountStatus }) {
  const label = statusLabels[status] ?? status;
  const tone = status === "active" ? "bg-[#edf8e8] text-[#25551f]" : status === "cookies_expired" || status === "blocked" || status === "proxy_error" ? "bg-[#fff4df] text-[#8a4b00]" : "bg-[#f7e8e5] text-[#8a2d25]";
  return <span className={`mt-1 inline-flex rounded-full px-3 py-1 text-xs ${tone}`}>{label}</span>;
}

function AccountSkeleton() {
  return (
    <div className="grid gap-3">
      {[1, 2, 3].map((item) => (
        <div key={item} className="h-16 animate-pulse rounded-2xl border border-[#e1e1dc] bg-[#fbfaf5] p-4">
          <div className="h-3 w-1/2 rounded-full bg-[#deded7]" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-[#c9c9c3] bg-white/70 px-5 py-10 text-center shadow-sm">
      <p className="font-display text-3xl leading-none text-[#151515]">{title}</p>
      <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-[#66645d]">{description}</p>
    </div>
  );
}

function Spinner() {
  return <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />;
}

function TagInput({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState("");

  function addDraft() {
    const normalized = draft.trim().toLowerCase();
    if (!normalized) {
      return;
    }

    if (value.map((item) => item.toLowerCase()).includes(normalized)) {
      toast.error("Такое стоп-слово уже добавлено");
      setDraft("");
      return;
    }

    onChange([...value, normalized]);
    setDraft("");
  }

  return (
    <div>
      <label className="grid gap-2">
        <span className="field-label">Добавить слово</span>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addDraft();
            }
          }}
          disabled={disabled}
          placeholder="например: сплиты"
          className="field-control disabled:opacity-50"
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        {value.length === 0 ? (
          <span className="text-sm text-[#77766f]">Стоп-слова пока не заданы</span>
        ) : (
          value.map((word) => (
            <span
              key={word}
              className="inline-flex items-center gap-2 rounded-full border border-[#d8d8d2] bg-white px-3 py-1.5 text-sm text-[#24231f] shadow-sm"
            >
              {word}
              <button
                type="button"
                onClick={() => onChange(value.filter((item) => item !== word))}
                disabled={disabled}
                className="grid h-5 w-5 place-items-center rounded-full text-[#77766f] transition hover:bg-[#151515] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={`Удалить ${word}`}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  );
}

const statusLabels: Record<AccountStatus, string> = {
  active: "активен",
  disabled: "выключен",
  error: "ошибка",
  warming_up: "прогрев",
  cookies_expired: "cookies истекли",
  blocked: "заблокирован",
  proxy_error: "техническая пауза",
};

function formatUsername(username: string) {
  return username === "pending_from_session" ? "Из сессии" : `@${username.replace(/^@/, "")}`;
}

function normalizeStopWords(words: string[]) {
  return Array.from(new Set(words.map((word) => word.trim().toLowerCase()).filter(Boolean)));
}

function normalizeTargetActions(actions: string[]) {
  return Array.from(new Set(actions.map((action) => action.trim()).filter(Boolean)));
}

function clampPostsPerDay(value: number) {
  if (!Number.isFinite(value)) {
    return 3;
  }

  return Math.min(20, Math.max(1, Math.round(value)));
}

function normalizeTimezone(value: string | null | undefined) {
  return value && timezoneOptionValues.has(value) ? value : "Europe/Moscow";
}
