import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";

import { getProjectDashboard, type ProjectDashboard } from "../api/client";

const sections = [
  { label: "Сводка", suffix: "" },
  { label: "Очередь", suffix: "/queue" },
  { label: "Тренды", suffix: "/trends" },
  { label: "Настройки и Аккаунты", suffix: "/settings" },
];

export default function ProjectLayout() {
  const { id } = useParams();
  const projectBasePath = `/projects/${id}`;
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

  const projectTitle = dashboard?.project.name || `Project #${id}`;
  const hasDeadSession = dashboard?.account_states.some((account) =>
    account.status === "cookies_expired" || account.status === "blocked"
  ) ?? false;

  return (
    <div className="min-h-screen bg-[#e8e8e4] text-[#151515]">
      <div className="grid min-h-screen lg:grid-cols-[272px_1fr]">
        <aside className="border-r border-black bg-[#141414] text-[#f4f1ea]">
          <div className="border-b border-white/10 px-6 py-7">
            <Link
              to="/"
              className="inline-block font-mono text-[11px] uppercase tracking-[0.18em] text-white/55 transition hover:text-white"
            >
              ← Назад к проектам
            </Link>
            <h1 className="mt-5 font-display text-2xl leading-none text-white">
              {projectTitle}
            </h1>
          </div>

          <nav className="grid border-b border-white/10">
            {sections.map((item, index) => (
              <NavLink
                key={item.suffix || "overview"}
                to={`${projectBasePath}${item.suffix}`}
                end={item.suffix === ""}
                className={({ isActive }) =>
                  [
                    "grid grid-cols-[36px_1fr] border-t border-white/10 px-6 py-4 text-sm transition",
                    isActive
                      ? "bg-[#f4f1ea] text-[#141414]"
                      : "text-white/60 hover:bg-white/[0.06] hover:text-white",
                  ].join(" ")
                }
              >
                <span className="font-mono text-[11px] opacity-50">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="px-6 py-8">
            <p className="font-mono text-[11px] uppercase leading-6 tracking-[0.18em] text-white/35">
              Project workspace
              <br />
              isolated queue / trends / accounts
            </p>
          </div>
        </aside>

        <main className="min-w-0 bg-[#f6f6f2]">
          <header className="border-b border-[#c9c9c3] px-6 py-6 md:px-10">
            <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-[#77766f]">
              Project control plane
            </p>
            <h2 className="mt-2 font-display text-4xl leading-none tracking-tight">
              {projectTitle}
            </h2>
          </header>

          <section className="px-6 py-8 md:px-10">
            {hasDeadSession ? (
              <SessionWarningBanner projectBasePath={projectBasePath} />
            ) : null}
            <Outlet />
          </section>
        </main>
      </div>
    </div>
  );
}

function SessionWarningBanner({ projectBasePath }: { projectBasePath: string }) {
  return (
    <div className="mb-6 rounded-3xl border border-[#d88a35]/40 bg-[#fff4df] p-5 text-[#4a2b08] shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#9b5c13]">
            Session health warning
          </p>
          <p className="mt-2 text-sm leading-6">
            ⚠️ Сессия Threads истекла. Генерация работает, но публикация приостановлена.
          </p>
        </div>
        <Link
          to={`${projectBasePath}/settings`}
          className="w-fit rounded-2xl border border-[#4a2b08] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] transition-all duration-200 ease-in-out hover:bg-[#4a2b08] hover:text-white"
        >
          Обновить Cookies
        </Link>
      </div>
    </div>
  );
}
