import { renderToReadableStream } from "react-dom/server";
import { StaticRouter } from "react-router-dom";

import App from "./App";
import { DEFAULT_OG_IMAGE, findSeoPage, seoPages, SITE_URL, systemSeoPages } from "./seo/site";
import { findSeoArticle, publishedSeoArticles } from "./seo/articles";

export const prerenderPaths = [...seoPages.map((page) => page.path), ...publishedSeoArticles.map((article) => article.path), ...systemSeoPages.map((page) => page.path)];

export async function render(url: string): Promise<string> {
  const stream = await renderToReadableStream(
    <StaticRouter location={url}>
      <App />
    </StaticRouter>,
  );
  await stream.allReady;
  return new Response(stream).text();
}

export function getSeoDocument(url: string) {
  const page = findSeoPage(url);
  const title = page?.title ?? "Страница не найдена | ThreadsGo";
  const description = page?.description ?? "Запрошенная страница не найдена.";
  const canonical = `${SITE_URL}${page?.path ?? url}`;
  const robots = page?.index === false || !page ? "noindex,follow" : "index,follow";
  const article = findSeoArticle(url);
  const schema =
    article
      ? [
          {
            "@context": "https://schema.org",
            "@type": "Article",
            headline: article.h1,
            description: article.description,
            datePublished: article.publishedAt,
            dateModified: article.updatedAt,
            author: { "@type": "Organization", name: "ThreadsGo" },
            mainEntityOfPage: canonical,
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Главная", item: SITE_URL },
              { "@type": "ListItem", position: 2, name: "Блог", item: `${SITE_URL}/blog/` },
              { "@type": "ListItem", position: 3, name: article.h1, item: canonical },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: article.faq.map((item) => ({
              "@type": "Question",
              name: item.question,
              acceptedAnswer: { "@type": "Answer", text: item.answer },
            })),
          },
        ]
      : page && page.kind !== "system"
      ? [
          {
            "@context": "https://schema.org",
            "@type": page.kind === "legal" || page.kind === "hub" ? "WebPage" : "SoftwareApplication",
            name: page.h1,
            url: canonical,
            description,
            applicationCategory: page.kind === "legal" || page.kind === "hub" ? undefined : "BusinessApplication",
            operatingSystem: page.kind === "legal" || page.kind === "hub" ? undefined : "Web",
          },
          ...(page.path !== "/"
            ? [{
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                itemListElement: [
                  { "@type": "ListItem", position: 1, name: "Главная", item: SITE_URL },
                  { "@type": "ListItem", position: 2, name: page.h1, item: canonical },
                ],
              }]
            : []),
        ]
      : undefined;

  return {
    title,
    description,
    canonical,
    robots,
    updatedAt: page?.updatedAt,
    ogImage: `${SITE_URL}${DEFAULT_OG_IMAGE}`,
    ogType: article ? "article" : "website",
    schema,
  };
}
