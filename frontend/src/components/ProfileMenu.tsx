import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getCurrentUser, type CurrentUser } from "../api/client";
import { logout } from "../auth";
import { AppIcon } from "./AppIcons";
import { RESTART_ONBOARDING_EVENT } from "./OnboardingTour";

export function ProfileMenu() {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    void getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
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
      >
        <Avatar user={user} sizeClass="h-9 w-9" />
        <span className="hidden max-w-32 truncate text-sm sm:block">{displayName}</span>
      </button>

      {isOpen ? (
        <div className="absolute right-0 top-[calc(100%+0.75rem)] z-50 w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-[1.8rem] border border-[#dfe4dc] bg-[#fbfcf7] p-3 shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
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
            <div className="relative h-28 overflow-hidden bg-[#07100e]">
              <img src="/interface/billing-soon.webp" alt="" className="h-full w-full object-cover opacity-82" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#07100e]/90 via-[#07100e]/35 to-transparent" />
              <div className="absolute bottom-3 left-4 right-4">
                <p className="text-sm font-medium text-white">{subscriptionLabel}</p>
              </div>
            </div>
            <div className="p-4">
              <p className="text-sm leading-6 text-[#5d665d]">
                Открыть тарифы, пробный период и управление подпиской через Tribute.
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={handleRestartOnboarding}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-[#dfe4dc] bg-white px-5 text-sm text-[#07100e] transition hover:border-[#07100e] hover:bg-[#eef4ec]"
          >
            <AppIcon name="spark" className="h-4 w-4" />
            Пройти обучение заново
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
