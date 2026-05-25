import { Link } from "react-router-dom";

const landingImages = {
  heroOrb: "/landing/hero-orb.webp",
  dashboard: "/landing/dashboard-mockup.webp",
  trendRadar: "/landing/trend-radar.webp",
  humanControl: "/landing/human-control.webp",
  mobilePreview: "/landing/mobile-preview.webp",
};

const audienceCards = [
  {
    title: "Экспертам и фрилансерам",
    text: "Развивайте личный бренд без выгорания. ИИ напишет экспертные треды и живые посты, пока вы заняты своей основной работой.",
  },
  {
    title: "Малому бизнесу",
    text: "Привлекайте аудиторию без найма дорогого копирайтера. Публикуйте контент, который вызывает доверие, а не выглядит как сухая рекламная витрина.",
  },
  {
    title: "SMM-агентствам",
    text: "Ведите десятки проектов в одном окне. Изолированные прокси, раздельные очереди публикаций и полная безопасность для сеток аккаунтов.",
  },
];

const stats = [
  {
    value: "сотни",
    label: "трендов в день",
    description: "Непрерывный анализ ленты Threads",
  },
  {
    value: "100%",
    label: "ручной контроль",
    description: "ИИ предлагает, вы публикуете",
  },
  {
    value: "24/7",
    label: "на автопилоте",
    description: "Публикации выходят точно в срок",
  },
];

const workflow = [
  {
    title: "Ищет идеи",
    text: "Система собирает свежие посты в Threads и отбирает только те, которые вызывают живой интерес аудитории.",
  },
  {
    title: "Разбирает успех",
    text: "ИИ анализирует не чужой текст, а его структуру: почему этот пост зацепил? Это полезный совет, шутка или провокация?",
  },
  {
    title: "Пишет под вас",
    text: "Генератор создает новый пост, учитывая описание вашего бренда, стиль общения, стоп-слова и актуальную повестку.",
  },
  {
    title: "Ждет одобрения",
    text: "Перед выходом в ленту вы читаете черновик. Его можно отредактировать, попросить ИИ переписать или сразу отправить в очередь.",
  },
];

const capabilities = [
  "Быстрый вход через Telegram.",
  "Полная изоляция каждого проекта.",
  "Умная защита от теневых банов.",
  "Работа через ваши приватные прокси.",
  "Переписывание любого поста в один клик.",
  "Моментальные уведомления об ошибках.",
  "Над одним проектом могут работать несколько аккаунтов, набирая в разы больше аудитории.",
];

const posts = [
  "Пост набирает реакции не потому, что громче всех кричит. Он попадает в ситуацию, которую аудитория узнает за секунду.",
  "Когда тема уже обсуждается в ленте, вам не нужно угадывать интерес. Нужно понять механику и сказать это своим голосом.",
  "Хороший пост выглядит простым. За ним обычно стоит правильный хук, понятная структура и точное время публикации.",
];

export default function LandingPage() {
  return (
    <main className="landing-shell min-h-screen overflow-hidden bg-[#070909] text-[#eff6ed]">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="landing-aurora absolute left-[-14rem] top-[-10rem] h-[32rem] w-[32rem] rounded-full bg-[#0076ff]/30 blur-[110px]" />
        <div className="landing-aurora absolute right-[-12rem] top-[12rem] h-[34rem] w-[34rem] rounded-full bg-[#73ff2d]/25 blur-[120px] [animation-delay:-5s]" />
        <div className="landing-aurora absolute bottom-[-18rem] left-[30%] h-[34rem] w-[34rem] rounded-full bg-[#00d8b7]/20 blur-[130px] [animation-delay:-9s]" />
        <div className="landing-grid absolute inset-0 opacity-[0.18]" />
      </div>

      <section className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-10">
        <header className="landing-reveal flex items-center justify-between gap-5">
          <Link to="/" className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur">
              <img src="/threadsgo-logo.png" alt="ThreadsGo" className="h-8 w-8 object-contain" />
            </span>
            <span className="block font-display text-xl tracking-[-0.04em] text-white">ThreadsGo</span>
          </Link>

          <Link
            to="/login"
            className="shrink-0 rounded-full border border-white/14 bg-white/[0.05] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-white/75 transition hover:border-white/40 hover:bg-white hover:text-[#070909] sm:px-5 sm:text-[11px]"
          >
            Войти
          </Link>
        </header>

        <div className="grid flex-1 items-center gap-10 py-14 sm:py-20 lg:grid-cols-[0.95fr_1.05fr] lg:py-10">
          <div className="landing-reveal max-w-3xl [animation-delay:120ms]">
            <h1 className="max-w-4xl font-display text-[clamp(3.15rem,13vw,8.5rem)] leading-[0.88] tracking-[-0.075em] text-white sm:leading-[0.82]">
              Умный автопостинг для Threads. Пишет то, что хотят читать.
            </h1>

            <p className="mt-7 max-w-2xl text-base leading-7 text-white/62 sm:mt-8 sm:text-lg sm:leading-8">
              Забудьте про запросы в духе «ИИ, напиши пост». Наша система сама находит обсуждаемые темы в вашей нише,
              перенимает стиль вашего проекта и ведет аккаунт 24/7. Вы только утверждаете черновики.
            </p>

            <div className="mt-9 grid gap-3 sm:mt-10 sm:flex sm:flex-wrap">
              <Link
                to="/login"
                className="group rounded-full bg-white px-7 py-4 text-center font-mono text-xs uppercase tracking-[0.18em] text-[#070909] transition hover:bg-[#70ff35]"
              >
                Начать работу
                <span className="ml-3 inline-block transition group-hover:translate-x-1">→</span>
              </Link>
              <a
                href="#audience"
                className="rounded-full border border-white/14 px-7 py-4 text-center font-mono text-xs uppercase tracking-[0.18em] text-white/68 transition hover:border-white/40 hover:text-white"
              >
                Кому это нужно
              </a>
            </div>

            <div className="mt-10 grid max-w-2xl grid-cols-1 gap-3 min-[420px]:grid-cols-3 sm:mt-14">
              {stats.map((item) => (
                <div key={item.label} className="rounded-3xl border border-white/10 bg-white/[0.045] p-4 backdrop-blur">
                  <p className="font-display text-4xl leading-none text-white">{item.value}</p>
                  <p className="mt-3 font-mono text-[9px] uppercase leading-4 tracking-[0.18em] text-white/40">
                    {item.label}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-white/48">{item.description}</p>
                </div>
              ))}
            </div>
          </div>

          <HeroDashboard />
        </div>
      </section>

      <section id="audience" className="relative z-10 mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-20 lg:px-10">
        <div className="mb-10 max-w-4xl">
          <h2 className="font-display text-5xl leading-[0.9] tracking-[-0.055em] text-white md:text-7xl">
            Кому ThreadsGo сэкономит сотни часов?
          </h2>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {audienceCards.map((card) => (
            <article
              key={card.title}
              className="landing-card min-h-72 rounded-[2rem] border border-white/10 bg-white/[0.045] p-7 backdrop-blur transition duration-300 hover:-translate-y-1 hover:bg-white/[0.075]"
            >
              <h3 className="font-display text-4xl leading-none tracking-[-0.04em] text-white">{card.title}</h3>
              <p className="mt-7 text-sm leading-7 text-white/58">{card.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="system" className="relative z-10 mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-20 lg:px-10">
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <article className="landing-card rounded-[2rem] border border-white/10 bg-white/[0.045] p-7 backdrop-blur md:p-10">
            <h2 className="max-w-3xl font-display text-5xl leading-[0.9] tracking-[-0.055em] text-white md:text-7xl">
              Почему обычный ИИ не работает? Он пишет шаблонами.
            </h2>
            <p className="mt-7 max-w-2xl text-base leading-8 text-white/58">
              Большинство сервисов просто просят нейросеть «придумать что-нибудь». ThreadsGo работает иначе. Мы
              непрерывно сканируем ленту, находим посты, которые прямо сейчас собирают лайки и комментарии, понимаем,
              почему они сработали, и пишем уникальный контент с такой же логикой для вас.
            </p>
          </article>

          <article className="landing-card overflow-hidden rounded-[2rem] border border-white/10 bg-[#eff6ed] p-7 text-[#08100d] md:p-8">
            <div className="space-y-3">
              {posts.map((post, index) => (
                <div key={post} className="rounded-3xl border border-[#d7dfd4] bg-white/65 p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="rounded-full bg-[#08100d] px-3 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-white">
                      сигнал {index + 1}
                    </span>
                    <span className="font-mono text-[10px] text-[#557162]">score {91 - index * 7}</span>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-[#26372f]">{post}</p>
                </div>
              ))}
            </div>
          </article>
        </div>

        <div className="landing-card relative mt-4 overflow-hidden rounded-[2.4rem] border border-white/10 bg-white/[0.035]">
          <img
            src={landingImages.trendRadar}
            alt="Карта трендов Threads"
            className="landing-pan-image h-[26rem] w-full object-cover opacity-88 sm:h-[34rem]"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#070909] via-[#070909]/30 to-transparent" />
          <div className="absolute bottom-0 left-0 max-w-xl p-7 sm:p-10">
            <h3 className="font-display text-4xl leading-none tracking-[-0.05em] text-white sm:text-6xl">
              Лента превращается в карту спроса.
            </h3>
            <p className="mt-5 text-sm leading-7 text-white/58">
              ThreadsGo видит, какие темы уже обсуждают люди, какие форматы получают реакции и какие механики можно
              безопасно адаптировать под ваш проект.
            </p>
          </div>
        </div>
      </section>

      <section id="workflow" className="relative z-10 mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-20 lg:px-10">
        <div className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <h2 className="font-display text-5xl leading-none tracking-[-0.055em] text-white md:text-7xl">
              От поиска идей до публикации — на автопилоте.
            </h2>
          </div>
          <p className="max-w-md text-sm leading-7 text-white/50">
            Внутри не магия, а понятный рабочий процесс.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {workflow.map((item, index) => (
            <article
              key={item.title}
              className="landing-card group min-h-56 rounded-[2rem] border border-white/10 bg-white/[0.045] p-6 transition duration-300 hover:-translate-y-1 hover:bg-white/[0.075] sm:min-h-72"
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

      <section id="control" className="relative z-10 mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-20 lg:px-10">
        <div className="rounded-[2.4rem] border border-white/10 bg-[#eff6ed] p-5 text-[#08100d] shadow-[0_40px_140px_rgba(0,0,0,0.35)] md:p-8">
          <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="rounded-[2rem] bg-[#08100d] p-8 text-white">
              <h2 className="font-display text-5xl leading-[0.9] tracking-[-0.055em]">
                Автономия, которую можно держать за руку.
              </h2>
              <p className="mt-7 text-sm leading-7 text-white/58">
                Вы не отдаете свой аккаунт слепому роботу. Платформа делает всю черновую работу по расписанию, но
                финальное решение всегда остается за вами. Если профиль разлогинится — система встанет на паузу и
                пришлет уведомление, а не будет молча жечь посты.
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

          <div className="landing-card relative mt-5 overflow-hidden rounded-[2rem] bg-[#050807]">
            <img
              src={landingImages.humanControl}
              alt="Ручной контроль публикаций"
              className="h-[24rem] w-full object-cover opacity-90 sm:h-[34rem]"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#050807] via-transparent to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8">
              <div className="max-w-xl rounded-3xl border border-white/12 bg-[#07100e]/70 p-5 text-white backdrop-blur">
                <p className="text-sm leading-7 text-white/62">
                  Автоматизация не забирает контроль. Она готовит черновики, а человек решает, что выпускать в ленту.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-5 pb-10 pt-12 sm:px-8 sm:pt-16 lg:px-10">
        <div className="landing-card grid overflow-hidden rounded-[2.4rem] border border-white/10 bg-white/[0.045] backdrop-blur lg:grid-cols-[0.95fr_1.05fr]">
          <div className="p-8 text-center md:p-14 lg:text-left">
            <img src="/threadsgo-logo.png" alt="" className="mx-auto h-20 w-20 object-contain lg:mx-0" />
            <h2 className="mt-7 max-w-3xl font-display text-5xl leading-[0.9] tracking-[-0.055em] text-white md:text-7xl">
              Ваш автономный редактор для Threads. Готов к работе.
            </h2>
            <p className="mt-6 max-w-xl text-sm leading-7 text-white/54">
              Начните с авторизации через Telegram, добавьте свой первый проект, подключите профиль Threads и позвольте
              алгоритмам сделать рутину за вас.
            </p>
            <Link
              to="/login"
              className="mt-9 inline-flex rounded-full bg-white px-8 py-4 font-mono text-xs uppercase tracking-[0.18em] text-[#070909] transition hover:bg-[#70ff35]"
            >
              Войти в кабинет
            </Link>
          </div>

          <div className="relative min-h-[28rem] overflow-hidden">
            <img
              src={landingImages.mobilePreview}
              alt="Мобильная панель ThreadsGo"
              className="landing-phone-image absolute left-1/2 top-6 h-[36rem] max-w-none -translate-x-1/2 object-contain lg:top-[-1rem] lg:h-[44rem]"
              loading="lazy"
            />
            <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#070909] to-transparent" />
          </div>
        </div>
      </section>
    </main>
  );
}

function HeroDashboard() {
  return (
    <div className="landing-reveal relative pt-20 [animation-delay:240ms] sm:pt-24 lg:pt-32">
      <img
        src={landingImages.heroOrb}
        alt=""
        className="landing-orb pointer-events-none absolute right-3 top-0 z-10 w-40 opacity-80 blur-[0.1px] sm:right-10 sm:w-56 lg:right-20 lg:w-72"
        loading="eager"
      />
      <div className="landing-dashboard-frame relative rounded-[2.2rem] border border-white/12 bg-[#101615]/80 p-2 shadow-[0_50px_160px_rgba(0,0,0,0.5)] backdrop-blur sm:p-3">
        <img
          src={landingImages.dashboard}
          alt="ThreadsGo dashboard"
          className="landing-dashboard-image aspect-[1.5/1] w-full rounded-[1.7rem] object-cover object-center"
          loading="eager"
        />

        <div className="absolute inset-x-5 bottom-5 hidden rounded-3xl border border-white/12 bg-[#07100e]/80 p-4 text-white shadow-2xl backdrop-blur md:block">
          <div className="flex items-center justify-between gap-4">
            <p className="max-w-lg text-sm leading-6 text-white/74">
              Система нашла тренд, подготовила черновик и поставила публикацию в очередь.
            </p>
            <span className="landing-signal-pill rounded-full bg-[#70ff35] px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#07100e]">
              ready
            </span>
          </div>
        </div>

        <div className="landing-float-card absolute -right-3 top-8 rounded-3xl border border-white/12 bg-[#08100d]/90 p-4 text-white shadow-2xl backdrop-blur sm:-right-5">
          <p className="font-display text-3xl leading-none">5</p>
          <p className="mt-1 text-xs text-white/48">постов в очереди</p>
        </div>
      </div>
    </div>
  );
}

function ControlMockup() {
  return (
    <div className="grid gap-4">
      <div className="rounded-[2rem] border border-[#d7dfd4] bg-white/75 p-5">
        <div className="flex items-center justify-between">
          <span className="rounded-full bg-[#fff2d6] px-3 py-1 text-xs text-[#8a5b12]">ожидает проверки</span>
        </div>
        <p className="mt-5 text-sm leading-7 text-[#26372f]">
          Черновик готов. Его можно отредактировать, попросить ИИ переписать или отправить в очередь публикаций.
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
          <p className="font-display text-3xl leading-none">healthy</p>
          <p className="mt-3 text-xs leading-5 text-[#557162]">сессия активна</p>
        </div>
        <div className="rounded-[2rem] border border-[#d7dfd4] bg-white/75 p-5">
          <p className="font-display text-3xl leading-none">3/day</p>
          <p className="mt-3 text-xs leading-5 text-[#557162]">публикации по расписанию</p>
        </div>
      </div>
    </div>
  );
}
