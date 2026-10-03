import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { generateStudioTrial, getStudioTrial, getApiErrorMessage, getProjects, getCurrentUser, getAccounts, importStudioDraft, type StudioTrial, type Project, type CurrentUser } from "../api/client";
import { requestAttempt } from "../api/requestAttempt";
import { trackSeoEvent } from "../components/SeoAnalytics";

export default function StudioPage() {
  const [trial, setTrial] = useState<StudioTrial | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [hasAccounts, setHasAccounts] = useState(false);
  const [projectId, setProjectId] = useState(0);
  const [topic, setTopic] = useState("");
  const [context, setContext] = useState("");
  const [tone, setTone] = useState("friendly");
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<"generate" | "transfer" | null>(null);
  const [loadError, setLoadError] = useState("");
  const loadSequence = useRef(0);
  const actionLock = useRef(false);
  const navigate = useNavigate();
  const field = "w-full rounded-xl border border-[#d8e2da] bg-white p-3 text-sm";
  async function load() {
    const sequence = ++loadSequence.current;
    setLoadError("");
    const [data, list, profile, accounts] = await Promise.allSettled([getStudioTrial(), getProjects(), getCurrentUser(), getAccounts()]);
    if (sequence !== loadSequence.current) return;
    if (data.status === "fulfilled") setTrial(data.value);
    else setLoadError(getApiErrorMessage(data.reason, "Не удалось загрузить черновики"));
    if (profile.status === "fulfilled") setUser(profile.value);
    if (accounts.status === "fulfilled") setHasAccounts(accounts.value.length > 0);
    if (list.status === "fulfilled") {
      setProjects(list.value);
      setProjectId(current => list.value.some(project => project.id === current) ? current : list.value[0]?.id || 0);
    }
  }
  useEffect(() => { void load(); return () => { loadSequence.current++; }; }, []);
  async function generate() {
    if (actionLock.current) return;
    if (topic.trim().length < 5 || context.trim().length < 20) { toast.error("Укажите тему от 5 символов и реальные факты от 20 символов"); return; }
    actionLock.current = true; setBusy(true); setBusyAction("generate");
    try { const payload = { topic: topic.trim(), context: context.trim(), tone };
      const attempt = await requestAttempt("trial", payload);
      const draft = await generateStudioTrial(payload, attempt.key);
      attempt.complete();
      setTrial(current => current ? { remaining: Math.max(0, current.remaining - (current.drafts.some(d => d.id === draft.id) ? 0 : 1)), drafts: [draft, ...current.drafts.filter(d => d.id !== draft.id)] } : current);
      void load();
      trackSeoEvent("trial_draft_created", { source: "studio" }); toast.success("Черновик готов. Проверьте факты и поправьте текст под себя."); }
    catch (e) { toast.error(getApiErrorMessage(e, "Не удалось подготовить черновик")); void load(); }
    finally { actionLock.current = false; setBusy(false); setBusyAction(null); }
  }
  async function transfer(draftId: number) {
    if (actionLock.current || !projectId) return;
    actionLock.current = true; setBusy(true); setBusyAction("transfer");
    try { const result = await importStudioDraft(draftId, projectId); navigate(`/app/projects/${result.project_id}/queue`); }
    catch (e) { toast.error(getApiErrorMessage(e, "Не удалось перенести черновик")); void load(); }
    finally { actionLock.current = false; setBusy(false); setBusyAction(null); }
  }
  async function copyText(text: string) {
    try { await navigator.clipboard.writeText(text); toast.success("Текст скопирован"); }
    catch { toast.error("Не удалось скопировать — выделите текст вручную"); }
  }
  const experienced = Boolean(user?.subscription_status || projects.length || hasAccounts);
  return <section className="workspace-page space-y-5"><header><p className="text-xs font-semibold uppercase tracking-wider text-[#49705a]">Пробные тексты по вашей теме</p>
    <h1 className="mt-3 font-display text-4xl">Проверить идею для поста</h1><p className="mt-4 max-w-2xl text-sm leading-6 text-[#67786e]">{!user && !experienced
      ? "Подготовьте отдельный текст по своей теме. Он сохранится здесь и не будет опубликован."
      : experienced
      ? "В проектах нейросеть сама пишет посты по вашим настройкам. Здесь можно отдельно попробовать конкретную тему. Если хотите написать свой пост, откройте проект и сохраните его как черновик."
      : "Попробуйте три текста после регистрации, без карты и входа в Threads. Они сохранятся здесь и не будут опубликованы. Дальше нейросеть сможет писать посты сама — в вашем проекте."}</p>
    {experienced && <Link className="mt-3 inline-block text-sm underline" to={projectId ? `/app/projects/${projectId}` : "/app"}>Перейти к работе в проекте →</Link>}</header>
    {loadError ? <div role="alert" className="rounded-2xl border p-5"><p>{loadError}</p><button onClick={() => void load()} className="mt-3 underline">Повторить</button></div> : !trial ? <p>Загружаем черновики…</p> : <>
      <form onSubmit={e => { e.preventDefault(); void generate(); }} className="grid gap-4 rounded-2xl border border-[#d8e2da] bg-white p-5 sm:p-7">
        <div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">О чём напишем?</h2><span className="text-sm text-[#49705a]">Пробных текстов осталось: {trial.remaining} из 3</span></div>
        <label className="grid gap-2 text-sm">Тема<input className={field} minLength={5} maxLength={600} required value={topic} onChange={e => setTopic(e.target.value)} placeholder="Например: почему клиентам сложно выбрать маркетолога" disabled={busy} /></label>
        <label className="grid gap-2 text-sm">Ваши факты, аудитория и мысль поста<textarea className={field} rows={5} minLength={20} maxLength={3000} required value={context} onChange={e => setContext(e.target.value)}
          placeholder="Для кого пишете? Что хотите сказать? Приведите реальный пример или наблюдение — с конкретикой текст будет лучше. Не вводите чужие персональные данные." disabled={busy} /></label>
        <label className="grid gap-2 text-sm">Манера<select className={field} value={tone} onChange={e => setTone(e.target.value)} disabled={busy}><option value="friendly">Как в разговоре</option><option value="expert">Экспертно, простыми словами</option><option value="direct">Коротко и прямо</option><option value="warm">Тепло и спокойно</option></select></label>
        <button className="rounded-xl bg-[#315b46] px-5 py-3 text-sm text-white disabled:opacity-50" disabled={busy || trial.remaining === 0}>{busyAction === "generate" ? "Готовим текст…" : trial.remaining ? "Подготовить пробный текст" : "Пробные тексты уже использованы"}</button>
        <p className="text-sm text-[#67786e]">В этом разделе доступны три пробных текста на аккаунт, независимо от тарифа. Генерация постов в проекте работает отдельно.</p>
        {!trial.remaining && <p className="text-sm text-[#67786e]">Ваши тексты останутся здесь. {user?.subscription_status
          ? <Link className="underline" to={projectId ? `/app/projects/${projectId}` : "/app"}>Продолжите работу в проекте</Link>
          : <>Для публикаций и автоматических постов <Link className="underline" to="/app/billing">выберите подписку</Link></>}.</p>}
      </form>
      {projects.length > 0 && <label className="grid gap-2 text-sm">Переносить тексты в проект<select className={field} value={projectId} disabled={busy} onChange={e => setProjectId(Number(e.target.value))}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      <div className="grid gap-4 md:grid-cols-2">{trial.drafts.map(draft => <article className="min-w-0 rounded-2xl border border-[#d8e2da] bg-white p-5" key={draft.id}><h2 className="break-words text-sm font-semibold">{draft.topic}</h2><p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7">{draft.content_text}</p>
        <div className="mt-5 flex flex-wrap gap-3"><button className="rounded-xl border px-4 py-2 text-sm" onClick={() => void copyText(draft.content_text)}>Скопировать</button>
          {draft.imported_task_id ? <span className="text-sm text-[#67786e]">Уже перенесён в проект</span> : projectId ? <button className="rounded-xl border px-4 py-2 text-sm" disabled={busy} onClick={() => void transfer(draft.id)}>Сохранить в проект как черновик</button> : <Link className="rounded-xl border px-4 py-2 text-sm" to="/app">Создать проект</Link>}</div></article>)}</div>
    </>}
  </section>;
}
