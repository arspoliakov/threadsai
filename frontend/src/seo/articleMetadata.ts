import type { SeoArticle } from "./articles";
import metadata from "../../.generated/article-metadata.json";

type ArticleMetadata = Pick<SeoArticle, "path" | "title" | "description" | "h1" | "lead" | "publishedAt" | "updatedAt" | "image">;
const articles: ArticleMetadata[] = metadata;
export function findArticleMetadata(path: string) {
  const normalized = path.endsWith("/") ? path : `${path}/`;
  return articles.find((article) => article.path === normalized);
}
