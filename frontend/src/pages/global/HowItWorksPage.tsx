import { Link } from "react-router-dom";

const launchSteps = [
  {
    title: "Создайте проект",
    text: "Назовите проект и коротко опишите, что вы продвигаете. Подробности можно дописать позже в настройках.",
  },
  {
    title: "Опишите продукт и аудиторию",
    text: "ИИ нужен контекст: кто ваш клиент, что болит, что нельзя обещать и куда вести интерес.",
  },
  {
    title: "Подключите Threads-аккаунт",
    text: "Пароль не нужен. Сервис работает через cookies и сам следит за техническими паузами.",
  },
  {
    title: "Проверьте контент-план",
    text: "Система готовит очередь на ближайшие дни. Каждый пост можно открыть, поправить или перегенерировать.",
  },
];

const formulaCards = [
  {
    title: "Живая сцена вместо рекламы",
    text: "Threads лучше реагирует на короткие наблюдения, вопросы, микроконфликты и бытовые детали. Поэтому пост не похож на продающий баннер.",
  },
  {
    title: "Тренды как топливо",
    text: "Мы берем из ленты не чужие факты, а механику внимания: хук, ритм, напряжение и структуру. Это помогает писать нативнее.",
  },
  {
    title: "Редкий CTA",
    text: "Пост должен работать сам по себе. Увод в био или закреп появляется только когда он звучит естественно, иначе доверие падает.",
  },
  {
    title: "Короткая длина",
    text: "Система режет простыни и держит текст компактным. В Threads чаще цепляет одна точная мысль, а не длинное объяснение.",
  },
];

const screenMap = [
  ["Проекты", "Все рабочие контуры. Здесь создается проект и видно, что уже запущено."],
  ["Сводка проекта", "Статус системы, ручной запуск трендов и генерации, последние действия."],
  ["Посты", "Контент-план: будущие публикации, статусы, редактирование и регенерация."],
  ["Тренды", "Собранные паттерны из Threads. Они используются генератором как материал."],
  ["Настройки проекта", "Продукт, аудитория, расписание, аккаунты и направление трафика."],
  ["Стиль", "Общий голос всех проектов. Не место для локальных деталей одного бренда."],
];

export default function HowItWorksPage() {
  return (
    <section className="space-y-8">
      <header className="overflow-hidden rounded-[32px] border border-[#dfe4dc] bg-[#07100e] p-7 text-white shadow-sm sm:p-8">
        <div className="max-w-4xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/50">content formula</p>
          <h1 className="mt-6 font-display text-5xl leading-[0.9] tracking-[-0.055em] sm:text-6xl lg:text-7xl">
            Как ThreadsGo ведет аккаунт
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-white/64">
            Это не генератор случайных текстов. Сервис собирает сигналы из ленты, держит контент в живом формате Threads
            и готовит посты так, чтобы они выглядели как нативные наблюдения, а не как реклама.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              to="/app"
              className="inline-flex h-12 items-center justify-center rounded-full bg-white px-5 text-sm text-[#07100e] transition hover:bg-[#70ff35]"
            >
              Перейти к проектам
            </Link>
            <Link
              to="/app/settings"
              className="inline-flex h-12 items-center justify-center rounded-full border border-white/22 px-5 text-sm text-white transition hover:bg-white hover:text-[#07100e]"
            >
              Настроить стиль
            </Link>
          </div>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-4">
        {launchSteps.map((step, index) => (
          <article key={step.title} className="rounded-[28px] border border-[#dfe4dc] bg-white p-6 shadow-sm">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#eef4ec] font-mono text-sm text-[#07100e]">
              {index + 1}
            </span>
            <h2 className="mt-6 font-display text-3xl leading-none text-[#111]">{step.title}</h2>
            <p className="mt-4 text-sm leading-6 text-[#667066]">{step.text}</p>
          </article>
        ))}
      </section>

      <section className="rounded-[32px] border border-[#dfe4dc] bg-white p-6 shadow-sm sm:p-7">
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#77766f]">почему посты такие</p>
          <h2 className="mt-3 font-display text-4xl leading-none text-[#111]">Формула держится на доверии</h2>
          <p className="mt-5 text-sm leading-7 text-[#667066]">
            Новому пользователю может показаться, что пост слишком простой или короткий. Это задумано. В Threads прямой
            продающий текст быстро выглядит чужеродно, поэтому система пишет через бытовую сцену, напряжение и вопрос.
          </p>
        </div>
        <div className="mt-7 grid gap-4 md:grid-cols-2">
          {formulaCards.map((card) => (
            <article key={card.title} className="rounded-[24px] border border-[#e2e6df] bg-[#fbfcf7] p-5">
              <h3 className="text-lg text-[#151815]">{card.title}</h3>
              <p className="mt-3 text-sm leading-6 text-[#667066]">{card.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <article className="rounded-[32px] border border-[#dfe4dc] bg-white p-6 shadow-sm sm:p-7">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#77766f]">важное разделение</p>
          <h2 className="mt-3 font-display text-4xl leading-none text-[#111]">Стиль и проект — разные вещи</h2>
          <div className="mt-6 grid gap-3">
            <div className="rounded-[24px] border border-[#e2e6df] bg-[#fbfcf7] p-5">
              <p className="text-base text-[#151815]">Стиль</p>
              <p className="mt-2 text-sm leading-6 text-[#667066]">
                Общий голос: сухо, дерзко, спокойно, иронично, без каких слов и интонаций писать.
              </p>
            </div>
            <div className="rounded-[24px] border border-[#e2e6df] bg-[#fbfcf7] p-5">
              <p className="text-base text-[#151815]">Настройки проекта</p>
              <p className="mt-2 text-sm leading-6 text-[#667066]">
                Локальный контекст: продукт, аудитория, боли, оффер, расписание, аккаунты и куда вести людей.
              </p>
            </div>
          </div>
        </article>

        <article className="rounded-[32px] border border-[#dfe4dc] bg-white p-6 shadow-sm sm:p-7">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#77766f]">где что находится</p>
          <h2 className="mt-3 font-display text-4xl leading-none text-[#111]">Карта интерфейса</h2>
          <div className="mt-6 divide-y divide-[#e2e6df] overflow-hidden rounded-[24px] border border-[#e2e6df]">
            {screenMap.map(([title, text]) => (
              <div key={title} className="grid gap-2 bg-[#fbfcf7] p-4 sm:grid-cols-[11rem_1fr]">
                <p className="text-sm font-medium text-[#07100e]">{title}</p>
                <p className="text-sm leading-6 text-[#667066]">{text}</p>
              </div>
            ))}
          </div>
        </article>
      </section>
    </section>
  );
}
