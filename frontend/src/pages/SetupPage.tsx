import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { apiClient, createProject, getAccounts, getApiErrorMessage, getCurrentUser, getProjectDashboard, getStudioTrial, generateStudioTrial, importStudioDraft, refreshBillingStatus, updateAccount, updateProject, type Account, type ProjectDashboard, type StudioDraft, type StudioTrial } from "../api/client";

import { StyleTemplatePicker } from "../components/StyleTemplatePicker";

type SetupAnswers = { name?: string; topic?: string; audience?: string; facts?: string; tone?: string; style_body?: string; mode?: "review" | "auto"; posts_per_day?: number; active_hours_start?: string; active_hours_end?: string; timezone?: string };
type Progress = { step: number; answers: SetupAnswers; preview: StudioDraft | null; project_id: number | null; completed: boolean };
const labels = ["Тема", "Стиль", "Пробный пост", "Публикации"];
const field = "mt-2 w-full rounded-xl border border-[var(--workspace-border)] bg-transparent p-3 text-base";
const button = "min-h-11 rounded-full bg-[#151515] px-5 py-3 text-sm text-white disabled:opacity-40";

export default function SetupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [progress, setProgress] = useState<Progress | null>(null);
  const current = useRef<Progress | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestKey = useRef<string | null>(null);
  const [trial, setTrial] = useState<StudioTrial | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [hasPlan, setHasPlan] = useState(false);
  const [postsLimit, setPostsLimit] = useState(1);
  const [dashboard, setDashboard] = useState<ProjectDashboard | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(true);
  const [busy, setBusy] = useState(false);
  const [accountId, setAccountId] = useState("");
  const initialization = useRef<Promise<Progress> | null>(null);
  const initializationSearch = useRef<string | null>(null);
  const projectRequestKey = useRef<string>(crypto.randomUUID());
  const mounted = useRef(true);
  const setupScope = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  function persist(next: Progress): Promise<unknown> {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setSaved(false);
    const scope = setupScope.current;
    const operation = queue.current.catch(() => undefined).then(() => apiClient.put("/api/v1/onboarding", next));
    queue.current = operation;
    void operation.then(() => { if (mounted.current && scope === setupScope.current && current.current === next) { setSaved(true); setError(""); } }).catch(cause => { if (mounted.current && scope === setupScope.current) setError(getApiErrorMessage(cause, "Не удалось сохранить ответы. Нажмите «Сохранить ещё раз».")); });
    return operation;
  }
  function changeAnswers(patch: Partial<SetupAnswers>) {
    if (!current.current || !mounted.current) return;
    if (["topic", "audience", "facts", "tone", "style_body"].some(key => key in patch)) requestKey.current = null;
    const next = { ...current.current, answers: { ...current.current.answers, ...patch } };
    current.current = next; setProgress(next); setSaved(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void persist(next); }, 600);
  }
  async function advance(step: number) {
    if (!current.current) return;
    const scope = setupScope.current;
    setBusy(true);
    try { const next = { ...current.current, step }; await persist(next); if (!mounted.current || scope !== setupScope.current) return; current.current = next; setProgress(next); setSaved(true); }
    catch (cause) { if (mounted.current && scope === setupScope.current) setError(getApiErrorMessage(cause, "Не удалось сохранить шаг. Ответы остались в форме.")); }
    finally { setBusy(false); }
  }
  async function refreshConnection(projectId = current.current?.project_id) {
    const [user, existingAccounts] = await Promise.all([getCurrentUser(), getAccounts()]);
    setHasPlan(user.subscription_status); setPostsLimit(user.tariff_posts_per_day || 1); setAccounts(existingAccounts);
    if (projectId) setDashboard(await getProjectDashboard(projectId));
  }
  useEffect(() => {
    let active = true;
    if (initializationSearch.current !== location.search && new URLSearchParams(location.search).has("new")) {
      initialization.current = null;
      setupScope.current += 1;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      projectRequestKey.current = crypto.randomUUID();
      requestKey.current = null;
      current.current = null;
      setProgress(null); setDashboard(null); setError(""); setSaved(true);
    }
    initializationSearch.current = location.search;
    initialization.current ??= (async () => {
      await queue.current.catch(() => undefined);
      let state = (await apiClient.get<Progress>("/api/v1/onboarding")).data;
      if (new URLSearchParams(location.search).has("new")) {
        state = { step: 0, answers: {}, preview: null, project_id: null, completed: false };
        await apiClient.put("/api/v1/onboarding", { ...state, reset: true });
      }
      return state;
    })();
    void initialization.current.then(async state => {
      if (!active) return;
      if (new URLSearchParams(location.search).has("new")) navigate("/app/setup", { replace: true });
      current.current = state; setProgress(state);
      const studio = await getStudioTrial();
      if (active) setTrial(studio);
      if (active) await refreshConnection(state.project_id);
    }).catch(cause => { if (active) setError(getApiErrorMessage(cause, "Не удалось открыть настройку. Попробуйте обновить страницу.")); });
    return () => { active = false; };
  }, [location.search]);
  useEffect(() => {
    const refresh = () => { void refreshConnection().catch(() => {}); };
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("focus", refresh); if (timer.current && current.current) void persist(current.current); };
  }, []);

  async function generatePreview() {
    if (!current.current || busy) return;
    setBusy(true); setError("");
    const scope = setupScope.current;
    try {
      await persist(current.current);
      const answers = current.current.answers;
      const context = [answers.audience && `Читатели: ${answers.audience.slice(0, 700)}`, answers.facts?.slice(0, 1100), answers.style_body?.slice(0, 1100)].filter(Boolean).join("\n").slice(0, 3000);
      requestKey.current ??= crypto.randomUUID();
      const draft = await generateStudioTrial({ topic: answers.topic || "", context, tone: answers.tone || "friendly" }, requestKey.current);
      requestKey.current = null;
      if (!mounted.current || scope !== setupScope.current) return;
      const next = { ...current.current, preview: draft };
      current.current = next; setProgress(next); await persist(next); setSaved(true);
      setTrial(await getStudioTrial());
    } catch (cause) { if (mounted.current && scope === setupScope.current) setError(getApiErrorMessage(cause, "Не удалось подготовить пост. Попробуйте ещё раз.")); }
    finally { setBusy(false); }
  }
  async function createSetupProject() {
    if (!current.current || busy) return;
    setBusy(true); setError("");
    const scope = setupScope.current;
    try {
      let state = current.current;
      if (!state.project_id) {
        const answers = state.answers;
        const project = await createProject({ onboarding_request_key: projectRequestKey.current, name: answers.name?.trim() || answers.topic?.slice(0, 80) || "Мой проект", slug: `project-${projectRequestKey.current.slice(0, 12)}`, description: answers.topic || null, global_context: [answers.topic, answers.facts].filter(Boolean).join("\n"), target_audience: answers.audience || null, style_body: answers.style_body || `Тон: ${answers.tone || "friendly"}. Короткие понятные тексты.`, publication_mode: "manual", is_active: true });
        if (!mounted.current || scope !== setupScope.current) return;
        state = { ...state, project_id: project.id };
        current.current = state; setProgress(state); await persist(state);
        window.dispatchEvent(new Event("threadsgo:project-updated"));
      }
      if (state.preview && state.project_id && !state.preview.imported_task_id) {
        const imported = await importStudioDraft(state.preview.id, state.project_id);
        if (!mounted.current || scope !== setupScope.current) return;
        state = { ...state, preview: { ...state.preview, imported_task_id: imported.task_id } };
        current.current = state; setProgress(state); await persist(state);
      }
      await refreshConnection(state.project_id); setSaved(true);
    } catch (cause) {
      if (!mounted.current || scope !== setupScope.current) return;
      try { const recovered = (await apiClient.get<Progress>("/api/v1/onboarding")).data; if (!mounted.current || scope !== setupScope.current) return; if (recovered.project_id && current.current) { const next = { ...current.current, project_id: recovered.project_id }; current.current = next; setProgress(next); await refreshConnection(next.project_id); } } catch { /* Keep answers for a later retry. */ }
      setError(getApiErrorMessage(cause, "Не удалось завершить создание. Повторите — сохранённый проект будет использован."));
    }
    finally { setBusy(false); }
  }
  async function bindAccount() {
    if (!current.current?.project_id || !accountId || busy) return;
    setBusy(true);
    try { await updateAccount(Number(accountId), { project_id: current.current.project_id }); await refreshConnection(); window.dispatchEvent(new Event("threadsgo:project-updated")); toast.success("Аккаунт добавлен"); }
    catch (cause) { setError(getApiErrorMessage(cause, "Не удалось добавить аккаунт")); }
    finally { setBusy(false); }
  }
  async function finish() {
    if (!current.current?.project_id || !dashboard?.workflow?.ready) return;
    const scope = setupScope.current;
    setBusy(true);
    try {
      const state = current.current;
      const answers = state.answers;
      await persist(state);
      if (state.preview && !state.preview.imported_task_id) await importStudioDraft(state.preview.id, state.project_id!);
      if (!mounted.current || scope !== setupScope.current) return;
      await updateProject(state.project_id!, { name: answers.name?.trim() || dashboard?.project.name || "Мой проект", description: answers.topic || null, global_context: [answers.topic, answers.facts].filter(Boolean).join("\n"), target_audience: answers.audience || null, style_body: answers.style_body || `Тон: ${answers.tone || "friendly"}. Короткие понятные тексты.`, publication_mode: answers.mode || "review", posts_per_day: Math.max(1, Math.min(postsLimit, answers.posts_per_day || 1)), active_hours_start: answers.active_hours_start || "09:00", active_hours_end: answers.active_hours_end || "21:00", timezone: answers.timezone || "Europe/Moscow" });
      if (!mounted.current || scope !== setupScope.current) return;
      const next = { ...state, completed: true }; current.current = next; setProgress(next); await persist(next);
      window.dispatchEvent(new Event("threadsgo:project-updated"));
      navigate(`/app/projects/${state.project_id}`);
    } catch (cause) {
      if (!mounted.current || scope !== setupScope.current) return;
      await refreshConnection().catch(() => undefined);
      window.dispatchEvent(new Event("threadsgo:project-updated"));
      setError(getApiErrorMessage(cause, "Не удалось подтвердить завершение. Часть настроек могла сохраниться. Проверьте режим в проекте или повторите завершение."));
    }
    finally { setBusy(false); }
  }
  if (!progress) return <section><h1 className="font-display text-4xl">Настроим ваши публикации</h1><p className="mt-4" role={error ? "alert" : "status"}>{error || "Загружаем сохранённые ответы…"}</p></section>;
  const answers = progress.answers;
  const freeAccounts = accounts.filter(account => account.project_id === null || account.project_id === progress.project_id);
  const enoughContext = [answers.audience, answers.facts, answers.style_body].filter(Boolean).join("\n").length >= 20;
  return <section className="mx-auto max-w-3xl space-y-6">
    <header><h1 className="font-display text-4xl">Настроим ваши публикации</h1><p className="mt-3 text-sm opacity-70">Ответы сохраняются. Можно вернуться позже и продолжить с этого места.</p></header>
    <ol className="grid grid-cols-4 gap-2" aria-label="Шаги настройки">{labels.map((label, index) => <li key={label} aria-current={progress.step === index ? "step" : undefined} className={`rounded-xl border p-3 text-center text-xs sm:text-sm ${progress.step === index ? "border-[#151515] bg-[#70ff35] text-[#07100e]" : "opacity-60"}`}>{index + 1}. {label}</li>)}</ol>
    {error && <div role="alert" className="rounded-xl border border-red-300 p-4 text-sm">{error}<button className="mt-3 block underline" disabled={busy} onClick={() => { if (current.current) void persist(current.current); }}>Сохранить ещё раз</button></div>}
    <fieldset disabled={busy} className="min-w-0 rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-panel)] p-5 sm:p-7"><legend className="sr-only">{labels[progress.step]}</legend>
      {progress.step === 0 && <div className="space-y-5"><h2 className="text-xl font-semibold">О чём пишем?</h2>
        <label className="block text-sm">Название проекта<input value={answers.name || ""} onChange={event => changeAnswers({ name: event.target.value })} maxLength={120} placeholder="Например: мой блог или название клиента" className={field} /></label>
        <label className="block text-sm">Тема постов<textarea aria-label="Тема постов" value={answers.topic || ""} onChange={event => changeAnswers({ topic: event.target.value })} rows={3} maxLength={600} placeholder="Помогаю предпринимателям вести учёт. Хочу писать о деньгах, налогах и частых ошибках." className={field} /></label>
        <label className="block text-sm">Для кого пишем?<textarea aria-label="Для кого пишем?" value={answers.audience || ""} onChange={event => changeAnswers({ audience: event.target.value })} rows={2} maxLength={1200} placeholder="Кто ваши читатели и что им интересно" className={field} /></label>
        <label className="block text-sm">Что важно знать о вас?<textarea aria-label="Что важно знать о вас?" value={answers.facts || ""} onChange={event => changeAnswers({ facts: event.target.value })} rows={3} maxLength={1600} placeholder="Ваш опыт, продукт, факты и примеры, на которые можно опереться" className={field} /></label>
      </div>}
      {progress.step === 1 && <div className="space-y-5"><h2 className="text-xl font-semibold">Как должны звучать тексты?</h2><label className="block text-sm">Тон<select value={answers.tone || "friendly"} onChange={event => changeAnswers({ tone: event.target.value })} className={field}><option value="friendly">Дружелюбно и просто</option><option value="expert">Спокойно и экспертно</option><option value="direct">Прямо и по делу</option><option value="warm">Тепло и лично</option></select></label>
        <label className="block text-sm">Пожелания и пример — необязательно<textarea aria-label="Пожелания и пример — необязательно" value={answers.style_body || ""} onChange={event => changeAnswers({ style_body: event.target.value })} rows={6} maxLength={12000} placeholder="Короткие посты от первого лица, немного юмора, без канцелярита. Можно вставить пример своего текста." className={field} /></label>
        <StyleTemplatePicker disabled={busy} onApply={body => changeAnswers({ style_body: body.slice(0, 12000) })} />
        <button className="min-h-11 rounded-full border px-5 text-sm" disabled={busy} onClick={async () => { const scope = setupScope.current; setBusy(true); try { const result = (await apiClient.post<{ body: string }>("/api/v1/onboarding/style", { tone: answers.tone || "friendly", perspective: "personal", length: "short", humor: "light", selling: "soft", restrictions: "", example: (answers.style_body || "").slice(0, 1000) }, { timeout: 65000 })).data; if (scope === setupScope.current) changeAnswers({ style_body: result.body }); } catch (cause) { if (scope === setupScope.current) setError(getApiErrorMessage(cause, "Не удалось предложить стиль. Можно описать его своими словами.")); } finally { setBusy(false); } }}>Помочь описать стиль с ИИ</button>
      </div>}
      {progress.step === 2 && <div className="space-y-5"><h2 className="text-xl font-semibold">Посмотрим, что получается</h2><p className="text-sm opacity-70">Пробный пост останется черновиком. После создания проекта его можно отредактировать в разделе «Посты».</p>
        {progress.preview && <article className="whitespace-pre-wrap rounded-xl border p-4 text-sm leading-7">{progress.preview.content_text}</article>}
        {!enoughContext && <p className="text-sm">Добавьте несколько фактов о себе или пожеланий к стилю — минимум 20 символов для осмысленного результата.</p>}
        {(trial?.remaining ?? 0) > 0 && <button className={button} disabled={busy || !enoughContext} onClick={() => void generatePreview()}>{busy ? "Готовим…" : progress.preview ? "Попробовать ещё один вариант" : "Подготовить пробный пост"}</button>}
        {trial?.remaining === 0 && !progress.preview && <div><p className="text-sm">Пробные генерации уже использованы. Можно выбрать сохранённый текст или продолжить настройку.</p>{trial.drafts.filter(draft => !draft.imported_task_id).map(draft => <button key={draft.id} className="mt-3 block w-full rounded-xl border p-3 text-left text-sm" onClick={() => { const next = { ...progress, preview: draft }; current.current = next; setProgress(next); void persist(next); }}>{draft.topic}</button>)}</div>}
        {progress.preview && <p className="text-xs opacity-60">Смена темы или стиля не меняет этот текст. Подготовьте новый вариант, чтобы увидеть изменения.</p>}
      </div>}
      {progress.step === 3 && <div className="space-y-5"><h2 className="text-xl font-semibold">Подключим публикации</h2>
        {!hasPlan ? <div><p className="text-sm leading-6">Для проекта и публикаций нужна подписка. Тема, стиль и пробный текст уже сохранены.</p><Link className={`${button} mt-4 inline-block`} to="/app/billing?return_to=%2Fapp%2Fsetup">Выбрать тариф</Link><button className="ml-3 mt-4 underline" onClick={() => { void refreshBillingStatus().then(() => refreshConnection()).catch(cause => setError(getApiErrorMessage(cause, "Не удалось проверить подписку"))); }}>Я уже оплатил — проверить</button></div> : !progress.project_id ? <button className={button} disabled={busy} onClick={() => void createSetupProject()}>{busy ? "Создаём…" : "Создать проект с этими настройками"}</button> : <>
          <p className="text-sm">Проект создан{progress.preview ? ". Пробный текст сохранён для проверки" : ""}. Тема и стиль обновятся при завершении настройки.</p>
          {dashboard?.workflow?.blockers?.map(blocker => <div key={blocker.code} className="rounded-xl border border-amber-300 p-4 text-sm"><p>{blocker.message}</p><Link to={blocker.action_href} className="mt-2 inline-block underline">{blocker.action_label}</Link></div>)}
          {!accounts.some(account => account.project_id === progress.project_id) && <div><Link to={`/app/infrastructure?return_to=${encodeURIComponent("/app/setup")}`} className="inline-flex min-h-11 items-center rounded-full border px-5 text-sm">Подключить аккаунт Threads</Link>{freeAccounts.length > 0 && <div className="mt-4"><label className="text-sm">Или выбрать уже подключённый<select value={accountId} onChange={event => setAccountId(event.target.value)} className={field}><option value="">Выберите аккаунт</option>{freeAccounts.map(account => <option key={account.id} value={account.id}>@{account.username} {account.status !== "active" ? "— нужна проверка" : ""}</option>)}</select></label><button className={`${button} mt-3`} disabled={!accountId || busy} onClick={() => void bindAccount()}>Добавить в проект</button></div>}</div>}
          <fieldset disabled={busy} className="grid gap-3"><legend className="mb-3 text-sm font-semibold">Как будем работать?</legend>{([{ value: "review", title: "С моей проверкой", text: "ИИ готовит тексты, вы проверяете и назначаете публикацию." }, { value: "auto", title: "Автоматически", text: "ИИ готовит и публикует по расписанию." }] as const).map(mode => <label key={mode.value} className="flex gap-3 rounded-xl border p-4 text-sm"><input type="radio" name="setup-mode" checked={(answers.mode || "review") === mode.value} onChange={() => changeAnswers({ mode: mode.value })} /><span><strong>{mode.title}</strong><span className="mt-1 block opacity-70">{mode.text}</span></span></label>)}</fieldset>
          <div className="grid gap-4 sm:grid-cols-3"><label className="text-sm">Постов в день<input type="number" min={1} max={postsLimit} value={answers.posts_per_day || 1} onChange={event => changeAnswers({ posts_per_day: Number(event.target.value) })} className={field} /></label><label className="text-sm">С<input type="time" value={answers.active_hours_start || "09:00"} onChange={event => changeAnswers({ active_hours_start: event.target.value })} className={field} /></label><label className="text-sm">До<input type="time" value={answers.active_hours_end || "21:00"} onChange={event => changeAnswers({ active_hours_end: event.target.value })} className={field} /></label></div>
          <label className="block text-sm">Часовой пояс<select value={answers.timezone || "Europe/Moscow"} onChange={event => changeAnswers({ timezone: event.target.value })} className={field}>{["Europe/Moscow", "Europe/Berlin", "Asia/Dubai", "Asia/Almaty", "America/New_York", "UTC"].map(zone => <option key={zone}>{zone}</option>)}</select></label>
          <p className="text-xs opacity-70">Нажатие кнопки включит выбранный режим. Автоматическая публикация начнётся только при рабочем аккаунте и действующей подписке.</p>
          <button className={button} disabled={busy || !dashboard?.workflow?.ready} onClick={() => void finish()}>{busy ? "Сохраняем…" : answers.mode === "auto" ? "Включить автоматическую публикацию" : "Включить подготовку с моей проверкой"}</button>
          <Link to={`/app/projects/${progress.project_id}`} className="ml-3 inline-block min-h-11 py-3 text-sm underline">Перейти в проект</Link>
        </>}
      </div>}
    </fieldset>
    <div className="flex flex-wrap items-center justify-between gap-3">{progress.step > 0 && <button className="min-h-11 rounded-full border px-5 text-sm" disabled={busy} onClick={() => void advance(progress.step - 1)}>Назад</button>}<span className="text-xs opacity-60" role="status">{saved ? "Ответы сохранены" : "Сохраняем ответы…"}</span>{progress.step < 3 && <button className={button} disabled={busy || (progress.step === 0 && (answers.topic?.trim().length || 0) < 5)} onClick={() => void advance(progress.step + 1)}>Продолжить</button>}</div>
    {progress.project_id && <Link className="inline-block text-sm underline" to={`/app/projects/${progress.project_id}`}>Открыть сохранённый проект</Link>}
  </section>;
}
