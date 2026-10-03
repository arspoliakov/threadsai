import { Link } from "react-router-dom";
import { ThemeToggle } from "../components/ThemeToggle";
import { planCopy } from "../billingPlans";
import { PublicLegalLinks } from "../components/PublicLegalLinks";

export default function PricingPage() {
  return (
    <main className="home-refresh min-h-screen bg-[#f8faf9] px-5 py-8 text-[#162b25] sm:px-8">
      <div className="mx-auto max-w-6xl">
        <nav className="flex flex-wrap items-center justify-between gap-4 text-sm">
          <Link to="/" className="font-display text-2xl">
            ThreadsGo
          </Link>
          <div className="flex items-center gap-5">
            <ThemeToggle />
            <Link to="/login">Войти</Link>
          </div>
        </nav>
        <header className="tg-reveal max-w-3xl py-14 sm:py-20">
          <p className="text-sm text-[#315b46]">
            От первого черновика до регулярных публикаций
          </p>
          <h1 className="mt-4 font-display text-5xl leading-tight sm:text-6xl">
            Тарифы ThreadsGo
          </h1>
          <p className="mt-6 text-lg leading-8 text-[#60716a]">
            Начните с Basic: 3 дня пробного периода, затем 1 490 ₽ в месяц.
            Создайте проект, настройте свой стиль и подключите профиль Threads.
          </p>
          <p className="mt-4 text-sm leading-7 text-[#60716a]">
            Подписка оплачивает доступ к генерации и редактированию текстов,
            проектам, очереди публикаций и подключению собственных аккаунтов
            Threads в пределах выбранного тарифа. Стоимость указана в рублях
            за месяц, квартал или год; лимиты доступны в кабинете перед оплатой.
          </p>
        </header>
        <section
          className="grid gap-5 lg:grid-cols-3"
          aria-label="Сравнение тарифов"
        >
          {Object.entries(planCopy).map(([key, plan]) => (
            <article
              key={key}
              data-plan={key}
              className={`pricing-card flex flex-col rounded-3xl border p-6 text-[#111] ${plan.tone}`}
            >
              <h2 className="font-display text-3xl">{plan.title}</h2>
              <p className="mt-3 text-sm font-medium">{plan.subtitle}</p>
              <p className="mt-5 font-semibold leading-7">{plan.price}</p>
              <p className="mb-6 mt-4 text-sm leading-6 text-[#526056]">
                {plan.body}
              </p>
              <Link
                to="/register?intent=start"
                data-analytics-cta="start_trial"
                className="home-primary tg-action mt-auto flex w-full text-center"
              >
                {key === "basic"
                  ? "Начать пробный период"
                  : `Выбрать ${plan.title}`}
              </Link>
            </article>
          ))}
        </section>
        <section className="mt-12 rounded-3xl border border-[#dbe6dd] bg-white p-6 sm:p-8">
          <h2 className="font-display text-3xl">Как включить доступ</h2>
          <ol className="mt-6 grid gap-6 text-sm leading-7 text-[#60716a] md:grid-cols-3">
            <li>
              <strong className="block text-[#162b25]">
                1. Создайте профиль
              </strong>
              На регистрации подтвердите согласия и авторизуйтесь через
              Telegram. Если профиль уже есть, используйте вход.
            </li>
            <li>
              <strong className="block text-[#162b25]">
                2. Подключите тариф в Tribute
              </strong>
              Завершите оформление подписки в том же Telegram-аккаунте,
              через который вошли в ThreadsGo. При задержке подтверждения
              используйте кнопку доступа к каналу тарифа для резервной проверки.
            </li>
            <li>
              <strong className="block text-[#162b25]">
                3. Вернитесь на сайт
              </strong>
              Мы проверим доступ. Затем создайте проект, подключите профиль
              Threads и получите первый черновик.
            </li>
          </ol>
        </section>
        <section className="grid gap-8 py-12 text-sm leading-7 text-[#60716a] md:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl text-[#162b25]">
              Без неожиданного продления
            </h2>
            <p className="mt-3">
              Пробный период начинается в Tribute. Проверьте дату и сумму
              следующего списания перед подтверждением. Отменить автоматическое
              продление можно в Tribute. Подарочные дни ThreadsGo не меняют дату
              списания в Tribute.
            </p>
          </div>
          <div>
            <h2 className="font-display text-2xl text-[#162b25]">
              Что нужно учитывать
            </h2>
            <p className="mt-3">
              Мы активно совершенствуем наши системы защиты от блокировок. Это
              не исключает ограничений. Meta меняет правила обнаружения
              автоматизации: ограничения и блокировка аккаунта возможны.
              ThreadsGo не гарантирует охваты, продажи или сохранность аккаунта.
            </p>
          </div>
        </section>
        <footer className="flex flex-wrap gap-6 border-t border-[#dbe6dd] py-8 text-sm text-[#60716a]">
          <PublicLegalLinks />
          <Link to="/updates/">Что нового</Link>
          <Link to="/resources/">Бесплатные инструменты</Link>
          <Link to="/blog/">Материалы о Threads</Link>
        </footer>
      </div>
    </main>
  );
}
