import { useEffect } from "react";
import { useLocation } from "react-router-dom";

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

const FIRST_LANDING_KEY = "threadsgo.first_landing";
const FIRST_UTM_KEY = "threadsgo.first_utm";

export function trackSeoEvent(event: string, payload: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ event, ...payload });
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
