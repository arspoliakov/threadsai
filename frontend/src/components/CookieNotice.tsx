import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { COOKIE_SETTINGS_EVENT, hasCookieChoice, saveCookieChoice } from "../cookieConsent";

export default function CookieNotice() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(!hasCookieChoice());
    const show = () => setOpen(true);
    window.addEventListener(COOKIE_SETTINGS_EVENT, show);
    return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, show);
  }, []);
  return open ? <section aria-label="Настройки cookie" className="cookie-notice fixed inset-x-3 bottom-3 z-[90] mx-auto max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto rounded-2xl border border-[#dbe6dd] bg-white p-3 text-[#162b25] shadow-[0_12px_60px_rgba(0,0,0,0.18)] sm:p-6">
    <p className="text-sm font-semibold sm:text-base">Пусть сайт запомнит самое нужное</p>
    <p className="mt-2 text-xs leading-5 text-[#60716a] sm:text-sm sm:leading-6">Сайт запоминает вход и настройки. С вашего разрешения Метрика и Вебвизор помогут понять, где пользоваться неудобно. Текст в полях и содержимое личного кабинета скрыты от записи. <Link to="/privacy#cookies" className="underline underline-offset-2">Подробнее</Link></p>
    <div className="mt-3 grid gap-2 sm:mt-4 sm:flex sm:flex-wrap sm:gap-3"><button type="button" className="home-primary" onClick={() => {saveCookieChoice(true); setOpen(false);}}>Разрешить аналитику</button><button type="button" className="home-secondary" onClick={() => {saveCookieChoice(false); setOpen(false);}}>Только необходимые</button></div>
  </section> : <button type="button" onClick={() => setOpen(true)} className="cookie-settings fixed bottom-1 right-3 z-40 rounded-lg border border-[#dbe6dd] bg-white px-2 py-1 text-[10px] text-[#60716a] lg:bottom-3">Настройки cookie</button>;
}
