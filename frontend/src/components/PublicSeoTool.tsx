import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { trackSeoEvent } from "./SeoAnalytics";

type PublicSeoToolProps = {
  path: string;
};

const ideaGroups = [
  ["Экспертность", "Разберите частую ошибку в нише «{niche}», которую замечаете сразу", "Покажите, как вы принимаете сложное решение в работе", "Объясните один профессиональный термин простым языком", "Сравните два популярных подхода и назовите критерий выбора"],
  ["Доверие", "Расскажите о решении, которое раньше считали правильным, но изменили мнение", "Покажите небольшой фрагмент рабочего процесса без идеальной картинки", "Опишите случай, когда честный отказ оказался полезнее продажи", "Расскажите, какое правило помогает вам сохранять качество"],
  ["Обсуждение", "Спросите аудиторию, какая часть задачи «{goal}» даётся ей сложнее всего", "Выскажите непопулярное мнение о вашей нише и спокойно аргументируйте", "Предложите выбрать между скоростью и качеством в знакомой ситуации", "Задайте вопрос, на который специалисты обычно отвечают слишком уверенно"],
  ["Личное", "Расскажите, почему вы вообще начали заниматься темой «{niche}»", "Опишите маленькую рабочую победу этой недели", "Поделитесь привычкой, которая заметно изменила ваш подход к работе", "Расскажите о смешной или неловкой ситуации без попытки выглядеть идеально"],
  ["Мягкая продажа", "Покажите состояние клиента до и после решения задачи «{goal}»", "Разберите один сценарий, в котором ваш продукт действительно не нужен", "Ответьте на главное сомнение клиента через конкретный пример", "Покажите часть результата и объясните, какие решения к нему привели"],
];

export default function PublicSeoTool({ path }: PublicSeoToolProps) {
  if (path === "/threads-ideas-generator/") return <IdeasTool />;
  if (path === "/threads-content-plan/") return <ContentPlanTool />;
  if (path === "/threads-post-generator/") return <PostGeneratorTool />;
  if (path === "/threads-hook-analyzer/") return <HookAnalyzerTool />;
  if (path === "/personal-brand-strategy-generator/") return <BrandStrategyTool />;
  const niche = nicheByPath[path];
  if (niche) return <IdeasTool initialNiche={niche} />;
  return null;
}

const nicheByPath: Record<string, string> = {
  "/for-psychologists/": "психолог",
  "/for-lawyers/": "юрист",
  "/for-photographers/": "фотограф",
  "/for-marketers/": "маркетолог",
  "/for-smm/": "SMM-специалист",
  "/for-consultants/": "консультант",
  "/personal-brand-for-experts/": "эксперт",
};

function IdeasTool({ initialNiche = "" }: { initialNiche?: string }) {
  const [niche, setNiche] = useState(initialNiche);
  const [goal, setGoal] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  const [generated, setGenerated] = useState(false);

  const groups = useMemo(
    () =>
      ideaGroups.map(([title, ...ideas]) => ({
        title,
        ideas: ideas.map((idea) =>
          idea.replaceAll("{niche}", niche.trim() || "ваша ниша").replaceAll("{goal}", goal.trim() || "ваша цель"),
        ),
      })),
    [goal, niche],
  );

  return (
    <ToolFrame title="Соберите 20 идей за минуту">
      <div className="grid gap-4 md:grid-cols-2">
        <ToolInput label="Ваша ниша" value={niche} onChange={setNiche} placeholder="Например, семейный психолог" />
        <ToolInput label="Главная цель" value={goal} onChange={setGoal} placeholder="Например, получать заявки на консультации" />
        <ToolInput label="Аудитория" value={audience} onChange={setAudience} placeholder="Например, родители подростков" />
        <ToolInput label="Тон" value={tone} onChange={setTone} placeholder="Например, спокойно и без назидания" />
      </div>
      <button type="button" onClick={() => { setGenerated(true); trackSeoEvent("seo_tool_success", { tool: "ideas", audience, tone }); }} className="mt-5 rounded-full bg-[#07100e] px-6 py-3.5 text-sm text-white hover:bg-[#17382b]">
        Получить идеи
      </button>
      {generated && (
        <div className="mt-10 grid gap-7 md:grid-cols-2">
          {groups.map((group) => (
            <section key={group.title} className="border-t border-[#aeb8b0] pt-5">
              <h3 className="font-display text-2xl">{group.title}</h3>
              <ol className="mt-4 space-y-3 text-sm leading-6 text-[#526056]">
                {group.ideas.map((idea) => <li key={idea}>{idea}</li>)}
              </ol>
            </section>
          ))}
          <ResultCta />
        </div>
      )}
    </ToolFrame>
  );
}

function ContentPlanTool() {
  const [niche, setNiche] = useState("");
  const [goal, setGoal] = useState("");
  const [days, setDays] = useState(7);
  const [frequency, setFrequency] = useState(1);
  const [generated, setGenerated] = useState(false);

  const plan = useMemo(() => {
    const themes = [
      ["Проблема аудитории", `Почему людям в нише «${niche || "ваша ниша"}» сложно достичь цели`, "Обсуждение"],
      ["Личный опыт", "Как вы пришли к своему текущему подходу", "Доверие"],
      ["Практический разбор", `Три шага к результату «${goal || "главная цель"}»`, "Экспертность"],
      ["Непопулярное мнение", "С чем в своей нише вы не согласны", "Обсуждение"],
      ["Рабочий процесс", "Что остаётся за кадром вашей работы", "Доверие"],
      ["Ошибка", "Одна дорогая ошибка и способ её избежать", "Экспертность"],
      ["Кейс", "Из какой точки клиент пришёл и что изменилось", "Мягкая продажа"],
    ];
    return Array.from({ length: days * frequency }, (_, index) => {
      const theme = themes[index % themes.length];
      return { day: Math.floor(index / frequency) + 1, slot: (index % frequency) + 1, theme: theme[0], hook: theme[1], purpose: theme[2] };
    });
  }, [days, frequency, goal, niche]);

  return (
    <ToolFrame title="Соберите связанный план публикаций">
      <div className="grid gap-4 md:grid-cols-2">
        <ToolInput label="Ваша ниша" value={niche} onChange={setNiche} placeholder="Например, маркетолог для малого бизнеса" />
        <ToolInput label="Цель контента" value={goal} onChange={setGoal} placeholder="Например, показать экспертность" />
        <label className="grid gap-2 text-sm text-[#526056]">
          Период
          <select value={days} onChange={(event) => setDays(Number(event.target.value))} className="rounded-xl border border-[#c8d0c9] bg-white px-4 py-3 text-[#07100e] outline-none focus:border-[#377457]">
            <option value={7}>7 дней</option>
            <option value={30}>30 дней</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm text-[#526056]">
          Постов в день
          <select value={frequency} onChange={(event) => setFrequency(Number(event.target.value))} className="rounded-xl border border-[#c8d0c9] bg-white px-4 py-3 text-[#07100e] outline-none focus:border-[#377457]">
            <option value={1}>1 пост</option>
            <option value={2}>2 поста</option>
            <option value={3}>3 поста</option>
          </select>
        </label>
      </div>
      <button type="button" onClick={() => { setGenerated(true); trackSeoEvent("seo_tool_success", { tool: "content_plan", days, frequency }); }} className="mt-5 rounded-full bg-[#07100e] px-6 py-3.5 text-sm text-white hover:bg-[#17382b]">
        Собрать план
      </button>
      {generated && (
        <div className="mt-9 overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-left text-sm">
            <thead><tr className="border-b border-[#aeb8b0]"><th className="py-3 pr-5">День</th><th className="py-3 pr-5">Формат</th><th className="py-3 pr-5">Первая мысль</th><th className="py-3">Задача</th></tr></thead>
            <tbody>{plan.map((item) => <tr key={`${item.day}-${item.slot}`} className="border-b border-[#d9ddd4]"><td className="py-4 pr-5">{item.day}{frequency > 1 ? ` · ${item.slot}` : ""}</td><td className="py-4 pr-5">{item.theme}</td><td className="py-4 pr-5 text-[#526056]">{item.hook}</td><td className="py-4">{item.purpose}</td></tr>)}</tbody>
          </table>
          <ResultCta />
        </div>
      )}
    </ToolFrame>
  );
}

function PostGeneratorTool() {
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("");
  const [goal, setGoal] = useState("");
  const [style, setStyle] = useState("");
  const [constraints, setConstraints] = useState("");
  const [generated, setGenerated] = useState(false);

  const subject = topic.trim() || "вашей рабочей теме";
  const reader = audience.trim() || "вашей аудитории";
  const purpose = goal.trim() || "начать полезный разговор";
  const variants = [
    {
      title: "Наблюдение",
      mechanic: "Начинается с позиции и оставляет читателю пространство для собственного опыта.",
      text: `Чем дольше работаю с ${subject}, тем меньше верю в универсальные советы.\n\nТо, что помогает одному человеку, другому добавляет ещё один пункт в список дел.\n\nПоэтому сначала я выясняю, что уже мешает ${reader}, и только потом предлагаю решение. Иначе даже хороший совет остаётся чужим.`,
    },
    {
      title: "Разбор ошибки",
      mechanic: "Показывает знакомую ошибку, её последствие и более точный следующий шаг.",
      text: `Самая дорогая ошибка в теме «${subject}» — начинать с инструмента.\n\nИнструмент создаёт ощущение движения, но не отвечает, какую задачу мы решаем и для кого.\n\nСначала сформулируйте ожидаемое изменение. После этого половина лишних действий отпадёт сама.`,
    },
    {
      title: "Вопрос для дискуссии",
      mechanic: "Даёт конкретный выбор, на который легче ответить, чем на формальное «что думаете?».",
      text: `Что важнее в теме «${subject}»: быстро получить первый результат или сразу построить процесс, который не придётся переделывать?\n\nЯ почти всегда выбираю первое маленькое подтверждение. Но вижу, как многие специалисты начинают с идеальной системы.\n\nКакой подход ближе вам?`,
    },
  ];

  return (
    <ToolFrame title="Создайте три разных черновика">
      <div className="grid gap-4 md:grid-cols-2">
        <ToolInput label="Тема поста" value={topic} onChange={setTopic} placeholder="Например, почему контент-план не работает" />
        <ToolInput label="Для кого пишем" value={audience} onChange={setAudience} placeholder="Например, эксперты с небольшим блогом" />
        <ToolInput label="Цель публикации" value={goal} onChange={setGoal} placeholder="Например, вызвать обсуждение" />
        <ToolInput label="Стиль" value={style} onChange={setStyle} placeholder="Например, спокойно и с лёгкой иронией" />
        <ToolInput label="Ограничения" value={constraints} onChange={setConstraints} placeholder="Например, без прямой продажи и канцелярита" />
      </div>
      <GenerateButton label={generated ? "Переписать варианты" : "Создать варианты"} onClick={() => { setGenerated(true); trackSeoEvent(generated ? "seo_tool_regenerate" : "seo_tool_success", { tool: "post_generator", purpose, style, constraints }); }} />
      {generated && (
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {variants.map((variant) => (
            <section key={variant.title} className="border-t border-[#aeb8b0] pt-5">
              <h3 className="font-display text-2xl">{variant.title}</h3>
              <p className="mt-3 text-sm leading-6 text-[#69766e]">{variant.mechanic}</p>
              <p className="mt-5 whitespace-pre-line leading-7 text-[#34433a]">{variant.text}</p>
            </section>
          ))}
          <ResultCta />
        </div>
      )}
    </ToolFrame>
  );
}

function HookAnalyzerTool() {
  const [text, setText] = useState("");
  const [analyzed, setAnalyzed] = useState(false);
  const normalized = text.trim();
  const firstLine = normalized.split(/\n+/)[0] ?? "";
  const genericWords = ["важно", "эффективный", "успех", "уникальный", "современный", "ключевой"];
  const genericCount = genericWords.filter((word) => normalized.toLowerCase().includes(word)).length;
  const clarity = Math.max(35, Math.min(95, 92 - Math.max(0, firstLine.length - 95) / 2 - genericCount * 6));
  const specificity = Math.max(25, Math.min(95, 42 + (/\d|«|:|—/.test(normalized) ? 25 : 0) + (normalized.length > 180 ? 12 : 0) - genericCount * 5));
  const discussion = Math.max(30, Math.min(94, 45 + (/\?/.test(normalized) ? 22 : 0) + (/(но|зато|почему|или)/i.test(normalized) ? 14 : 0)));
  const hookStrength = Math.max(25, Math.min(96, 88 - Math.max(0, firstLine.length - 85) / 2 + (/\d|«|:|—|\?/.test(firstLine) ? 9 : 0) - genericCount * 5));
  const naturalness = Math.max(25, Math.min(96, 92 - genericCount * 12 - ((normalized.match(/важно|необходимо|следует/gi) ?? []).length * 5)));
  const suggestions = [
    firstLine.length > 100 ? "Сократите первую строку: сейчас смысл раскрывается слишком поздно." : "Первая строка читается быстро. Проверьте, обещает ли она конкретный разговор.",
    genericCount ? `Замените общие слова (${genericWords.filter((word) => normalized.toLowerCase().includes(word)).join(", ")}) на ситуацию, действие или наблюдение.` : "Общих оценочных слов немного — это помогает тексту звучать увереннее.",
    !/\d|«|:|—/.test(normalized) ? "Добавьте деталь: цифру, короткую реплику, момент выбора или конкретное последствие." : "В тексте уже есть заметная конкретная деталь.",
    !/\?/.test(normalized) ? "Если вам нужны ответы, завершите не формальным вопросом, а понятным выбором или просьбой поделиться опытом." : "Вопрос создаёт повод ответить. Проверьте, не слишком ли он общий.",
  ];

  return (
    <ToolFrame title="Разберите первую строку и весь пост">
      <ToolTextArea label="Текст поста" value={text} onChange={setText} placeholder="Вставьте черновик поста целиком" />
      <GenerateButton label="Проверить пост" disabled={!normalized} onClick={() => { setAnalyzed(true); trackSeoEvent("seo_tool_success", { tool: "hook_analyzer", length: normalized.length }); }} />
      {analyzed && (
        <div className="mt-10">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Score title="Ясность" value={Math.round(clarity)} />
            <Score title="Первая строка" value={Math.round(hookStrength)} />
            <Score title="Конкретность" value={Math.round(specificity)} />
            <Score title="Повод ответить" value={Math.round(discussion)} />
            <Score title="Живой язык" value={Math.round(naturalness)} />
          </div>
          <section className="mt-8 border-t border-[#aeb8b0] pt-6">
            <h3 className="font-display text-2xl">Что улучшить</h3>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-[#526056]">{suggestions.map((item) => <li key={item}>— {item}</li>)}</ul>
          </section>
          <ResultCta />
        </div>
      )}
    </ToolFrame>
  );
}

function BrandStrategyTool() {
  const [profession, setProfession] = useState("");
  const [product, setProduct] = useState("");
  const [audience, setAudience] = useState("");
  const [expertise, setExpertise] = useState("");
  const [desiredImage, setDesiredImage] = useState("");
  const [constraints, setConstraints] = useState("");
  const [generated, setGenerated] = useState(false);
  const role = profession.trim() || "эксперт";
  const offer = product.trim() || "ваш продукт";
  const readers = audience.trim() || "ваша аудитория";
  const strength = expertise.trim() || "практический опыт";
  const rubrics = [
    `Решения ${role}: как вы выбираете подход`,
    `Ошибки, которые мешают ${readers}`,
    `Рабочие истории и выводы из практики`,
    `Непопулярные мнения в вашей теме`,
    `Как устроен ${offer} и кому он не подходит`,
    `Ответы на реальные сомнения клиентов`,
  ];

  return (
    <ToolFrame title="Соберите основу личного бренда">
      <div className="grid gap-4 md:grid-cols-2">
        <ToolInput label="Профессия" value={profession} onChange={setProfession} placeholder="Например, карьерный консультант" />
        <ToolInput label="Продукт" value={product} onChange={setProduct} placeholder="Например, консультация по смене профессии" />
        <ToolInput label="Аудитория" value={audience} onChange={setAudience} placeholder="Например, специалисты после 30 лет" />
        <ToolInput label="Сильная сторона" value={expertise} onChange={setExpertise} placeholder="Например, переход без потери дохода" />
        <ToolInput label="Желаемый образ" value={desiredImage} onChange={setDesiredImage} placeholder="Например, спокойный практик без громких обещаний" />
        <ToolInput label="Ограничения" value={constraints} onChange={setConstraints} placeholder="Например, не обсуждать личную жизнь" />
      </div>
      <GenerateButton label="Собрать стратегию" onClick={() => { setGenerated(true); trackSeoEvent("seo_tool_success", { tool: "brand_strategy", desiredImage, constraints }); }} />
      {generated && (
        <div className="mt-10 grid gap-7 md:grid-cols-2">
          <section className="border-t border-[#aeb8b0] pt-5">
            <h3 className="font-display text-2xl">Позиционирование</h3>
            <p className="mt-4 leading-7 text-[#526056]">Я — {role}, который помогает {readers} получить понятное изменение через {offer}. В контенте показываю не только советы, но и {strength}: критерии, решения и ограничения подхода.</p>
          </section>
          <section className="border-t border-[#aeb8b0] pt-5">
            <h3 className="font-display text-2xl">Голос бренда</h3>
            <p className="mt-4 leading-7 text-[#526056]">{desiredImage.trim() || "Спокойный, конкретный и человеческий"}. Без громких гарантий, искусственной срочности и попытки продать в каждом посте.{constraints.trim() ? ` Учитывайте ограничение: ${constraints.trim()}.` : ""}</p>
          </section>
          <section className="border-t border-[#aeb8b0] pt-5 md:col-span-2">
            <h3 className="font-display text-2xl">Рубрики</h3>
            <ul className="mt-4 grid gap-3 text-sm leading-6 text-[#526056] md:grid-cols-2">{rubrics.map((item) => <li key={item}>— {item}</li>)}</ul>
          </section>
          <section className="border-t border-[#aeb8b0] pt-5 md:col-span-2">
            <h3 className="font-display text-2xl">Первые 14 публикаций</h3>
            <p className="mt-4 leading-7 text-[#526056]">Возьмите по две темы из каждой рубрики, добавьте один пост-знакомство и один спокойный продуктовый сценарий. Чередуйте наблюдения, разборы, истории и вопросы, чтобы лента не выглядела однообразно.</p>
          </section>
          <ResultCta />
        </div>
      )}
    </ToolFrame>
  );
}

function ToolFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="border-y border-[#d9ddd4] bg-[#edf3eb]"><div className="mx-auto max-w-6xl px-5 py-14 sm:px-8"><h2 className="font-display text-4xl">{title}</h2><div className="mt-7">{children}</div></div></section>;
}

function ToolInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="grid gap-2 text-sm text-[#526056]">{label}<input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} maxLength={120} className="rounded-xl border border-[#c8d0c9] bg-white px-4 py-3 text-[#07100e] outline-none placeholder:text-[#929b94] focus:border-[#377457]" /></label>;
}

function ToolTextArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="grid gap-2 text-sm text-[#526056]">{label}<textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} maxLength={1800} rows={8} className="resize-y rounded-xl border border-[#c8d0c9] bg-white px-4 py-3 leading-7 text-[#07100e] outline-none placeholder:text-[#929b94] focus:border-[#377457]" /></label>;
}

function GenerateButton({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="mt-5 rounded-full bg-[#07100e] px-6 py-3.5 text-sm text-white hover:bg-[#17382b] disabled:cursor-not-allowed disabled:opacity-40">{label}</button>;
}

function Score({ title, value }: { title: string; value: number }) {
  return <div className="border-t border-[#aeb8b0] pt-4"><p className="text-sm text-[#69766e]">{title}</p><p className="mt-2 font-display text-4xl">{value}<span className="text-lg text-[#69766e]">/100</span></p></div>;
}

function ResultCta() {
  return <div className="mt-8 border-t border-[#aeb8b0] pt-6"><p className="max-w-2xl leading-7 text-[#526056]">В ThreadsGo эти идеи можно превратить в посты, сохранить голос проекта и равномерно поставить публикации в очередь.</p><Link to="/login" className="mt-4 inline-flex rounded-full bg-[#07100e] px-6 py-3.5 text-sm text-white">Создать проект</Link></div>;
}
