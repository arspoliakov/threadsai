import { useCallback, useEffect, useRef, useState } from "react";

import {
  TelegramBotChallenge,
  TelegramBotLoginError,
  cancelTelegramBotLogin,
  completeTelegramBotLogin,
  getTelegramBotLoginStatus,
  setStoredAuthToken,
  startTelegramBotLogin,
} from "../api/client";
import { getSeoAttribution } from "../components/SeoAnalytics";

const STORAGE_KEY = "threadsgo.telegram_bot_login";

export type BotLoginPhase = "idle" | "starting" | "waiting" | "finishing" | "expired" | "denied" | "cancelled";

export function useTelegramBotLogin(onAuthenticated: () => Promise<void>) {
  const [challenge, setChallenge] = useState<TelegramBotChallenge | null>(() => readStoredChallenge());
  const [phase, setPhase] = useState<BotLoginPhase>(() => (readStoredChallenge() ? "waiting" : "idle"));
  const [message, setMessage] = useState<string | null>(null);
  const [pollTick, setPollTick] = useState(0);
  const timerRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const checkingRef = useRef(false);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearAttempt = useCallback(() => {
    generationRef.current += 1;
    stopTimer();
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // The in-memory state is still enough until the page is closed.
    }
    setChallenge(null);
  }, [stopTimer]);

  const finish = useCallback(
    async (active: TelegramBotChallenge, generation: number) => {
      setPhase("finishing");
      setMessage("Подтверждение получено. Завершаем вход…");
      try {
        const response = await completeTelegramBotLogin(active);
        if (generation !== generationRef.current) return;
        setStoredAuthToken(response.access_token);
        clearAttempt();
        await onAuthenticated();
      } catch (error) {
        if (generation !== generationRef.current) return;
        const loginError = error instanceof TelegramBotLoginError ? error : null;
        if (loginError?.code === "challenge_pending") {
          setPhase("waiting");
          return;
        }
        if (loginError?.code === "challenge_expired" || loginError?.code === "challenge_consumed") {
          setPhase("expired");
          setMessage(loginError.message);
          return;
        }
        if (loginError?.code === "challenge_denied") {
          setPhase("denied");
          setMessage(loginError.message);
          return;
        }
        setPhase("waiting");
        setMessage(loginError?.message || "Не удалось завершить вход. Повторим проверку.");
      }
    },
    [clearAttempt, onAuthenticated],
  );

  const checkNow = useCallback(async () => {
    const active = challenge;
    if (!active || checkingRef.current || document.visibilityState === "hidden") return;
    checkingRef.current = true;
    const generation = generationRef.current;
    try {
      const result = await getTelegramBotLoginStatus(active);
      if (generation !== generationRef.current) return;
      if (result.status === "approved" || result.status === "consumed") {
        await finish(active, generation);
      } else if (result.status === "expired") {
        setPhase("expired");
        setMessage("Время подтверждения истекло. Начните вход заново.");
      } else if (result.status === "denied") {
        setPhase("denied");
        setMessage("Вы отменили вход в Telegram.");
      } else if (result.status === "cancelled") {
        setPhase("cancelled");
        setMessage("Попытка входа отменена.");
      } else {
        setPhase("waiting");
        setMessage(null);
      }
    } catch (error) {
      if (generation !== generationRef.current) return;
      const loginError = error instanceof TelegramBotLoginError ? error : null;
      if (loginError?.code === "challenge_invalid" || loginError?.code === "challenge_expired") {
        setPhase("expired");
      }
      setMessage(loginError?.message || "Не удалось проверить подтверждение. Попробуем ещё раз.");
    } finally {
      checkingRef.current = false;
      if (generation === generationRef.current) setPollTick((value) => value + 1);
    }
  }, [challenge, finish]);

  useEffect(() => {
    stopTimer();
    if (!challenge || !["waiting", "finishing"].includes(phase)) return;
    const delay = Math.max(2000, challenge.poll_interval_ms || 3000);
    timerRef.current = window.setTimeout(() => void checkNow(), phase === "finishing" ? 1000 : delay);
    return stopTimer;
  }, [challenge, checkNow, phase, pollTick, stopTimer]);

  useEffect(() => {
    const resume = () => {
      if (document.visibilityState !== "hidden") void checkNow();
    };
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [checkNow]);

  useEffect(() => {
    if (challenge) void checkNow();
    // Only recover once after mount; further checks are driven by the polling loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(
    async (telegramWindow: Window | null) => {
      if (phase === "starting" || phase === "finishing") return;
      generationRef.current += 1;
      const generation = generationRef.current;
      stopTimer();
      setPhase("starting");
      setMessage(null);
      try {
        const created = await startTelegramBotLogin(getSeoAttribution());
        if (generation !== generationRef.current) return;
        try {
          window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(created));
        } catch {
          telegramWindow?.close();
          setPhase("idle");
          setMessage("Браузер не разрешил сохранить попытку входа. Разрешите хранение данных сайта и попробуйте снова.");
          return;
        }
        setChallenge(created);
        setPhase("waiting");
        if (telegramWindow && !telegramWindow.closed) {
          telegramWindow.opener = null;
          telegramWindow.location.href = created.bot_url;
        }
      } catch (error) {
        telegramWindow?.close();
        if (generation !== generationRef.current) return;
        setPhase("idle");
        setMessage(error instanceof TelegramBotLoginError ? error.message : "Не удалось начать вход через бота.");
      }
    },
    [phase, stopTimer],
  );

  const cancel = useCallback(async () => {
    const active = challenge;
    if (active) {
      try {
        await cancelTelegramBotLogin(active);
      } catch {
        // The local attempt is cancelled even if the network is temporarily unavailable.
      }
    }
    clearAttempt();
    setPhase("cancelled");
    setMessage("Попытка входа отменена.");
  }, [challenge, clearAttempt]);

  const reset = useCallback(() => {
    clearAttempt();
    setPhase("idle");
    setMessage(null);
  }, [clearAttempt]);

  return { challenge, phase, message, start, cancel, reset, checkNow };
}

function readStoredChallenge(): TelegramBotChallenge | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<TelegramBotChallenge>;
    if (!value.challenge_id || !value.browser_secret || !value.bot_url || !value.expires_at) return null;
    return value as TelegramBotChallenge;
  } catch {
    return null;
  }
}
