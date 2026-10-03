import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { generateStudioTrial, getStudioTrial, getApiErrorMessage, getProjects, importStudioDraft, type StudioTrial, type Project } from "../api/client";
import { trackSeoEvent } from "../components/SeoAnalytics";

export default function StudioPage() {
  const [trial, setTrial] = useState<StudioTrial | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(0);
  const [topic, setTopic] = useState("");
  const [context, setContext] = useState("");
  const [tone, setTone] = useState("friendly");
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<"generate" | "transfer" | null>(null);
  const [loadError, setLoadError] = useState("");
  const loadSequence = useRef(0);
  const navigate = useNavigate();
  const field = "w-full rounded-xl border border-[#d8e2da] bg-white p-3 text-sm";
  async function load() {
    const sequence = ++loadSequence.current;
    setLoadError("");
    const [data, list] = await Promise.allSettled([getStudioTrial(), getProjects()]);
    if (sequence !== loadSequence.current) return;
    if (data.status === "fulfilled") setTrial(data.value);
    else setLoadError(getApiErrorMessage(data.reason, "Не удалось загрузить черновики"));
    if (list.status === "fulfilled") {
      setProjects(list.value);
      setProjectId(current => list.value.some(project => project.id === current) ? current : list.value[0]?.id || 0);
    }
  }
  useEffect(() => { void load(); return () => { loadSequence.current++; }; }, []);
  async function generate() {
    if (busy) return;
    if (topic.trim().length < 5 || context.trim().length < 20) { toast.error("Укажите тему от 5 символов и реальные факты от 20 символов"); return; }
    setBusy(true); setBusyAction("generate");
    try { const draft = await generateStudioTrial({ topic: topic.trim(), context: context.trim(), tone });
      setTrial(current => current ? { remaining: Math.max(0, current.remaining - 1), drafts: [draft, ...current.drafts] } : current);
      trackSeoEvent("trial_draft_created", { source: "studio" }); toast.success("Черновик готов. Проверьте факты и поправьте текст под себя."); }
    catch (e) { toast.error(getApiErrorMessage(e, "Не удалось подготовить черновик")); }
    finally { setBusy(false); setBusyAction(null); }
  }
  async function transfer(draftId: number) {
    if (busy || !projectId) return;
    setBusy(true); setBusyAction("transfer");
    try { const result = await importStudioDraft(draftId, projectId); navigate(`/app/projects/${result.project_id}/queue`); }
    catch (e) { toast.error(getApiErrorMessage(e, "Не удалось перенести черновик")); }
    finally { setBusy(false); setBusyAction(null); }
  }
  async function copyText(text: string) {
    try { await navigator.clipboard.writeText(text); toast.success("Текст скопирован"); }
    catch { toast.error("Не удалось скопировать — выделите текст вручную"); }
  }
  return <section className="space-y-5"><header><p className="text-xs font-semibold uppercase tracking-wider text-[#49705a]">Попробуйте до подключения аккаунта</p>
    <h1 className="mt-3 font-display text-4xl">Первый текст — без лишних шагов</h1><p className="mt-4 max-w-2xl text-sm leading-6 text-[#67786e]">Три бесплатных черновика после регистрации. Карта и вход в Threads не нужны. Здесь ничего не публикуется: тексты сохраняются в вашем кабинете.</p></header>
    {loadError ? <div role="alert" className="rounded-2xl border p-5"><p>{loadError}</p><button onClick={() => void load()} className="mt-3 underline">Повторить</button></div> : !trial ? <p>Загружаем черновики…</p> : <>
      <form onSubmit={e => { e.preventDefault(); void generate(); }} className="grid gap-4 rounded-2xl border border-[#d8e2da] bg-white p-5 sm:p-7">
        <div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">О чём напишем?</h2><span className="text-sm text-[#49705a]">Осталось {trial.remaining} из 3</span></div>
        <label className="grid gap-2 text-sm">Тема<input className={field} minLength={5} maxLength={600} required value={topic} onChange={e => setTopic(e.target.value)} placeholder="Например: почему клиентам сложно выбрать маркетолога" disabled={busy} /></label>
        <label className="grid gap-2 text-sm">Ваши факты, аудитория и мысль поста<textarea className={field} rows={5} minLength={20} maxLength={3000} required value={context} onChange={e => setContext(e.target.value)}
          placeholder="Для кого пишете? Что хотите сказать? Приведите реальный пример или наблюдение — с конкретикой текст будет лучше. Не вводите чужие персональные данные." disabled={busy} /></label>
        <label className="grid gap-2 text-sm">Манера<select className={field} value={tone} onChange={e => setTone(e.target.value)} disabled={busy}><option value="friendly">Как в разговоре</option><option value="expert">Экспертно, простыми словами</option><option value="direct">Коротко и прямо</option><option value="warm">Тепло и спокойно</option></select></label>
        <button className="rounded-xl bg-[#315b46] px-5 py-3 text-sm text-white disabled:opacity-50" disabled={busy || trial.remaining === 0}>{busyAction === "generate" ? "Готовим текст…" : trial.remaining ? "Создать пробный черновик" : "Три черновика уже использованы"}</button>
        {!trial.remaining && <p className="text-sm text-[#67786e]">Ваши тексты останутся здесь. Для работы с проектами и публикациями <Link className="underline" to="/app/billing">выберите подписку</Link>.</p>}
      </form>
      {projects.length > 0 && <label className="grid gap-2 text-sm">Переносить тексты в проект<select className={field} value={projectId} disabled={busy} onChange={e => setProjectId(Number(e.target.value))}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      <div className="grid gap-4 md:grid-cols-2">{trial.drafts.map(draft => <article className="min-w-0 rounded-2xl border border-[#d8e2da] bg-white p-5" key={draft.id}><h2 className="break-words text-sm font-semibold">{draft.topic}</h2><p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7">{draft.content_text}</p>
        <div className="mt-5 flex flex-wrap gap-3"><button className="rounded-xl border px-4 py-2 text-sm" onClick={() => void copyText(draft.content_text)}>Скопировать</button>
          {draft.imported_task_id ? <span className="text-sm text-[#67786e]">Уже перенесён в проект</span> : projectId ? <button className="rounded-xl border px-4 py-2 text-sm" disabled={busy} onClick={() => void transfer(draft.id)}>Сохранить в проект как черновик</button> : <Link className="rounded-xl border px-4 py-2 text-sm" to="/app/billing">К проекту и публикациям</Link>}</div></article>)}</div>
    </>}
  </section>;
}
