import { NavLink, Outlet } from "react-router-dom";

import { FloatingDock, type FloatingDockItem } from "../components/FloatingDock";
import { ProfileMenu } from "../components/ProfileMenu";

const navigation: FloatingDockItem[] = [
  {
    label: "Проекты",
    to: "/app",
    icon: "home",
    end: true,
  },
  {
    label: "Аккаунты",
    to: "/app/infrastructure",
    icon: "accounts",
  },
  {
    label: "Стиль",
    to: "/app/settings",
    icon: "style",
  },
];

export default function GlobalLayout() {
  return (
    <div className="min-h-screen bg-[#f5f6f1] text-[#111]">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_16%_0%,rgba(0,118,255,0.14),transparent_34%),radial-gradient(circle_at_82%_8%,rgba(112,255,53,0.14),transparent_30%)]" />

      <header className="sticky top-0 z-30 border-b border-[#d9ddd4]/85 bg-[#f5f6f1]/82 px-4 py-3 backdrop-blur-2xl sm:px-6 lg:px-10 lg:py-4">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
          <NavLink to="/app" className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#dfe4dc] bg-white shadow-sm sm:h-12 sm:w-12">
              <img src="/threadsgo-logo.png" alt="ThreadsGo" className="h-8 w-8 object-contain sm:h-9 sm:w-9" />
            </span>
            <div className="min-w-0">
              <p className="text-xs leading-none text-[#6d746d]">рабочая панель</p>
              <h1 className="truncate font-display text-2xl leading-none tracking-[-0.04em] sm:text-3xl">
                ThreadsGo
              </h1>
            </div>
          </NavLink>

          <ProfileMenu />
        </div>
      </header>

      <main className="relative mx-auto max-w-[1440px] px-4 pb-32 pt-5 sm:px-6 sm:pb-36 sm:pt-8 lg:px-10">
        <Outlet />
      </main>

      <FloatingDock items={navigation} />
    </div>
  );
}
