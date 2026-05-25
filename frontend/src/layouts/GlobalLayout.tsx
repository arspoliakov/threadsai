import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { logout } from "../auth";
import { AppIcon, type AppIconName } from "../components/AppIcons";
import { MobileTabBar, type MobileTabItem } from "../components/MobileTabBar";
import { ProfileMenu } from "../components/ProfileMenu";

const navigation: Array<MobileTabItem & { hint: string }> = [
  {
    label: "Проекты",
    hint: "контент и расписание",
    to: "/app",
    icon: "home",
    end: true,
  },
  {
    label: "Аккаунты",
    hint: "Threads-профили",
    to: "/app/infrastructure",
    icon: "accounts",
  },
  {
    label: "Стиль",
    hint: "глобальный промпт",
    to: "/app/settings",
    icon: "style",
  },
  {
    label: "Выйти",
    hint: "завершить сессию",
    to: "/",
    icon: "logout",
  },
];

export default function GlobalLayout() {
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/", { replace: true });
  }

  const mobileItems = navigation.slice(0, 3).map((item) => ({
    label: item.label,
    to: item.to,
    icon: item.icon,
    end: item.end,
  }));

  return (
    <div className="min-h-screen bg-[#f5f6f1] text-[#111]">
      <div className="flex min-h-screen flex-col lg:grid lg:grid-cols-[312px_1fr]">
        <aside className="hidden border-r border-white/10 bg-[#070909] text-[#f4f1ea] lg:block">
          <div className="sticky top-0 flex h-screen flex-col overflow-hidden">
            <div className="pointer-events-none absolute left-[-8rem] top-[-8rem] h-72 w-72 rounded-full bg-[#0076ff]/24 blur-[90px]" />
            <div className="pointer-events-none absolute bottom-[-10rem] right-[-10rem] h-80 w-80 rounded-full bg-[#70ff35]/14 blur-[100px]" />

            <div className="relative px-6 py-7">
              <NavLink to="/app" className="flex items-center gap-3">
                <span className="grid h-14 w-14 place-items-center rounded-3xl border border-white/10 bg-white/[0.06]">
                  <img src="/threadsgo-logo.png" alt="ThreadsGo" className="h-10 w-10 object-contain" />
                </span>
                <span className="font-display text-3xl leading-none tracking-[-0.04em] text-white">
                  ThreadsGo
                </span>
              </NavLink>
            </div>

            <nav className="relative grid gap-3 px-4">
              {navigation.slice(0, 3).map((item) => (
                <SidebarLink key={item.to} {...item} />
              ))}
            </nav>

            <div className="relative mt-auto p-4">
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/14 bg-white/[0.04] px-4 py-3 text-sm text-white/62 transition hover:border-white/35 hover:bg-white hover:text-[#070909]"
              >
                <AppIcon name="logout" className="h-4 w-4" />
                Выйти
              </button>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-28 lg:pb-0">
          <header className="sticky top-0 z-30 border-b border-[#d9ddd4] bg-[#f5f6f1]/86 px-4 py-3 backdrop-blur-2xl sm:px-6 lg:px-10 lg:py-5">
            <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
              <div className="flex items-center gap-3 lg:hidden">
                <span className="grid h-11 w-11 place-items-center rounded-2xl border border-[#dfe4dc] bg-white shadow-sm">
                  <img src="/threadsgo-logo.png" alt="ThreadsGo" className="h-8 w-8 object-contain" />
                </span>
                <div>
                  <p className="text-xs text-[#6d746d]">панель управления</p>
                  <h1 className="font-display text-2xl leading-none tracking-[-0.04em]">ThreadsGo</h1>
                </div>
              </div>

              <div className="hidden lg:block">
                <p className="text-sm text-[#6d746d]">Панель управления</p>
                <h1 className="font-display text-4xl leading-none tracking-[-0.04em] text-[#111]">
                  Кабинет
                </h1>
              </div>

              <ProfileMenu />
            </div>
          </header>

          <section className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 sm:py-8 lg:px-10">
            <Outlet />
          </section>
        </main>
      </div>

      <MobileTabBar items={mobileItems} />
    </div>
  );
}

function SidebarLink({
  label,
  hint,
  to,
  icon,
  end,
}: {
  label: string;
  hint: string;
  to: string;
  icon: AppIconName;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          "group flex items-center gap-3 rounded-3xl px-4 py-4 transition",
          isActive
            ? "bg-white text-[#07100e] shadow-[0_20px_70px_rgba(0,0,0,0.22)]"
            : "text-white/58 hover:bg-white/[0.06] hover:text-white",
        ].join(" ")
      }
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-current/12 bg-current/[0.04]">
        <AppIcon name={icon} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-base">{label}</span>
        <span className="mt-0.5 block truncate text-xs opacity-48">{hint}</span>
      </span>
    </NavLink>
  );
}
