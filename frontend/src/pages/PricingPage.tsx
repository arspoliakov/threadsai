import { Link } from "react-router-dom";
import { planCopy } from "../billingPlans";

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-[#07100e] px-5 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-6xl">
        <nav className="flex flex-wrap items-center justify-between gap-4 text-sm">
          <Link to="/" className="font-display text-2xl">ThreadsGo</Link>
          <div className="flex gap-5"><Link to="/threads-ideas-generator/">Бесплатные идеи</Link><Link to="/login">Войти</Link></div>
        </nav>
        <header className="max-w-3xl py-14 sm:py-20">
          <p className="text-sm text-[#b7ff91]">От первого черновика до регулярных публикаций</p>
          <h1 className="mt-4 font-display text-5xl leading-tight sm:text-6xl">Тарифы ThreadsGo</h1>
          <p className="mt-6 text-lg leading-8 text-white/70">Начните с Basic: 3 дня пробного периода, затем 1 490 ₽ в месяц. До подключения можно бесплатно попробовать генератор идей — без входа и карты.</p>
          <Link to="/threads-ideas-generator/" className="mt-6 inline-block text-[#b7ff91] underline underline-offset-4">Попробовать генератор идей →</Link>
        </header>
        <section className="grid gap-5 lg:grid-cols-3" aria-label="Сравнение тарифов">
          {Object.entries(planCopy).map(([key, plan]) => (
            <article key={key} className={`rounded-3xl border p-6 text-[#111] ${plan.tone}`}>
              <h2 className="font-display text-3xl">{plan.title}</h2>
              <p className="mt-3 text-sm font-medium">{plan.subtitle}</p>
              <p className="mt-5 font-semibold leading-7">{plan.price}</p>
              <p className="mt-4 text-sm leading-6 text-[#526056]">{plan.body}</p>
              <Link to="/login?intent=start" data-analytics-cta="start_trial" className="mt-6 block rounded-full bg-[#111] px-5 py-4 text-center text-sm font-semibold text-white hover:bg-[#17382b]">{key === "basic" ? "Начать пробный период" : `Выбрать ${plan.title}`}</Link>
            </article>
          ))}
        </section>
        <section className="mt-12 rounded-3xl border border-white/15 p-6 sm:p-8">
          <h2 className="font-display text-3xl">Как включить доступ</h2>
          <ol className="mt-6 grid gap-6 text-sm leading-7 text-white/75 md:grid-cols-3">
            <li><strong className="block text-white">1. Войдите через Telegram</strong>Подтвердите вход у бота. На сайте откроется выбор тарифа.</li>
            <li><strong className="block text-white">2. Подключите тариф в Tribute</strong>Завершите привязку карты и активацию. Нажмите кнопку доступа к каналу тарифа и вступите в него.</li>
            <li><strong className="block text-white">3. Вернитесь на сайт</strong>Мы проверим доступ. Затем создайте проект, подключите профиль Threads и получите первый черновик.</li>
          </ol>
        </section>
        <section className="grid gap-8 py-12 text-sm leading-7 text-white/70 md:grid-cols-2">
          <div><h2 className="font-display text-2xl text-white">Без неожиданного продления</h2><p className="mt-3">Пробный период начинается в Tribute. Проверьте дату и сумму следующего списания перед подтверждением. Отменить автоматическое продление можно в Tribute. Подарочные дни ThreadsGo не меняют дату списания в Tribute.</p></div>
          <div><h2 className="font-display text-2xl text-white">Что нужно учитывать</h2><p className="mt-3">Мы ограничиваем активность и приостанавливаем действия при проблемах. Meta меняет правила обнаружения автоматизации: ограничения и блокировка аккаунта возможны. ThreadsGo не гарантирует охваты, продажи или сохранность аккаунта.</p></div>
        </section>
        <footer className="flex flex-wrap gap-6 border-t border-white/10 py-8 text-sm text-white/60"><Link to="/resources/">Бесплатные инструменты</Link><Link to="/blog/">Материалы о Threads</Link><Link to="/terms/">Условия</Link><a href="https://t.me/cuartenlol" target="_blank" rel="noreferrer">Поддержка</a></footer>
      </div>
    </main>
  );
}
