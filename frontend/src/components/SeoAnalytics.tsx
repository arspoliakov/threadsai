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
const FIRST_REFERRER_KEY = "threadsgo.first_referrer";
const GTM_ID = import.meta.env.VITE_GTM_ID as string | undefined;
const YANDEX_METRIKA_ID = import.meta.env.VITE_YANDEX_METRIKA_ID as string | undefined;
let analyticsScriptsMounted = false;
let previousPageUrl = "";
let cachedClientId: string | undefined;
const memoryStorage = new Map<string, string>();
function readStorage(key: string) {
  try { return window.localStorage.getItem(key) ?? memoryStorage.get(key); } catch { return memoryStorage.get(key); }
}
function writeStorage(key: string, value: string) {
  memoryStorage.set(key, value);
  try { window.localStorage.setItem(key, value); } catch { /* Analytics must never block access. */ }
}

export function trackSeoEvent(event: string, payload: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ event, ...payload });
  const counterId = getYandexCounterId();
  try { if (counterId && window.ym) window.ym(counterId, "reachGoal", event, payload); } catch { /* Nonessential telemetry. */ }
}

export function trackSeoEventOnce(event: string, payload: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const scope = readStorage("threadsgo.analytics_user") || "anonymous";
  const storageKey = `threadsgo.analytics.${scope}.${event}`;
  if (readStorage(storageKey)) return;
  writeStorage(storageKey, new Date().toISOString());
  trackSeoEvent(event, payload);
}

export function getSeoAttribution(): {
  first_landing?: string | null;
  referrer?: string | null;
  utm?: Record<string, string>;
  analytics?: Record<string, string>;
} {
  if (typeof window === "undefined") return {};
  const firstLanding = readStorage(FIRST_LANDING_KEY);
  const firstReferrer = readStorage(FIRST_REFERRER_KEY);
  const storedUtm = readStorage(FIRST_UTM_KEY);
  let firstUtm: Record<string, string> = {};
  if (storedUtm) {
    try {
      firstUtm = cleanStringRecord(JSON.parse(storedUtm));
    } catch {
      firstUtm = {};
    }
  }
  return {
    first_landing: firstLanding,
    referrer: firstReferrer,
    utm: firstUtm,
    analytics: getClientAnalyticsIds(),
  };
}

function cleanStringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, typeof item === "string" ? item : String(item)])
      .filter(([key, item]) => key && item),
  );
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
    const currentPath = `${location.pathname}${location.search}`;
    if (!readStorage(FIRST_LANDING_KEY)) {
      writeStorage(FIRST_LANDING_KEY, currentPath);
      writeStorage(FIRST_REFERRER_KEY, document.referrer || "");
      const utm = Object.fromEntries([...params.entries()].filter(([key]) =>
        key.startsWith("utm_") || ["yclid", "gclid", "fbclid"].includes(key)));
      writeStorage(FIRST_UTM_KEY, JSON.stringify(utm));
    }
    const recordPage = () => {
      if (previousPageUrl === `${window.location.origin}${currentPath}`) return;
      trackPageView(currentPath);
      trackSeoEvent("seo_page_view", { path: location.pathname });
    };
    document.addEventListener("threadsgo:seo-ready", recordPage);
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonical && new URL(canonical.href).pathname.replace(/\/$/, "") === location.pathname.replace(/\/$/, "")) recordPage();
    return () => document.removeEventListener("threadsgo:seo-ready", recordPage);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      if (!link) return;
      const href = link.getAttribute("href");
      if (href?.split("?")[0] === "/login") {
        trackSeoEvent("seo_cta_click", { path: location.pathname, label: link.textContent?.trim() });
        if (link.getAttribute("data-analytics-cta") === "start_trial" || href?.includes("intent=start")) {
          trackSeoEvent("registration_start", { path: location.pathname });
        }
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
  const existingScript = document.querySelector(`script[src="https://mc.yandex.com/metrika/tag.js?id=${counterId}"]`);
  if (existingScript) return;

  window.ym =
    window.ym ||
    function ymStub(...args: unknown[]) {
      (window.ym!.a = window.ym!.a || []).push(args);
    };
  window.ym.l = Date.now();
  window.ym(counterId, "init", {
    defer: true,
    ssr: true,
    clickmap: true,
    ecommerce: "dataLayer",
    referrer: document.referrer,
    url: window.location.href,
    trackLinks: true,
    accurateTrackBounce: true,
    webvisor: true,
  });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://mc.yandex.com/metrika/tag.js?id=${counterId}`;
  document.head.appendChild(script);
}

function getYandexCounterId() {
  if (!YANDEX_METRIKA_ID) return undefined;
  const counterId = Number(YANDEX_METRIKA_ID);
  return Number.isFinite(counterId) ? counterId : undefined;
}

function getClientAnalyticsIds() {
  const result: Record<string, string> = {};
  const counterId = getYandexCounterId();
  if (counterId) result.yandex_metrika_id = String(counterId);

  const yandexClientId = getYandexClientId(counterId);
  if (yandexClientId) result.yandex_client_id = yandexClientId;

  return result;
}

function getYandexClientId(counterId: number | undefined) {
  if (!counterId || !window.ym) return undefined;
  let clientId = cachedClientId;
  try {
    window.ym(counterId, "getClientID", (value: unknown) => {
      if (typeof value === "string") clientId = cachedClientId = value;
    });
  } catch {
    return undefined;
  }
  return clientId;
}

function trackPageView(path: string) {
  if (typeof window === "undefined") return;

  const currentUrl = `${window.location.origin}${path}`;
  if (currentUrl === previousPageUrl) return;
  const referrer = previousPageUrl || document.referrer;
  previousPageUrl = currentUrl;

  const counterId = getYandexCounterId();
  if (counterId && window.ym) {
    window.ym(counterId, "hit", currentUrl, {
      referer: referrer,
      title: document.title,
    });
  }

  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({
    event: "page_view",
    page_location: currentUrl,
    page_referrer: referrer,
    page_title: document.title,
  });
}

export async function getSeoAttributionForLogin() {
  const counterId = getYandexCounterId();
  if (counterId && window.ym && !cachedClientId) {
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 600);
      try { window.ym!(counterId, "getClientID", (value: unknown) => {
        if (typeof value === "string") cachedClientId = value;
        window.clearTimeout(timeout); resolve();
      }); } catch { window.clearTimeout(timeout); resolve(); }
    });
  }
  return getSeoAttribution();
}
export function setAnalyticsUser(userId: number) { writeStorage("threadsgo.analytics_user", String(userId)); }
