import { Link, useLocation } from "react-router-dom";

import { findSeoArticle } from "../../seo/articles";
import NotFoundPage from "../NotFoundPage";

export default function ArticlePage() {
  const location = useLocation();
  const article = findSeoArticle(location.pathname);
  if (!article) return <NotFoundPage />;

  return (
    <main className="min-h-screen bg-[#f5f6f1] text-[#07100e]">
      <header className="border-b border-[#d9ddd4] bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4 sm:px-8">
          <Link to="/" className="flex items-center gap-3 font-display text-2xl"><img src="/threadsgo-logo.png" alt="" className="h-9 w-9" />ThreadsGo</Link>
          <div className="flex items-center gap-4 text-sm">
            <Link to="/resources/" className="hidden text-[#526056] hover:text-[#07100e] sm:block">Ресурсы</Link>
            <Link to="/threads-ideas-generator/" className="rounded-full bg-[#07100e] px-5 py-3 text-white">Найти идеи</Link>
          </div>
        </div>
      </header>

      <article className="mx-auto max-w-5xl px-5 pb-20 pt-12 sm:px-8 sm:pt-18">
        <nav className="text-sm text-[#69766e]" aria-label="Хлебные крошки"><Link to="/">Главная</Link><span className="mx-2">/</span><Link to="/blog/">Блог</Link></nav>
        <p className="mt-10 text-sm uppercase tracking-[0.14em] text-[#377457]">ThreadsGo · Обновлено {formatDate(article.updatedAt)} · {article.readingMinutes} минут</p>
        <h1 className="mt-6 max-w-4xl font-display text-5xl leading-[0.96] sm:text-7xl">{article.h1}</h1>
        <p className="mt-7 max-w-3xl text-xl leading-9 text-[#526056]">{article.lead}</p>

        <div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,1fr)_15rem]">
          <div className="space-y-12">
            {article.sections.map((section) => (
              <section key={section.title} className="border-t border-[#aeb8b0] pt-7">
                <h2 className="font-display text-3xl sm:text-4xl">{section.title}</h2>
                {section.paragraphs?.map((paragraph) => <p key={paragraph} className="mt-5 text-base leading-8 text-[#46544b]">{paragraph}</p>)}
                {section.bullets && <ul className="mt-5 space-y-3 pl-5 text-base leading-7 text-[#46544b]">{section.bullets.map((item) => <li key={item} className="list-disc pl-1">{item}</li>)}</ul>}
                {section.example && <p className="mt-6 border-l-2 border-[#377457] bg-white px-5 py-4 leading-7 text-[#46544b]"><strong>Пример:</strong> {section.example}</p>}
              </section>
            ))}

            <section className="border-y border-[#aeb8b0] bg-white px-6 py-8 sm:px-8">
              <h2 className="font-display text-3xl">{article.cta.title}</h2>
              <p className="mt-4 max-w-2xl leading-7 text-[#526056]">{article.cta.text}</p>
              <Link to={article.cta.path} className="mt-6 inline-flex rounded-full bg-[#07100e] px-6 py-3.5 text-sm text-white">
                {article.cta.label}
              </Link>
            </section>

            <section className="border-t border-[#aeb8b0] pt-7">
              <h2 className="font-display text-3xl">Короткие ответы</h2>
              {article.faq.map((item) => <div key={item.question} className="mt-6"><h3 className="text-lg font-semibold">{item.question}</h3><p className="mt-2 leading-7 text-[#526056]">{item.answer}</p></div>)}
            </section>
          </div>

          <aside className="h-fit border-t border-[#aeb8b0] pt-5 lg:sticky lg:top-6">
            <p className="text-sm font-semibold">Продолжить</p>
            <div className="mt-3 grid gap-3 text-sm">{article.related.map((item) => <Link key={item.path} to={item.path} className="border-b border-[#d9ddd4] pb-3 text-[#526056] hover:text-[#07100e]">{item.label} →</Link>)}</div>
          </aside>
        </div>
      </article>
      <footer className="border-t border-[#d9ddd4] px-5 py-7 text-center text-xs leading-5 text-[#69766e]">
        *Деятельность Meta, включая Threads, запрещена в России как деятельность экстремистской организации.
      </footer>
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
