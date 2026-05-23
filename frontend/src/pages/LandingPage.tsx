import { Link } from "react-router-dom";

const stats = [
  { label: "сигналы из ленты", value: "300+" },
  { label: "ручной контроль", value: "100%" },
  { label: "постинг по расписанию", value: "24/7" },
];

const workflow = [
  {
    title: "Смотрит на ленту",
    text: "Система собирает свежие посты из Threads и сохраняет только то, что может стать рабочим сигналом.",
  },
  {
    title: "Достает механику",
    text: "ИИ разбирает не чужой текст, а его скелет: хук, структуру, ритм и живые формулировки.",
  },
  {
    title: "Пишет под проект",
    text: "Генератор учитывает описание бренда, стоп-слова, историю прошлых постов и актуальные тренды.",
  },
  {
    title: "Отдает на контроль",
    text: "Перед публикацией текст можно отредактировать, перегенерировать или отправить в очередь вручную.",
  },
];

const capabilities = [
  "Telegram-вход без паролей",
  "изоляция проектов и аккаунтов",
  "проверка cookies-сессий",
  "пул прокси и ручная привязка профилей",
  "перегенерация конкретного поста",
  "алерты, когда сессия Threads слетает",
];

const posts = [
  "Нас уже 20 человек на воскресный круг. Стартуем в 12:30, спокойно едем по маршруту и потом садимся за пиццу.",
  "Вчера собрали маршрут и поняли простую вещь: людям нужен не спорт, а понятный повод выйти из дома.",
  "Пока все усложняют формат, мы делаем проще: встречаемся, едем, разговариваем, потом едим.",
];

export default function LandingPage() {
  return (
    <main className="landing-shell min-h-screen overflow-hidden bg-[#070909] text-[#eff6ed]">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute left-[-14rem] top-[-10rem] h-[32rem] w-[32rem] rounded-full bg-[#0076ff]/30 blur-[110px]" />
        <div className="absolute right-[-12rem] top-[12rem] h-[34rem] w-[34rem] rounded-full bg-[#73ff2d]/25 blur-[120px]" />
        <div className="absolute bottom-[-18rem] left-[30%] h-[34rem] w-[34rem] rounded-full bg-[#00d8b7]/20 blur-[130px]" />
        <div className="landing-grid absolute inset-0 opacity-[0.18]" />
      </div>

      <section className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-10">
        <header className="landing-reveal flex items-center justify-between gap-5">
          <Link to="/" className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur">
              <img src="/threadsgo-logo.png" alt="ThreadsGo" className="h-8 w-8 object-contain" />
            </span>
            <span>
              <span className="block font-display text-xl tracking-[-0.04em] text-white">ThreadsGo</span>
              <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-white/36">
                AI content cockpit
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-7 font-mono text-[11px] uppercase tracking-[0.18em] text-white/45 md:flex">
            <a href="#system" className="transition hover:text-white">система</a>
            <a href="#workflow" className="transition hover:text-white">процесс</a>
            <a href="#control" className="transition hover:text-white">контроль</a>
          </nav>

          <Link
            to="/login"
            className="rounded-full border border-white/14 bg-white/[0.05] px-5 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-white/75 transition hover:border-white/40 hover:bg-white hover:text-[#070909]"
          >
            войти
          </Link>
        </header>

        <div className="grid flex-1 items-center gap-12 py-20 lg:grid-cols-[0.95fr_1.05fr] lg:py-10">
          <div className="landing-reveal max-w-3xl [animation-delay:120ms]">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 backdrop-blur">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#70ff35]" />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/52">
                автономный контент-оператор для threads
              </span>
            </div>

            <h1 className="mt-8 max-w-4xl font-display text-[clamp(4rem,10vw,9.5rem)] leading-[0.78] tracking-[-0.075em] text-white">
              Посты, которые сначала слушают рынок.
            </h1>

            <p className="mt-8 max-w-2xl text-lg leading-8 text-white/62">
              ThreadsGo собирает сигналы из ленты, превращает их в понятные паттерны
              и готовит посты под голос проекта. Не “автокопирайтер”, а рабочая панель
              для контент-операций: тренды, генерация, очередь, сессии и ручной контроль.
            </p>

            <div className="mt-10 flex flex-wrap gap-3">
              <Link
                to="/login"
                className="group rounded-full bg-white px-7 py-4 font-mono text-xs uppercase tracking-[0.18em] text-[#070909] transition hover:bg-[#70ff35]"
              >
                открыть кабинет
                <span className="ml-3 inline-block transition group-hover:translate-x-1">→</span>
              </Link>
              <a
                href="#system"
                className="rounded-full border border-white/14 px-7 py-4 font-mono text-xs uppercase tracking-[0.18em] text-white/68 transition hover:border-white/40 hover:text-white"
              >
                посмотреть систему
              </a>
            </div>

            <div className="mt-14 grid max-w-2xl grid-cols-3 gap-3">
              {stats.map((item) => (
                <div key={item.label} className="rounded-3xl border border-white/10 bg-white/[0.045] p-4 backdrop-blur">
                  <p className="font-display text-4xl leading-none text-white">{item.value}</p>
                  <p className="mt-3 font-mono text-[9px] uppercase leading-4 tracking-[0.18em] text-white/38">
                    {item.label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <HeroDashboard />
        </div>
      </section>

      <section id="system" className="relative z-10 mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-10">
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <article className="landing-card rounded-[2rem] border border-white/10 bg-white/[0.045] p-7 backdrop-blur md:p-10">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#70ff35]/70">
              why it sells
            </p>
            <h2 className="mt-5 max-w-3xl font-display text-5xl leading-[0.9] tracking-[-0.055em] text-white md:text-7xl">
              Не генерируем в пустоту. Работаем от доказанного спроса.
            </h2>
            <p className="mt-7 max-w-2xl text-base leading-8 text-white/58">
              Большинство AI-постинга делает одну ошибку: просит модель “придумать что-нибудь”.
              ThreadsGo начинает раньше: смотрит, что уже цепляет людей, достает механику
              и только потом адаптирует ее под проект.
            </p>
          </article>

          <article className="landing-card overflow-hidden rounded-[2rem] border border-white/10 bg-[#eff6ed] p-7 text-[#08100d] md:p-8">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#355447]">
              signal stream
            </p>
            <div className="mt-8 space-y-3">
              {posts.map((post, index) => (
                <div
                  key={post}
                  className="rounded-3xl border border-[#d7dfd4] bg-white/65 p-5 shadow-sm"
                  style={{ transform: `translateX(${index * 18}px)` }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="rounded-full bg-[#08100d] px-3 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-white">
                      trend {index + 1}
                    </span>
                    <span className="font-mono text-[10px] text-[#557162]">score {91 - index * 7}</span>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-[#26372f]">{post}</p>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section id="workflow" className="relative z-10 mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-10">
        <div className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/35">pipeline</p>
            <h2 className="mt-4 font-display text-5xl leading-none tracking-[-0.055em] text-white md:text-7xl">
              От ленты до публикации.
            </h2>
          </div>
          <p className="max-w-md text-sm leading-7 text-white/50">
            Внутри не магия, а нормальный продуктовый контур: сбор, анализ, генерация,
            редактура, публикация и диагностика сессий.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {workflow.map((item, index) => (
            <article
              key={item.title}
              className="landing-card group min-h-72 rounded-[2rem] border border-white/10 bg-white/[0.045] p-6 transition duration-300 hover:-translate-y-1 hover:bg-white/[0.075]"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-12 font-display text-4xl leading-none tracking-[-0.04em] text-white">
                {item.title}
              </h3>
              <p className="mt-6 text-sm leading-7 text-white/52">{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="control" className="relative z-10 mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-10">
        <div className="rounded-[2.4rem] border border-white/10 bg-[#eff6ed] p-5 text-[#08100d] shadow-[0_40px_140px_rgba(0,0,0,0.35)] md:p-8">
          <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="rounded-[2rem] bg-[#08100d] p-8 text-white">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#70ff35]/70">
                human-in-the-loop
              </p>
              <h2 className="mt-5 font-display text-5xl leading-[0.9] tracking-[-0.055em]">
                Автономия, которую можно держать за руку.
              </h2>
              <p className="mt-7 text-sm leading-7 text-white/58">
                Пост можно остановить, переписать, перегенерировать или выпустить сразу.
                Если cookies слетели, система покажет это в интерфейсе и не будет молча жечь очередь.
              </p>

              <div className="mt-8 grid gap-2">
                {capabilities.map((item) => (
                  <div key={item} className="flex items-center gap-3 rounded-2xl border border-white/10 px-4 py-3">
                    <span className="h-2 w-2 rounded-full bg-[#70ff35]" />
                    <span className="text-sm text-white/68">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <ControlMockup />
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-5 pb-10 pt-16 sm:px-8 lg:px-10">
        <div className="landing-card overflow-hidden rounded-[2.4rem] border border-white/10 bg-white/[0.045] p-8 text-center backdrop-blur md:p-14">
          <img src="/threadsgo-logo.png" alt="" className="mx-auto h-20 w-20 object-contain" />
          <h2 className="mx-auto mt-7 max-w-3xl font-display text-5xl leading-[0.9] tracking-[-0.055em] text-white md:text-7xl">
            Соберите контент-оператора для своего проекта.
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-sm leading-7 text-white/54">
            Начните с Telegram-входа, добавьте проект, подключите Threads-профиль
            и запустите первый сбор трендов.
          </p>
          <Link
            to="/login"
            className="mt-9 inline-flex rounded-full bg-white px-8 py-4 font-mono text-xs uppercase tracking-[0.18em] text-[#070909] transition hover:bg-[#70ff35]"
          >
            войти в кабинет
          </Link>
        </div>
      </section>
    </main>
  );
}

function HeroDashboard() {
  return (
    <div className="landing-reveal relative [animation-delay:240ms]">
      <div className="absolute -left-6 top-16 hidden rounded-3xl border border-white/10 bg-[#0e1412]/90 p-4 shadow-2xl backdrop-blur lg:block">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/35">session</p>
        <p className="mt-2 text-sm text-white">cookies active</p>
      </div>

      <div className="relative rounded-[2.2rem] border border-white/12 bg-[#101615]/80 p-3 shadow-[0_50px_160px_rgba(0,0,0,0.5)] backdrop-blur">
        <div className="rounded-[1.7rem] border border-white/8 bg-[#eff6ed] p-4 text-[#08100d]">
          <div className="flex items-center justify-between gap-4 border-b border-[#d7dfd4] pb-4">
            <div className="flex items-center gap-3">
              <img src="/threadsgo-logo.png" alt="" className="h-10 w-10 object-contain" />
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#698073]">
                  project cockpit
                </p>
                <h2 className="font-display text-3xl leading-none">MosRiders</h2>
              </div>
            </div>
            <span className="rounded-full bg-[#08100d] px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-white">
              live
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <DashboardMetric label="тренды" value="10" />
            <DashboardMetric label="очередь" value="5" />
            <DashboardMetric label="профиль" value="active" />
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_0.85fr]">
            <div className="rounded-3xl bg-[#08100d] p-5 text-white">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/35">
                    generated post
                  </p>
                  <p className="mt-4 text-sm leading-7 text-white/74">
                    Нас уже 20 человек на воскресный круг. Стартуем в 12:30, спокойно
                    едем по маршруту и потом садимся за пиццу. Если хочешь влиться —
                    напиши, скину детали.
                  </p>
                </div>
              </div>
              <div className="mt-5 flex gap-2">
                <span className="rounded-full bg-white/10 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white/55">
                  edit
                </span>
                <span className="rounded-full bg-[#70ff35] px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[#08100d]">
                  publish
                </span>
              </div>
            </div>

            <div className="grid gap-3">
              <MiniPanel title="applied angle" text="Social proof без давления" />
              <MiniPanel title="next post" text="сегодня, 18:40" />
              <MiniPanel title="trend check" text="завтра, 09:00" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-[#d7dfd4] bg-white/70 p-4">
      <p className="font-display text-3xl leading-none">{value}</p>
      <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.18em] text-[#698073]">{label}</p>
    </div>
  );
}

function MiniPanel({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-3xl border border-[#d7dfd4] bg-white/70 p-4">
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#698073]">{title}</p>
      <p className="mt-2 text-sm leading-5 text-[#26372f]">{text}</p>
    </div>
  );
}

function ControlMockup() {
  return (
    <div className="grid gap-4">
      <div className="rounded-[2rem] border border-[#d7dfd4] bg-white/75 p-5">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#698073]">queue</p>
          <span className="rounded-full bg-[#fff2d6] px-3 py-1 text-xs text-[#8a5b12]">ожидает проверки</span>
        </div>
        <p className="mt-5 text-sm leading-7 text-[#26372f]">
          Вчера собрали маршрут и поняли простую вещь: людям нужен понятный повод
          выйти, а не еще один план на потом.
        </p>
        <div className="mt-5 grid grid-cols-3 gap-2">
          <button className="rounded-2xl border border-[#c9d4c6] px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em]">
            edit
          </button>
          <button className="rounded-2xl border border-[#c9d4c6] px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em]">
            regen
          </button>
          <button className="rounded-2xl bg-[#08100d] px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white">
            now
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-[2rem] border border-[#d7dfd4] bg-white/75 p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#698073]">cookies</p>
          <p className="mt-4 font-display text-3xl leading-none">healthy</p>
          <p className="mt-3 text-xs leading-5 text-[#557162]">публикация доступна</p>
        </div>
        <div className="rounded-[2rem] border border-[#d7dfd4] bg-white/75 p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#698073]">velocity</p>
          <p className="mt-4 font-display text-3xl leading-none">3/day</p>
          <p className="mt-3 text-xs leading-5 text-[#557162]">окно 09:00–21:00</p>
        </div>
      </div>
    </div>
  );
}
