import { mkdir, writeFile } from "node:fs/promises";
import { publishedSeoArticles } from "../.seo-meta-bundle/articles.js";

// Public routing and head tags need summaries, not every article's full text.
const metadata = publishedSeoArticles.map(({ path, title, description, h1, lead, publishedAt, updatedAt, image }) => ({
  path, title, description, h1, lead, publishedAt, updatedAt, ...(image ? { image } : {}),
}));
await mkdir(new URL("../.generated/", import.meta.url), { recursive: true });
await writeFile(new URL("../.generated/article-metadata.json", import.meta.url), JSON.stringify(metadata));
console.log(`Generated lightweight metadata for ${metadata.length} published articles.`);
