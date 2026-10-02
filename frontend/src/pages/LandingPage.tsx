import { useState } from "react";
import { Link } from "react-router-dom";
import { AppIcon } from "../components/AppIcons";

const steps = [
  [
    "Создайте проект",
    "Расскажите, о чём пишете и кто ваша аудитория. Один проект — одна тема или бренд.",
  ],
  [
    "Найдите свой голос",
    "Ответьте на несколько вопросов: нейросеть предложит стиль, который вы сможете изменить.",
  ],
  [
    "Подключите Threads",
    "Настройте профиль и расписание. Проверяйте и редактируйте тексты в очереди до их выхода.",
  ],
];
const examples = [
  {
    label: "Эксперт",
    title: "Личный бренд без пустого листа",
    text: "Один полезный совет часто работает лучше длинной лекции. Расскажите о частой ошибке клиента и покажите, как её избежать.",
  },
  {
    label: "Бизнес",
    title: "Покажите, что стоит за продуктом",
    text: "Что покупатель обычно не замечает? Расскажите об одной детали вашего продукта и объясните, почему она важна.",
  },
  {
    label: "SMM",
    title: "Разные проекты. Разные голоса.",
    text: "Для одного клиента — короткие наблюдения, для другого — спокойные разборы. Разделяйте темы и очереди, а общий стиль задавайте в настройках.",
  },
];

export default function LandingPage() {
  const [selected, setSelected] = useState(0);
  return (
    <main className="home-refresh bg-[#f8faf9] text-[#162b25]">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Link
          to="/"
          className="flex items-center gap-2.5 text-xl font-bold tracking-tight"
        >
          <img
            src="/threadsgo-logo.png"
            alt=""
            className="h-9 w-9 object-contain"
          />
          ThreadsGo
        </Link>
        <nav
          aria-label="Основная навигация"
          className="flex items-center gap-5 text-sm font-medium"
        >
          <a href="#how-it-works" className="hidden text-[#60716a] md:block">
            Как это работает
          </a>
          <Link to="/updates/" className="hidden text-[#60716a] sm:block">
            Что нового
          </Link>
          <Link to="/pricing/" className="text-[#60716a]">
            Тарифы
          </Link>
          <Link
            to="/login"
            className="rounded-xl border border-[#d5e0d9] bg-white px-4 py-2.5 hover:bg-[#edf3ef]"
          >
            Войти
          </Link>
        </nav>
      </header>
      <section className="mx-auto grid max-w-7xl items-center gap-12 px-5 pb-16 pt-12 sm:px-8 sm:pt-20 lg:grid-cols-[1fr_1.05fr] lg:gap-14 lg:pb-24">
        <div>
          <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#dbe6dd] bg-white px-3.5 py-2 text-xs font-medium text-[#49705a]">
            <AppIcon name="spark" className="h-4 w-4" />
            Ваш помощник для контента в Threads
          </p>
          <h1 className="max-w-xl text-[clamp(2.7rem,5.5vw,4.6rem)] font-semibold leading-[1.06] tracking-[-0.055em]">
            Больше ваших идей.
            <br />
            <span className="text-[#5c8b71]">Меньше рутины.</span>
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-[#60716a] sm:text-lg sm:leading-8">
            ThreadsGo находит темы, пишет посты в вашем стиле и помогает
            публиковать по расписанию. Всё — в одном спокойном рабочем
            пространстве.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/login?intent=start"
              data-analytics-cta="start_trial"
              className="home-primary"
            >
              Попробовать 3 дня <span aria-hidden="true">↗</span>
            </Link>
            <Link to="/threads-ideas-generator/" className="home-secondary">
              Получить идеи бесплатно
            </Link>
          </div>
          <p className="mt-4 max-w-lg text-xs leading-5 text-[#738078]">
            Basic: 3 дня бесплатно, затем 1 490 ₽/мес. Для пробного периода
            нужны карта в Tribute и вступление в канал.{" "}
            <Link to="/pricing/" className="underline underline-offset-2">
              Все условия
            </Link>
          </p>
          <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-[#60716a]">
            <span>✓ Помощь со стилем</span>
            <span>✓ Редактирование постов</span>
            <span>✓ Расписание публикаций</span>
          </div>
        </div>
        <ProductPreview />
      </section>
      <section id="how-it-works" className="border-y border-[#e0e8e2] bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="home-eyebrow">ПЕРВЫЕ ШАГИ</p>
              <h2 className="home-heading mt-3">От идеи до вашей ленты.</h2>
            </div>
            <p className="max-w-sm text-sm leading-6 text-[#60716a]">
              Начните с одного проекта. Остальные настройки можно уточнить по
              ходу работы.
            </p>
          </div>
          <div className="mt-9 grid gap-5 md:grid-cols-3">
            {steps.map(([title, text], i) => (
              <article
                key={title}
                className="rounded-2xl border border-[#e0e8e2] bg-[#f8faf9] p-6"
              >
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e8efe9] text-sm font-semibold text-[#49705a]">
                  0{i + 1}
                </span>
                <h3 className="mt-6 text-xl font-semibold tracking-tight">
                  {title}
                </h3>
                <p className="mt-3 text-sm leading-7 text-[#60716a]">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="home-eyebrow">ВАШ ГОЛОС, ВАШИ ПРАВИЛА</p>
          <h2 className="home-heading mt-3">
            Не знаете, что написать
            <br />в настройках стиля?
          </h2>
          <p className="mt-5 max-w-lg text-base leading-8 text-[#60716a]">
            Не нужно разбираться в промптах. Помощник спросит о тоне, длине
            постов и юморе, затем предложит текст настроек. Вы прочитаете его и
            решите, что сохранить.
          </p>
          <Link
            to="/login?intent=start"
            className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#315b46]"
          >
            Настроить свой стиль →
          </Link>
        </div>
        <div className="rounded-3xl border border-[#dbe6dd] bg-[#edf3ef] p-5 sm:p-8">
          <div className="rounded-2xl bg-white p-6 shadow-[0_16px_40px_rgba(30,60,45,0.06)]">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e8efe9]">
                <AppIcon name="spark" />
              </span>
              <div>
                <p className="text-sm font-semibold">Как вы хотите звучать?</p>
                <p className="mt-1 text-xs text-[#738078]">
                  Пример настройки стиля
                </p>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="rounded-lg bg-[#315b46] px-3 py-2 text-xs text-white">
                По-дружески
              </span>
              {["Экспертно", "С юмором", "Коротко и по делу"].map((t) => (
                <span
                  key={t}
                  className="rounded-lg border border-[#e0e8e2] px-3 py-2 text-xs text-[#60716a]"
                >
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-5 rounded-xl bg-[#f8faf9] p-4 text-sm leading-7 text-[#60716a]">
              «Пиши простым языком, как в разговоре с коллегой. Начинай с
              конкретной мысли, добавляй примеры и избегай рекламных клише».
            </p>
            <p className="mt-4 text-xs text-[#738078]">
              Стиль можно изменить в любой момент.
            </p>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-5 pb-16 sm:px-8 sm:pb-24">
        <div className="rounded-3xl bg-[#162b25] p-6 text-white sm:p-10 lg:p-12">
          <div className="grid gap-9 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-xs font-semibold tracking-[0.13em] text-[#a6c4b1]">
                ДЛЯ ВАШЕЙ РАБОТЫ
              </p>
              <h2 className="home-heading mt-4">
                Контенту есть место.
                <br />И у вас есть время.
              </h2>
              <p className="mt-5 max-w-md text-sm leading-7 text-[#b2c3ba]">
                Экспертам — для личного бренда. Бизнесу — для общения с
                аудиторией. SMM — для работы с несколькими проектами.
              </p>
              <div
                role="tablist"
                aria-label="Примеры для разных задач"
                className="mt-7 flex flex-wrap gap-2"
              >
                {examples.map((item, i) => (
                  <button
                    key={item.label}
                    type="button"
                    role="tab"
                    id={`audience-tab-${i}`}
                    aria-selected={selected === i}
                    aria-controls="audience-example"
                    tabIndex={selected === i ? 0 : -1}
                    onClick={() => setSelected(i)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                        e.preventDefault();
                        const next =
                          (selected +
                            (e.key === "ArrowRight" ? 1 : -1) +
                            examples.length) %
                          examples.length;
                        setSelected(next);
                        document
                          .getElementById(`audience-tab-${next}`)
                          ?.focus();
                      }
                    }}
                    className={`rounded-xl px-4 py-2.5 text-sm transition ${selected === i ? "bg-[#d9eadc] text-[#162b25]" : "border border-white/20 text-[#b2c3ba] hover:bg-white/10"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div
              id="audience-example"
              role="tabpanel"
              aria-labelledby={`audience-tab-${selected}`}
              className="rounded-2xl border border-white/15 bg-white/[0.06] p-6 sm:p-8"
            >
              <p className="text-xs text-[#a6c4b1]">
                Иллюстрация идеи для поста
              </p>
              <h3 className="mt-5 text-2xl font-semibold tracking-tight">
                {examples[selected].title}
              </h3>
              <p className="mt-4 text-base leading-8 text-[#d3dfd8]">
                {examples[selected].text}
              </p>
            </div>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-3xl px-5 pb-16 text-center sm:pb-24">
        <p className="home-eyebrow">НАЧНИТЕ С МАЛЕНЬКОГО</p>
        <h2 className="home-heading mt-3">
          Ваш следующий пост
          <br />
          начинается здесь.
        </h2>
        <p className="mt-5 text-base leading-7 text-[#60716a]">
          Посмотрите, как ThreadsGo подходит вашей задаче.
          <br />
          На Basic есть пробный период — 3 дня.
        </p>
        <Link
          to="/login?intent=start"
          data-analytics-cta="start_trial"
          className="home-primary mx-auto mt-7 w-fit"
        >
          Создать первый проект ↗
        </Link>
        <Link
          to="/pricing/"
          className="mt-4 block text-sm text-[#60716a] underline underline-offset-4"
        >
          Посмотреть тарифы и условия
        </Link>
      </section>
      <footer className="border-t border-[#e0e8e2] bg-white">
        <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row">
            <span className="text-lg font-bold tracking-tight">ThreadsGo</span>
            <nav
              aria-label="Полезные ссылки"
              className="flex flex-wrap gap-5 text-sm text-[#60716a]"
            >
              <Link to="/updates/">Что нового</Link>
              <Link to="/resources/">Полезные материалы</Link>
              <Link to="/pricing/">Тарифы</Link>
              <Link to="/terms">Условия и политика</Link>
              <a
                href="https://t.me/cuartenlol"
                target="_blank"
                rel="noreferrer"
              >
                Поддержка ↗
              </a>
            </nav>
          </div>
          <p className="mt-6 max-w-4xl text-xs leading-6 text-[#738078]">
            Мы ограничиваем активность и приостанавливаем работу при проблемах с
            доступом. Это не исключает ограничений или блокировки аккаунта: Meta
            меняет свои правила и способы обнаружения автоматизации. Учитывайте
            этот риск при подключении профиля.
          </p>
          <p className="mt-2 text-[11px] leading-5 text-[#738078]">
            * Деятельность Meta (соцсети Facebook, Threads и Instagram)
            запрещена в России как экстремистская.
          </p>
        </div>
      </footer>
    </main>
  );
}

function ProductPreview() {
  return (
    <div className="relative min-w-0 rounded-[28px] border border-[#d6e3d9] bg-[#eaf1ec] p-3 shadow-[0_30px_80px_-35px_rgba(35,75,50,0.3)] sm:p-5">
      <div className="overflow-hidden rounded-2xl border border-[#e0e8e2] bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-[#e7ede9] px-5 py-4">
          <span className="text-sm font-semibold">Рабочее пространство</span>
          <span className="rounded-full bg-[#f1f5f2] px-2.5 py-1 text-[10px] text-[#60716a]">
            Пример интерфейса
          </span>
        </div>
        <div className="grid grid-cols-[42px_1fr] sm:grid-cols-[110px_1fr]">
          <div className="border-r border-[#e7ede9] bg-[#f8faf9] p-2 sm:p-3">
            {(
              [
                ["overview", "Обзор"],
                ["queue", "Посты"],
                ["trends", "Идеи"],
                ["settings", "Настройки"],
              ] as const
            ).map(([icon, label], i) => (
              <div
                key={label}
                className={`mb-2 flex items-center gap-2 rounded-lg p-2 text-xs ${i === 1 ? "bg-[#e4eee6] text-[#315b46]" : "text-[#738078]"}`}
              >
                <AppIcon name={icon} className="h-4 w-4 shrink-0" />
                <span className="hidden sm:block">{label}</span>
              </div>
            ))}
          </div>
          <div className="min-w-0 p-4 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-tight">
                Публикации
              </h2>
              <span className="text-xs text-[#738078]">Мой блог</span>
            </div>
            <div className="mt-5 flex gap-4 border-b border-[#e7ede9] pb-3 text-xs">
              <span className="font-semibold text-[#315b46]">В очереди</span>
              <span className="text-[#738078]">Опубликовано</span>
            </div>
            <article className="mt-4 rounded-xl border border-[#dbe6dd] p-4">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-[#e8efe9] text-xs font-semibold">
                  М
                </span>
                <div>
                  <p className="text-xs font-semibold">Мой блог</p>
                  <p className="mt-0.5 text-[10px] text-[#738078]">
                    Пример текста
                  </p>
                </div>
                <AppIcon
                  name="spark"
                  className="ml-auto h-4 w-4 text-[#5c8b71]"
                />
              </div>
              <p className="mt-4 text-sm leading-6">
                Самая полезная привычка в работе — записывать идеи сразу.
                <br />
                <br />
                Не ждать вдохновения, а оставлять себе маленькие подсказки. Из
                одной заметки потом может вырасти целый пост.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#e7ede9] pt-3">
                <span className="rounded-md bg-[#eef4ef] px-2 py-1 text-[10px] text-[#49705a]">
                  По расписанию
                </span>
                <span className="text-[10px] text-[#738078]">
                  Можно изменить до выхода
                </span>
              </div>
            </article>
            <div className="mt-3 flex items-center gap-3 rounded-xl bg-[#f3f6f4] p-3">
              <AppIcon
                name="trends"
                className="h-5 w-5 shrink-0 text-[#5c8b71]"
              />
              <p className="text-xs leading-5 text-[#60716a]">
                Новые идеи и очередь постов — рядом с настройками проекта.
              </p>
            </div>
          </div>
        </div>
      </div>
      <p className="px-2 pt-3 text-center text-[11px] text-[#738078]">
        Идеи → тексты в вашем стиле → расписание
      </p>
    </div>
  );
}
