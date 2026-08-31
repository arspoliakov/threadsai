import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import {
  LoginError,
  TelegramAuthPayload,
  getCurrentUser,
  loginWithTelegram,
  loginWithTelegramWebApp,
  setStoredAuthToken,
} from "../../api/client";
import { isAuthenticated } from "../../auth";
import { getSeoAttribution, trackSeoEvent } from "../../components/SeoAnalytics";

type LocationState = {
  from?: string;
};

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramAuthPayload) => void;
    Telegram?: {
      WebApp?: {
        initData?: string;
        ready?: () => void;
        expand?: () => void;
      };
    };
  }
}

const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined;
const WIDGET_TIMEOUT_MS = 4500;
const TERMS_ACCEPTED_STORAGE_KEY = "threadsgo.terms.accepted";
const META_NOTICE_ACCEPTED_STORAGE_KEY = "threadsgo.meta_notice.accepted";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const loginReason = new URLSearchParams(location.search).get("reason");
  const sessionNeedsRefresh = loginReason === "session-expired" || loginReason === "access-denied";
  const widgetContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetTimeoutRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [widgetKey, setWidgetKey] = useState(0);
  const [widgetStatus, setWidgetStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [termsAccepted, setTermsAccepted] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(TERMS_ACCEPTED_STORAGE_KEY) === "true",
  );
  const [metaNoticeAccepted, setMetaNoticeAccepted] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(META_NOTICE_ACCEPTED_STORAGE_KEY) === "true",
  );
  const canLogin = termsAccepted && metaNoticeAccepted;

  const handleTelegramAuth = useCallback(
    async (user: TelegramAuthPayload) => {
      setError(null);
      setIsLoading(true);

      try {
        const response = await loginWithTelegram(user, getSeoAttribution());
        setStoredAuthToken(response.access_token);
        trackSeoEvent("registration_complete", getSeoAttribution());
        toast.success("Вход через Telegram выполнен");
        navigate(await getPostLoginDestination(state?.from), { replace: true });
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
    },
    [navigate, state?.from],
  );

  useEffect(() => {
    async function tryTelegramWebAppLogin() {
      if (!canLogin) {
        return false;
      }

      await loadTelegramWebAppScript();
      const webApp = window.Telegram?.WebApp;
      const initData = webApp?.initData;

      if (!initData) {
        return false;
      }

      setError(null);
      setIsLoading(true);

      try {
        webApp?.ready?.();
        webApp?.expand?.();
        const response = await loginWithTelegramWebApp(initData, getSeoAttribution());
        setStoredAuthToken(response.access_token);
        trackSeoEvent("registration_complete", getSeoAttribution());
        toast.success("Вход через Telegram выполнен");
        navigate(await getPostLoginDestination(state?.from), { replace: true });
        return true;
      } catch (telegramError) {
        const message =
          telegramError instanceof LoginError
            ? telegramError.message
            : "Не удалось выполнить вход через Telegram.";
        setError(message);
        toast.error(message);
        return false;
      } finally {
        setIsLoading(false);
      }
    }

    void tryTelegramWebAppLogin();
  }, [canLogin, navigate, state?.from]);

  useEffect(() => {
    if (!canLogin) {
      setWidgetStatus("failed");
      return;
    }

    if (!widgetContainerRef.current || !TELEGRAM_BOT_USERNAME) {
      setWidgetStatus("failed");
      return;
    }

    setWidgetStatus("loading");
    setError(null);
    window.onTelegramAuth = handleTelegramAuth;
    widgetContainerRef.current.innerHTML = "";

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", TELEGRAM_BOT_USERNAME.replace(/^@/, ""));
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "16");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.onload = () => {
      window.setTimeout(() => {
        const hasWidget = Boolean(widgetContainerRef.current?.querySelector("iframe"));
        setWidgetStatus(hasWidget ? "ready" : "failed");
      }, 800);
    };
    script.onerror = () => setWidgetStatus("failed");

    widgetContainerRef.current.appendChild(script);

    widgetTimeoutRef.current = window.setTimeout(() => {
      const hasWidget = Boolean(widgetContainerRef.current?.querySelector("iframe"));
      if (!hasWidget) {
        setWidgetStatus("failed");
      }
    }, WIDGET_TIMEOUT_MS);

    return () => {
      delete window.onTelegramAuth;
      if (widgetTimeoutRef.current) {
        window.clearTimeout(widgetTimeoutRef.current);
      }
      if (widgetContainerRef.current) {
        widgetContainerRef.current.innerHTML = "";
      }
    };
  }, [canLogin, handleTelegramAuth, widgetKey]);

  function updateTermsAccepted(value: boolean) {
    setTermsAccepted(value);
    window.localStorage.setItem(TERMS_ACCEPTED_STORAGE_KEY, String(value));
  }

  function updateMetaNoticeAccepted(value: boolean) {
    setMetaNoticeAccepted(value);
    window.localStorage.setItem(META_NOTICE_ACCEPTED_STORAGE_KEY, String(value));
  }

  if (isAuthenticated()) {
    return <Navigate to={state?.from || "/app"} replace />;
  }

  const botLink = TELEGRAM_BOT_USERNAME
    ? `https://t.me/${TELEGRAM_BOT_USERNAME.replace(/^@/, "")}?start=login`
    : "https://t.me/";

  return (
    <main className="landing-shell relative grid min-h-screen overflow-hidden bg-[#070909] px-5 py-8 text-[#eff6ed] sm:px-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="landing-aurora absolute left-[-12rem] top-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#0076ff]/28 blur-[110px]" />
        <div className="landing-aurora absolute bottom-[-14rem] right-[-10rem] h-[34rem] w-[34rem] rounded-full bg-[#73ff2d]/22 blur-[130px] [animation-delay:-6s]" />
        <div className="landing-grid absolute inset-0 opacity-[0.16]" />
      </div>

      <section className="landing-reveal relative m-auto grid w-full max-w-6xl overflow-hidden rounded-[2.2rem] border border-white/10 bg-white/[0.045] shadow-[0_50px_160px_rgba(0,0,0,0.55)] backdrop-blur md:grid-cols-[0.95fr_1.05fr]">
        <div className="relative min-h-[22rem] overflow-hidden border-b border-white/10 bg-[#08100d] md:border-b-0 md:border-r md:border-white/10">
          <img
            src="/landing/secure-mobile-console.webp"
            alt=""
            className="landing-phone-image absolute left-1/2 top-6 h-[35rem] max-w-none -translate-x-1/2 object-contain opacity-95 md:top-0 md:h-[42rem]"
          />
          <img
            src="/landing/login-auth-orb.webp"
            alt=""
            className="landing-orb absolute left-8 top-8 h-24 w-24 object-contain opacity-80"
          />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#08100d] to-transparent" />
          <Link
            to="/"
            className="absolute left-5 top-5 rounded-full border border-white/12 bg-white/[0.06] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/62 transition hover:border-white/35 hover:text-white"
          >
            ← лендинг
          </Link>
        </div>

        <div className="relative p-7 sm:p-9 lg:p-12">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.06]">
              <img src="/threadsgo-logo.png" alt="ThreadsGo" className="h-9 w-9 object-contain" />
            </span>
            <div>
              <p className="font-display text-2xl leading-none text-white">ThreadsGo</p>
            </div>
          </div>

          <h1 className="mt-10 font-display text-6xl leading-[0.82] tracking-[-0.06em] text-white sm:text-7xl">
            Вход в кабинет.
          </h1>

          {sessionNeedsRefresh ? (
            <div className="mt-6 rounded-2xl border border-[#6cc9ff]/30 bg-[#10212a] px-4 py-3 text-sm leading-6 text-[#ccecff]">
              Сессия кабинета устарела после обновления. С данными всё в порядке — просто войдите через Telegram ещё
              раз.
            </div>
          ) : null}

          <div className="mt-8 grid gap-3 rounded-[1.6rem] border border-white/10 bg-black/24 p-5">
            <AgreementCheckbox
              checked={termsAccepted}
              onChange={updateTermsAccepted}
            >
              Я принимаю{" "}
              <Link to="/terms#terms" className="text-white underline decoration-[#70ff35] underline-offset-4">
                условия использования
              </Link>{" "}
              и{" "}
              <Link to="/terms#privacy" className="text-white underline decoration-[#70ff35] underline-offset-4">
                политику конфиденциальности
              </Link>
              .
            </AgreementCheckbox>
            <AgreementCheckbox
              checked={metaNoticeAccepted}
              onChange={updateMetaNoticeAccepted}
            >
              Я понимаю, что деятельность Meta Platforms Inc. и связанных соцсетей запрещена в РФ,
              а ответственность за использование Threads, сетевой доступ и публикуемый контент лежит на мне.
            </AgreementCheckbox>
          </div>

          <div className="mt-8 rounded-[1.6rem] border border-white/10 bg-black/24 p-5">
            <div className="relative grid min-h-20 place-items-center rounded-[1.2rem] border border-white/8 bg-[#050807]/70 p-5">
              {!canLogin ? (
                <p className="max-w-md text-center text-sm leading-6 text-white/54">
                  Чтобы войти, сначала подтвердите условия beta-доступа и юридическую оговорку выше.
                </p>
              ) : widgetStatus === "loading" ? (
                <div className="absolute inset-0 grid place-items-center">
                  <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/42">
                    <Spinner />
                    загружаем telegram
                  </div>
                </div>
              ) : null}

              {canLogin && TELEGRAM_BOT_USERNAME ? (
                <div className={widgetStatus === "failed" ? "hidden" : "grid place-items-center"} ref={widgetContainerRef} />
              ) : null}

              {canLogin && widgetStatus === "failed" ? (
                <div className="max-w-md text-center">
                  <p className="text-sm leading-6 text-white/68">
                    Telegram-виджет не загрузился. Так бывает, если браузер, VPN или провайдер режет внешний
                    скрипт Telegram.
                  </p>
                  <p className="mt-3 text-sm leading-6 text-white/54">
                    Альтернативный вход: нажмите «Войти через бота», откройте Telegram и отправьте боту команду
                    <span className="mx-1 rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] text-white/76">
                      /start
                    </span>
                    . Бот покажет кнопку кабинета и авторизует вас внутри Telegram.
                  </p>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setWidgetKey((current) => current + 1)}
                      className="rounded-full bg-white px-5 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[#070909] transition hover:bg-[#70ff35]"
                    >
                      попробовать снова
                    </button>
                    <a
                      href={botLink}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-white/14 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-white/68 transition hover:border-white/40 hover:text-white"
                    >
                      войти через бота
                    </a>
                  </div>
                </div>
              ) : null}
            </div>

            {canLogin ? (
              <div className="mt-4 rounded-[1.2rem] border border-white/8 bg-[#050807]/45 p-4 text-center">
                <p className="mx-auto max-w-lg text-sm leading-6 text-white/58">
                  Если кнопка Telegram выше не появилась или висит загрузка, используйте надежный вход через бота:
                  откройте Telegram, нажмите <span className="text-white">Start</span> или отправьте{" "}
                  <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] text-white/76">
                    /start
                  </span>
                  , затем выберите «Открыть кабинет ThreadsGo».
                </p>
                <a
                  href={botLink}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex rounded-full bg-white px-6 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[#070909] transition hover:bg-[#70ff35]"
                >
                  войти через бота
                </a>
              </div>
            ) : null}
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

        </div>
      </section>
    </main>
  );
}

async function getPostLoginDestination(requestedPath?: string) {
  try {
    const user = await getCurrentUser();
    if (!user.subscription_status) {
      return "/app/billing";
    }
  } catch {
    // The normal API interceptor will handle invalid access; keep a safe fallback here.
  }

  return requestedPath || "/app";
}

function Spinner() {
  return <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />;
}

function AgreementCheckbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/8 bg-[#050807]/48 p-4 text-sm leading-6 text-white/62 transition hover:border-white/18">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-white/20 bg-transparent accent-[#70ff35]"
      />
      <span>{children}</span>
    </label>
  );
}

function loadTelegramWebAppScript() {
  if (window.Telegram?.WebApp) {
    return Promise.resolve();
  }

  const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://telegram.org/js/telegram-web-app.js"]');
  if (existingScript) {
    return new Promise<void>((resolve) => {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => resolve(), { once: true });
      window.setTimeout(resolve, 1200);
    });
  }

  return new Promise<void>((resolve) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
    window.setTimeout(resolve, 1600);
  });
}
