import { Link } from "react-router-dom";

const notes = [
  {
    title: "Не рекламный текст",
    text: "Не кричим «купи» в каждом сообщении. Если в каждом посте будет призыв «перейди по ссылке», подписчики быстро устанут. Мы пишем так, будто это просто дружеское сообщение — искренне и по делу.",
  },
  {
    title: "Коротко, но не пусто",
    text: "В Threads ценится лаконичность. Лучше одна меткая мысль, чем длинный монолог. Пост должен зацепить с первых слов — без долгих вступлений.",
  },
  {
    title: "Тренды нужны для ритма",
    text: "Мы не копируем чужие идеи. Нейросеть анализирует живую ленту: как люди формулируют мысли, где рождается интерес, какой ритм сейчас актуален.",
  },
  {
    title: "Увод не в каждом посте",
    text: "Ссылка в закреп или био — это финальная точка маршрута. Не нужно пихать её в каждый пост — так аккаунт рискует выглядеть навязчиво.",
  },
];

export default function HowItWorksPage() {
  return (
    <section className="space-y-5">
      <header className="rounded-[24px] border border-[#dfe4dc] bg-white p-5 shadow-sm sm:p-6">
        <div className="max-w-3xl">
          <h1 className="font-display text-4xl leading-[0.95] tracking-[-0.04em] text-[#111] sm:text-5xl">
            Как звучат посты от нейросети?
          </h1>
          <p className="mt-5 text-sm leading-7 text-[#667066]">
            Наша цель — не «впаривать», а зацепить. Нейросеть пишет живые заметки, которые откликаются читателю.
            Человек сначала читает интересную мысль, потом заходит в профиль — и уже там видит, куда можно перейти.
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
            text="Найдите свой голос: спокойный, дерзкий, ироничный, экспертный или просто ваш."
          />
          <SmallCard
            title="Проект"
            text="Опишите задачу: что предлагаете, кому это нужно и что волнует ваших читателей."
          />
          <SmallCard
            title="Аккаунт"
            text="Откройте профиль Threads в браузере и подключите его расширением ThreadsGo. Пароль вводить не нужно."
          />
        </div>
      </section>

      <section className="rounded-[28px] border border-[#dfe4dc] bg-white p-6 shadow-sm">
        <h2 className="font-display text-3xl leading-none text-[#111]">Почему пост может выглядеть простым</h2>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-[#667066]">
          Секрет в простоте — она выглядит искренне. Нейросеть не грузит «продажей», а создает живую историю:
          задает вопрос, делится наблюдением или рисует мини-сценку. Такие посты хочется дочитать до конца,
          поставить лайк и отправить другу.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            to="/app"
            className="inline-flex h-11 items-center justify-center rounded-full bg-[#141815] px-5 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e]"
          >
            Перейти к проектам
          </Link>
          <Link
            to="/app/settings"
            className="inline-flex h-11 items-center justify-center rounded-full border border-[#141815] px-5 text-sm text-[#141815] transition hover:bg-[#141815] hover:text-white"
          >
            Настроить стиль публикаций
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
