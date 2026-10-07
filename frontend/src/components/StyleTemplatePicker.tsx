import { useEffect, useRef, useState } from "react";
import { getActiveGlobalPrompts, getApiErrorMessage } from "../api/client";

export function StyleTemplatePicker({ onApply, disabled = false }: { onApply: (body: string) => void; disabled?: boolean }) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="mt-3 text-sm">
    <button type="button" className="min-h-11 rounded-full border px-5" disabled={disabled || busy} onClick={async () => {
      setBusy(true); setError("");
      try {
        const prompts = await getActiveGlobalPrompts();
        const template = prompts.find(prompt => prompt.prompt_type === "virality");
        if (!mounted.current) return;
        if (template) { onApply(template.body.slice(0, 12000)); if (template.body.length > 12000) setError("В редактор добавлены первые 12 000 символов шаблона. Сократите его перед сохранением проекта."); }
        else setError("Шаблон пока не сохранён. Можно описать стиль своими словами или попросить ИИ.");
      } catch (cause) { setError(getApiErrorMessage(cause, "Не удалось загрузить шаблон")); }
      finally { setBusy(false); }
    }}>{busy ? "Загружаем…" : "Взять мой шаблон стиля"}</button>
    {error && <p role="alert" className="mt-2 opacity-70">{error}</p>}
  </div>;
}
