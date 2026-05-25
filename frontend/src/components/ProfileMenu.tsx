import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getCurrentUser, type CurrentUser } from "../api/client";
import { logout } from "../auth";
import { AppIcon } from "./AppIcons";

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

  const displayName = user?.first_name || user?.username || "Профиль";
  const handle = user?.username ? `@${user.username}` : user?.telegram_id ? `id ${user.telegram_id}` : "telegram";

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
          <div className="flex items-center gap-3 rounded-[1.35rem] bg-[#eef4ec] p-3">
            <Avatar user={user} sizeClass="h-12 w-12" />
            <div className="min-w-0">
              <p className="truncate text-base font-medium text-[#111]">{displayName}</p>
              <p className="truncate text-sm text-[#687168]">{handle}</p>
            </div>
          </div>

          <div className="mt-3 rounded-[1.35rem] border border-[#e2e7df] bg-white p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[#8a9288]">профиль</p>
            <p className="mt-2 text-sm leading-6 text-[#5d665d]">
              Здесь позже появятся тариф, платежи и лимиты. Сейчас можно только выйти из кабинета.
            </p>
          </div>

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
