import { readFile } from "node:fs/promises";
import { join } from "node:path";

const dist = join(process.cwd(), "dist");
const sitemap = await readFile(join(dist, "sitemap.xml"), "utf8");
const urls = [...sitemap.matchAll(/<loc>https:\/\/threadsgo\.ru([^<]*)<\/loc>/g)].map((match) => match[1] || "/");
const seenTitles = new Set();
const seenDescriptions = new Set();
const failures = [];
const htmlByPath = new Map();
const requiredPaths = [
  "/pricing/",
  "/updates/",
  "/threads-autoposting/",
  "/threads-post-generator/",
  "/threads-ideas-generator/",
  "/threads-content-plan/",
  "/threads-trends/",
  "/threads-scheduler/",
  "/threads-hook-analyzer/",
  "/personal-brand-strategy-generator/",
  "/resources/",
  "/personal-brand/",
  "/personal-brand-for-experts/",
  "/for-smm/",
  "/for-marketers/",
  "/for-agencies/",
  "/for-psychologists/",
  "/for-lawyers/",
  "/for-photographers/",
  "/for-consultants/",
  "/blog/",
  "/research/",
  "/compare/",
  "/blog/threads-profile-bio/",
  "/blog/threads-first-post/",
  "/blog/threads-topic-tags/",
  "/blog/threads-insights-guide/",
  "/blog/threads-low-views/",
  "/blog/threads-links-utm/",
  "/blog/instagram-post-to-threads/",
  "/blog/threads-media-posts/",
  "/blog/threads-post-chain/",
  "/blog/threads-replies-guide/",
  "/blog/threads-communities-guide/",
  "/blog/threads-content-audit/",
  "/blog/threads-competitor-analysis/",
  "/blog/threads-audience-questions/",
  "/blog/threadsgo-global-style-prompt/",
];

for (const path of urls) {
  const file = path === "/" ? join(dist, "index.html") : join(dist, path.replace(/^\/|\/$/g, ""), "index.html");
  const html = await readFile(file, "utf8");
  htmlByPath.set(path, html);
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const description = html.match(/<meta name="description" content="([^"]+)"/i)?.[1]?.trim();
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1];

  if (!title || seenTitles.has(title)) failures.push(`${path}: title отсутствует или дублируется`);
  if (!description || seenDescriptions.has(description)) failures.push(`${path}: description отсутствует или дублируется`);
  if (!html.includes("<h1")) failures.push(`${path}: отсутствует H1 в готовом HTML`);
  if (canonical !== `https://threadsgo.ru${path}`) failures.push(`${path}: неверный canonical ${canonical ?? "отсутствует"}`);
  if (!html.includes('<meta name="robots" content="index,follow">')) failures.push(`${path}: страница не помечена index,follow`);
  if (!html.includes('<meta property="og:title"')) failures.push(`${path}: отсутствует Open Graph`);
  if (!html.includes('<meta name="twitter:card" content="summary_large_image">')) failures.push(`${path}: отсутствует Twitter Card`);
  if (!html.includes("application/ld+json")) failures.push(`${path}: отсутствует schema.org`);
  if (path.startsWith("/blog/") && path !== "/blog/" && !html.includes('"@type":"Article"')) failures.push(`${path}: отсутствует Article schema`);
  if (path.startsWith("/blog/") && path !== "/blog/" && !html.includes('"@type":"FAQPage"')) failures.push(`${path}: отсутствует FAQPage schema`);

  seenTitles.add(title);
  seenDescriptions.add(description);
}

// A valid sitemap is not enough if the reader follows a broken internal link.
for (const [path, html] of htmlByPath) {
  for (const match of html.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
    const href = match[1].replaceAll("&amp;", "&");
    if (!href.startsWith("/") && !href.startsWith("#")) continue;
    const target = new URL(href, `https://threadsgo.ru${path}`);
    if (target.origin !== "https://threadsgo.ru" || target.pathname.startsWith("/app")) continue;
    const normalized = target.pathname === "/" ? "/" : `${target.pathname.replace(/\/$/, "")}/`;
    let targetHtml = htmlByPath.get(normalized);
    if (!targetHtml) {
      try { targetHtml = await readFile(join(dist, target.pathname.replace(/^\/|\/$/g, ""), "index.html"), "utf8"); }
      catch { failures.push(`${path}: ссылка ведёт на отсутствующую страницу ${href}`); continue; }
    }
    if (target.hash && !targetHtml.includes(`id="${decodeURIComponent(target.hash.slice(1))}"`)) failures.push(`${path}: отсутствует якорь ${href}`);
  }
}

for (const path of requiredPaths) {
  if (!urls.includes(path)) failures.push(`${path}: обязательная страница отсутствует в sitemap`);
}

for (const path of ["login", "register", "consent"]) {
  const html = await readFile(join(dist, path, "index.html"), "utf8");
  if (!html.includes('<meta name="robots" content="noindex,follow">')) failures.push(`/${path}: отсутствует noindex,follow`);
  if (sitemap.includes(`https://threadsgo.ru/${path}`)) failures.push(`/${path} ошибочно находится в sitemap`);
}

const notFound = await readFile(join(dist, "404.html"), "utf8");
if (!notFound.includes('<meta name="robots" content="noindex,follow">')) failures.push("404.html: отсутствует noindex,follow");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`SEO-проверка пройдена: ${urls.length} индексируемых страниц.`);
}
