import { readFile } from "node:fs/promises";
import { join } from "node:path";

const dist = join(process.cwd(), "dist");
const sitemap = await readFile(join(dist, "sitemap.xml"), "utf8");
const urls = [...sitemap.matchAll(/<loc>https:\/\/threadsgo\.ru([^<]*)<\/loc>/g)].map((match) => match[1] || "/");
const seenTitles = new Set();
const seenDescriptions = new Set();
const failures = [];
const requiredPaths = [
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
];

for (const path of urls) {
  const file = path === "/" ? join(dist, "index.html") : join(dist, path.replace(/^\/|\/$/g, ""), "index.html");
  const html = await readFile(file, "utf8");
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

for (const path of requiredPaths) {
  if (!urls.includes(path)) failures.push(`${path}: обязательная страница отсутствует в sitemap`);
}

const login = await readFile(join(dist, "login", "index.html"), "utf8");
if (!login.includes('<meta name="robots" content="noindex,follow">')) failures.push("/login: отсутствует noindex,follow");
if (sitemap.includes("https://threadsgo.ru/login")) failures.push("/login ошибочно находится в sitemap");

const notFound = await readFile(join(dist, "404.html"), "utf8");
if (!notFound.includes('<meta name="robots" content="noindex,follow">')) failures.push("404.html: отсутствует noindex,follow");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`SEO-проверка пройдена: ${urls.length} индексируемых страниц.`);
}
