import { Link } from "react-router-dom";
import { OperatorDetails } from "../components/OperatorDetails";
import { ThemeToggle } from "../components/ThemeToggle";
import { PublicLegalLinks } from "../components/PublicLegalLinks";

const updatedAt = "3 октября 2026";

export default function TermsPage() {
  return (
    <main className="home-refresh public-reader min-h-screen bg-[#f5f6f1] px-5 py-6 text-[#07100e] sm:px-8 lg:px-10">
      <section className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#d9ddd4] pb-6">
          <Link to="/" className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl border border-[#dfe4dc] bg-white shadow-sm">
              <img
                src="/threadsgo-logo.png"
                alt="ThreadsGo"
                className="h-9 w-9 object-contain"
              />
            </span>
            <span className="font-display text-3xl leading-none tracking-[-0.04em]">
              ThreadsGo
            </span>
          </Link>
          <ThemeToggle />
          <Link
            to="/login"
            className="rounded-full border border-[#07100e] px-5 py-3 font-mono text-[10px] uppercase tracking-[0.16em] transition hover:bg-[#07100e] hover:text-white"
          >
            Войти
          </Link>
        </header>

        <article className="mt-10 overflow-hidden rounded-[2.4rem] border border-[#d9ddd4] bg-white shadow-sm">
          <div className="bg-[#07100e] p-7 text-white sm:p-10">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/42">
              Последнее обновление: {updatedAt}
            </p>
            <h1 className="mt-5 max-w-3xl font-display text-5xl leading-[0.9] tracking-[-0.055em] sm:text-7xl">
              Пользовательское соглашение
            </h1>
            <p className="mt-6 max-w-2xl text-sm leading-7 text-white/62">
              Правила доступа к ThreadsGo, использования генерации текстов,
              подключения аккаунтов и платных функций.
            </p>
          </div>

          <div className="grid gap-10 p-6 sm:p-10">
            <LegalNotice />
            <OperatorDetails />
            <TermsSection />
            <p className="text-sm leading-7">
              Порядок обработки данных описан в{" "}
              <Link to="/privacy" className="underline">
                политике конфиденциальности
              </Link>
              . Отдельное{" "}
              <Link to="/consent" className="underline">
                согласие на обработку данных
              </Link>{" "}
              подтверждается при регистрации.
            </p>
            <BetaNotice />
          </div>
        </article>
        <footer className="mt-8 border-t border-[#d9ddd4] py-8"><PublicLegalLinks /></footer>
      </section>
    </main>
  );
}

function LegalNotice() {
  return (
    <section
      className="rounded-[2rem] border border-[#ffd48a] bg-[#fff8e8] p-6"
      id="meta-notice"
    >
      <h2 className="font-display text-3xl leading-none tracking-[-0.04em]">
        Важная юридическая оговорка
      </h2>
      <p className="mt-4 text-sm leading-7 text-[#5f4b1d]">
        Meta Platforms Inc. признана экстремистской организацией; её
        деятельность запрещена в России.
      </p>
      <p className="mt-3 text-sm leading-7 text-[#5f4b1d]">
        ThreadsGo является техническим инструментом автоматизации
        контент-операций. Сервис не предоставляет VPN, средства обхода
        блокировок и не пропагандирует деятельность запрещенных организаций.
        Пользователь самостоятельно принимает решение об использовании сторонних
        сервисов, настройке сетевого доступа, подключении аккаунтов и публикации
        материалов.
      </p>
    </section>
  );
}

function TermsSection() {
  return (
    <section id="terms" className="legal-copy">
      <h2>Условия использования</h2>
      <p>
        ThreadsGo — SaaS-платформа для автоматизации контента в Threads.
        Используя сервис, вы соглашаетесь с правилами ниже и подтверждаете, что
        понимаете технические и юридические риски такой автоматизации.
      </p>

      <h3>1. Что делает сервис</h3>
      <p>
        Платформа может собирать данные из ленты Threads, анализировать тренды,
        создавать черновики публикаций с помощью языковых моделей, ставить
        задачи в очередь и публиковать материалы через подключенные
        пользователем профили Threads. Для работы могут использоваться
        cookies-сессии, параметры аккаунтов и внутренняя серверная
        инфраструктура платформы.
      </p>

      <h3>2. Использование на свой риск</h3>
      <p>
        Любая автоматизация социальных сетей может нарушать правила
        соответствующей платформы или восприниматься ее алгоритмами как
        подозрительная активность. Возможны сброс cookies, ограничение охватов,
        теневой бан, временная или постоянная блокировка аккаунта. ThreadsGo не
        гарантирует сохранность профилей Threads и не компенсирует убытки,
        связанные с действиями сторонних платформ.
      </p>

      <h3>3. Доступ и платные функции</h3>
      <p>
        Авторизация в кабинете выполняется через Telegram. Генерация,
        подключение профилей и автоматическая публикация доступны в пределах
        активного тарифа и его лимитов. Оплата оформляется через указанные в
        кабинете страницы подписки. В период технических работ или закрытого
        тестирования оператор вправе временно ограничить регистрацию
        дополнительным списком допуска.
      </p>
      <p>
        Актуальные цены, периоды оплаты и описание тарифов постоянно доступны
        на странице <Link to="/pricing/" className="underline">«Цены и тарифы»</Link>.
        Перед подтверждением оплаты проверьте выбранный период, сумму и условия
        продления на странице платежного сервиса. Управление текущей подпиской
        выполняется через тот платежный сервис, в котором она оформлена.
      </p>

      <h3>4. Что запрещено</h3>
      <p>
        Запрещено использовать ThreadsGo для массового спама, мошеннических
        предложений, фишинга, публикации незаконных материалов, разжигания
        ненависти, обхода чужих ограничений доступа, нарушения прав третьих лиц
        и любых действий, которые прямо противоречат применимому
        законодательству или правилам платформ, с которыми работает
        пользователь.
      </p>
      <p>
        Также запрещены создание и публикация сексуального контента 18+,
        материалов сексуальной эксплуатации несовершеннолетних, инструкций
        по изготовлению оружия, взрывчатых веществ и совершению насилия.
        Эти ограничения распространяются на запросы к ИИ, настройки проекта,
        черновики и материалы, добавленные пользователем.
      </p>

      <h3>5. Контент и ответственность пользователя</h3>
      <p>
        Сервис генерирует черновики и технически помогает с публикацией, но
        ответственность за смысл, законность, достоверность и последствия
        опубликованных материалов несет пользователь. Перед публикацией
        рекомендуется проверять каждый текст вручную, особенно если он касается
        финансов, здоровья, политики, юридических вопросов или иных
        чувствительных тем.
      </p>

      <h3>6. Изменения условий</h3>
      <p>
        Условия могут обновляться. Существенные изменения публикуются на этой
        странице и/или в официальных каналах проекта. Продолжение использования
        сервиса после обновления условий означает согласие с новой редакцией.
      </p>
    </section>
  );
}

function BetaNotice() {
  return (
    <section className="rounded-[2rem] border border-[#d9ddd4] bg-[#f8faf5] p-6">
      <h2 className="font-display text-3xl leading-none tracking-[-0.04em]">
        Контакты
      </h2>
      <p className="mt-4 text-sm leading-7 text-[#5d685d]">
        Если у вас есть вопросы по условиям, данным или работе сервиса, напишите
        разработчику:{" "}
        <a
          className="underline decoration-[#70ff35] underline-offset-4"
          href="https://t.me/cuartenlol"
          target="_blank"
          rel="noreferrer"
        >
          @cuartenlol
        </a>
        .
      </p>
    </section>
  );
}
