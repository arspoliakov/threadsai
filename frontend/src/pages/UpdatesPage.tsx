import { Link } from "react-router-dom";
import { productUpdates } from "../productUpdates";
import { ThemeToggle } from "../components/ThemeToggle";

const formatDate = (date: string) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" }).format(new Date(`${date}T12:00:00+03:00`));

export default function UpdatesPage() {
  return <main className="home-refresh public-reader min-h-screen bg-[#f5f6f1] text-[#111]">
    <nav aria-label="Основная навигация" className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-5 py-6 sm:px-8">
      <Link to="/" className="font-display text-2xl">ThreadsGo</Link>
      <div className="flex flex-wrap items-center gap-5 text-sm text-[#53604f]"><Link to="/pricing/">Тарифы</Link><Link to="/app">Личный кабинет →</Link><ThemeToggle /></div>
    </nav>
    <header className="tg-reveal mx-auto max-w-5xl px-5 pb-12 pt-8 sm:px-8 sm:pt-14">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#4f7442]">Сервис развивается</p>
      <h1 className="mt-4 font-display text-5xl leading-none tracking-[-0.04em] sm:text-6xl">Что нового в ThreadsGo</h1>
      <p className="mt-6 max-w-2xl text-base leading-7 text-[#657160]">Новые возможности и улучшения, которые уже появились в сервисе. Рассказываем, что изменилось и как это поможет в работе.</p>
    </header>
    <section aria-label="История обновлений" className="mx-auto max-w-5xl space-y-7 px-5 pb-16 sm:px-8">
      {productUpdates.map((update, index) => <article key={update.id} id={update.id} className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-8">
        <div className="pt-1 sm:pt-6"><time dateTime={update.date} className="block text-sm font-medium text-[#55644e]">{formatDate(update.date)}</time>{index === 0 ? <span className="mt-3 inline-block rounded-full bg-[#d9f8c8] px-3 py-1 text-xs text-[#315b22]">Последнее обновление</span> : null}</div>
        <div className="rounded-[26px] border border-[#dfe4dc] bg-white p-5 shadow-sm sm:p-7">
          <p className="text-xs font-medium text-[#4c7440]">{update.label}</p>
          <h2 className="mt-3 font-display text-3xl leading-tight tracking-[-0.025em]">{update.title}</h2>
          <p className="mt-4 text-sm leading-7 text-[#5d6957]">{update.description}</p>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-[#46533f]">{update.details.map(detail => <li key={detail}>{detail}</li>)}</ul>
          {"action" in update && update.action ? update.action.to.includes("#")
            ? <a href={update.action.to} className="mt-6 inline-flex rounded-full bg-[#18351e] px-5 py-3 text-sm text-white transition hover:bg-[#305d28]">{update.action.label} →</a>
            : <Link to={update.action.to} className="mt-6 inline-flex rounded-full bg-[#18351e] px-5 py-3 text-sm text-white transition hover:bg-[#305d28]">{update.action.label} →</Link> : null}
        </div>
      </article>)}
    </section>
    <footer className="mx-auto flex max-w-5xl flex-wrap gap-5 border-t border-[#dfe4dc] px-5 py-7 text-xs text-[#657160] sm:px-8"><Link to="/resources/">Бесплатные инструменты</Link><Link to="/terms">Условия</Link><a href="https://t.me/cuartenlol" target="_blank" rel="noreferrer">Предложить улучшение</a></footer>
  </main>;
}
