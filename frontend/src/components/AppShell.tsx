import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { AppIcon } from "./AppIcons";
import { FloatingDock, type FloatingDockItem } from "./FloatingDock";
import { ProfileMenu } from "./ProfileMenu";
import { ThemeToggle } from "./ThemeToggle";
import { OnboardingTour } from "./OnboardingTour";

export function AppShell({
  navigation,
  title = "Рабочее пространство",
  children,
}: {
  navigation: FloatingDockItem[];
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="app-refresh min-h-screen bg-[#f6f8f7] text-[#162b25]">
      <a
        href="#workspace-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-white focus:p-4"
      >
        К содержимому
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-[#e0e8e2] bg-white px-4 py-7 lg:flex">
        <Link
          to="/app"
          className="flex items-center gap-3 px-3 text-xl font-bold tracking-tight"
        >
          <img
            src="/threadsgo-logo.png"
            alt=""
            className="h-9 w-9 object-contain"
          />
          ThreadsGo
        </Link>
        <p className="mb-3 mt-10 px-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#8a9890]">
          Рабочее пространство
        </p>
        <nav aria-label="Навигация кабинета" className="space-y-1">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? item.to === "/app"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition ${isActive ? "bg-[#e9f1eb] text-[#315b46]" : "text-[#67786e] hover:bg-[#f5f8f6] hover:text-[#162b25]"}`
              }
            >
              <AppIcon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-1 pt-8">
          <Link
            to="/app/billing"
            className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-[#67786e] hover:bg-[#f5f8f6]"
          >
            <AppIcon name="user" />
            Моя подписка
          </Link>
          <Link
            to="/app/how-it-works"
            className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-[#67786e] hover:bg-[#f5f8f6]"
          >
            <AppIcon name="spark" />
            Как начать
          </Link>
          <Link
            to="/updates/"
            className="flex items-center justify-between rounded-xl bg-[#f5f8f6] px-3 py-3 text-xs font-medium text-[#49705a]"
          >
            Что нового в ThreadsGo <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </aside>
      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 border-b border-[#e0e8e2] bg-white/95 px-4 py-3 backdrop-blur-xl sm:px-8">
          <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <Link to="/app" aria-label="Все проекты" className="lg:hidden">
                <img
                  src="/threadsgo-logo.png"
                  alt=""
                  className="h-9 w-9 object-contain"
                />
              </Link>
              <div className="min-w-0">
                <p className="hidden text-[10px] font-medium text-[#8a9890] sm:block">
                  ThreadsGo / кабинет
                </p>
                <p className="truncate text-sm font-semibold">{title}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2"><ThemeToggle /><ProfileMenu /></div>
          </div>
        </header>
        <main
          id="workspace-content"
          className="mx-auto max-w-[1320px] px-4 pb-28 pt-6 sm:px-8 sm:pt-9 lg:pb-8"
        >
          {children}
          <footer className="mt-12 border-t border-[#e0e8e2] pt-5 text-xs leading-6 text-[#8a9890]">
            <div className="flex flex-wrap gap-5">
              <Link to="/updates/">Что нового</Link>
              <Link to="/terms">Условия и политика</Link>
              <a
                href="https://t.me/cuartenlol"
                target="_blank"
                rel="noreferrer"
              >
                Поддержка ↗
              </a>
            </div>
            <p className="mt-3">
              *Meta Platforms Inc. признана экстремистской организацией; её деятельность запрещена в России.
            </p>
          </footer>
        </main>
      </div>
      <div className="lg:hidden">
        <FloatingDock
          items={navigation.map((item) => ({
            ...item,
            end: item.end ?? item.to === "/app",
          }))}
        />
      </div>
      <OnboardingTour />
    </div>
  );
}
