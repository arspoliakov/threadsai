import { NavLink, Outlet, useNavigate } from "react-router-dom";
import type { ComponentType } from "react";

import { logout } from "../auth";

const navigation = [
  {
    label: "Проекты",
    hint: "контент и расписание",
    to: "/app",
    icon: ProjectsIcon,
  },
  {
    label: "Аккаунты",
    hint: "Threads-профили",
    to: "/app/infrastructure",
    icon: AccountsIcon,
  },
  {
    label: "Стиль",
    hint: "глобальный промпт",
    to: "/app/settings",
    icon: StyleIcon,
  },
];

export default function GlobalLayout() {
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/", { replace: true });
  }

  return (
    <div className="min-h-screen bg-[#070909] text-[#151515]">
      <div className="grid min-h-screen lg:grid-cols-[292px_1fr]">
        <aside className="relative flex min-h-screen flex-col overflow-hidden border-r border-white/10 bg-[#0b0d0d] text-[#f4f1ea]">
          <div className="pointer-events-none absolute left-[-8rem] top-[-8rem] h-72 w-72 rounded-full bg-[#0076ff]/24 blur-[90px]" />
          <div className="pointer-events-none absolute bottom-[-10rem] right-[-10rem] h-80 w-80 rounded-full bg-[#70ff35]/14 blur-[100px]" />

          <div className="relative px-6 py-7">
            <NavLink to="/app" className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.06]">
                <img src="/threadsgo-logo.png" alt="ThreadsGo" className="h-9 w-9 object-contain" />
              </span>
              <span className="font-display text-3xl leading-none tracking-[-0.04em] text-white">
                ThreadsGo
              </span>
            </NavLink>
          </div>

          <nav className="relative grid gap-2 px-4">
            {navigation.map((item) => (
              <SidebarLink key={item.to} {...item} />
            ))}
          </nav>

          <div className="relative mt-auto p-4">
            <div className="mb-4 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#70ff35] opacity-60" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-[#70ff35]" />
                </span>
                <span className="text-sm text-white/72">Система активна</span>
              </div>
              <p className="mt-3 text-xs leading-5 text-white/38">
                Генерация, тренды и публикации работают в фоне.
              </p>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/14 bg-white/[0.04] px-4 py-3 text-sm text-white/62 transition hover:border-white/35 hover:bg-white hover:text-[#070909]"
            >
              <LogoutIcon />
              Выйти
            </button>
          </div>
        </aside>

        <main className="min-w-0 bg-[#f5f6f1]">
          <header className="flex items-center justify-between gap-4 border-b border-[#d9ddd4] px-5 py-5 sm:px-8 lg:px-10">
            <div className="flex items-center gap-3">
              <img src="/threadsgo-logo.png" alt="" className="h-9 w-9 object-contain lg:hidden" />
              <div>
                <p className="text-sm text-[#6d746d]">Панель управления</p>
                <h1 className="font-display text-3xl leading-none tracking-[-0.04em] text-[#111] sm:text-4xl">
                  Кабинет
                </h1>
              </div>
            </div>

            <div className="hidden items-center gap-2 rounded-full border border-[#cfd5cc] bg-white px-4 py-2 text-sm text-[#3f463f] shadow-sm sm:flex">
              <span className="h-2 w-2 rounded-full bg-[#70ff35]" />
              Онлайн
            </div>
          </header>

          <section className="px-5 py-7 sm:px-8 lg:px-10">
            <Outlet />
          </section>
        </main>
      </div>
    </div>
  );
}

function SidebarLink({
  label,
  hint,
  to,
  icon: Icon,
}: {
  label: string;
  hint: string;
  to: string;
  icon: ComponentType;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/app"}
      className={({ isActive }) =>
        [
          "group flex items-center gap-3 rounded-3xl px-4 py-4 transition",
          isActive
            ? "bg-white text-[#07100e] shadow-[0_20px_70px_rgba(0,0,0,0.22)]"
            : "text-white/58 hover:bg-white/[0.06] hover:text-white",
        ].join(" ")
      }
    >
      <span className="grid h-11 w-11 place-items-center rounded-2xl border border-current/12 bg-current/[0.04]">
        <Icon />
      </span>
      <span>
        <span className="block text-base">{label}</span>
        <span className="mt-0.5 block text-xs opacity-48">{hint}</span>
      </span>
    </NavLink>
  );
}

function ProjectsIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7.5h16M4 12h16M4 16.5h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function AccountsIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3.5 20c.6-3.2 2.3-5 5-5s4.4 1.8 5 5M17 8h4M17 13h4M17 18h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function StyleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 18.5c4.8-1 8.7-4.9 9.7-9.7l.4-2a1.8 1.8 0 0 1 3.5.7l-.4 2A14 14 0 0 1 7.5 20.2l-2 .4a1.8 1.8 0 0 1-.7-3.5l.2-.1ZM14 10l-2-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10 6H6.8A2.8 2.8 0 0 0 4 8.8v6.4A2.8 2.8 0 0 0 6.8 18H10M15 8l4 4-4 4M19 12H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
