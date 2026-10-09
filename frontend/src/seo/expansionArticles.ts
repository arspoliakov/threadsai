import type { SeoArticle } from "./articles";
import { withIllustration } from "./octoberArticles";
import marketing from "./expansionMarketing.json";
import formats from "./expansionFormats.json";
import planning from "./expansionPlanning.json";

// The batches are checked against their Wordstat manifest before publication.
const groups = [marketing, formats, planning] as SeoArticle[][];
const illustrationGroups = [3, 2, 0];
export const expansionSeoArticles: SeoArticle[] = [];
for (let row = 0; row < Math.max(...groups.map((group) => group.length)); row += 1) {
  groups.forEach((group, index) => {
    const article = group[row];
    if (article) expansionSeoArticles.push(withIllustration(article, illustrationGroups[index]));
  });
}
