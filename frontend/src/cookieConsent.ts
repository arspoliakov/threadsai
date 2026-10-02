export const COOKIE_CONSENT_KEY = "threadsgo.cookie-consent.v1";
export const COOKIE_CONSENT_EVENT = "threadsgo:cookie-consent";
export const COOKIE_SETTINGS_EVENT = "threadsgo:cookie-settings";
export function hasAnalyticsConsent() {
  if (typeof window === "undefined") return false;
  try {
    const value = JSON.parse(localStorage.getItem(COOKIE_CONSENT_KEY) || "null");
    return value?.analytics === true && value?.version === "2026-10-02" && Date.now() - value.savedAt < 180 * 86400000;
  } catch { return false; }
}
export function hasCookieChoice() {
  if (typeof window === "undefined") return false;
  try {
    const value = JSON.parse(localStorage.getItem(COOKIE_CONSENT_KEY) || "null");
    return typeof value?.analytics === "boolean" && value.version === "2026-10-02" && Date.now() - value.savedAt < 180 * 86400000;
  } catch { return false; }
}
export function saveCookieChoice(analytics: boolean) {
  try { localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify({analytics, version: "2026-10-02", savedAt: Date.now()})); } catch { /* Without durable consent analytics stays disabled. */ }
  window.dispatchEvent(new Event(COOKIE_CONSENT_EVENT));
}
