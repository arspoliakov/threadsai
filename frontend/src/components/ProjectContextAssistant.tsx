import { useEffect, useRef, useState } from "react";
import { assistProjectContext, type ProjectContextAnswers, type ProjectContextPreview } from "../api/projectContext";
import { getApiErrorMessage } from "../api/client";
import { trackSeoEvent } from "./SeoAnalytics";

const fields = [
  { key: "offer", label: "Что вы предлагаете?", placeholder: "Продукт, услуга или просто тема блога. Например: помогаю организовать домашний бюджет." },
  { key: "audience", label: "Для кого ваш проект?", placeholder: "Например: семьи, которым сложно планировать расходы." },
  { key: "problems", label: "Какие проблемы помогаете решить?", placeholder: "Например: неожиданные траты, непонятно, куда уходят деньги." },
] as const;
const resultFields = [
  { key: "description", label: "Описание проекта", max: 2000 },
  { key: "target_audience", label: "Аудитория", max: 1200 },
  { key: "product_context", label: "Что предлагаете и какую пользу даёте", max: 1600 },
] as const;
const fieldClass = "mt-2 w-full rounded-2xl border border-[#cfd8cc] bg-white p-3 text-sm leading-6 text-[#18251c] outline-none focus:border-[#4b7f35]";

export function ProjectContextAssistant({ disabled = false, onApply, onBusyChange }: {
  disabled?: boolean; onApply: (context: ProjectContextPreview) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<ProjectContextAnswers>({ offer: "", audience: "", problems: "" });
  const [result, setResult] = useState<ProjectContextPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(false);
  const alive = useRef(true);
  const working = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const canGenerate = fields.every(field => answers[field.key].trim().length >= 5);

  async function generate() {
    if (working.current || disabled || !canGenerate) return;
    working.current = true; setBusy(true); onBusyChange(true); setError("");
    trackSeoEvent("project_context_started");
    try {
      const preview = await assistProjectContext(answers);
      if (!alive.current) return;
      setResult(preview); setApplied(false);
      trackSeoEvent("project_context_generated");
    } catch (cause) {
      if (alive.current) setError(getApiErrorMessage(cause, "Не удалось составить описание. Ответы остались в форме."));
    } finally {
      working.current = false;
      if (alive.current) { setBusy(false); onBusyChange(false); }
    }
  }

  return <section className="rounded-[22px] border border-[#c8dfbd] bg-[#f3faef] p-4 text-[#18251c]" aria-label="Помощник описания проекта">
    <h2 className="text-lg font-semibold">Не знаете, как описать проект?</h2>
    <p className="mt-2 text-sm leading-6 text-[#52634f]">Три вопроса — и нейросеть подготовит описание, аудиторию и пользу проекта.</p>
    <button type="button" aria-expanded={open} disabled={disabled || busy} onClick={() => setOpen(!open)} className="mt-3 rounded-full border border-[#bccdb6] bg-white px-4 py-2 text-sm disabled:opacity-50">{open ? "Свернуть" : "Помочь с описанием"}</button>
    {open ? <div className="mt-4 space-y-4">
      <fieldset disabled={disabled || busy} className="space-y-3 disabled:opacity-60">
        {fields.map(field => <label key={field.key} className="block text-sm font-medium">{field.label}<textarea rows={2} maxLength={1000} value={answers[field.key]} placeholder={field.placeholder} className={fieldClass} onChange={e => { setAnswers(current => ({ ...current, [field.key]: e.target.value })); setApplied(false); setResult(null); }} /></label>)}
      </fieldset>
      <p className="text-xs leading-5 text-[#657560]">Ответы передаются нашей нейросети. Не указывайте пароли, cookies и личные данные. Используйте реальные факты; результат нужно проверить.</p>
      <button type="button" disabled={disabled || busy || !canGenerate} onClick={() => void generate()} className="rounded-full bg-[#18351e] px-5 py-3 text-sm text-white disabled:opacity-50">{busy ? "Составляем описание…" : result ? "Составить заново" : "Составить описание"}</button>
      {!canGenerate ? <p className="text-xs text-[#657560]">Напишите хотя бы несколько слов в каждом ответе.</p> : null}
      {error ? <p role="alert" className="rounded-xl bg-[#fff0eb] p-3 text-sm text-[#9a3524]">{error}</p> : null}
      {busy ? <p role="status" className="text-sm text-[#52634f]">Готовим вариант. Ваши поля проекта пока не изменены.</p> : null}
      {result ? <fieldset disabled={disabled || busy} className="space-y-3">
        <legend className="text-sm font-semibold">Проверьте и при желании отредактируйте</legend>
        {resultFields.map(field => <label key={field.key} className="block text-sm font-medium">{field.label}<textarea rows={3} maxLength={field.max} value={result[field.key]} className={fieldClass} onChange={e => { setResult(current => current ? { ...current, [field.key]: e.target.value } : current); setApplied(false); }} /></label>)}
        <p className="text-xs leading-5 text-[#657560]">Кнопка ниже заменит эти три поля в форме. Общий стиль не изменится. В сервисе всё сохранится только после нажатия «Создать».</p>
        <button type="button" disabled={applied || result.description.trim().length < 10 || result.target_audience.trim().length < 5 || result.product_context.trim().length < 5} onClick={() => { onApply(result); setApplied(true); trackSeoEvent("project_context_applied"); }} className="rounded-full bg-[#18351e] px-5 py-3 text-sm text-white disabled:opacity-50">{applied ? "Перенесено в форму" : "Использовать описание"}</button>
      </fieldset> : null}
    </div> : null}
  </section>;
}
