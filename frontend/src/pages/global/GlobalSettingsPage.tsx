import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { DismissibleTip } from "../../components/DismissibleTip";
import {
  createGlobalPrompt,
  getActiveGlobalPrompts,
  updateGlobalPrompt,
  type GlobalPrompt,
} from "../../api/client";

const DEFAULT_GLOBAL_PROMPT = `Ты — редактор ThreadsGo. Пиши как живой человек, а не как рекламный отдел.

Главная задача:
создавать короткие, понятные и нативные посты для Threads. Текст должен звучать как наблюдение, заметка или сообщение от человека/команды, а не как промо-баннер.

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
  const [prompt, setPrompt] = useState<GlobalPrompt | null>(null);
  const [body, setBody] = useState(DEFAULT_GLOBAL_PROMPT);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function loadPrompt() {
      setIsLoading(true);

      try {
        const prompts = await getActiveGlobalPrompts();
        const activePrompt = prompts[0] ?? null;
        setPrompt(activePrompt);
        setBody(activePrompt?.body || DEFAULT_GLOBAL_PROMPT);
      } catch {
        toast.error("Не удалось загрузить стиль генерации");
      } finally {
        setIsLoading(false);
      }
    }

    void loadPrompt();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);

    try {
      const savedPrompt = prompt
        ? await updateGlobalPrompt(prompt.id, {
            title: "Пользовательский стиль генерации",
            body,
            is_active: true,
          })
        : await createGlobalPrompt({
            prompt_type: "virality",
            title: "Пользовательский стиль генерации",
            body,
            version: "1.0.0",
            is_active: true,
          });

      setPrompt(savedPrompt);
      toast.success("Стиль генерации сохранен");
    } catch {
      toast.error("Не удалось сохранить стиль генерации");
    } finally {
      setIsSaving(false);
    }
  }

  function resetToDefault() {
    setBody(DEFAULT_GLOBAL_PROMPT);
    toast.success("Базовый стиль возвращен в редактор");
  }

  return (
    <section className="space-y-7">
      <header className="relative overflow-hidden rounded-[32px] border border-[#dfe4dc] bg-[#090d0c] p-7 text-white shadow-sm sm:p-8">
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
          <div className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.06]">
            <img src="/threadsgo-logo.png" alt="" className="h-9 w-9 object-contain" />
          </div>
          <h1 className="mt-8 font-display text-5xl leading-[0.9] tracking-[-0.055em] sm:text-6xl">
            Стиль генерации
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-white/62">
            Это персональный глобальный промпт пользователя. Он применяется ко всем вашим проектам
            и задает общий голос: насколько текст сухой, живой, экспертный, дерзкий или спокойный.
          </p>
        </div>
      </header>

      <DismissibleTip
        storageKey="threadsgo.global-style-tip"
        title="Здесь настраивается общий голос"
        action={
          <Link
            to="/app/how-it-works"
            className="inline-flex h-10 items-center justify-center rounded-full border border-[#141815] px-4 text-sm text-[#141815] transition hover:bg-[#141815] hover:text-white"
          >
            Какие посты пишет нейросеть?
          </Link>
        }
      >
        В стиль лучше писать про тон, ритм и запретные слова. А продукт, аудиторию, оффер и закреп настраивайте внутри
        конкретного проекта.
      </DismissibleTip>

      <form
        onSubmit={handleSubmit}
        className="overflow-hidden rounded-[32px] border border-[#dfe4dc] bg-white shadow-sm"
      >
        <header className="flex flex-col gap-4 border-b border-[#e3e7df] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="font-display text-3xl leading-none tracking-[-0.04em] text-[#111]">
              Системный промпт
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#667066]">
              Пишите человеческим языком: какие слова избегать, какой тон держать,
              что важно для вашей аудитории и чего ИИ не должен делать.
            </p>
          </div>
          <button
            type="button"
            onClick={resetToDefault}
            disabled={isLoading || isSaving}
            className="inline-flex h-11 items-center justify-center rounded-full border border-[#cfd5cc] px-5 text-sm text-[#323832] transition hover:border-[#141815] hover:bg-[#141815] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Вернуть базовый
          </button>
        </header>

        <div className="grid gap-6 p-5 lg:grid-cols-[1fr_18rem] sm:p-6">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            disabled={isLoading || isSaving}
            rows={22}
            className="min-h-[34rem] w-full resize-y rounded-[24px] border border-[#dfe4dc] bg-[#fbfcf7] p-5 text-sm leading-6 text-[#1d231d] outline-none transition focus:border-[#141815] disabled:opacity-50"
          />

          <aside className="space-y-4">
            <InfoCard
              title="Для чего это"
              text="Это верхний слой правил. Он не заменяет описание проекта, а задает общий голос генерации."
            />
            <InfoCard
              title="Что писать"
              text="Тон, запреты, слова-паразиты, формат подачи, уровень экспертности и границы brand safety."
            />
            <InfoCard
              title="Что не писать"
              text="Не забивайте сюда локальные стоп-слова одного проекта. Для этого есть настройки конкретного проекта."
            />
          </aside>
        </div>

        <footer className="flex flex-col gap-3 border-t border-[#e3e7df] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <p className="text-sm leading-6 text-[#667066]">
            Изменения начнут применяться к новым генерациям после сохранения.
          </p>
          <button
            type="submit"
            disabled={isLoading || isSaving}
            className="inline-flex h-12 items-center justify-center gap-3 rounded-full bg-[#141815] px-6 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? <Spinner /> : null}
            {isSaving ? "Сохраняем" : "Сохранить стиль"}
          </button>
        </footer>
      </form>
    </section>
  );
}

function InfoCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-[24px] border border-[#dfe4dc] bg-[#fbfcf7] p-5">
      <p className="text-base text-[#141815]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[#667066]">{text}</p>
    </div>
  );
}

function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border border-current border-t-transparent" />;
}
