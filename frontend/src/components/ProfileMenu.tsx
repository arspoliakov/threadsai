import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

import { apiClient, getApiErrorMessage, getCurrentUser, type CurrentUser } from "../api/client";
import { logout } from "../auth";
import { AppIcon } from "./AppIcons";
import { RESTART_ONBOARDING_EVENT } from "./OnboardingTour";

export function ProfileMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [messagePrefs, setMessagePrefs] = useState<{marketing_consent:boolean; onboarding_consent:boolean} | null>(null);
  const [messageError, setMessageError] = useState("");
  const [savingMessages, setSavingMessages] = useState(false);
  const [messageRetry, setMessageRetry] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("profile") === "messages") {
      setIsOpen(true); setMessagesOpen(true);
      params.delete("profile");
      navigate({pathname:location.pathname,search:params.toString()}, {replace:true});
    }
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!isOpen || !messagesOpen) return;
    let active = true;
    setMessageError("");
    void apiClient.get("/api/v1/retention/preferences").then(r => { if(active) setMessagePrefs(r.data); })
      .catch(e => {if(active) setMessageError(getApiErrorMessage(e,"Не удалось загрузить настройки."));});
    return () => {active=false;};
  }, [isOpen, messagesOpen, messageRetry]);

  async function updateMessages(kind:"marketing_consent"|"onboarding_consent", enabled:boolean) {
    if (!messagePrefs || savingMessages) return;
    setSavingMessages(true); setMessageError("");
    try {
      const result = await apiClient.put("/api/v1/retention/preferences", {...messagePrefs,[kind]:enabled});
      setMessagePrefs(result.data);
    } catch(e) {setMessageError(getApiErrorMessage(e,"Не удалось сохранить выбор."));}
    finally {setSavingMessages(false);}
  }

  useEffect(() => {
    void getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null));
  }, [isOpen]);

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentClick);
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => { document.removeEventListener("mousedown", handleDocumentClick); document.removeEventListener("keydown", handleEscape); };
  }, []);

  function handleLogout() {
    logout();
    navigate("/", { replace: true });
  }

  function handleRestartOnboarding() {
    setIsOpen(false);
    window.dispatchEvent(new Event(RESTART_ONBOARDING_EVENT));
  }

  function handleBillingClick() {
    setIsOpen(false);
    navigate("/app/billing");
  }

  const displayName = user?.first_name || user?.username || "Профиль";
  const handle = user?.username ? `@${user.username}` : user?.telegram_id ? `id ${user.telegram_id}` : "telegram";
  const subscriptionLabel = user?.subscription_status
    ? `Тариф ${formatTariffName(user.tariff_plan)}`
    : "Подписка пока не активна";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="group flex h-12 items-center gap-3 rounded-full border border-[#d6ddd2] bg-white p-1.5 pr-4 text-[#111] shadow-sm transition hover:border-[#141815] hover:shadow-md"
        aria-label="Открыть профиль"
        aria-expanded={isOpen}
      >
        <Avatar user={user} sizeClass="h-9 w-9" />
        <span className="hidden max-w-32 truncate text-sm sm:block">{displayName}</span>
      </button>

      {isOpen ? (
        <div className="absolute right-0 top-[calc(100%+0.75rem)] z-50 max-h-[calc(100dvh-6rem)] w-[min(21rem,calc(100vw-2rem))] overflow-y-auto rounded-[1.8rem] border border-[#dfe4dc] bg-[#fbfcf7] p-3 shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
          <div className="relative overflow-hidden rounded-[1.35rem] bg-[#07100e] p-3 text-white">
            <img
              src="/interface/profile-orb.webp"
              alt=""
              className="absolute -right-8 -top-10 h-32 w-32 object-cover opacity-45 mix-blend-screen"
            />
            <div className="relative flex items-center gap-3">
              <Avatar user={user} sizeClass="h-12 w-12" />
              <div className="min-w-0">
                <p className="truncate text-base font-medium">{displayName}</p>
                <p className="truncate text-sm text-white/55">{handle}</p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleBillingClick}
            className="mt-3 w-full overflow-hidden rounded-[1.35rem] border border-[#e2e7df] bg-white text-left transition hover:border-[#07100e]"
          >
            <div className="p-4">
              <p className="text-sm font-semibold text-[var(--workspace-ink)]">{subscriptionLabel}</p>
              <p className="text-sm leading-6 text-[#5d665d]">
                Управлять подпиской →
              </p>
            </div>
          </button>

          <button type="button" onClick={() => setMessagesOpen(v=>!v)} aria-expanded={messagesOpen} className="mt-3 flex h-12 w-full items-center justify-center rounded-full border bg-white text-sm">Настройки сообщений</button>
          {messagesOpen && <div className="mt-3 space-y-3 rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-panel)] p-4 text-sm text-[var(--workspace-ink)]">
            <p className="text-xs text-[var(--workspace-muted)]">Изменения сохраняются сразу. Отписаться также можно кнопкой в сообщении бота.</p>
            {messageError && <p role="alert">{messageError}</p>}
            {!messagePrefs ? (messageError ? <button type="button" className="underline" onClick={()=>setMessageRetry(value=>value+1)}>Попробовать снова</button> : <p>Загружаем…</p>) : <>
              <label className="flex items-start gap-3"><input type="checkbox" checked={messagePrefs.onboarding_consent} disabled={savingMessages} onChange={e=>void updateMessages("onboarding_consent",e.target.checked)}/><span>Помощь с началом работы</span></label>
              <label className="flex items-start gap-3"><input type="checkbox" checked={messagePrefs.marketing_consent} disabled={savingMessages} onChange={e=>void updateMessages("marketing_consent",e.target.checked)}/><span>Новости и рекламные предложения</span></label>
            </>}
          </div>}

          <button
            type="button"
            onClick={handleRestartOnboarding}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-[#dfe4dc] bg-white px-5 text-sm text-[#07100e] transition hover:border-[#07100e] hover:bg-[#eef4ec]"
          >
            <AppIcon name="spark" className="h-4 w-4" />
            Как пользоваться
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#141815] px-5 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e]"
          >
            <AppIcon name="logout" className="h-4 w-4" />
            Выйти из профиля
          </button>
        </div>
      ) : null}
    </div>
  );
}

function formatTariffName(value: string) {
  const names: Record<string, string> = {
    basic: "Basic",
    pro: "Pro",
    agency: "Agency",
  };
  return names[value.toLowerCase()] || value;
}
function Avatar({ user, sizeClass }: { user: CurrentUser | null; sizeClass: string }) {
  if (user?.photo_url) {
    return (
      <img
        src={user.photo_url}
        alt={user.first_name || user.username || "Telegram avatar"}
        className={`${sizeClass} shrink-0 rounded-full border border-[#dfe4dc] object-cover`}
      />
    );
  }

  const initials = (user?.first_name || user?.username || "T").slice(0, 1).toUpperCase();

  return (
    <span
      className={`${sizeClass} grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0076ff] via-[#00d4c8] to-[#70ff35] text-sm font-semibold text-white`}
    >
      {user ? initials : <AppIcon name="user" className="h-5 w-5" />}
    </span>
  );
}
