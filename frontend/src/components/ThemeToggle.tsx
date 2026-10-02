import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const key = "threadsgo.theme";
const eventName = "threadsgo:theme";

function currentTheme(): Theme {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#09110e" : "#f8faf9");
  window.dispatchEvent(new Event(eventName));
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => {
    const sync = () => setTheme(currentTheme());
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const followPreference = () => {
      let saved: string | null = null;
      try { saved = localStorage.getItem(key); } catch { /* Storage can be unavailable in private browsing. */ }
      applyTheme(saved === "dark" || (saved !== "light" && system.matches) ? "dark" : "light");
    };
    window.addEventListener(eventName, sync);
    window.addEventListener("storage", followPreference);
    system.addEventListener("change", followPreference);
    followPreference();
    return () => {
      window.removeEventListener(eventName, sync);
      window.removeEventListener("storage", followPreference);
      system.removeEventListener("change", followPreference);
    };
  }, []);
  const label = theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему";
  return <button type="button" aria-label={label} title={label} onClick={() => {
    const next = theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(key, next); } catch { /* Keep the current-page choice even without storage. */ }
    applyTheme(next);
  }} className="theme-toggle grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#d5e0d9] bg-white text-[#49705a] transition hover:bg-[#edf3ef]">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{theme === "dark" ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></> : <path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z" />}</svg>
  </button>;
}
