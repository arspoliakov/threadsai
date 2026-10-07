import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { createWeekPlan, getApiErrorMessage, previewTaskRewrite, returnTaskToDraft, scheduleTask, updateTask,
  type PostingTask, type ProjectAccountState, type RewriteMode } from "../api/client";
import { requestAttempt } from "../api/requestAttempt";
import { trackSeoEvent } from "./SeoAnalytics";

const field = "w-full rounded-xl border border-[#d8e2da] bg-white p-3 text-sm text-[#162b25]";
const button = "rounded-xl border border-[#315b46] px-4 py-2 text-sm text-[#315b46] disabled:opacity-50";

export function WeekPlanBuilder({ projectId, onCreated }: { projectId: number; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [rubrics, setRubrics] = useState("Практический совет, Разбор ошибки, Личное наблюдение");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function generate() {
    if (actionLock.current) return;
    const list = rubrics.split(",").map(x => x.trim()).filter(Boolean);
    if (!list.length || list.length > 5 || goal.trim().length < 10) {
      toast.error("Укажите 1–5 рубрик через запятую и цель недели — минимум 10 символов"); return;
    }
    actionLock.current = true; setBusy(true);
    try {
      const attempt = await requestAttempt(`week-plan.${projectId}`, { rubrics: list, goal: goal.trim() });
      const result = await createWeekPlan(projectId, list, goal.trim(), attempt.key);
      attempt.complete();
      if (!alive.current) return;
      toast.success(`${result.count} черновиков готовы. Проверьте факты и назначьте время каждому.`);
      trackSeoEvent("week_plan_created", { project_id: projectId });
      setOpen(false); onCreated();
    } catch (error) { if (alive.current) toast.error(getApiErrorMessage(error, "Не удалось создать план")); }
    finally { actionLock.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="rounded-2xl border border-[#d8e2da] bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Контент на неделю</h2>
      <p className="mt-1 text-sm text-[#67786e]">Семь текстов по вашим темам. Сначала вы проверите их и выберете время.</p></div>
      <button type="button" className={button} disabled={busy} onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Свернуть" : "Составить план"}</button></div>
    {open && <form className="mt-4 grid gap-4" onSubmit={e => { e.preventDefault(); void generate(); }}>
      <label className="grid gap-2 text-sm">Рубрики через запятую<input className={field} value={rubrics} maxLength={500} onChange={e => setRubrics(e.target.value)} disabled={busy} /></label>
      <label className="grid gap-2 text-sm">Что хотите рассказать на этой неделе?<textarea className={field} rows={3} value={goal} minLength={10} maxLength={1000} required disabled={busy}
        placeholder="Например: объяснить, как выбрать специалиста, разобрать частую ошибку клиентов и рассказать о новой услуге. Укажите реальные факты." onChange={e => setGoal(e.target.value)} /></label>
      <p className="text-xs text-[#67786e]">ИИ учитывает описание и стиль проекта. Этот план всегда сохраняется в черновиках, даже при автоматической публикации проекта. Даты вы выберете после проверки.</p>
      <button className={button} disabled={busy}>{busy ? "Готовим семь черновиков…" : "Подготовить 7 черновиков"}</button>
    </form>}
  </section>;
}

export function TaskPlanningControls({ task, accounts, onUpdated, disabled = false, onBusyChange }: { task: PostingTask; accounts: ProjectAccountState[]; onUpdated: (task: PostingTask) => void; disabled?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(task.scheduled_at ? localInput(task.scheduled_at) : "");
  const available = accounts.filter(a => a.ready_for_ideas === true);
  const [accountId, setAccountId] = useState(task.account_id || available[0]?.id || 0);
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  async function save() {
    if (actionLock.current || disabled) return;
    if (!time || !accountId) { toast.error("Выберите дату, время и рабочий профиль"); return; }
    const when = new Date(time);
    if (!Number.isFinite(when.getTime()) || when.getTime() < Date.now() + 120000) { toast.error("Выберите время хотя бы на две минуты вперёд"); return; }
    actionLock.current = true; setBusy(true); onBusyChange?.(true);
    try {
      const updated = await scheduleTask(task.id, when.toISOString(), accountId, task.posts_chain.length ? task.posts_chain : [task.content_text]);
      onUpdated(updated); setOpen(false); toast.success("Пост добавлен в расписание");
      trackSeoEvent("draft_scheduled", { task_id: task.id, project_id: task.project_id });
    } catch (error) { toast.error(getApiErrorMessage(error, "Не удалось сохранить время")); }
    finally { actionLock.current = false; setBusy(false); onBusyChange?.(false); }
  }
  async function pause() {
    if (actionLock.current || disabled) return;
    actionLock.current = true; setBusy(true); onBusyChange?.(true);
    try { onUpdated(await returnTaskToDraft(task.id)); setOpen(false); toast.success("Пост снят с расписания, текст сохранён"); }
    catch (error) { toast.error(getApiErrorMessage(error, "Не удалось снять пост с расписания")); }
    finally { actionLock.current = false; setBusy(false); onBusyChange?.(false); }
  }
  return <div className="mt-4 border-t border-[#e0e8e2] pt-4">
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || disabled} aria-expanded={open} onClick={() => { setAccountId(available.some(a => a.id === task.account_id) ? task.account_id! : available[0]?.id || 0); setTime(task.scheduled_at ? localInput(task.scheduled_at) : ""); setOpen(!open); }}>
      {task.status === "draft" ? "Запланировать публикацию" : "Изменить время"}</button>
      {task.status === "queued" && <button type="button" className={button} disabled={busy || disabled} onClick={() => void pause()}>Вернуть в черновики</button>}</div>
    {open && <form className="mt-4 grid gap-3" onSubmit={e => { e.preventDefault(); void save(); }}>
      {!available.length ? <p className="text-sm">Сначала <Link className="underline" to={`/app/projects/${task.project_id}/settings#profiles`}>подключите рабочий аккаунт Threads</Link>. Текст останется в черновиках.</p> : <>
        <label className="grid gap-2 text-sm">Аккаунт<select className={field} value={accountId} onChange={e => setAccountId(Number(e.target.value))} disabled={busy || disabled} required>
          {available.map(a => <option key={a.id} value={a.id}>@{a.username}</option>)}</select></label>
        <label className="grid gap-2 text-sm">Дата и время<input type="datetime-local" className={field} value={time} min={localInput(new Date(Date.now() + 180000).toISOString())} max={localInput(new Date(Date.now() + 90 * 86400000).toISOString())} onChange={e => setTime(e.target.value)} required disabled={busy || disabled} /></label>
        <p className="text-xs text-[#67786e]">Часовой пояс вашего браузера: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Проверьте факты: после подтверждения пост будет отправлен автоматически в активные часы проекта.</p>
        <button className={button} disabled={busy || disabled}>{busy ? "Сохраняем…" : "Подтвердить текст и время"}</button>
      </>}
    </form>}
  </div>;
}

export function TaskRewriteControls({ task, onUpdated, disabled = false, onBusyChange }: { task: PostingTask; onUpdated: (task: PostingTask) => void; disabled?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<RewriteMode>("clearer");
  const [instruction, setInstruction] = useState("");
  const [preview, setPreview] = useState<{ posts_chain: string[]; source_posts_chain: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  async function prepare() {
    if (actionLock.current || disabled) return;
    actionLock.current = true; setBusy(true); onBusyChange?.(true); setPreview(null);
    try {
      if (task.status === "queued") { onUpdated(await returnTaskToDraft(task.id)); }
      setPreview(await previewTaskRewrite(task.id, mode, instruction));
      trackSeoEvent("rewrite_preview", { task_id: task.id, mode });
    } catch (error) { toast.error(getApiErrorMessage(error, "Не удалось подготовить правку")); }
    finally { actionLock.current = false; setBusy(false); onBusyChange?.(false); }
  }
  async function apply() {
    if (!preview || actionLock.current || disabled) return;
    actionLock.current = true; setBusy(true); onBusyChange?.(true);
    try {
      const updated = await updateTask(task.id, preview.posts_chain, preview.source_posts_chain);
      onUpdated(updated);
      setPreview(null); setOpen(false); toast.success("Правка применена. Пост остаётся черновиком.");
      trackSeoEvent("rewrite_applied", { task_id: task.id, mode });
    } catch (error) { toast.error(getApiErrorMessage(error, "Текст изменился — обновите список")); }
    finally { actionLock.current = false; setBusy(false); onBusyChange?.(false); }
  }
  return <div className="mt-4">
    <div className="flex flex-wrap gap-2"><button className={button} type="button" disabled={busy || disabled} aria-expanded={open} onClick={() => setOpen(!open)}>Улучшить с ИИ</button></div>
    {open && <div className="mt-3 grid gap-3 rounded-2xl bg-[#f5f8f6] p-4">
      <label className="grid gap-2 text-sm">Что изменить?<select className={field} value={mode} onChange={e => { setMode(e.target.value as RewriteMode); setPreview(null); }} disabled={busy || disabled}>
        <option value="clearer">Сделать понятнее</option><option value="shorter">Сократить</option><option value="hook">Улучшить начало</option><option value="warmer">Добавить живой тон</option><option value="custom">Своя правка</option></select></label>
      {mode === "custom" && <label className="grid gap-2 text-sm">Ваша инструкция<textarea className={field} maxLength={600} value={instruction} onChange={e => { setInstruction(e.target.value); setPreview(null); }} disabled={busy || disabled} /></label>}
      <p className="text-xs text-[#67786e]">Исходный текст не заменится до подтверждения. Запланированный пост сначала вернётся в черновики, чтобы не отправиться во время правки.</p>
      <button type="button" className={button} disabled={busy || disabled || (mode === "custom" && !instruction.trim())} onClick={() => void prepare()}>{busy ? "Обрабатываем…" : "Показать вариант"}</button>
      {preview && <><div className="grid gap-3 md:grid-cols-2"><div><h3 className="text-sm font-semibold">Было</h3>{preview.source_posts_chain.map((p, i) => <p key={i} className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{p}</p>)}</div>
        <div><h3 className="text-sm font-semibold">Предлагаем</h3>{preview.posts_chain.map((p, i) => <p key={i} className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{p}<span className="block text-xs text-[#67786e]">{p.length}/500</span></p>)}</div></div>
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || disabled} onClick={() => void apply()}>Применить</button><button type="button" className={button} disabled={busy || disabled} onClick={() => setPreview(null)}>Оставить исходный</button></div></>}
    </div>}
  </div>;
}

export function localInput(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
