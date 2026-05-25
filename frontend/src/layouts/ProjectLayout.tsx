import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";

import { getProjectDashboard, type ProjectDashboard } from "../api/client";
import { AppIcon, type AppIconName } from "../components/AppIcons";
import { MobileTabBar, type MobileTabItem } from "../components/MobileTabBar";

const sections: Array<MobileTabItem & { hint: string; suffix: string }> = [
  {
    label: "Сводка",
    hint: "статус и запуск",
    suffix: "",
    to: "",
    icon: "overview",
    end: true,
  },
  {
    label: "Посты",
    hint: "очередь публикаций",
    suffix: "/queue",
    to: "",
    icon: "queue",
  },
  {
    label: "Тренды",
    hint: "сигналы из ленты",
    suffix: "/trends",
    to: "",
    icon: "trends",
  },
  {
    label: "Настройки",
    hint: "аккаунты и стиль",
    suffix: "/settings",
    to: "",
    icon: "settings",
  },
];

export default function ProjectLayout() {
  const { id } = useParams();
  const projectBasePath = `/app/projects/${id}`;
  const [dashboard, setDashboard] = useState<ProjectDashboard | null>(null);

  useEffect(() => {
    const projectId = Number(id);
    if (!Number.isFinite(projectId)) {
      return;
    }

    void getProjectDashboard(projectId)
      .then(setDashboard)
      .catch(() => setDashboard(null));
  }, [id]);

  const projectTitle = dashboard?.project.name || `Проект #${id}`;
  const hasDeadSession =
    dashboard?.account_states.some(
      (account) => account.status === "cookies_expired" || account.status === "blocked",
    ) ?? false;

  const mobileItems = sections.map((item) => ({
    label: item.label,
    to: `${projectBasePath}${item.suffix}`,
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
              <Link to="/app" className="inline-flex items-center gap-2 text-sm text-white/58 transition hover:text-white">
                <span className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/[0.05]">
                  <AppIcon name="home" className="h-5 w-5" />
                </span>
                к проектам
              </Link>

              <div className="mt-6 flex items-center gap-3">
                <span className="grid h-14 w-14 place-items-center rounded-3xl border border-white/10 bg-white/[0.06]">
                  <img src="/threadsgo-logo.png" alt="ThreadsGo" className="h-10 w-10 object-contain" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-white/42">рабочий контур</p>
                  <h1 className="truncate font-display text-3xl leading-none tracking-[-0.04em] text-white">
                    {projectTitle}
                  </h1>
                </div>
              </div>
            </div>

            <nav className="relative grid gap-3 px-4">
              {sections.map((item) => (
                <SidebarLink
                  key={item.suffix || "overview"}
                  label={item.label}
                  hint={item.hint}
                  to={`${projectBasePath}${item.suffix}`}
                  icon={item.icon}
                  end={item.end}
                />
              ))}
            </nav>

            <div className="relative mt-auto p-4">
              <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center gap-2 text-sm text-white">
                  <span className={hasDeadSession ? "h-2.5 w-2.5 rounded-full bg-[#ffb020]" : "h-2.5 w-2.5 rounded-full bg-[#70ff35]"} />
                  {hasDeadSession ? "нужны cookies" : "публикация готова"}
                </div>
                <p className="mt-3 text-xs leading-5 text-white/52">
                  {hasDeadSession
                    ? "Threads-сессия слетела. Обновите cookies в настройках проекта."
                    : "Генерация, тренды и очередь работают в фоне."}
                </p>
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-28 lg:pb-0">
          <header className="sticky top-0 z-30 border-b border-[#d9ddd4] bg-[#f5f6f1]/86 px-4 py-3 backdrop-blur-2xl sm:px-6 lg:px-10 lg:py-5">
            <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <Link
                  to="/app"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#dfe4dc] bg-white shadow-sm transition hover:bg-[#07100e] hover:text-white lg:hidden"
                  aria-label="К проектам"
                >
                  <AppIcon name="home" className="h-5 w-5" />
                </Link>
                <div className="min-w-0">
                  <p className="text-xs text-[#6d746d]">проект</p>
                  <h1 className="truncate font-display text-2xl leading-none tracking-[-0.04em] sm:text-3xl lg:text-4xl">
                    {projectTitle}
                  </h1>
                </div>
              </div>

              <div
                className={[
                  "hidden items-center gap-2 rounded-full border bg-white px-4 py-2 text-sm shadow-sm sm:inline-flex",
                  hasDeadSession
                    ? "border-[#ffd48a] text-[#7d4b00]"
                    : "border-[#d6ddd2] text-[#4f584f]",
                ].join(" ")}
              >
                <span className={hasDeadSession ? "h-2.5 w-2.5 rounded-full bg-[#ffb020]" : "h-2.5 w-2.5 rounded-full bg-[#70ff35]"} />
                {hasDeadSession ? "cookies истекли" : "аккаунт готов"}
              </div>
            </div>
          </header>

          <section className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 sm:py-8 lg:px-10">
            {hasDeadSession ? <SessionWarningBanner projectBasePath={projectBasePath} /> : null}
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

function SessionWarningBanner({ projectBasePath }: { projectBasePath: string }) {
  return (
    <div className="mb-5 overflow-hidden rounded-[2rem] border border-[#ffd48a] bg-[#fff7e6] p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-[#ffb020]" />
          <div>
            <p className="text-base font-medium text-[#3b2a08]">Сессия Threads истекла</p>
            <p className="mt-1 text-sm leading-6 text-[#7a5b22]">
              Генерация работает, но публикация остановлена до обновления cookies.
            </p>
          </div>
        </div>
        <Link
          to={`${projectBasePath}/settings`}
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-[#141815] px-5 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e] sm:w-fit"
        >
          Обновить cookies
        </Link>
      </div>
    </div>
  );
}
