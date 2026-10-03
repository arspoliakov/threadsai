import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import {
  LoginError,
  type LoginResponse,
  type RegistrationConsentPayload,
  TelegramAuthPayload,
  getCurrentUser,
  loginWithTelegram,
  loginWithTelegramWebApp,
  setStoredAuthToken,
} from "../../api/client";
import { isAuthenticated } from "../../auth";
import { getSeoAttributionForLogin, trackSeoEvent, trackSeoEventOnce, setAnalyticsUser } from "../../components/SeoAnalytics";
import { ThemeToggle } from "../../components/ThemeToggle";
import { useTelegramBotLogin } from "../../hooks/useTelegramBotLogin";

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
export default function LoginPage({mode = "login"}: {mode?: "login" | "register"}) {
  const isRegistration = mode === "register";
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const requestedPath = new URLSearchParams(location.search).get("intent") === "studio" ? "/app/studio" : state?.from;
  const loginReason = new URLSearchParams(location.search).get("reason");
  const sessionNeedsRefresh = loginReason === "session-expired" || loginReason === "access-denied";
  const widgetContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetTimeoutRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [widgetKey, setWidgetKey] = useState(0);
  const [widgetStatus, setWidgetStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [metaNoticeAccepted, setMetaNoticeAccepted] = useState(false);
  const canLogin = !isRegistration || (termsAccepted && privacyAccepted && metaNoticeAccepted);
  const registration = useMemo<RegistrationConsentPayload | undefined>(() => isRegistration && canLogin ? {version: "2026-10-02", terms: true, privacy: true, risks: true} : undefined, [isRegistration, canLogin]);

  const finishAuthenticated = useCallback(async (response: LoginResponse) => {
    if (response.user_id != null) setAnalyticsUser(response.user_id);
    trackSeoEvent("telegram_login_complete");
    if (response.is_new_user) trackSeoEventOnce("registration_complete");
    toast.success("Вход через Telegram выполнен");
    navigate(await getPostLoginDestination(requestedPath), { replace: true });
  }, [navigate, requestedPath]);

  const botLogin = useTelegramBotLogin(finishAuthenticated, registration);

  const handleTelegramAuth = useCallback(
    async (user: TelegramAuthPayload) => {
      setError(null);
      setIsLoading(true);

      try {
        const response = await loginWithTelegram(user, await getSeoAttributionForLogin(), registration);
        setStoredAuthToken(response.access_token);
        await finishAuthenticated(response);
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
    [finishAuthenticated, registration],
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
        const response = await loginWithTelegramWebApp(initData, await getSeoAttributionForLogin(), registration);
        setStoredAuthToken(response.access_token);
        await finishAuthenticated(response);
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
  }, [canLogin, finishAuthenticated, registration]);

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

  if (isAuthenticated()) {
    return <Navigate to={sanitizeReturnPath(requestedPath)} replace />;
  }

  return (
    <main className="auth-refresh home-refresh relative grid min-h-screen overflow-hidden bg-[#f8faf9] px-5 py-8 text-[#162b25] sm:px-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="landing-aurora absolute left-[-12rem] top-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#0076ff]/28 blur-[110px]" />
        <div className="landing-aurora absolute bottom-[-14rem] right-[-10rem] h-[34rem] w-[34rem] rounded-full bg-[#73ff2d]/22 blur-[130px] [animation-delay:-6s]" />
        <div className="landing-grid absolute inset-0 opacity-[0.16]" />
      </div>

      <section className="landing-reveal relative m-auto grid w-full max-w-6xl overflow-hidden rounded-[2.2rem] border border-[#dbe6dd] bg-white shadow-[0_30px_100px_rgba(25,65,40,0.12)] backdrop-blur md:grid-cols-[0.95fr_1.05fr]">
        <div className="relative hidden min-h-[22rem] md:block overflow-hidden border-b border-white/10 bg-[#08100d] md:border-b-0 md:border-r md:border-white/10">
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
        </div>

        <div className="relative p-5 sm:p-9 lg:p-12">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl border border-[#dbe6dd] bg-white/[0.06]">
              <img src="/threadsgo-logo.png" alt="ThreadsGo" className="h-9 w-9 object-contain" />
            </span>
            <div>
              <p className="font-display text-2xl leading-none text-[#162b25]">ThreadsGo</p>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between"><Link to="/" className="text-sm text-[#60716a]">← На главную</Link><ThemeToggle /></div>
          <h1 className="mt-6 font-display text-3xl font-semibold leading-tight tracking-[-0.04em] sm:text-5xl">
            {isRegistration ? "Создать профиль." : "С возвращением."}
          </h1>

          <p className="mt-5 text-sm leading-6 text-[#60716a]">Войдите через Telegram, подтвердите вход у бота и вернитесь на сайт. <Link to="/pricing/" className="text-[#315b46] underline underline-offset-4">Тарифы и условия 3 дней пробного периода</Link>.</p>

          {sessionNeedsRefresh ? (
            <div className="mt-6 rounded-2xl border border-[#6cc9ff]/30 bg-[#10212a] px-4 py-3 text-sm leading-6 text-[#ccecff]">
              Сессия кабинета устарела после обновления. С данными всё в порядке — просто войдите через Telegram ещё
              раз.
            </div>
          ) : null}

          <p className="mt-4 text-sm text-[#60716a]">{isRegistration ? "Уже есть профиль?" : "Ещё нет профиля?"} <Link to={isRegistration ? "/login" : "/register"} className="font-semibold underline underline-offset-4">{isRegistration ? "Войти" : "Зарегистрироваться"}</Link></p>
          {isRegistration ? <div className="mt-6 grid gap-3 rounded-2xl border border-[#dbe6dd] bg-[#f8faf9] p-5">
            <AgreementCheckbox checked={termsAccepted} onChange={setTermsAccepted}>Я принимаю <Link to="/terms#terms" className="underline">условия использования</Link>.</AgreementCheckbox>
            <AgreementCheckbox checked={privacyAccepted} onChange={setPrivacyAccepted}>Я отдельно даю <Link to="/consent" className="underline">согласие на обработку персональных данных</Link> и ознакомился с <Link to="/privacy" className="underline">политикой конфиденциальности</Link>.</AgreementCheckbox>
            <AgreementCheckbox checked={metaNoticeAccepted} onChange={setMetaNoticeAccepted}>Я понимаю риски ограничений и блокировки профиля при автоматизации. Я ознакомился с <Link to="/terms#meta-notice" className="underline">оговоркой о Meta</Link>.</AgreementCheckbox>
          </div> : null}

          <div className="mt-8 rounded-[1.6rem] border border-[#dbe6dd] bg-[#f8faf9] p-5">
            {!canLogin ? <p className="text-center text-sm leading-6 text-[#60716a]">Подтвердите три пункта выше, чтобы создать профиль через Telegram.</p> : null}
            {canLogin ? (
              <div className="mt-4 rounded-[1.2rem] border border-[#dbe6dd] bg-white p-4 text-center">
                {botLogin.challenge && ["waiting", "finishing"].includes(botLogin.phase) ? (
                  <>
                    <p className="text-sm font-medium text-[#162b25]">Подтвердите вход в Telegram</p>
                    <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#60716a]">
                      Нажмите «Да, войти» в сообщении бота, затем вернитесь в эту вкладку. Вход завершится автоматически.
                    </p>
                    <div className="mx-auto mt-4 w-fit rounded-2xl border border-[#70ff35]/30 bg-[#70ff35]/10 px-5 py-3">
                      <span className="block font-mono text-[9px] uppercase tracking-[0.18em] text-[#738078]">код входа</span>
                      <span className="font-mono text-2xl tracking-[0.25em] text-[#315b46]">{botLogin.challenge.display_code}</span>
                    </div>
                    {botLogin.message ? <p className="mt-3 text-sm text-[#60716a]">{botLogin.message}</p> : null}
                    <div className="mt-5 flex flex-wrap justify-center gap-3">
                      <a
                        href={botLogin.challenge.bot_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full bg-[#315b46] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#244735]"
                      >
                        открыть Telegram ещё раз
                      </a>
                      <button
                        type="button"
                        onClick={() => void botLogin.checkNow()}
                        className="rounded-full border border-[#dbe6dd] px-5 py-3 text-sm font-medium text-[#60716a] transition hover:bg-[#edf3ef] hover:text-[#162b25]"
                      >
                        проверить
                      </button>
                      <button
                        type="button"
                        onClick={() => void botLogin.cancel()}
                        className="rounded-full border border-[#dbe6dd] px-5 py-3 text-sm font-medium text-[#60716a] transition hover:bg-[#edf3ef] hover:text-[#162b25]"
                      >
                        отменить
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mx-auto max-w-lg text-sm leading-6 text-[#60716a]">
                      Удобный вход через чат с ботом. Подтвердите вход одной кнопкой и вернитесь на сайт — эта вкладка авторизуется автоматически.
                    </p>
                    {botLogin.message ? <p role="status" className="mt-3 text-sm text-[#b42318]">{botLogin.message}</p> : null}
                    <button
                      type="button"
                      disabled={botLogin.phase === "starting"}
                      onClick={() => {
                        if (["expired", "denied", "cancelled"].includes(botLogin.phase)) botLogin.reset();
                        const telegramWindow = window.open("about:blank", "_blank");
                        void botLogin.start(telegramWindow);
                      }}
                      className="mt-4 inline-flex min-h-12 items-center justify-center rounded-full bg-[#315b46] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#244735] disabled:cursor-wait disabled:opacity-60"
                    >
                      {botLogin.phase === "starting" ? "создаём вход…" : (isRegistration ? "создать профиль через Telegram" : "войти через бота Telegram")}
                    </button>
                  </>
                )}
              </div>
            ) : null}
            <details className="mt-4"><summary className="cursor-pointer text-center text-sm text-[#60716a]">Другой способ входа через Telegram</summary>
            <div className="relative grid min-h-20 place-items-center rounded-[1.2rem] border border-[#dbe6dd] bg-white p-5">
              {!canLogin ? (
                <p className="max-w-md text-center text-sm leading-6 text-[#60716a]">
                  Чтобы создать профиль, сначала подтвердите три пункта выше.
                </p>
              ) : widgetStatus === "loading" ? (
                <div className="absolute inset-0 grid place-items-center">
                  <div role="status" className="flex items-center gap-3 text-sm text-[#60716a]">
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
                  <p className="text-sm leading-6 text-[#60716a]">
                    Telegram-виджет не загрузился. Так бывает, если браузер, VPN или провайдер режет внешний
                    скрипт Telegram.
                  </p>
                  <div className="mt-5">
                    <button
                      type="button"
                      onClick={() => setWidgetKey((current) => current + 1)}
                      className="rounded-full bg-[#315b46] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#244735]"
                    >
                      попробовать снова
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            </details>
          </div>

          {isLoading ? (
            <div className="mt-5 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[#738078]">
              <Spinner />
              Проверка Telegram
            </div>
          ) : null}

          {error ? (
            <div role="alert" className="mt-5 rounded-2xl border border-[#b42318]/40 bg-[#2a1110] px-4 py-3 text-sm text-[#ffb4a9]">
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
      return requestedPath === "/app/billing" ? "/app/billing" : "/app/studio";
    }
  } catch {
    // The normal API interceptor will handle invalid access; keep a safe fallback here.
  }

  return sanitizeReturnPath(requestedPath);
}

function sanitizeReturnPath(requestedPath?: string) {
  if (!requestedPath) return "/app";
  const normalized = requestedPath.replace(/\\/g, "/");
  if (normalized === "/app" || normalized.startsWith("/app/")) return normalized;
  return "/app";
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
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#dbe6dd] bg-white p-4 text-sm leading-6 text-[#60716a] transition hover:border-[#aeb8b0]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-5 w-5 shrink-0 rounded border-[#d5e0d9] bg-transparent accent-[#315b46]"
      />
      <span>{children}</span>
    </label>
  );
}

async function loadTelegramWebAppScript() {
  if (window.Telegram?.WebApp) {
    return;
  }

  const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://telegram.org/js/telegram-web-app.js"]');
  if (!existingScript) {
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-web-app.js";
    document.head.appendChild(script);
  }

  const deadline = Date.now() + 4000;
  while (!window.Telegram?.WebApp && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
}
