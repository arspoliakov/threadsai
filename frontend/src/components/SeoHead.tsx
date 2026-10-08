import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { DEFAULT_OG_IMAGE, findSeoPage, SITE_URL } from "../seo/site";

function setMeta(selector: string, attribute: "name" | "property", key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.content = content;
}

export default function SeoHead() {
  const location = useLocation();

  useEffect(() => {
    const page = findSeoPage(location.pathname) ?? getAppPageMeta(location.pathname);
    const title = page?.title ?? "Страница не найдена | ThreadsGo";
    const description = page?.description ?? "Запрошенная страница не найдена.";
    const canonicalPath = page?.path ?? location.pathname;
    const canonicalUrl = `${SITE_URL}${canonicalPath === "/" ? "/" : canonicalPath}`;

    document.title = title;
    setMeta('meta[name="description"]', "name", "description", description);
    setMeta('meta[name="robots"]', "name", "robots", !page || page.index === false ? "noindex,follow" : "index,follow");
    setMeta('meta[property="og:title"]', "property", "og:title", title);
    setMeta('meta[property="og:description"]', "property", "og:description", description);
    setMeta('meta[property="og:url"]', "property", "og:url", canonicalUrl);
    setMeta('meta[name="twitter:title"]', "name", "twitter:title", title);
    setMeta('meta[name="twitter:description"]', "name", "twitter:description", description);

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;

    setMeta('meta[property="og:image"]', "property", "og:image", `${SITE_URL}${DEFAULT_OG_IMAGE}`);
    document.dispatchEvent(new Event("threadsgo:seo-ready"));
  }, [location.pathname]);

  return null;
}

function getAppPageMeta(pathname: string) {
  if (!pathname.startsWith("/app")) {
    return undefined;
  }

  const projectSection = pathname.match(/^\/app\/projects\/[^/]+(?:\/(queue|trends|settings))?\/?$/)?.[1];
  const titles: Record<string, string> = {
    "/app/setup": "Первый запуск | ThreadsGo",
    "/app/admin": "Дашборд администратора | ThreadsGo",
    "/app/admin/users": "Пользователи и подписки | ThreadsGo",
    "/app/admin/proxies": "Прокси и хранилище | ThreadsGo",
    "/app/admin/retention": "Рассылки | ThreadsGo",
    "/app": "Проекты | ThreadsGo",
    "/app/": "Проекты | ThreadsGo",
    "/app/infrastructure": "Профили Threads | ThreadsGo",
    "/app/infrastructure/": "Профили Threads | ThreadsGo",
    "/app/settings": "Настройки сервиса | ThreadsGo",
    "/app/settings/": "Настройки сервиса | ThreadsGo",
    "/app/settings/style": "Шаблон стиля | ThreadsGo",
    "/app/settings/style/": "Шаблон стиля | ThreadsGo",
    "/app/billing": "Тариф и подписка | ThreadsGo",
    "/app/billing/": "Тариф и подписка | ThreadsGo",
    "/app/studio": "Пробные черновики | ThreadsGo",
    "/app/studio/": "Пробные черновики | ThreadsGo",
    "/app/how-it-works": "Как работает ThreadsGo",
    "/app/how-it-works/": "Как работает ThreadsGo",
  };
  const projectTitles: Record<string, string> = {
    queue: "Посты | ThreadsGo",
    trends: "Источники вдохновения | ThreadsGo",
    settings: "Настройки проекта | ThreadsGo",
  };
  const title = projectSection
    ? projectTitles[projectSection]
    : /^\/app\/projects\/[^/]+\/?$/.test(pathname)
      ? "Проект | ThreadsGo"
      : titles[pathname.replace(/\/$/, "")] ?? "Кабинет | ThreadsGo";

  if (!title) {
    return undefined;
  }

  return {
    path: pathname,
    title,
    description: "Закрытый кабинет ThreadsGo.",
    h1: title,
    lead: "",
    kind: "system" as const,
    index: false,
    updatedAt: "2026-07-11",
  };
}
