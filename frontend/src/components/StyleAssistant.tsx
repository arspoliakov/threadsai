import { useEffect, useRef, useState } from "react";
import { assistGlobalStyle, getStyleAssistantErrorMessage, type StyleAnswers } from "../api/client";
import { trackSeoEvent } from "./SeoAnalytics";

const initialAnswers: StyleAnswers = { tone: "friendly", perspective: "personal", length: "short", humor: "light", selling: "soft", restrictions: "", example: "" };
const fieldClass = "mt-2 w-full rounded-2xl border border-[#cfd8cc] bg-white p-3 text-sm leading-6 text-[#18251c] outline-none focus:border-[#4b7f35]";

export function StyleAssistant({ onApply, disabled = false }: { onApply: (body: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<StyleAnswers>(initialAnswers);
  const [result, setResult] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(false);
  const requestId = useRef(0);
  const alive = useRef(true);
  const working = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; requestId.current += 1; }; }, []);

  function answer<K extends keyof StyleAnswers>(key: K, value: StyleAnswers[K]) {
    setAnswers(current => ({ ...current, [key]: value }));
    setApplied(false);
  }
  async function generate() {
    if (working.current || disabled) return;
    working.current = true;
    const id = ++requestId.current;
    setIsGenerating(true); setError("");
    trackSeoEvent("style_assistant_started");
    try {
      const preview = await assistGlobalStyle(answers);
      if (!alive.current || id !== requestId.current) return;
      setResult(preview.body); setStep(3); setApplied(false);
      trackSeoEvent("style_assistant_generated");
    } catch (cause) {
      if (alive.current && id === requestId.current) setError(getStyleAssistantErrorMessage(cause));
    } finally {
      working.current = false;
      if (alive.current && id === requestId.current) setIsGenerating(false);
    }
  }

  return (
    <section className="rounded-[22px] border border-[#c8dfbd] bg-[#f3faef] p-4 text-[#18251c] sm:p-5" aria-label="Помощник настройки стиля" onKeyDown={event => {
      if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
    }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold">Помочь настроить стиль постов?</h2><p className="mt-2 text-sm leading-6 text-[#52634f]">Ответьте на несколько вопросов — нейросеть составит инструкции для ваших текстов.</p></div>
        <button type="button" disabled={disabled || isGenerating} onClick={() => setOpen(!open)} aria-expanded={open} className="rounded-full bg-[#18351e] px-5 py-3 text-sm text-white disabled:opacity-50">{open ? "Свернуть" : "Помочь со стилем"}</button>
      </div>
      {open ? <div className="mt-5 space-y-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#597051]">{step < 3 ? `Шаг ${step + 1} из 3` : "Ваш стиль готов"}</p>
        <fieldset disabled={disabled || isGenerating} className="space-y-4 disabled:opacity-60">
          {step === 0 ? <>
            <label className="block text-sm font-medium">Как должен звучать автор?<select value={answers.tone} onChange={e => answer("tone", e.target.value as StyleAnswers["tone"])} className={fieldClass}><option value="friendly">Просто и дружелюбно</option><option value="expert">Экспертно, без канцелярита</option><option value="direct">Прямо и по делу</option><option value="warm">Тепло и поддерживающе</option></select></label>
            <label className="block text-sm font-medium">От чьего лица писать?<select value={answers.perspective} onChange={e => answer("perspective", e.target.value as StyleAnswers["perspective"])} className={fieldClass}><option value="personal">От моего лица — «я»</option><option value="team">От команды — «мы»</option><option value="neutral">Нейтрально, без «я» и «мы»</option></select></label>
          </> : null}
          {step === 1 ? <>
            <label className="block text-sm font-medium">Как раскрывать мысль?<select value={answers.length} onChange={e => answer("length", e.target.value as StyleAnswers["length"])} className={fieldClass}><option value="short">Коротко: одна мысль без воды</option><option value="balanced">С пояснением или конкретным примером</option></select></label>
            <label className="block text-sm font-medium">Сколько юмора?<select value={answers.humor} onChange={e => answer("humor", e.target.value as StyleAnswers["humor"])} className={fieldClass}><option value="none">Без шуток</option><option value="light">Немного лёгкого юмора</option><option value="ironic">С иронией, без токсичности</option></select></label>
            <label className="block text-sm font-medium">Как относиться к продажам по умолчанию?<select value={answers.selling} onChange={e => answer("selling", e.target.value as StyleAnswers["selling"])} className={fieldClass}><option value="none">Без коммерческих призывов</option><option value="rare">Редко, только когда это уместно</option><option value="soft">Мягко знакомить с продуктом</option></select></label>
          </> : null}
          {step === 2 ? <>
            <label className="block text-sm font-medium">Что точно не хочется видеть? <span className="font-normal text-[#657560]">Необязательно</span><textarea value={answers.restrictions} maxLength={600} onChange={e => answer("restrictions", e.target.value)} rows={3} placeholder="Например: без давления, пафоса, сленга и слов «уникальный» или «успешный успех»" className={fieldClass} /></label>
            <label className="block text-sm font-medium">Пример текста, который вам нравится <span className="font-normal text-[#657560]">Необязательно</span><textarea value={answers.example} maxLength={1000} onChange={e => answer("example", e.target.value)} rows={3} placeholder="Небольшой отрывок — чтобы понять ритм и манеру, а не копировать его" className={fieldClass} /></label>
            <p className="text-xs leading-5 text-[#657560]">Ответы отправятся нейросети, которая уже готовит посты ThreadsGo. Не вводите пароли, cookies и чужие личные данные. Из примера мы берём манеру, а не тему проекта.</p>
          </> : null}
          {step === 3 ? <label className="block text-sm font-medium">Проверьте и при желании отредактируйте<textarea value={result} maxLength={6000} onChange={e => { setResult(e.target.value); setApplied(false); }} rows={9} className={fieldClass} /></label> : null}
        </fieldset>
        {error ? <p role="alert" className="rounded-xl bg-[#fff0eb] p-3 text-sm leading-6 text-[#9a3524]">{error}</p> : null}
        <p className="text-sm leading-6 text-[#52634f]">Это общий голос для всех проектов. Темы и аудитории задаются отдельно; конкретные настройки продаж в проекте имеют приоритет. Текущий стиль не изменится, пока вы не сохраните настройки или новый проект.</p>
        <div className="flex flex-wrap gap-3">
          {step > 0 ? <button type="button" disabled={isGenerating || disabled} onClick={() => setStep(step === 3 ? 0 : step - 1)} className="rounded-full border border-[#bccdb6] bg-white px-5 py-3 text-sm disabled:opacity-50">{step === 3 ? "Изменить ответы" : "Назад"}</button> : null}
          {step < 2 ? <button type="button" onClick={() => setStep(step + 1)} disabled={disabled} className="rounded-full bg-[#18351e] px-5 py-3 text-sm text-white disabled:opacity-50">Далее →</button> : null}
          {step === 2 ? <button type="button" disabled={isGenerating || disabled} onClick={() => void generate()} className="rounded-full bg-[#18351e] px-5 py-3 text-sm text-white disabled:opacity-50">{isGenerating ? "Готовим стиль…" : "Составить стиль"}</button> : null}
          {step === 3 ? <button type="button" disabled={disabled || result.trim().length < 10 || applied} onClick={() => { onApply(result.trim()); setApplied(true); trackSeoEvent("style_assistant_applied"); }} className="rounded-full bg-[#18351e] px-5 py-3 text-sm text-white disabled:opacity-50">{applied ? "Добавлено в редактор" : "Использовать этот стиль"}</button> : null}
        </div>
        {isGenerating ? <p role="status" className="text-sm text-[#52634f]">Обычно это занимает несколько секунд. Можно оставить окно открытым — готовый текст появится здесь.</p> : null}
        {applied ? <p role="status" className="text-sm font-medium text-[#345b29]">Стиль добавлен в редактор. Сохраните настройки или создайте проект, чтобы применить его.</p> : null}
      </div> : null}
    </section>
  );
}
