import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { toast } from "sonner";

import {
  checkAccountSession,
  getApiErrorMessage,
  getAccounts,
  getCurrentUser,
  getProjectDashboard,
  unlinkAccount,
  updateAccount,
  updateProject,
  type Account,
  type AccountStatus,
  type ConversionMode,
  type Project,
} from "../../api/client";
import { trackSeoEvent } from "../../components/SeoAnalytics";
import { StyleTemplatePicker } from "../../components/StyleTemplatePicker";
import { StyleAssistant } from "../../components/StyleAssistant";
import "./settings-ux.css";
import AccountRiskNotice from "../../components/AccountRiskNotice";

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

function notifyProjectUpdated() {
  window.dispatchEvent(new Event("threadsgo:project-updated"));
}

export default function ProjectSettingsPage() {
  const location = useLocation();
  const { id } = useParams();
  const projectId = Number(id);
  const settingsPane = ["#publication-mode", "#schedule"].includes(location.hash) ? "publication" : ["#profiles", "#accounts"].includes(location.hash) ? "accounts" : "content";
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [styleBody, setStyleBody] = useState("");
  const [projectName, setProjectName] = useState("");
  const [managementBusy, setManagementBusy] = useState(false);
  const [savingStyle, setSavingStyle] = useState(false);
  const [globalContext, setGlobalContext] = useState("");
  const [targetActions, setTargetActions] = useState<string[]>([]);
  const [conversionMode, setConversionMode] = useState<ConversionMode>("bio_link");
  const [conversionTarget, setConversionTarget] = useState("");
  const [conversionIntensity, setConversionIntensity] = useState(25);
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
  const [isSavingMode, setIsSavingMode] = useState(false);
  const [savingCookiesId, setSavingCookiesId] = useState<number | null>(null);
  const [checkingAccountId, setCheckingAccountId] = useState<number | null>(null);
  const [unlinkingAccountId, setUnlinkingAccountId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tariffPostsPerDayLimit, setTariffPostsPerDayLimit] = useState(20);

  useEffect(() => {
    if (!isLoading && Boolean(location.hash)) {
      const target = document.getElementById(location.hash === "#accounts" ? "profiles" : location.hash.slice(1));
      if (target instanceof HTMLDetailsElement) target.open = true;
      target?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [isLoading, location.hash]);

  async function loadSettings({ silent = false, preserveDrafts = false }: { silent?: boolean; preserveDrafts?: boolean } = {}) {
    setIsLoading(true);
    setLoadError(null);

    try {
      const [accountsResult, dashboardResult, currentUser] = await Promise.all([
        getAccounts(),
        getProjectDashboard(projectId),
        getCurrentUser(),
      ]);
      setAccounts(accountsResult);
      setProject(dashboardResult.project);
      if (!preserveDrafts) {
        setProjectName(dashboardResult.project.name);
        setStyleBody(dashboardResult.project.style_body ?? "");
        setGlobalContext(dashboardResult.project.global_context || dashboardResult.project.description || "");
        setTargetActions(normalizeTargetActions(dashboardResult.project.target_actions ?? []));
        setConversionMode(dashboardResult.project.conversion_mode ?? "bio_link");
        setConversionTarget(dashboardResult.project.conversion_target ?? "");
        setConversionIntensity(dashboardResult.project.conversion_intensity ?? 25);
        setStopWords(dashboardResult.project.stop_words ?? []);
        setScheduleDraft({
          posts_per_day: dashboardResult.project.posts_per_day ?? 3,
          active_hours_start: dashboardResult.project.active_hours_start ?? "09:00",
          active_hours_end: dashboardResult.project.active_hours_end ?? "21:00",
          timezone: normalizeTimezone(dashboardResult.project.timezone),
        });
      }
      setTariffPostsPerDayLimit(Math.max(1, currentUser.tariff_posts_per_day || 1));
      if (!silent) {
        toast.success("Настройки обновлены");
      }
    } catch (error) {
      const message = getApiErrorMessage(error, "Не удалось загрузить настройки проекта.");
      setLoadError(message);
      toast.error(message);
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
      const action = updateAccount(Number(selectedAccountId), { project_id: projectId });
      toast.promise(action, {
        loading: "Добавляем аккаунт...",
        success: "Аккаунт добавлен в проект",
        error: (error) => getApiErrorMessage(error, "Не удалось добавить аккаунт."),
      });
      await action;
      notifyProjectUpdated();
      trackSeoEvent("threads_account_attached", {
        method: "existing_profile",
        project_id: projectId,
        account_id: Number(selectedAccountId),
      });
      setSelectedAccountId("");
      await loadSettings({ silent: true, preserveDrafts: true });
    } catch {
      // The promise toast displays the error; leave the current state available for retry.
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
        conversion_intensity: conversionIntensity,
      });
      toast.promise(savePromise, {
        loading: "Сохраняем настройки проекта...",
        success: "Описание проекта сохранено",
        error: (error) => getApiErrorMessage(error, "Не удалось сохранить описание проекта."),
      });
      const savedProject = await savePromise;
      setProject(savedProject);
      setGlobalContext(savedProject.global_context || "");
      setTargetActions(normalizeTargetActions(savedProject.target_actions ?? []));
      setConversionMode(savedProject.conversion_mode ?? "bio_link");
      setConversionTarget(savedProject.conversion_target ?? "");
      setConversionIntensity(savedProject.conversion_intensity ?? 25);
      notifyProjectUpdated();
    } catch {
      // The promise toast already explains the failure; preserve the entered text.
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
        loading: "Сохраняем запрещенные слова...",
        success: "Запрещенные слова сохранены",
        error: (error) => getApiErrorMessage(error, "Не удалось сохранить запрещённые слова."),
      });
      const savedProject = await savePromise;
      setProject(savedProject);
      setStopWords(savedProject.stop_words ?? []);
      notifyProjectUpdated();
    } catch {
      // The promise toast already explains the failure.
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
        posts_per_day: clampPostsPerDay(scheduleDraft.posts_per_day, tariffPostsPerDayLimit),
        active_hours_start: scheduleDraft.active_hours_start,
        active_hours_end: scheduleDraft.active_hours_end,
        timezone: normalizeTimezone(scheduleDraft.timezone),
      });
      toast.promise(savePromise, {
        loading: "Сохраняем настройки публикаций...",
        success: "Настройки публикаций сохранены",
        error: (error) => getApiErrorMessage(error, "Не удалось сохранить расписание публикаций."),
      });
      const savedProject = await savePromise;
      setProject(savedProject);
      setScheduleDraft({
        posts_per_day: savedProject.posts_per_day,
        active_hours_start: savedProject.active_hours_start,
        active_hours_end: savedProject.active_hours_end,
        timezone: normalizeTimezone(savedProject.timezone),
      });
      notifyProjectUpdated();
    } catch {
      // The promise toast already explains the failure.
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
      });
      toast.promise(savePromise, {
        loading: "Обновляем данные входа...",
        success: "Данные входа обновлены",
        error: (error) => getApiErrorMessage(error, "Не удалось обновить данные входа."),
      });
      await savePromise;
      notifyProjectUpdated();
      trackSeoEvent("threads_login_data_updated", {
        method: "cookies_refresh",
        project_id: projectId,
        account_id: accountId,
      });
      await loadSettings({ silent: true, preserveDrafts: true });
    } catch {
      // The promise toast already explains the failure.
    } finally {
      setSavingCookiesId(null);
    }
  }

  async function checkSession(accountId: number) {
    setCheckingAccountId(accountId);

    try {
      const checkPromise = checkAccountSession(accountId);
      toast.promise(checkPromise, {
        loading: "Проверяем доступ к Threads...",
        success: (result) => result.message,
        error: (error) => getApiErrorMessage(error, "Не удалось проверить доступ. Попробуйте ещё раз или обновите данные входа."),
      });
      const result = await checkPromise;
      if (result.status === "active") trackSeoEvent("threads_connection_verified", { project_id: projectId, account_id: accountId });
      notifyProjectUpdated();
      await loadSettings({ silent: true, preserveDrafts: true });
    } catch {
      // The promise toast already explains the failure.
    } finally {
      setCheckingAccountId(null);
    }
  }

  async function unlinkFromProject(accountId: number) {
    setUnlinkingAccountId(accountId);

    try {
      const action = unlinkAccount(accountId);
      toast.promise(action, {
        loading: "Отключаем аккаунт...",
        success: "Аккаунт отключён от проекта",
        error: (error) => getApiErrorMessage(error, "Не удалось отключить аккаунт."),
      });
      await action;
      notifyProjectUpdated();
      await loadSettings({ silent: true, preserveDrafts: true });
    } catch {
      // The promise toast displays the error; leave the current state available for retry.
    } finally {
      setUnlinkingAccountId(null);
    }
  }

  return (
    <section className="project-settings-ux space-y-5" data-active-pane={settingsPane}>
      <header>
        <h1 className="font-display text-4xl leading-none">Настройки проекта</h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-[#66645d]">
          Расскажите ИИ, о чём писать. Выберите аккаунт Threads, расписание и способ публикации.
        </p>
      </header>

      <nav aria-label="Разделы настроек проекта" className="settings-sections grid grid-cols-3 gap-2 rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-panel)] p-2">{[{ key: "content", hash: "#content", title: "Контент" }, { key: "publication", hash: "#publication-mode", title: "Публикации" }, { key: "accounts", hash: "#profiles", title: "Аккаунты" }].map(item => <Link key={item.key} to={`${location.pathname}${item.hash}`} aria-current={settingsPane === item.key ? "page" : undefined} className="flex min-h-11 items-center justify-center rounded-xl px-2 text-sm font-medium">{item.title}</Link>)}</nav>

      {project && <section data-settings-pane="publication" id="publication-mode" className="rounded-2xl border border-[#d8e2da] bg-white p-5">
        <h2 className="font-semibold">Режим публикации</h2>
        <p className="mt-2 text-sm leading-6 text-[#67786e]">ИИ может готовить посты с вашей проверкой или сразу публиковать по расписанию.</p>
        <fieldset className="mt-4 grid gap-3" disabled={isLoading || isSavingMode}>
          <legend className="sr-only">Режим проекта</legend>
          {([{ value: "review", title: "С моей проверкой", description: "ИИ регулярно готовит тексты. Вы проверяете их в разделе «Посты» и выбираете время публикации." },
            { value: "auto", title: "Автоматически", description: "ИИ готовит и отправляет новые посты по расписанию. Каждый текст подтверждать не нужно." },
            ...(project.publication_mode === "manual" ? [{ value: "manual", title: "По моему запросу — прежний режим", description: "ИИ готовит текст только по кнопке. Фоновая подготовка выключена." }] : [])] as const).map(mode =>
            <label key={mode.value} className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#d8e2da] p-4">
              <input type="radio" name="publication-mode" className="mt-1" checked={project.publication_mode === mode.value} onChange={async () => {
                if (isSavingMode || project.publication_mode === mode.value) return;
                setIsSavingMode(true);
                try { await updateProject(project.id, { publication_mode: mode.value as "review" | "auto" | "manual" }); notifyProjectUpdated(); await loadSettings({ silent: true, preserveDrafts: true }); toast.success("Режим сохранён"); }
                catch (error) { toast.error(getApiErrorMessage(error, "Не удалось изменить режим")); }
                finally { setIsSavingMode(false); }
              }} />
              <span><strong className="block">{mode.title}</strong><span className="mt-1 block text-sm leading-6 text-[#67786e]">{mode.description}</span></span>
            </label>)}
        </fieldset>
        {project.publication_mode !== "manual" && <details className="mt-3 text-sm"><summary className="cursor-pointer">Дополнительный режим</summary><button type="button" className="mt-3 rounded-xl border p-3" disabled={isSavingMode} onClick={async () => { setIsSavingMode(true); try { await updateProject(project.id, { publication_mode: "manual" }); notifyProjectUpdated(); await loadSettings({ silent: true, preserveDrafts: true }); } catch (error) { toast.error(getApiErrorMessage(error, "Не удалось изменить режим")); } finally { setIsSavingMode(false); } }}>Готовить только по моему запросу</button></details>}
        <p className="mt-3 text-xs leading-5 text-[#67786e]">Собственный текст можно добавить в разделе «Посты». Для такого черновика вы сами выбираете время, даже если ИИ публикует остальные посты автоматически.</p>
        <details className="mt-3 text-xs leading-5 text-[#67786e]">
          <summary className="cursor-pointer">Что будет с уже подготовленными постами при смене режима</summary>
          <div className="mt-2 space-y-2">
            <p>Смена режима не отправляет старые черновики. Посты из плана недели и пробные тексты тоже нужно запланировать самостоятельно.</p>
            <p>При переходе к проверке или ручной подготовке будущие автоматические посты снимаются с расписания. Посты, которые вы уже запланировали сами, и начавшиеся публикации остаются. Уже назначенные вами публикации можно изменить в разделе «Посты».</p>
          </div>
        </details>
      </section>}

      {loadError ? (
        <div className="rounded-[24px] border border-[#e8c7c2] bg-[#fff7f5] p-6 shadow-sm">
          <h2 className="font-display text-3xl text-[#111]">Настройки пока не загрузились</h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[#665d5a]">{loadError}</p>
          <button
            type="button"
            onClick={() => void loadSettings({ silent: true })}
            className="mt-5 h-11 rounded-full bg-[#151515] px-5 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e]"
          >
            Попробовать снова
          </button>
        </div>
      ) : null}

      <div className={`settings-content-grid ${loadError && !project ? "hidden" : "grid"} gap-4 xl:grid-cols-[1.2fr_0.8fr]`}>
        <section data-settings-pane="content" id="content" className="scroll-mt-28 rounded-[24px] border border-[#deded7] bg-white p-5 shadow-sm xl:col-span-2">
          <div className="grid gap-5 lg:grid-cols-[1fr_480px]">
            <div>
              <h2 className="font-display text-3xl">О чём и как писать</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#66645d]">
                Расскажите, кто вы, как общаетесь и что интересно вашим читателям.
                Если хотите, укажите, куда приглашать читателя в конце поста.
              </p>
            </div>

            <div className="grid gap-4 rounded-2xl border border-[#e1e1dc] bg-[#fbfaf5] p-4">
              <label className="grid gap-2">
                <span className="field-label">Описание проекта для нейросети</span>
                <textarea
                  value={globalContext}
                  onChange={(event) => setGlobalContext(event.target.value)}
                  disabled={isLoading || isSavingContext}
                  rows={5}
                  placeholder="Кто вы, для кого пишете, какие темы хотите обсуждать и какие факты ИИ должен учитывать. Стиль этого проекта настраивается ниже."
                  className="resize-y rounded-2xl border border-[#d8d8d2] bg-white p-4 text-sm leading-6 text-[#24231f] outline-none transition focus:border-[#151515] disabled:opacity-50"
                />
              </label>

              <details><summary className="cursor-pointer text-sm font-medium">Приглашения и продажи — необязательно</summary><div className="mt-4">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="field-label">Что предложить читателю</span>
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
                      Действия пока не заданы. Можно добавить варианты: написать в личку, оставить комментарий,
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
                  <span className="field-label">Куда пригласить читателя</span>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <ConversionModeButton
                      label="Ссылка в описании профиля"
                      isActive={conversionMode === "bio_link"}
                      onClick={() => setConversionMode("bio_link")}
                      disabled={isLoading || isSavingContext}
                    />
                    <ConversionModeButton
                      label="На закрепленный пост"
                      isActive={conversionMode === "pinned_post"}
                      onClick={() => setConversionMode("pinned_post")}
                      disabled={isLoading || isSavingContext}
                    />
                    <ConversionModeButton
                      label="Оставаться в ленте"
                      isActive={conversionMode === "none"}
                      onClick={() => setConversionMode("none")}
                      disabled={isLoading || isSavingContext}
                    />
                  </div>
                </div>

                {conversionMode !== "none" ? (
                    <label className="grid gap-2">
                      <span className="field-label">
                        {conversionMode === "bio_link" ? "Что указано в описании профиля" : "Что указано в закрепленном посте"}
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

                <label className="grid gap-3 rounded-2xl border border-[#e1e1dc] bg-[#fbfaf5] p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="field-label">Как часто добавлять приглашение</span>
                      <p className="mt-2 text-sm leading-5 text-[#66645d]">
                        {getConversionIntensityDescription(conversionIntensity)}
                      </p>
                    </div>
                    <span className="shrink-0 font-display text-3xl">{conversionIntensity}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="25"
                    value={conversionIntensity}
                    onChange={(event) => setConversionIntensity(Number(event.target.value))}
                    disabled={isLoading || isSavingContext}
                    className="h-2 w-full cursor-pointer accent-[#151515] disabled:cursor-not-allowed disabled:opacity-40"
                  />
                  <div className="flex justify-between text-xs text-[#77766f]">
                    <span>без приглашения</span>
                    <span>в каждом посте</span>
                  </div>
                </label>
              </div>

              </div></details>
              <button
                type="button"
                onClick={() => void saveProjectContext()}
                disabled={isLoading || isSavingContext || !project}
                className="flex w-full items-center justify-center gap-3 rounded-2xl border border-[#151515] bg-[#151515] px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-white transition hover:bg-transparent hover:text-[#151515] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSavingContext ? <Spinner /> : null}
                {isSavingContext ? "Сохранение..." : "Сохранить настройки"}
              </button>
            </div>
          </div>
        </section>

      {project && <section data-settings-pane="content" id="style" className="scroll-mt-28 rounded-2xl border border-[#d8e2da] bg-white p-5">
        <h2 className="font-semibold">Стиль этого проекта</h2><p className="mt-2 text-sm opacity-70">Как звучат ваши тексты: тон, длина, юмор и любимые приёмы. Другие проекты сохранят свой стиль.</p>
        <textarea aria-label="Стиль проекта" value={styleBody} onChange={event => setStyleBody(event.target.value)} maxLength={12000} rows={5} className="mt-4 w-full rounded-xl border bg-transparent p-3 text-sm" disabled={savingStyle} />
        <button type="button" className="mt-4 rounded-full bg-[#151515] px-5 py-3 text-sm text-white" disabled={savingStyle} onClick={async () => { setSavingStyle(true); try { const saved = await updateProject(project.id, { style_body: styleBody.trim() }); setProject(saved); notifyProjectUpdated(); toast.success("Стиль проекта сохранён"); } catch (error) { toast.error(getApiErrorMessage(error, "Не удалось сохранить стиль")); } finally { setSavingStyle(false); } }}>{savingStyle ? "Сохраняем…" : "Сохранить стиль"}</button>
        <details className="mt-4 text-sm"><summary className="cursor-pointer">Помощь со стилем и источники вдохновения</summary><div className="mt-4"><StyleAssistant disabled={savingStyle} onApply={setStyleBody} /><StyleTemplatePicker disabled={savingStyle} onApply={setStyleBody} /></div><div className="mt-3 flex flex-wrap gap-4"><Link to="/app/settings">Мой шаблон стиля</Link><Link to={`/app/projects/${project.id}/trends`}>Источники вдохновения</Link></div></details>
      </section>}
        <details data-settings-pane="content" className="rounded-[24px] border border-[#deded7] bg-white p-5 shadow-sm xl:col-span-2">
          <summary className="cursor-pointer font-semibold">Стоп-слова — дополнительные настройки</summary><div className="mt-4 grid gap-5 lg:grid-cols-[1fr_420px]">
            <div>
              <h2 className="font-display text-3xl">Запрещенные слова</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#66645d]">
                Здесь можно указать слова, которые нейросеть не должна использовать в постах для этого проекта:
                неудачные термины, старые мемы или слова, которые ломают тон.
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
                {isSavingStopWords ? "Сохранение..." : "Сохранить запрещенные слова"}
              </button>
            </div>
          </div>
        </details>

        <section data-settings-pane="publication" id="schedule" className="rounded-[24px] border border-[#deded7] bg-white p-5 shadow-sm xl:col-span-2">
          <div className="grid gap-5 lg:grid-cols-[1fr_480px]">
            <div>
              <h2 className="font-display text-3xl">Настройка публикаций</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#66645d]">
                Выберите, сколько постов в день выпускать на каждом аккаунте и в какие часы.
                В ручном режиме вы назначаете время сами.
              </p>
            </div>

            <div className="grid gap-4 rounded-2xl border border-[#e1e1dc] bg-[#fbfaf5] p-4">
              <label className="grid gap-2">
                <span className="field-label">Постов в день на каждый аккаунт</span>
                <input
                  type="number"
                  min={1}
                  max={tariffPostsPerDayLimit}
                  value={scheduleDraft.posts_per_day}
                  disabled={isLoading || isSavingSchedule}
                  onChange={(event) =>
                    setScheduleDraft((current) => ({
                      ...current,
                      posts_per_day: Number(event.target.value),
                    }))
                  }
                  className="field-control"
                />
                <span className="text-xs leading-5 text-[#77766f]">
                  Ваш тариф: до {tariffPostsPerDayLimit} публикаций в день на каждый аккаунт.
                </span>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-2">
                  <span className="field-label">Публиковать с</span>
                  <input
                    type="time"
                    value={scheduleDraft.active_hours_start}
                    disabled={isLoading || isSavingSchedule}
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
                  <span className="field-label">Публиковать до</span>
                  <input
                    type="time"
                    value={scheduleDraft.active_hours_end}
                    disabled={isLoading || isSavingSchedule}
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
                  disabled={isLoading || isSavingSchedule}
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
                {isSavingSchedule ? "Сохранение..." : "Сохранить настройки"}
              </button>
            </div>
          </div>
        </section>

        <section data-settings-pane="accounts" id="profiles" className="scroll-mt-28 rounded-[24px] border border-[#deded7] bg-white p-5 shadow-sm">
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
                title="Аккаунт ещё не выбран"
                description="Выберите свободный аккаунт в блоке «Добавить аккаунт в проект». Если его ещё нет в ThreadsGo, сначала подключите его в разделе «Аккаунты»."
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
                    isBusy={savingCookiesId !== null || checkingAccountId !== null || unlinkingAccountId !== null}
                    onSaveCookies={(cookies) => void saveAccountCookies(account.id, cookies)}
                    onCheckSession={() => void checkSession(account.id)}
                    onUnlink={() => void unlinkFromProject(account.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section data-settings-pane="accounts" className="rounded-[24px] border border-[#deded7] bg-white p-5 shadow-sm">
          <h2 className="font-display text-3xl">Добавить аккаунт в проект</h2>
          <div className="mt-3"><AccountRiskNotice /></div>
          <p className="mt-3 text-sm leading-6 text-[#66645d]">
            {freeAccounts.length > 0 ? "Здесь аккаунты, которые ещё не используются в других проектах. Выберите нужный и добавьте его." : "Свободных аккаунтов пока нет. Подключите новый или отключите существующий от другого проекта."}
          </p>
          <Link to="/app/infrastructure" className="mt-4 inline-flex min-h-11 items-center rounded-full border border-[#151515] px-4 text-sm text-[#151515] transition hover:bg-[#151515] hover:text-white">
            {freeAccounts.length === 0 ? "Подключить аккаунт Threads" : "Все аккаунты"}
          </Link>

          <label className="mt-6 grid gap-2">
            <span className="field-label">Свободный аккаунт</span>
            <select
              value={selectedAccountId}
              disabled={isLoading || isBinding || freeAccounts.length === 0}
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
            disabled={isLoading || !selectedAccountId || isBinding}
            className="mt-4 flex w-full items-center justify-center gap-3 rounded-2xl border border-[#151515] bg-[#151515] px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-white transition hover:bg-transparent hover:text-[#151515] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isBinding ? <Spinner /> : null}
            {isBinding ? "Добавляем..." : "Добавить аккаунт"}
          </button>

        </section>
      </div>
      {project && <details id="project-management" className="scroll-mt-28 rounded-2xl border border-[#d8e2da] bg-white p-5"><summary className="cursor-pointer font-semibold">{project.is_active ? "Название и пауза проекта" : "Проект на паузе · настройки"}</summary>
        <label className="mt-3 block text-sm">Название<input value={projectName} onChange={event => setProjectName(event.target.value)} maxLength={120} className="mt-2 w-full rounded-xl border bg-transparent p-3" /></label>
        <div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={managementBusy || !projectName.trim()} className="rounded-full border px-5 py-3 text-sm" onClick={async () => { setManagementBusy(true); try { setProject(await updateProject(project.id, { name: projectName.trim() })); notifyProjectUpdated(); toast.success("Название сохранено"); } catch (error) { toast.error(getApiErrorMessage(error, "Не удалось сохранить название")); } finally { setManagementBusy(false); } }}>Сохранить название</button>
        <button type="button" disabled={managementBusy} className="rounded-full border px-5 py-3 text-sm" onClick={async () => { setManagementBusy(true); try { setProject(await updateProject(project.id, { is_active: !project.is_active })); notifyProjectUpdated(); toast.success(project.is_active ? "Проект на паузе" : "Проект возобновлён"); } catch (error) { toast.error(getApiErrorMessage(error, "Не удалось изменить состояние")); } finally { setManagementBusy(false); } }}>{project.is_active ? "Поставить на паузу" : "Возобновить проект"}</button></div><p className="mt-3 text-xs opacity-70">На паузе проект сохраняет настройки и посты. Подготовка и публикации останавливаются.</p>
      </details>}

      {!isLoading && project ? (
        <Link to={`/app/projects/${projectId}`} className="inline-flex min-h-11 items-center rounded-full bg-[#151515] px-5 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e]">
          Открыть проект
        </Link>
      ) : null}
    </section>
  );
}

function AccountCard({
  account,
  isSavingCookies,
  isChecking,
  isUnlinking,
  isBusy,
  onSaveCookies,
  onCheckSession,
  onUnlink,
}: {
  account: Account;
  isSavingCookies: boolean;
  isChecking: boolean;
  isUnlinking: boolean;
  isBusy: boolean;
  onSaveCookies: (cookies: string) => void;
  onCheckSession: () => void;
  onUnlink: () => void;
}) {
  const [cookiesDraft, setCookiesDraft] = useState("");
  const proxyPaused = account.status === "proxy_error";
  const sessionNeedsUpdate = account.status === "cookies_expired" || account.status === "blocked" || account.status === "error";
  const isPaused = account.status !== "active";

  return (
    <article
      className={`rounded-2xl border p-4 transition hover:shadow-sm ${
        isPaused
          ? "border-[#d88a35]/50 bg-[#fff4df]"
          : "border-[#e1e1dc] bg-[#fbfaf5] hover:border-[#151515]"
      }`}
    >
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-center">
        <div>
          <p className="field-label">Аккаунт Threads</p>
          <p className="mt-1 text-sm text-[#24231f]">{formatUsername(account.username)}</p>
        </div>
        <div>
          <p className="field-label">Состояние</p>
          {account.username === "pending_from_session" && account.status === "active" ? (
            <span className="mt-1 inline-flex rounded-full bg-[#fff4df] px-3 py-1 text-xs text-[#8a4b00]">Нужно проверить вход</span>
          ) : <StatusBadge status={account.status} />}
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton onClick={onCheckSession} disabled={isBusy}>
            {isChecking ? "Проверяем..." : isPaused ? "Проверить и возобновить" : "Проверить вход"}
          </ActionButton>
          <ActionButton danger onClick={onUnlink} disabled={isBusy}>
            {isUnlinking ? "Отключаем..." : "Отключить от проекта"}
          </ActionButton>
        </div>
      </div>

      {isPaused ? <p className="mt-3 text-xs leading-5 text-[#66645d]">Успешная проверка входа снимет паузу и возобновит запланированные публикации.</p> : null}

      {account.last_error ? (
        <details className="mt-4 rounded-2xl border border-[#f0c7c1] bg-[#fff6f4] px-4 py-3 text-xs leading-5 text-[#7a625f]">
          <summary className="cursor-pointer font-medium text-[#8a2d25]">Показать техническую информацию для поддержки</summary>
          <p className="mt-2 break-words">{account.last_error}</p>
        </details>
      ) : null}

      {proxyPaused ? (
        <div className="mt-4 rounded-2xl border border-[#f1d19a] bg-[#fff8e8] px-4 py-3 text-sm leading-6 text-[#6f4300]">
          Соединение временно недоступно. Данные входа менять не нужно:
          ThreadsGo попробует восстановить подключение автоматически.
        </div>
      ) : null}

      {sessionNeedsUpdate ? (
        <div className="mt-4 space-y-4 border-t border-[#d88a35]/30 pt-4">
          <div className="rounded-2xl border border-[#d88a35]/40 bg-white/70 p-4 text-sm leading-6 text-[#4a2b08]">
            <p className="font-semibold text-[#24231f]">Публикации с этого аккаунта приостановлены.</p>
            <p className="mt-2">
              Threads мог попросить повторный вход или проверку безопасности. Иногда это ошибка открытия
              страницы. Попытки остановлены, пока вы не проверите аккаунт.
            </p>
            <ol className="mt-3 list-decimal space-y-1 pl-5">
              <li>Откройте свой аккаунт в Threads и проверьте, что вход работает.</li>
              <li>Если Meta просит код или проверку, пройдите её самостоятельно.</li>
              <li>Здесь нажмите «Проверить и возобновить».</li>
              <li>Если вход устарел, обновите данные через блок ниже и повторите проверку.</li>
            </ol>
          </div>
          <details className="rounded-2xl border border-[#d88a35]/40 bg-white/70 p-4">
            <summary className="cursor-pointer text-sm text-[#4a2b08]">Обновить данные входа</summary>
            <p className="mt-3 text-xs leading-5 text-[#66645d]">В браузере, где вы уже вошли в Threads, экспортируйте cookies в формате JSON через Cookie-Editor. После сохранения нажмите «Проверить и возобновить» выше.</p>
            <textarea
            value={cookiesDraft}
            onChange={(event) => setCookiesDraft(event.target.value)}
            disabled={isBusy}
            rows={5}
            placeholder="Вставьте свежие данные входа в формате JSON"
            className="mt-3 w-full resize-y rounded-2xl border border-[#d8d8d2] bg-white p-4 text-xs leading-5 text-[#24231f] outline-none transition focus:border-[#151515]"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onSaveCookies(cookiesDraft)}
              disabled={isBusy || !cookiesDraft.trim()}
              className="flex items-center gap-2 rounded-2xl border border-[#4a2b08] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#4a2b08] transition hover:bg-[#4a2b08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSavingCookies ? <Spinner /> : null}
              {isSavingCookies ? "Сохраняем..." : "Сохранить данные входа"}
            </button>
          </div>
          </details>
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
      toast.error("Такое слово уже добавлено");
      setDraft("");
      return;
    }

    onChange([...value, normalized]);
    setDraft("");
  }

  return (
    <div>
      <label className="grid gap-2">
        <span className="field-label">Введите слово, которое нужно запретить</span>
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
          placeholder="Пример: сплиты"
          className="field-control disabled:opacity-50"
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        {value.length === 0 ? (
          <span className="text-sm text-[#77766f]">Список запрещенных слов пока пуст</span>
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
  active: "Подключён",
  disabled: "На паузе",
  error: "Нужна проверка",
  warming_up: "Подготавливается",
  cookies_expired: "Нужен повторный вход",
  blocked: "Ограничение Threads",
  proxy_error: "Ошибка подключения",
};

function formatUsername(username: string) {
  return username === "pending_from_session" ? "Имя определится после проверки" : `@${username.replace(/^@/, "")}`;
}

function normalizeStopWords(words: string[]) {
  return Array.from(new Set(words.map((word) => word.trim().toLowerCase()).filter(Boolean)));
}

function normalizeTargetActions(actions: string[]) {
  return Array.from(new Set(actions.map((action) => action.trim()).filter(Boolean)));
}

function getConversionIntensityDescription(value: number) {
  if (value <= 0) {
    return "Посты помогают начать обсуждение. Приглашения перейти по ссылке не добавляем.";
  }
  if (value <= 25) {
    return "Редко приглашаем читателя сделать следующий шаг, когда это подходит к теме.";
  }
  if (value <= 50) {
    return "Добавляем приглашение примерно в половину постов.";
  }
  if (value <= 75) {
    return "Добавляем приглашение в большинство постов.";
  }
  return "Добавляем приглашение в каждый пост.";
}

function clampPostsPerDay(value: number, limit = 20) {
  if (!Number.isFinite(value)) {
    return 3;
  }

  return Math.min(limit, Math.max(1, Math.round(value)));
}

function normalizeTimezone(value: string | null | undefined) {
  return value && timezoneOptionValues.has(value) ? value : "Europe/Moscow";
}
