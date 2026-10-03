import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  applyGlobalStyle,
  getActiveGlobalPrompts,
  getApiErrorMessage,
} from "../../api/client";
import { StyleAssistant } from "../../components/StyleAssistant";
import { readStyleDraft, saveStyleDraft, clearStyleDraft } from "../../styleDraft";

const DEFAULT_GLOBAL_PROMPT = `Ты — редактор ThreadsGo. Пиши как живой человек, а не как рекламный отдел.

Главная задача:
создавать короткие, понятные и нативные посты для Threads. Текст должен звучать как наблюдение, заметка или сообщение от человека, а не как промо-баннер.

Правила стиля:
- сначала конкретика, потом настроение;
- без списков в финальном посте;
- без эмодзи и хештегов;
- без канцелярита, пафоса и мотивационных выводов;
- без дешевого кликбейта;
- нормальная пунктуация и живой русский язык;
- если есть тренды, бери из них ритм и механику внимания, но не копируй чужие факты.

Brand safety:
не используй скам, агрессию, оскорбления, политические провокации и токсичный конфликт. Если тренд грязный, забери только механику внимания, а не грязь.

Формат:
верни только готовый пост на русском языке, если конкретная функция не просит JSON.`;

export default function GlobalSettingsPage() {
  const [body, setBody] = useState(DEFAULT_GLOBAL_PROMPT);
  const [savedBody, setSavedBody] = useState(DEFAULT_GLOBAL_PROMPT);
  const [hasSavedStyle, setHasSavedStyle] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recoverableDraft, setRecoverableDraft] = useState<string | null>(null);

  useEffect(() => {
    async function loadPrompt() {
      setIsLoading(true);
      setLoadError(null);

      try {
        const prompts = await getActiveGlobalPrompts();
        const activePrompt = prompts.find(item => item.prompt_type === "virality") ?? null;
        const loadedBody = activePrompt?.body || DEFAULT_GLOBAL_PROMPT;
        setBody(loadedBody);
        setSavedBody(loadedBody);
        setHasSavedStyle(activePrompt !== null);
        const draft = readStyleDraft();
        if (draft && draft !== loadedBody) setRecoverableDraft(draft);
        else clearStyleDraft();
      } catch {
        const message = "Не удалось загрузить стиль. Попробуйте ещё раз — ваши сохранённые настройки не изменились.";
        setLoadError(message);
        toast.error(message);
      } finally {
        setIsLoading(false);
      }
    }

    void loadPrompt();
  }, []);

  const isDirty = body !== savedBody;
  const needsSave = isDirty || !hasSavedStyle;
  useEffect(() => {
    if (isLoading || loadError) return;
    if (isDirty) saveStyleDraft(body);
    else if (recoverableDraft === null) clearStyleDraft();
  }, [body, isDirty, isLoading, loadError, recoverableDraft]);

  useEffect(() => {
    function warnAboutUnsavedChanges(event: BeforeUnloadEvent) {
      if (body === savedBody) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnAboutUnsavedChanges);
    return () => window.removeEventListener("beforeunload", warnAboutUnsavedChanges);
  }, [body, savedBody]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);

    try {
      const savedPrompt = await applyGlobalStyle(body);
      setBody(savedPrompt.body);
      setSavedBody(savedPrompt.body);
      setHasSavedStyle(true);
      clearStyleDraft();
      setRecoverableDraft(null);
      toast.success("Стиль сохранён");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Не удалось сохранить стиль. Ваш текст остался в редакторе."));
    } finally {
      setIsSaving(false);
    }
  }

  function resetToDefault() {
    setBody(DEFAULT_GLOBAL_PROMPT);
    setRecoverableDraft(null);
    toast.info("Стандартный стиль добавлен в редактор. Нажмите «Сохранить стиль», чтобы применить его.");
  }

  return (
    <section className="workspace-page space-y-5">
      <header className="relative overflow-hidden rounded-[24px] border border-[#dfe4dc] bg-[#090d0c] p-5 text-white shadow-sm sm:p-6">
        <div className="absolute right-[-8rem] top-[-8rem] h-80 w-80 rounded-full bg-[#70ff35]/18 blur-[110px]" />
        <div className="absolute bottom-[-10rem] left-[20%] h-80 w-80 rounded-full bg-[#0076ff]/22 blur-[110px]" />
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[52%] overflow-hidden lg:block">
          <div className="absolute inset-0 bg-gradient-to-r from-[#090d0c] via-[#090d0c]/55 to-transparent" />
          <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-[#090d0c] to-transparent" />
          <img
            src="/interface/prompt-style.webp"
            alt=""
            className="absolute inset-y-0 right-[-4rem] h-full w-[calc(100%+6rem)] object-cover opacity-48 mix-blend-screen"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#090d0c] via-transparent to-[#090d0c]/35" />
        </div>

        <div className="relative max-w-3xl">
          <div className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/[0.06]">
            <img src="/threadsgo-logo.png" alt="" className="h-8 w-8 object-contain" />
          </div>
          <h1 className="mt-5 font-display text-4xl leading-[0.95] tracking-[-0.04em] sm:text-5xl">
            Стиль постов
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-white/62">
            Объясните ИИ, как писать от вашего имени: коротко или подробно, с юмором или серьёзно.
            Эти правила действуют во всех ваших проектах. Темы и аудитория задаются в каждом проекте отдельно.
          </p>
        </div>
      </header>

      {loadError ? (
        <div className="rounded-[24px] border border-[#e8c7c2] bg-[#fff7f5] p-6 shadow-sm">
          <h2 className="font-display text-3xl text-[#111]">Стиль пока не загрузился</h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[#665d5a]">{loadError}</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-5 h-11 rounded-full bg-[#151515] px-5 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e]">
            Попробовать снова
          </button>
        </div>
      ) : null}

      {!loadError ? <StyleAssistant disabled={isLoading || isSaving} onApply={generated => {
        setBody(generated);
        setRecoverableDraft(null);
        toast.info("Стиль добавлен в редактор. Нажмите «Сохранить стиль», чтобы применить его.");
      }} /> : null}
      {recoverableDraft !== null && !isDirty ? <div role="status" className="rounded-2xl border border-[#c8dfbd] bg-[#f3faef] p-5 text-[#18251c]">
        <p className="font-medium">Остался несохранённый вариант стиля</p>
        <p className="mt-2 text-sm">Можно вернуть его в редактор. Сохранённые настройки не изменятся, пока вы не нажмёте «Сохранить стиль».</p>
        <div className="mt-3 flex flex-wrap gap-3"><button type="button" onClick={() => { setBody(recoverableDraft); setRecoverableDraft(null); }} className="rounded-full bg-[#18351e] px-4 py-2 text-sm text-white">Восстановить вариант</button><button type="button" onClick={() => { clearStyleDraft(); setRecoverableDraft(null); }} className="rounded-full border border-[#bccdb6] px-4 py-2 text-sm">Оставить сохранённый стиль</button></div>
      </div> : null}

      <form onSubmit={handleSubmit} className={`${loadError ? "hidden" : "block"} overflow-hidden rounded-[24px] border border-[#dfe4dc] bg-white shadow-sm`}>
        <header className="flex flex-col gap-4 border-b border-[#e3e7df] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="font-display text-3xl leading-none tracking-[-0.04em] text-[#111]">
              Как ИИ будет писать
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#667066]">
              Например: «Пиши просто, от моего лица, без пафоса и эмодзи.
              Одна мысль на пост, с конкретным примером».
            </p>
          </div>
          <button
            type="button"
            onClick={resetToDefault}
            disabled={isLoading || isSaving}
            className="inline-flex h-11 items-center justify-center rounded-full border border-[#cfd5cc] px-5 text-sm text-[#323832] transition hover:border-[#141815] hover:bg-[#141815] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Взять стандартный стиль
          </button>
        </header>

        <div className="p-5 sm:p-6">
          <textarea
            aria-label="Общий стиль постов"
            maxLength={30000}
            value={body}
            onChange={(event) => { setBody(event.target.value); setRecoverableDraft(null); }}
            disabled={isLoading || isSaving}
            rows={18}
            className="min-h-[26rem] w-full resize-y rounded-[20px] border border-[#dfe4dc] bg-[#fbfcf7] p-4 text-sm leading-6 text-[#1d231d] outline-none transition focus:border-[#141815] disabled:opacity-50"
          />
        </div>

        <footer className="flex flex-col gap-3 border-t border-[#e3e7df] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <p className="text-sm leading-6 text-[#667066]">
            {isLoading ? "Загружаем ваш стиль…" : needsSave
              ? "Сохраните стиль, чтобы ИИ использовал его в следующих текстах. Готовые черновики не изменятся."
              : "Стиль сохранён. ИИ использует его при создании новых текстов."}
          </p>
          <button
            type="submit"
            disabled={isLoading || isSaving || !needsSave || !body.trim()}
            className="inline-flex h-12 items-center justify-center gap-3 rounded-full bg-[#141815] px-6 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? <Spinner /> : null}
            {isLoading ? "Загружаем…" : isSaving ? "Сохраняем…" : needsSave ? "Сохранить стиль" : "Стиль сохранён"}
          </button>
        </footer>
      </form>
    </section>
  );
}

function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border border-current border-t-transparent" />;
}
