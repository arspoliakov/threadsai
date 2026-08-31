import { Link } from "react-router-dom";

import { publishedSeoArticles } from "../../seo/articles";
import { seoPages } from "../../seo/site";

const tools = [
  "/threads-ideas-generator/",
  "/threads-content-plan/",
  "/threads-post-generator/",
  "/threads-hook-analyzer/",
  "/personal-brand-strategy-generator/",
];

const commercialPages = [
  "/direct/autoposting-social-media/",
  "/direct/ai-post-generator/",
  "/direct/threads-recommendations/",
  "/ai-for-threads/",
  "/ai-posts-for-threads/",
  "/automatic-threads-management/",
  "/threads-content-automation/",
  "/threads-for-business/",
  "/threads-for-small-business/",
];

const productPages = [
  "/threads-autoposting/",
  "/threads-trends/",
  "/threads-scheduler/",
  "/personal-brand/",
  "/personal-brand-for-experts/",
  "/compare/",
  "/research/",
];

const nichePages = [
  "/for-smm/",
  "/for-marketers/",
  "/for-agencies/",
  "/for-psychologists/",
  "/for-lawyers/",
  "/for-photographers/",
  "/for-consultants/",
  "/for-tutors/",
  "/for-cosmetologists/",
];

function pagesByPath(paths: string[]) {
  return paths.map((path) => seoPages.find((page) => page.path === path)).filter(Boolean) as typeof seoPages;
}

export default function ResourcesPage() {
  return (
    <main className="min-h-screen bg-[#f5f6f1] text-[#07100e]">
      <header className="border-b border-[#d9ddd4] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <Link to="/" className="flex items-center gap-3 font-display text-2xl">
            <img src="/threadsgo-logo.png" alt="" className="h-9 w-9 object-contain" />
            ThreadsGo
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link to="/blog/" className="hidden text-[#526056] hover:text-[#07100e] sm:block">Блог</Link>
            <Link to="/login" className="rounded-full bg-[#07100e] px-5 py-3 text-white hover:bg-[#17382b]">Начать</Link>
          </div>
        </div>
      </header>

      <section className="border-b border-[#d9ddd4] bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <nav className="mb-8 text-sm text-[#69766e]" aria-label="Хлебные крошки">
            <Link to="/" className="hover:text-[#07100e]">Главная</Link>
            <span className="mx-2">/</span>
            <span>Ресурсы</span>
          </nav>
          <p className="mb-5 text-sm font-semibold uppercase tracking-[0.16em] text-[#377457]">ThreadsGo</p>
          <h1 className="max-w-4xl font-display text-5xl leading-[0.94] sm:text-7xl">
            Все материалы и инструменты ThreadsGo
          </h1>
          <p className="mt-7 max-w-3xl text-lg leading-8 text-[#526056]">
            Собрали всё в одном месте: бесплатные инструменты, статьи, страницы по нишам и разборы того,
            как вести Threads регулярнее без ощущения, что вы каждый день начинаете с пустого листа.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-16 px-5 py-14 sm:px-8">
        <section className="rounded-[2rem] border border-[#c8d6cb] bg-[#07100e] p-6 text-white shadow-[0_24px_80px_rgba(7,16,14,0.16)] sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="text-sm uppercase tracking-[0.14em] text-[#7eff3a]">Быстрый старт</p>
              <h2 className="mt-2 max-w-3xl font-display text-4xl sm:text-5xl">Ищете ИИ для Threads или автопостинг?</h2>
              <p className="mt-4 max-w-2xl leading-7 text-white/70">
                Начните с этих страниц: они коротко объясняют, как ThreadsGo помогает писать посты,
                вести очередь и не терять контроль над аккаунтом.
              </p>
            </div>
            <Link to="/login" className="rounded-full bg-[#7eff3a] px-6 py-3.5 text-sm font-semibold uppercase tracking-[0.14em] text-[#07100e] hover:bg-white">
              Попробовать
            </Link>
          </div>
          <div className="mt-7 grid gap-3 md:grid-cols-3">
            {pagesByPath(commercialPages).map((page) => (
              <Link key={page.path} to={page.path} className="rounded-2xl border border-white/10 bg-white/[0.06] p-5 hover:border-[#7eff3a]/70">
                <h3 className="font-display text-2xl">{page.h1}</h3>
                <p className="mt-3 line-clamp-3 text-sm leading-6 text-white/68">{page.description}</p>
              </Link>
            ))}
          </div>
        </section>
        <ResourceSection title="Бесплатные инструменты" items={pagesByPath(tools)} />
        <ResourceSection title="Как работает ThreadsGo" items={pagesByPath(productPages)} />
        <ResourceSection title="Страницы по нишам" items={pagesByPath(nichePages)} />

        <section>
          <div className="flex flex-wrap items-end justify-between gap-4 border-t border-[#aeb8b0] pt-7">
            <div>
              <p className="text-sm uppercase tracking-[0.14em] text-[#69766e]">Гайды</p>
              <h2 className="mt-2 font-display text-4xl">Статьи про Threads и контент</h2>
            </div>
            <Link to="/blog/" className="rounded-full border border-[#aeb8b0] px-5 py-3 text-sm hover:border-[#07100e]">
              Открыть блог
            </Link>
          </div>
          <div className="mt-7 grid gap-5 md:grid-cols-2">
            {publishedSeoArticles.map((article) => (
              <Link key={article.path} to={article.path} className="border-t border-[#d9ddd4] py-5 hover:text-[#377457]">
                <p className="text-sm text-[#69766e]">{article.readingMinutes} минут</p>
                <h3 className="mt-2 font-display text-3xl">{article.h1}</h3>
                <p className="mt-3 line-clamp-3 leading-7 text-[#526056]">{article.lead}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <footer className="border-t border-[#d9ddd4] px-5 py-7 text-center text-xs leading-5 text-[#69766e]">
        *Деятельность Meta, включая Threads, запрещена в России как деятельность экстремистской организации.
      </footer>
    </main>
  );
}

function ResourceSection({ title, items }: { title: string; items: typeof seoPages }) {
  return (
    <section>
      <div className="border-t border-[#aeb8b0] pt-7">
        <p className="text-sm uppercase tracking-[0.14em] text-[#69766e]">Раздел</p>
        <h2 className="mt-2 font-display text-4xl">{title}</h2>
      </div>
      <div className="mt-7 grid gap-5 md:grid-cols-2">
        {items.map((page) => (
          <Link key={page.path} to={page.path} className="border-t border-[#d9ddd4] py-5 hover:text-[#377457]">
            <h3 className="font-display text-3xl">{page.h1}</h3>
            <p className="mt-3 line-clamp-3 leading-7 text-[#526056]">{page.lead || page.description}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
