import { useEffect } from "react";
import { useLocation } from "react-router-dom";

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
    ym?: ((...args: unknown[]) => void) & { a?: unknown[][]; l?: number };
  }
}

const FIRST_LANDING_KEY = "threadsgo.first_landing";
const FIRST_UTM_KEY = "threadsgo.first_utm";
const GTM_ID = import.meta.env.VITE_GTM_ID as string | undefined;
const YANDEX_METRIKA_ID = import.meta.env.VITE_YANDEX_METRIKA_ID as string | undefined;
let analyticsScriptsMounted = false;

export function trackSeoEvent(event: string, payload: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ event, ...payload });
  const counterId = getYandexCounterId();
  if (counterId && window.ym) window.ym(counterId, "reachGoal", event, payload);
}

export function getSeoAttribution() {
  if (typeof window === "undefined") return {};
  const firstLanding = window.localStorage.getItem(FIRST_LANDING_KEY);
  const storedUtm = window.localStorage.getItem(FIRST_UTM_KEY);
  let firstUtm: Record<string, unknown> = {};
  if (storedUtm) {
    try {
      firstUtm = JSON.parse(storedUtm) as Record<string, unknown>;
    } catch {
      firstUtm = {};
    }
  }
  return { first_landing: firstLanding, ...firstUtm };
}

export default function SeoAnalytics() {
  const location = useLocation();

  useEffect(() => {
    if (analyticsScriptsMounted) return;
    analyticsScriptsMounted = true;
    mountGtm();
    mountYandexMetrika();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!window.localStorage.getItem(FIRST_LANDING_KEY)) window.localStorage.setItem(FIRST_LANDING_KEY, location.pathname);
    if (!window.localStorage.getItem(FIRST_UTM_KEY)) {
      const utm = Object.fromEntries([...params.entries()].filter(([key]) => key.startsWith("utm_")));
      if (Object.keys(utm).length) window.localStorage.setItem(FIRST_UTM_KEY, JSON.stringify(utm));
    }
    trackSeoEvent("seo_page_view", { path: location.pathname });
  }, [location.pathname, location.search]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest("a");
      if (!link) return;
      const href = link.getAttribute("href");
      if (href === "/login") {
        trackSeoEvent("seo_cta_click", { path: location.pathname, label: link.textContent?.trim() });
        trackSeoEvent("registration_start", { path: location.pathname, ...getSeoAttribution() });
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [location.pathname]);

  return null;
}

function mountGtm() {
  if (!GTM_ID || typeof document === "undefined") return;
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(GTM_ID)}`;
  document.head.appendChild(script);
}

function mountYandexMetrika() {
  if (!YANDEX_METRIKA_ID || typeof document === "undefined") return;
  const counterId = getYandexCounterId();
  if (!counterId) return;

  window.ym =
    window.ym ||
    function ymStub(...args: unknown[]) {
      (window.ym!.a = window.ym!.a || []).push(args);
    };
  window.ym.l = Date.now();
  window.ym(counterId, "init", {
    clickmap: true,
    trackLinks: true,
    accurateTrackBounce: true,
    webvisor: true,
  });

  const script = document.createElement("script");
  script.async = true;
  script.src = "https://mc.yandex.ru/metrika/tag.js";
  document.head.appendChild(script);
}

function getYandexCounterId() {
  if (!YANDEX_METRIKA_ID) return undefined;
  const counterId = Number(YANDEX_METRIKA_ID);
  return Number.isFinite(counterId) ? counterId : undefined;
}
