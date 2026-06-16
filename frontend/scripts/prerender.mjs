import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const dist = join(root, "dist");
const serverBundle = join(root, "dist-ssr", "entry-server.js");
const template = await readFile(join(dist, "index.html"), "utf8");
const { getSeoDocument, prerenderPaths, render } = await import(pathToFileURL(serverBundle));

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function buildHead(seo) {
  const schema = seo.schema
    ? `<script type="application/ld+json">${JSON.stringify(seo.schema).replaceAll("<", "\\u003c")}</script>`
    : "";
  return [
    `<title>${escapeHtml(seo.title)}</title>`,
    `<meta name="description" content="${escapeHtml(seo.description)}">`,
    `<meta name="robots" content="${seo.robots}">`,
    `<link rel="canonical" href="${seo.canonical}">`,
    `<meta property="og:type" content="${seo.ogType}">`,
    `<meta property="og:locale" content="ru_RU">`,
    `<meta property="og:site_name" content="ThreadsGo">`,
    `<meta property="og:title" content="${escapeHtml(seo.title)}">`,
    `<meta property="og:description" content="${escapeHtml(seo.description)}">`,
    `<meta property="og:url" content="${seo.canonical}">`,
    `<meta property="og:image" content="${seo.ogImage}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(seo.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(seo.description)}">`,
    schema,
  ].join("\n    ");
}

function stripManagedHead(html) {
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta\s+(?:name|property)="(?:description|robots|og:[^"]+|twitter:[^"]+)"[^>]*>/gi, "")
    .replace(/<link\s+rel="canonical"[^>]*>/gi, "")
    .replace(/<script\s+type="application\/ld\+json">[\s\S]*?<\/script>/gi, "");
}

for (const path of prerenderPaths) {
  const seo = getSeoDocument(path);
  const appHtml = await render(path);
  const html = stripManagedHead(template)
    .replace("</head>", `    ${buildHead(seo)}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`);
  const output = path === "/" ? join(dist, "index.html") : join(dist, path.replace(/^\/|\/$/g, ""), "index.html");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html, "utf8");
}

const notFoundSeo = getSeoDocument("/not-found");
const notFoundHtml = stripManagedHead(template)
  .replace("</head>", `    ${buildHead(notFoundSeo)}\n  </head>`)
  .replace('<div id="root"></div>', `<div id="root">${await render("/not-found")}</div>`);
await writeFile(join(dist, "404.html"), notFoundHtml, "utf8");

const sitemapPages = prerenderPaths
  .map((path) => ({ path, seo: getSeoDocument(path) }))
  .filter(({ seo }) => seo.robots === "index,follow")
  .map(({ path, seo }) => `  <url><loc>https://threadsgo.ru${path}</loc><lastmod>${seo.updatedAt}</lastmod></url>`)
  .join("\n");
await writeFile(
  join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapPages}\n</urlset>\n`,
);
await writeFile(join(dist, "robots.txt"), "User-agent: *\nAllow: /\nDisallow: /app/\n\nSitemap: https://threadsgo.ru/sitemap.xml\n");
await rm(join(root, "dist-ssr"), { recursive: true, force: true });
