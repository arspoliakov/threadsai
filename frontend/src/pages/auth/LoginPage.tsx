import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import {
  LoginError,
  TelegramAuthPayload,
  loginWithTelegram,
  setStoredAuthToken,
} from "../../api/client";
import { isAuthenticated } from "../../auth";

type LocationState = {
  from?: string;
};

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramAuthPayload) => void;
  }
}

const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined;

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const widgetContainerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!widgetContainerRef.current || !TELEGRAM_BOT_USERNAME) {
      return;
    }

    window.onTelegramAuth = async (user: TelegramAuthPayload) => {
      setError(null);
      setIsLoading(true);

      try {
        const response = await loginWithTelegram(user);
        setStoredAuthToken(response.access_token);
        toast.success("Вход через Telegram выполнен");
        navigate(state?.from || "/", { replace: true });
      } catch (telegramError) {
        const message =
          telegramError instanceof LoginError
            ? telegramError.message
            : "Не удалось выполнить вход через Telegram.";
        setError(message);
        toast.error(message);
      } finally {
        setIsLoading(false);
      }
    };

    widgetContainerRef.current.innerHTML = "";
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", TELEGRAM_BOT_USERNAME);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "10");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    widgetContainerRef.current.appendChild(script);

    return () => {
      delete window.onTelegramAuth;
      if (widgetContainerRef.current) {
        widgetContainerRef.current.innerHTML = "";
      }
    };
  }, [navigate, state?.from]);

  if (isAuthenticated()) {
    return <Navigate to={state?.from || "/"} replace />;
  }

  return (
    <main className="grid min-h-screen bg-[#101010] px-6 py-10 text-[#f4f1ea]">
      <section className="m-auto w-full max-w-md rounded-3xl border border-white/15 bg-[#141414] p-8 shadow-sm">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/40">
          Telegram protected console
        </p>
        <h1 className="mt-4 font-display text-5xl leading-none">Вход</h1>
        <p className="mt-5 text-sm leading-6 text-white/55">
          Войдите через Telegram. Backend проверит подпись виджета, создаст пользователя
          и выдаст JWT-токен для API.
        </p>

        <div className="mt-8 rounded-2xl border border-white/10 bg-black/20 p-5">
          {TELEGRAM_BOT_USERNAME ? (
            <div className="grid min-h-12 place-items-center" ref={widgetContainerRef}>
              {isLoading ? <Spinner /> : null}
            </div>
          ) : (
            <div className="text-sm leading-6 text-[#ffb4a9]">
              Не задан `VITE_TELEGRAM_BOT_USERNAME` во frontend `.env`.
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="mt-5 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-white/45">
            <Spinner />
            Проверка Telegram
          </div>
        ) : null}

        {error ? (
          <div className="mt-5 rounded-2xl border border-[#b42318]/40 bg-[#2a1110] px-4 py-3 text-sm text-[#ffb4a9]">
            {error}
          </div>
        ) : null}

        <p className="mt-6 text-xs leading-5 text-white/35">
          Если окно Telegram не появилось, проверьте username бота и домен в настройках
          Telegram Login Widget.
        </p>
      </section>
    </main>
  );
}

function Spinner() {
  return <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />;
}
