import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const counterId = process.env.VITE_YANDEX_METRIKA_ID || await readEnvValue("VITE_YANDEX_METRIKA_ID");
const dist = join(process.cwd(), "dist");

if (!counterId) {
  console.log("Yandex Metrika injection skipped: VITE_YANDEX_METRIKA_ID is empty.");
  process.exit(0);
}

// Analytics is mounted by SeoAnalytics only after explicit cookie permission.
// Keep only the counter ID in static HTML; do not send a noscript tracking pixel.
const headSnippet = `<meta name="threadsgo-metrika-id" content="${counterId}">`;

const htmlFiles = await findHtmlFiles(dist);
let injected = 0;

for (const file of htmlFiles) {
  if (/[/\\]yandex_[^/\\]+\.html$/.test(file)) continue;

  let html = await readFile(file, "utf8");
  if (html.includes(`mc.yandex.com/metrika/tag.js?id=${counterId}`)) continue;

  html = html.replace("</head>", `${headSnippet}\n  </head>`);

  await writeFile(file, html);
  injected += 1;
}

console.log(`Consent-gated Metrika configuration added to ${injected} HTML files.`);

async function findHtmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await findHtmlFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(path);
  }
  return files;
}

async function readEnvValue(key) {
  try {
    const env = await readFile(join(process.cwd(), ".env"), "utf8");
    const line = env
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${key}=`));
    return line?.slice(key.length + 1).replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}
