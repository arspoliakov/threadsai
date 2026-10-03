import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "../components/ThemeToggle";
import { AppIcon } from "../components/AppIcons";
import { AnimatedWorkflow } from "../components/AnimatedWorkflow";

const steps = [
  [
    "Попробуйте черновики",
    "Зарегистрируйтесь и расскажите о теме и аудитории. Первые три текста — без карты и входа в Threads.",
  ],
  [
    "Найдите свой голос",
    "Ответьте на несколько вопросов: нейросеть предложит стиль, который вы сможете изменить.",
  ],
  [
    "Подключите Threads",
    "Когда тексты понравятся, выберите подписку и подключите профиль. Вы сами проверяете посты и назначаете время в календаре.",
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);
  return (
    <main className="home-refresh relative overflow-hidden bg-[#f8faf9] text-[#162b25]">
      <header className="relative z-20 mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-8">
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
          className="hidden items-center gap-2 text-sm font-medium sm:flex sm:gap-5"
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
          <ThemeToggle />
          <Link
            to="/login"
            className="rounded-xl border border-[#d5e0d9] bg-white px-4 py-2.5 hover:bg-[#edf3ef]"
          >
            Войти
          </Link>
        </nav>
        <div className="flex items-center gap-2 sm:hidden">
          <ThemeToggle />
          <button ref={menuButton} type="button" aria-expanded={menuOpen} aria-controls="mobile-public-navigation" aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"} onClick={() => setMenuOpen((open) => !open)} className="grid h-11 w-11 place-items-center rounded-xl border border-[#d5e0d9] bg-white text-[#49705a]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">{menuOpen ? <path d="m6 6 12 12M6 18 18 6" /> : <path d="M4 6h16M4 12h16M4 18h16" />}</svg>
          </button>
        </div>
        {menuOpen ? <nav id="mobile-public-navigation" aria-label="Основная навигация на телефоне" className="grid w-full gap-1 rounded-2xl border border-[#dbe6dd] bg-white p-2 text-sm font-medium sm:hidden" onClick={() => setMenuOpen(false)}>
          <a href="#how-it-works" className="rounded-xl px-4 py-3 hover:bg-[#edf3ef]">Как это работает</a>
          <Link to="/pricing/" className="rounded-xl px-4 py-3 hover:bg-[#edf3ef]">Тарифы</Link>
          <Link to="/updates/" className="rounded-xl px-4 py-3 hover:bg-[#edf3ef]">Что нового</Link>
          <Link to="/blog/" className="rounded-xl px-4 py-3 hover:bg-[#edf3ef]">Материалы о Threads</Link>
          <Link to="/login" className="rounded-xl px-4 py-3 hover:bg-[#edf3ef]">Войти в кабинет</Link>
          <Link to="/register?intent=studio" className="home-primary mt-1">Попробовать бесплатно</Link>
        </nav> : null}
      </header>
      <section className="home-hero mx-auto grid max-w-7xl items-center gap-12 px-5 pb-16 pt-12 sm:px-8 sm:pt-20 lg:grid-cols-[1fr_1.05fr] lg:gap-14 lg:pb-24">
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
              to="/register?intent=studio"
              data-analytics-cta="try_drafts"
              className="home-primary"
            >
              Попробовать бесплатно <span aria-hidden="true">↗</span>
            </Link>
            <a href="#how-it-works" className="home-secondary">Как это работает</a>
          </div>
          <p className="mt-4 max-w-lg text-xs leading-5 text-[#738078]">
            Три пробных черновика после регистрации — без карты и подключения Threads.
            Подписка нужна для работы с проектами и публикации.{" "}
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
        <div className="hero-visual relative min-w-0 pt-14 sm:pt-16">
          <div className="hero-glow pointer-events-none absolute inset-0" aria-hidden="true" />
          <img src="/landing/hero-orb.webp" width="1254" height="1254" alt="" className="hero-art pointer-events-none absolute -right-3 -top-16 z-10 h-44 w-44 object-contain sm:-top-20 sm:h-56 sm:w-56" fetchPriority="high" />
          <ProductPreview />
        </div>
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
          <div id="workflow-example" className="tg-reveal mt-14 grid scroll-mt-8 items-center gap-8 lg:grid-cols-[1fr_1.05fr] lg:gap-12">
            <div className="min-w-0">
              <figure className="overflow-hidden rounded-[2rem] border border-[#dbe6dd] bg-[#edf3ef]">
                <img src="/images/threadsgo-creative-flow-v1.webp" alt="" width="1536" height="1024" loading="lazy" decoding="async"
                  className="tg-illustration aspect-[3/2] w-full object-contain" />
              </figure>
              <h3 className="mt-6 text-2xl font-semibold tracking-tight">От мысли — к готовому тексту.</h3>
              <p className="mt-3 max-w-lg text-sm leading-7 text-[#60716a]">Помощник берёт на себя подготовку. Вы выбираете направление, проверяете слова и управляете тем, что попадёт в вашу ленту.</p>
            </div>
            <AnimatedWorkflow />
          </div>
        </div>
      </section>
      <section className="home-enter mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-2 lg:items-center">
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
            to="/register?intent=studio"
            className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#315b46]"
          >
            Попробовать свой стиль в черновике →
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
      <section className="home-enter mx-auto max-w-7xl px-5 pb-16 sm:px-8 sm:pb-24">
        <div className="idea-landscape relative overflow-hidden rounded-3xl bg-[#07100e] text-white">
          <img src="/landing/trend-radar.webp" width="1605" height="970" alt="" loading="lazy" className="idea-landscape-image absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#07100e] via-[#07100e]/85 to-[#07100e]/10" />
          <div className="relative max-w-xl px-6 py-12 sm:px-10 sm:py-16">
            <p className="text-xs font-semibold tracking-[0.13em] text-[#a6c4b1]">ИЗ ЛЕНТЫ — В ВАШ ПРОЕКТ</p>
            <h2 className="home-heading mt-4">У интересных тем<br />есть продолжение.</h2>
            <p className="mt-5 text-sm leading-7 text-[#d3dfd8]">ThreadsGo собирает обсуждаемые темы и помогает превратить их в новые тексты с учётом описания проекта и вашего стиля.</p>
            <a href="#how-it-works" className="mt-7 inline-flex items-center gap-3 rounded-xl border border-white/25 bg-white/10 px-4 py-3 text-sm font-medium hover:bg-white/20">Посмотреть первые шаги <span aria-hidden="true">→</span></a>
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
          Начните с трёх бесплатных черновиков без привязки карты.
        </p>
        <Link
          to="/register?intent=studio"
          data-analytics-cta="try_drafts"
          className="home-primary mx-auto mt-7 w-fit"
        >
          Попробовать три черновика ↗
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
              <Link to="/terms/">Пользовательское соглашение</Link>
              <Link to="/privacy/">Политика конфиденциальности</Link>
              <a
                href="https://t.me/cuartenlol"
                target="_blank"
                rel="noreferrer"
              >
                Поддержка ↗
              </a>
            </nav>
          </div>
          <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#e0e8e2] px-3 py-1.5 text-xs text-[#60716a]">
            Проверка платежного подключения · <span className="font-mono font-semibold">OPLAT</span>
          </p>
          <p className="mt-6 max-w-4xl text-xs leading-6 text-[#738078]">
            Мы активно совершенствуем наши системы защиты от блокировок. Однако
            это не исключает ограничений или блокировки аккаунта: Meta постоянно
            меняет правила и способы обнаружения автоматизации. Учитывайте этот
            риск при подключении профиля.
          </p>
          <p className="mt-2 text-[11px] leading-5 text-[#738078]">
            *Meta Platforms Inc. признана экстремистской организацией; её деятельность запрещена в России.
          </p>
        </div>
      </footer>
    </main>
  );
}

function ProductPreview() {
  return (
    <div className="product-preview relative min-w-0 rounded-[28px] border border-[#d6e3d9] bg-[#eaf1ec] p-3 shadow-[0_30px_80px_-35px_rgba(35,75,50,0.3)] sm:p-5">
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
