import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  createGlobalPrompt,
  getActiveGlobalPrompts,
  updateGlobalPrompt,
  type GlobalPrompt,
} from "../../api/client";

const DEFAULT_GLOBAL_PROMPT = `Ты — уставший, циничный практик, который пишет как человек, а не как нейросеть.
Ты делишься мыслью на ходу: без позы, без мотивационного тона, без рекламной лакировки.

Главная задача:
писать емкие, хлесткие, живые посты для Threads. Текст должен ощущаться как наблюдение человека, который слишком много раз видел одну и ту же ошибку и наконец сказал вслух.

Жестко запрещено:
- списки любого вида в финальном посте;
- эмодзи;
- хештеги;
- дешевый кликбейт;
- финальная мораль, наставление или вывод ради вывода;
- слова и фразы: "безусловно", "в современном мире", "важно помнить", "представьте".

Стиль:
можно начинать со строчной буквы. Предложения могут быть рваными, но не превращай текст в набор коротких обрубков. Ритм должен подстраиваться под успешные тренды, которые ты прочитал. Пиши прямо, немного устало, с практической злостью, но без оскорблений и провокации на срач.

Brand Safety:
не используй скам, агрессию, оскорбления, политические провокации и токсичный конфликт. Даже если тренд был грязным, забери только механику внимания, а не грязь.

Формат ответа:
только финальный пост на русском языке. Без заголовков, без пояснений, без этапов.`;

export default function GlobalSettingsPage() {
  const [prompt, setPrompt] = useState<GlobalPrompt | null>(null);
  const [body, setBody] = useState(DEFAULT_GLOBAL_PROMPT);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadPrompt() {
      setIsLoading(true);
      setError(null);

      try {
        const prompts = await getActiveGlobalPrompts();
        const firstPrompt = prompts[0] ?? null;
        setPrompt(firstPrompt);
        setBody(firstPrompt?.body || DEFAULT_GLOBAL_PROMPT);
      } catch {
        toast.error("Не удалось загрузить глобальный промпт");
        setError("Не удалось загрузить глобальный промпт.");
      } finally {
        setIsLoading(false);
      }
    }

    void loadPrompt();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setMessage(null);
    setError(null);

    try {
      const savedPrompt = prompt
        ? await updateGlobalPrompt(prompt.id, {
            title: "Default Anti-AI global content prompt",
            body,
            is_active: true,
          })
        : await createGlobalPrompt({
            prompt_type: "virality",
            title: "Default Anti-AI global content prompt",
            body,
            version: "1.0.0",
            is_active: true,
          });

      setPrompt(savedPrompt);
      setMessage("Глобальный промпт сохранен.");
      toast.success("Глобальный промпт сохранен");
    } catch {
      toast.error("Не удалось сохранить глобальный промпт");
      setError("Не удалось сохранить глобальный промпт.");
    } finally {
      setIsSaving(false);
    }
  }

  function resetToDefault() {
    setBody(DEFAULT_GLOBAL_PROMPT);
    setMessage("В поле возвращены Anti-AI рекомендации из шага 22. Нажми «Сохранить», чтобы записать их в базу.");
    toast.success("Anti-AI дефолт возвращен в поле");
  }

  return (
    <section className="space-y-8">
      <header className="border border-[#c9c9c3] bg-white p-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[#77766f]">
          System settings
        </p>
        <h1 className="mt-4 font-display text-5xl leading-none">Глобальные настройки</h1>
        <p className="mt-6 max-w-2xl text-sm leading-6 text-[#66645d]">
          Видимый GlobalPrompt теперь содержит те же Anti-AI правила, которые влияют
          на генерацию: запреты, стиль, Brand Safety и финальный формат.
        </p>
      </header>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="neutral">{message}</Notice> : null}

      <form onSubmit={handleSubmit} className="border border-[#c9c9c3] bg-white">
        <header className="grid gap-4 border-b border-[#c9c9c3] px-5 py-5 md:grid-cols-[1fr_auto]">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77766f]">
              GlobalPrompt
            </p>
            <h2 className="mt-2 font-display text-3xl">Ядро генерации</h2>
          </div>
          <button
            type="button"
            onClick={resetToDefault}
            className="self-end border border-[#151515] px-4 py-3 font-mono text-xs uppercase tracking-[0.16em] transition hover:bg-[#151515] hover:text-white"
          >
            Вернуть Anti-AI дефолт
          </button>
        </header>

        <div className="p-5">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            disabled={isLoading}
            rows={20}
            className="w-full resize-none border border-[#c9c9c3] bg-transparent p-4 text-sm leading-6 outline-none focus:border-[#151515] disabled:opacity-50"
          />
          <p className="mt-3 max-w-3xl text-xs leading-5 text-[#77766f]">
            Если промпт отсутствует в базе, backend автоматически создаст активный
            GlobalPrompt с этим Anti-AI дефолтом. Кодовый safety-backstop остается
            внутри генератора, но управляемая версия теперь видна здесь.
          </p>
        </div>

        <footer className="border-t border-[#c9c9c3] p-5">
          <button
            type="submit"
            disabled={isLoading || isSaving}
            className="border border-[#151515] bg-[#151515] px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-white transition hover:bg-transparent hover:text-[#151515] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSaving ? "Сохранение" : "Сохранить"}
          </button>
        </footer>
      </form>
    </section>
  );
}

function Notice({ children, tone }: { children: string; tone: "neutral" | "error" }) {
  const className =
    tone === "error"
      ? "border-l-2 border-[#b42318] bg-white px-5 py-4 text-sm text-[#61140e]"
      : "border-l-2 border-[#151515] bg-white px-5 py-4 text-sm text-[#252525]";

  return <div className={className}>{children}</div>;
}
