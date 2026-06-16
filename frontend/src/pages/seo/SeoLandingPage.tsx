import { Link, useLocation } from "react-router-dom";

import PublicSeoTool from "../../components/PublicSeoTool";
import { publishedSeoArticles } from "../../seo/articles";
import { findSeoPage } from "../../seo/site";

const relatedLinks = [
  { to: "/threads-ideas-generator/", label: "Найти идеи для постов" },
  { to: "/threads-content-plan/", label: "Собрать контент-план" },
  { to: "/threads-autoposting/", label: "Настроить автопостинг" },
];

export default function SeoLandingPage() {
  const location = useLocation();
  const page = findSeoPage(location.pathname);

  if (!page) return null;

  return (
    <main className="min-h-screen bg-[#f5f6f1] text-[#07100e]">
      <header className="border-b border-[#d9ddd4] bg-white/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <Link to="/" className="flex items-center gap-3 font-display text-2xl">
            <img src="/threadsgo-logo.png" alt="" className="h-9 w-9 object-contain" />
            ThreadsGo
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link to="/blog/" className="hidden text-[#526056] hover:text-[#07100e] sm:block">
              Блог
            </Link>
            <Link to="/resources/" className="hidden text-[#526056] hover:text-[#07100e] sm:block">
              Ресурсы
            </Link>
            <Link to="/login" className="rounded-full bg-[#07100e] px-5 py-3 text-white hover:bg-[#17382b]">
              Начать
            </Link>
          </div>
        </div>
      </header>

      <article>
        <section className="border-b border-[#d9ddd4] bg-white">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
            <nav className="mb-8 text-sm text-[#69766e]" aria-label="Хлебные крошки">
              <Link to="/" className="hover:text-[#07100e]">Главная</Link>
              <span className="mx-2">/</span>
              <span>{page.h1}</span>
            </nav>
            <p className="mb-5 text-sm font-semibold uppercase tracking-[0.16em] text-[#377457]">
              {page.kind === "tool" ? "Бесплатный инструмент" : "ThreadsGo"}
            </p>
            <h1 className="max-w-4xl font-display text-5xl leading-[0.94] sm:text-7xl">{page.h1}</h1>
            <p className="mt-7 max-w-3xl text-lg leading-8 text-[#526056]">{page.lead}</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link to="/login" className="rounded-full bg-[#07100e] px-6 py-3.5 text-sm text-white hover:bg-[#17382b]">
                Попробовать ThreadsGo
              </Link>
              <Link to="/threads-ideas-generator/" className="rounded-full border border-[#aeb8b0] px-6 py-3.5 text-sm hover:border-[#07100e]">
                Начать с идей
              </Link>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-5 px-5 py-14 sm:px-8 md:grid-cols-2">
          {(page.sections ?? defaultSections).map((section) => (
            <section key={section.title} className="border-t border-[#aeb8b0] py-6">
              <h2 className="font-display text-3xl">{section.title}</h2>
              {"text" in section && <p className="mt-4 max-w-xl leading-7 text-[#526056]">{section.text}</p>}
            </section>
          ))}
        </section>

        <PublicSeoTool path={page.path} />

        {page.path === "/blog/" && (
          <section className="mx-auto max-w-6xl px-5 pb-14 sm:px-8">
            <h2 className="font-display text-4xl">Новые материалы</h2>
            <div className="mt-7 grid gap-5 md:grid-cols-2">
              {publishedSeoArticles.map((article) => (
                <Link key={article.path} to={article.path} className="border-t border-[#aeb8b0] py-6">
                  <p className="text-sm text-[#69766e]">{article.readingMinutes} минут</p>
                  <h3 className="mt-3 font-display text-3xl">{article.h1}</h3>
                  <p className="mt-4 leading-7 text-[#526056]">{article.lead}</p>
                  <span className="mt-5 inline-block text-sm font-semibold">Читать →</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="border-y border-[#d9ddd4] bg-white">
          <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
            <h2 className="font-display text-4xl">Что посмотреть дальше</h2>
            <div className="mt-7 grid gap-3 md:grid-cols-3">
              {relatedLinks.map((link) => (
                <Link key={link.to} to={link.to} className="border-t border-[#aeb8b0] py-5 text-lg hover:text-[#377457]">
                  {link.label} <span aria-hidden="true">→</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </article>

      <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 px-5 py-8 text-xs leading-5 text-[#69766e] sm:px-8">
        <p>*Деятельность Meta, включая Threads, запрещена в России как деятельность экстремистской организации.</p>
        <Link to="/terms">Условия и конфиденциальность</Link>
      </footer>
    </main>
  );
}

const defaultSections = [
  {
    title: "Под задачу, а не ради текста",
    text: "Каждая идея и публикация получает понятную роль: привлечь внимание, показать экспертизу, вызвать разговор или мягко познакомить с продуктом.",
  },
  {
    title: "Живой результат можно менять",
    text: "ThreadsGo хранит контекст проекта и даёт контролировать тексты. Пост можно отредактировать, переписать или убрать из очереди.",
  },
];
