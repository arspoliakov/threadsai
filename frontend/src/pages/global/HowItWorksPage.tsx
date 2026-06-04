import { Link } from "react-router-dom";

const notes = [
  {
    title: "Не рекламный текст",
    text: "Если каждый пост кричит «перейди по ссылке», люди быстро считывают рекламу. Поэтому нейросеть пишет так, будто человек делится мыслью из жизни.",
  },
  {
    title: "Коротко, но не пусто",
    text: "В Threads часто лучше работает одна точная мысль, чем длинное объяснение. Пост должен быстро зацепить, а не выглядеть как статья.",
  },
  {
    title: "Тренды нужны для ритма",
    text: "Мы не копируем чужие посты. Система смотрит, как люди начинают мысль, где появляется конфликт и какой темп у живой ленты.",
  },
  {
    title: "Увод не в каждом посте",
    text: "Ссылка в био или закреп — это финальная точка. Если пихать ее в каждый текст, аккаунт начинает выглядеть как спам.",
  },
];

export default function HowItWorksPage() {
  return (
    <section className="space-y-5">
      <header className="rounded-[24px] border border-[#dfe4dc] bg-white p-5 shadow-sm sm:p-6">
        <div className="max-w-3xl">
          <h1 className="font-display text-4xl leading-[0.95] tracking-[-0.04em] text-[#111] sm:text-5xl">
            Какие посты пишет нейросеть?
          </h1>
          <p className="mt-5 text-sm leading-7 text-[#667066]">
            Коротко: не “продающие посты”, а живые заметки для ленты. Идея в том, чтобы человек сначала узнал себя в
            мысли, зашел в профиль, а уже там увидел ссылку в био или закреп.
          </p>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        {notes.map((note) => (
          <article key={note.title} className="rounded-[24px] border border-[#dfe4dc] bg-white p-5 shadow-sm">
            <h2 className="text-lg text-[#111]">{note.title}</h2>
            <p className="mt-3 text-sm leading-6 text-[#667066]">{note.text}</p>
          </article>
        ))}
      </section>

      <section className="rounded-[28px] border border-[#dfe4dc] bg-[#fbfcf7] p-6 shadow-sm">
        <h2 className="font-display text-3xl leading-none text-[#111]">Что вам нужно настроить</h2>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <SmallCard
            title="Стиль"
            text="Как звучит аккаунт: спокойно, жестко, иронично, экспертно или совсем по-своему."
          />
          <SmallCard
            title="Проект"
            text="Что вы продаете, кому, какие боли у аудитории и куда вести интерес."
          />
          <SmallCard
            title="Аккаунт"
            text="Готовый Threads-профиль. Пароль не нужен, только cookies для публикации."
          />
        </div>
      </section>

      <section className="rounded-[28px] border border-[#dfe4dc] bg-white p-6 shadow-sm">
        <h2 className="font-display text-3xl leading-none text-[#111]">Почему пост может выглядеть простым</h2>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-[#667066]">
          Потому что в ленте простота часто выглядит честнее. Нейросеть не пытается каждый раз “продать в лоб”.
          Она делает маленькую сцену, вопрос или наблюдение. Такой пост легче дочитать, легче лайкнуть и легче переслать.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            to="/app"
            className="inline-flex h-11 items-center justify-center rounded-full bg-[#141815] px-5 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e]"
          >
            К проектам
          </Link>
          <Link
            to="/app/settings"
            className="inline-flex h-11 items-center justify-center rounded-full border border-[#141815] px-5 text-sm text-[#141815] transition hover:bg-[#141815] hover:text-white"
          >
            Настроить стиль
          </Link>
        </div>
      </section>
    </section>
  );
}

function SmallCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-[22px] border border-[#e2e6df] bg-white p-4">
      <p className="text-base text-[#151815]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[#667066]">{text}</p>
    </div>
  );
}
