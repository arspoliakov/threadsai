import { readFile } from "node:fs/promises";
import { join } from "node:path";

const key = process.env.INDEXNOW_KEY?.trim();
if (!key) {
  console.error("INDEXNOW_KEY is required.");
  process.exit(1);
}

const sitemap = await readFile(join(process.cwd(), "dist", "sitemap.xml"), "utf8");
const urlList = [...sitemap.matchAll(/<loc>(https:\/\/threadsgo\.ru[^<]+)<\/loc>/g)].map((match) => match[1]);

const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    host: "threadsgo.ru",
    key,
    keyLocation: process.env.INDEXNOW_KEY_LOCATION || `https://threadsgo.ru/${key}.txt`,
    urlList,
  }),
});

if (!response.ok) {
  throw new Error(`IndexNow returned ${response.status}: ${await response.text()}`);
}

console.log(`IndexNow accepted ${urlList.length} URLs.`);
