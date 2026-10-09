import { Link, useLocation } from "react-router-dom";
import { useState } from "react";
import { ThemeToggle } from "../../components/ThemeToggle";

import PublicSeoTool from "../../components/PublicSeoTool";
import { publishedSeoArticles } from "../../seo/articles";
import { findSeoPage } from "../../seo/site";

const relatedLinks = [
  { to: "/blog/threads-first-post/", label: "Подготовить первый пост" },
  { to: "/threads-content-plan/", label: "Собрать контент-план" },
  { to: "/threads-autoposting/", label: "Настроить автопостинг" },
];

export default function SeoLandingPage() {
  const location = useLocation();
  const page = findSeoPage(location.pathname);
  const [articleQuery, setArticleQuery] = useState("");
  const [articleCategory, setArticleCategory] = useState("all");
  const visibleArticles = publishedSeoArticles.filter((article) =>
    (articleCategory === "all" || articleCategory === articleCategoryFor(article.path)) &&
    `${article.h1} ${article.description}`
      .toLocaleLowerCase("ru")
      .includes(articleQuery.trim().toLocaleLowerCase("ru")),
  );

  if (!page) return null;

  return (
    <main className="public-reader min-h-screen bg-[#f5f6f1] text-[#07100e]">
      <header className="border-b border-[#d9ddd4] bg-white/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <Link
            to="/"
            className="flex items-center gap-2 font-display text-xl sm:gap-3 sm:text-2xl"
          >
            <img
              src="/threadsgo-logo.png"
              alt=""
              className="h-8 w-8 object-contain sm:h-9 sm:w-9"
            />
            ThreadsGo
          </Link>
          <div className="flex items-center gap-2 text-sm sm:gap-4">
            <ThemeToggle />
            <Link
              to="/blog/"
              className="hidden text-[#526056] hover:text-[#07100e] sm:block"
            >
              Блог
            </Link>
            <Link
              to="/resources/"
              className="hidden text-[#526056] hover:text-[#07100e] sm:block"
            >
              Ресурсы
            </Link>
            <Link
              to="/register?intent=start"
              data-analytics-cta="start_trial"
              className="home-primary rounded-full bg-[#07100e] px-4 py-3 text-white hover:bg-[#17382b] sm:px-5"
            >
              Начать
            </Link>
          </div>
        </div>
      </header>

      <article>
        <section className="border-b border-[#d9ddd4] bg-white">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
            <nav
              className="mb-8 text-sm text-[#69766e]"
              aria-label="Хлебные крошки"
            >
              <Link to="/" className="hover:text-[#07100e]">
                Главная
              </Link>
              <span className="mx-2">/</span>
              <span>{page.h1}</span>
            </nav>
            <p className="mb-5 text-sm font-semibold uppercase tracking-[0.16em] text-[#377457]">
              {page.kind === "tool" ? "Бесплатный инструмент" : "ThreadsGo"}
            </p>
            <h1 className="max-w-4xl font-display text-5xl leading-[0.94] sm:text-7xl">
              {page.h1}
            </h1>
            <p className="mt-7 max-w-3xl text-lg leading-8 text-[#526056]">
              {page.lead}
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                to="/register?intent=start"
                data-analytics-cta="start_trial"
                className="home-primary rounded-full bg-[#07100e] px-6 py-3.5 text-sm text-white hover:bg-[#17382b]"
              >
                Попробовать ThreadsGo
              </Link>
              <Link
                to="/pricing/"
                className="rounded-full border border-[#aeb8b0] px-6 py-3.5 text-sm hover:border-[#07100e]"
              >
                Посмотреть тарифы
              </Link>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-5 px-5 py-14 sm:px-8 md:grid-cols-2">
          {(page.sections ?? defaultSections).map((section) => (
            <section
              key={section.title}
              className="border-t border-[#aeb8b0] py-6"
            >
              <h2 className="font-display text-3xl">{section.title}</h2>
              {"text" in section && (
                <p className="mt-4 max-w-xl leading-7 text-[#526056]">
                  {section.text}
                </p>
              )}
            </section>
          ))}
        </section>

        <PublicSeoTool path={page.path} />

        {page.path === "/blog/" && (
          <section className="mx-auto max-w-6xl px-5 pb-14 sm:px-8">
            <h2 className="font-display text-4xl">Новые материалы</h2>
            <label className="mt-6 block max-w-xl text-sm font-medium">
              Найти статью
              <input
                type="search"
                value={articleQuery}
                onChange={(event) => setArticleQuery(event.target.value)}
                placeholder="Например, профиль, статистика или промпт"
                className="mt-2 w-full rounded-xl border border-[#aeb8b0] bg-white px-4 py-3 text-base text-[#07100e]"
              />
            </label>
            <p className="mt-3 text-sm text-[#69766e]" role="status">
              {visibleArticles.length
                ? `Материалов: ${visibleArticles.length}`
                : "Ничего не найдено. Попробуйте более короткий запрос."}
            </p>
            <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Темы статей">
              {[["all", "Все статьи"], ["threads", "Threads"], ["planning", "Контент-планы"], ["ai", "ИИ и тексты"]].map(([value, label]) => <button key={value} type="button" aria-pressed={articleCategory === value} onClick={() => setArticleCategory(value)} className={`min-h-11 rounded-full border border-[#aeb8b0] px-4 text-sm ${articleCategory === value ? "home-primary bg-[#07100e] text-white" : "bg-white text-[#07100e]"}`}>{label}</button>)}
            </div>
            <div className="mt-7 grid gap-5 md:grid-cols-2">
              {visibleArticles.map((article) => (
                <Link
                  key={article.path}
                  to={article.path}
                  className="border-t border-[#aeb8b0] py-6"
                >
                  {article.image && <img src={article.image.src} alt="" width={article.image.width} height={article.image.height} loading="lazy" decoding="async" className="mb-5 aspect-[8/5] w-full rounded-2xl object-cover" />}
                  <p className="text-sm text-[#69766e]">
                    {article.readingMinutes} мин.
                  </p>
                  <h3 className="mt-3 font-display text-3xl">{article.h1}</h3>
                  <p className="mt-4 leading-7 text-[#526056]">
                    {article.lead}
                  </p>
                  <span className="mt-5 inline-block text-sm font-semibold">
                    Читать →
                  </span>
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
                <Link
                  key={link.to}
                  to={link.to}
                  className="border-t border-[#aeb8b0] py-5 text-lg hover:text-[#377457]"
                >
                  {link.label} <span aria-hidden="true">→</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </article>

      <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 px-5 py-8 text-xs leading-5 text-[#69766e] sm:px-8">
        <p>
          *Meta Platforms Inc. признана экстремистской организацией; её деятельность запрещена в России.
        </p>
        <Link to="/terms">Условия и конфиденциальность</Link>
      </footer>
    </main>
  );
}

function articleCategoryFor(path: string) {
  if (/\/blog\/(?:content-plan|content-rubrics|threads-posting-schedule)/.test(path)) return "planning";
  if (/\/blog\/(?:ai-|how-to-write|personal-brand-strategy)/.test(path)) return "ai";
  return "threads";
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
