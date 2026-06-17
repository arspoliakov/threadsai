import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const counterId = process.env.VITE_YANDEX_METRIKA_ID || await readEnvValue("VITE_YANDEX_METRIKA_ID");
const dist = join(process.cwd(), "dist");

if (!counterId) {
  console.log("Yandex Metrika injection skipped: VITE_YANDEX_METRIKA_ID is empty.");
  process.exit(0);
}

const headSnippet = `<!-- Yandex.Metrika counter -->
<script type="text/javascript">
    (function(m,e,t,r,i,k,a){
        m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
        m[i].l=1*new Date();
        for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
        k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
    })(window, document,'script','https://mc.yandex.com/metrika/tag.js?id=${counterId}', 'ym');

    ym(${counterId}, 'init', {ssr:true, webvisor:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});
</script>
<!-- /Yandex.Metrika counter -->`;

const bodySnippet = `<noscript><div><img src="https://mc.yandex.com/watch/${counterId}" style="position:absolute; left:-9999px;" alt="" /></div></noscript>`;

const htmlFiles = await findHtmlFiles(dist);
let injected = 0;

for (const file of htmlFiles) {
  if (/[/\\]yandex_[^/\\]+\.html$/.test(file)) continue;

  let html = await readFile(file, "utf8");
  if (html.includes(`mc.yandex.com/metrika/tag.js?id=${counterId}`)) continue;

  html = html.replace("</head>", `${headSnippet}\n  </head>`);
  html = html.replace("<body>", `<body>\n    ${bodySnippet}`);
  await writeFile(file, html);
  injected += 1;
}

console.log(`Yandex Metrika injected into ${injected} HTML files.`);

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
