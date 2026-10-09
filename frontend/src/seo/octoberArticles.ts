import type { SeoArticle } from "./articles";
import plans from "./octoberPlans.json";
import threads from "./octoberThreads.json";
import ai from "./octoberAi.json";

const illustrations = {
  planning: { src: "/blog/images/planning-2026-10.webp", alt: "Календарь и карточки публикаций в мятных и тёмно-зелёных оттенках" },
  threads: { src: "/blog/images/threads-2026-10.webp", alt: "Объёмные экраны и облака сообщений на тёмно-зелёном фоне" },
  security: { src: "/blog/images/security-2026-10.webp", alt: "Защитный щит рядом с карточкой профиля и замком" },
  ai: { src: "/blog/images/ai-2026-10.webp", alt: "Открытый блокнот, карточки текста и светящийся шар" },
  marketing: { src: "/blog/images/marketing-2026-10.webp", alt: "Мятное облако сообщения соединено стеклянными дорожками с четырьмя группами читателей" },
};

export function withIllustration(article: SeoArticle, group: number): SeoArticle {
  const kind = group === 0 || article.path.includes("content-plan-") || article.path.includes("content-rubrics")
    ? "planning"
    : group === 3 ? "marketing" : group === 2 ? "ai"
    : /login|recovery|blocked|registration|visitors|rules|instagram-connection/.test(article.path)
      ? "security" : "threads";
  const text = [article.lead, ...article.sections.flatMap((section) => [
    section.title, ...(section.paragraphs ?? []), ...(section.bullets ?? []), section.example ?? "",
  ]), ...article.faq.flatMap((item) => [item.question, item.answer])].join(" ");
  const readingMinutes = Math.max(2, Math.ceil(text.trim().split(/\s+/).length / 180));
  return { ...article, readingMinutes, image: { ...illustrations[kind], width: 1586, height: 992 } };
}

// The JSON batches are checked against the publication manifest before deployment.
const groups = [plans, threads, ai] as SeoArticle[][];
export const octoberSeoArticles: SeoArticle[] = [];
for (let row = 0; row < Math.max(...groups.map((group) => group.length)); row += 1) {
  groups.forEach((group, index) => {
    const article = group[row];
    if (article) octoberSeoArticles.push(withIllustration(article, index));
  });
}
