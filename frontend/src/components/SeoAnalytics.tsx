import { COOKIE_CONSENT_EVENT, hasAnalyticsConsent } from "../cookieConsent";
import { useEffect, useState } from "react";
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
const YANDEX_METRIKA_ID = import.meta.env.VITE_YANDEX_METRIKA_ID as
  string | undefined;
let analyticsScriptsMounted = false;
let previousPageUrl = "";
let cachedClientId: string | undefined;
let activeUserId: number | undefined;
let internalTraffic = false;
let lastSentIdentity = "";
const memoryStorage = new Map<string, string>();
function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key) ?? memoryStorage.get(key);
  } catch {
    return memoryStorage.get(key);
  }
}
function writeStorage(key: string, value: string) {
  memoryStorage.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Analytics must never block access. */
  }
}

export function trackSeoEvent(
  event: string,
  payload: Record<string, unknown> = {},
) {
  if (typeof window === "undefined" || !hasAnalyticsConsent() || internalTraffic) return;
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ event, ...payload });
  const counterId = getYandexCounterId();
  try {
    if (counterId && window.ym)
      window.ym(counterId, "reachGoal", event, payload);
  } catch {
    /* Nonessential telemetry. */
  }
}

export function trackSeoEventOnce(
  event: string,
  payload: Record<string, unknown> = {},
) {
  if (typeof window === "undefined" || !hasAnalyticsConsent() || internalTraffic) return;
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
  if (typeof window === "undefined" || !hasAnalyticsConsent()) return {};
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
    first_landing: firstLanding ? sanitizeLanding(firstLanding) : firstLanding,
    referrer: firstReferrer ? safeReferrer(firstReferrer) : firstReferrer,
    utm: Object.fromEntries(
      campaignParams(new URLSearchParams(firstUtm).toString()).entries(),
    ),
    analytics: getClientAnalyticsIds(),
  };
}

function cleanStringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [
        key,
        typeof item === "string" ? item : String(item),
      ])
      .filter(([key, item]) => key && item),
  );
}

export default function SeoAnalytics() {
  const location = useLocation();
  const [consented, setConsented] = useState(hasAnalyticsConsent);
  useEffect(() => {
    const sync = () => setConsented(hasAnalyticsConsent());
    window.addEventListener(COOKIE_CONSENT_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(COOKIE_CONSENT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    if (!consented) {
      const id = getYandexCounterId();
      if (id && window.ym) {
        try {
          window.ym(id, "destruct");
        } catch {}
      }
      if (id)
        (window as unknown as Record<string, unknown>)[
          `disableYaCounter${id}`
        ] = true;
      analyticsScriptsMounted = false;
      previousPageUrl = "";
      cachedClientId = undefined;
      lastSentIdentity = "";
      memoryStorage.clear();
      try {
        for (const name of [
          FIRST_LANDING_KEY,
          FIRST_UTM_KEY,
          FIRST_REFERRER_KEY,
          "threadsgo.analytics_user",
        ])
          localStorage.removeItem(name);
      } catch {}
      return;
    }
    if (analyticsScriptsMounted) return;
    const id = getYandexCounterId();
    if (id)
      (window as unknown as Record<string, unknown>)[`disableYaCounter${id}`] =
        false;
    analyticsScriptsMounted = true;
    mountYandexMetrika();
  }, [consented]);

  useEffect(() => {
    if (!consented) return;
    const params = campaignParams(location.search);
    const currentPath = analyticsPath(location.pathname, location.search);
    if (!readStorage(FIRST_LANDING_KEY)) {
      writeStorage(FIRST_LANDING_KEY, currentPath);
      writeStorage(FIRST_REFERRER_KEY, safeReferrer(document.referrer));
      const utm = Object.fromEntries(params.entries());
      writeStorage(FIRST_UTM_KEY, JSON.stringify(utm));
    }
    const recordPage = () => {
      if (previousPageUrl === `${window.location.origin}${currentPath}`) return;
      trackPageView(currentPath);
      trackSeoEvent("seo_page_view", { path: location.pathname });
    };
    document.addEventListener("threadsgo:seo-ready", recordPage);
    const canonical = document.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    if (
      canonical &&
      new URL(canonical.href).pathname.replace(/\/$/, "") ===
        location.pathname.replace(/\/$/, "")
    )
      recordPage();
    return () =>
      document.removeEventListener("threadsgo:seo-ready", recordPage);
  }, [location.pathname, location.search, consented]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const link =
        event.target instanceof Element ? event.target.closest("a") : null;
      if (!link) return;
      const href = link.getAttribute("href");
      if (["/login", "/register"].includes(href?.split("?")[0] || "")) {
        trackSeoEvent("seo_cta_click", {
          path: location.pathname,
          label: link.textContent?.trim(),
        });
        if (
          href?.split("?")[0] === "/register"
        ) {
          trackSeoEvent("registration_start", { path: location.pathname });
        }
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [location.pathname]);

  return null;
}

function safeReferrer(value: string) {
  try {
    const url = new URL(value);
    return url.origin === window.location.origin ? `${url.origin}${url.pathname}` : url.origin;
  } catch {
    return "";
  }
}

// Only campaign labels and click IDs belong in analytics URLs, never form input.
function campaignParams(search: string) {
  const result = new URLSearchParams();
  const input = new URLSearchParams(search);
  for (const key of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "yclid",
    "gclid",
    "fbclid",
  ]) {
    const value = input.get(key);
    if (value && /^[\p{L}\p{N}_.: -]{1,256}$/u.test(value)) result.set(key, value);
  }
  return result;
}

function analyticsPath(pathname: string, search: string) {
  const params = campaignParams(search).toString();
  return params ? `${pathname}?${params}` : pathname;
}

function sanitizeLanding(value: string) {
  try {
    const url = new URL(value, window.location.origin);
    return analyticsPath(url.pathname, url.search);
  } catch {
    return "/";
  }
}

function mountYandexMetrika() {
  if (!YANDEX_METRIKA_ID || typeof document === "undefined") return;
  const counterId = getYandexCounterId();
  if (!counterId) return;
  const existingScript = document.querySelector(
    `script[src="https://mc.yandex.com/metrika/tag.js?id=${counterId}"]`,
  );

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
    referrer: safeReferrer(document.referrer),
    url: `${window.location.origin}${analyticsPath(window.location.pathname, window.location.search)}`,
    trackLinks: true,
    accurateTrackBounce: true,
    webvisor: true,
  });
  if (activeUserId) syncAnalyticsIdentity();

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://mc.yandex.com/metrika/tag.js?id=${counterId}`;
  if (!existingScript) document.head.appendChild(script);
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
  if (typeof window === "undefined" || !hasAnalyticsConsent()) return;

  const currentUrl = `${window.location.origin}${path}`;
  if (currentUrl === previousPageUrl) return;
  const referrer = previousPageUrl || safeReferrer(document.referrer);
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
  if (!hasAnalyticsConsent()) return {};
  const counterId = getYandexCounterId();
  if (counterId && window.ym && !cachedClientId) {
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 600);
      try {
        window.ym!(counterId, "getClientID", (value: unknown) => {
          if (typeof value === "string") cachedClientId = value;
          window.clearTimeout(timeout);
          resolve();
        });
      } catch {
        window.clearTimeout(timeout);
        resolve();
      }
    });
  }
  return getSeoAttribution();
}
function syncAnalyticsIdentity() {
  if (!activeUserId || !hasAnalyticsConsent()) return;
  writeStorage("threadsgo.analytics_user", String(activeUserId));
  const counterId = getYandexCounterId();
  const identity = `${activeUserId}:${internalTraffic}`;
  if (identity === lastSentIdentity) return;
  try {
    if (counterId && window.ym) {
      window.ym(counterId, "setUserID", `u${activeUserId}`);
      window.ym(counterId, "params", { traffic_type: internalTraffic ? "internal" : "customer" });
      lastSentIdentity = identity;
    }
  } catch { /* Optional analytics cannot interrupt authentication. */ }
}
export function setAnalyticsUser(userId: number, isOperator?: boolean) {
  if (typeof window === "undefined" || !Number.isSafeInteger(userId) || userId <= 0) return;
  if (activeUserId !== userId) internalTraffic = false;
  activeUserId = userId;
  if (isOperator !== undefined) internalTraffic = isOperator;
  syncAnalyticsIdentity();
}
export function clearAnalyticsUser() {
  activeUserId = undefined;
  internalTraffic = false;
  lastSentIdentity = "";
  memoryStorage.delete("threadsgo.analytics_user");
  try { window.localStorage.removeItem("threadsgo.analytics_user"); } catch { /* Storage may be unavailable. */ }
}
