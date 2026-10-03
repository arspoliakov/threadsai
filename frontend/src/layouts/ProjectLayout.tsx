import { useEffect, useState } from "react";
import { Link, Outlet, useParams, useLocation } from "react-router-dom";

import { getProjectDashboard, type ProjectDashboard } from "../api/client";
import { AppShell } from "../components/AppShell";
import { type FloatingDockItem } from "../components/FloatingDock";

export default function ProjectLayout() {
  const { id } = useParams();
  const { pathname } = useLocation();
  const projectBasePath = `/app/projects/${id}`;
  const [dashboard, setDashboard] = useState<ProjectDashboard | null>(null);

  useEffect(() => {
    const projectId = Number(id);
    if (!Number.isFinite(projectId)) {
      return;
    }

    let active = true;
    function refresh() {
      void getProjectDashboard(projectId)
        .then(result => { if (active) setDashboard(result); })
        .catch(() => { if (active) setDashboard(null); });
    }
    refresh();
    window.addEventListener("threadsgo:project-updated", refresh);
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("threadsgo:project-updated", refresh); window.removeEventListener("focus", refresh); };
  }, [id, pathname]);

  const projectTitle = dashboard?.project.name || "Загружаем проект";
  const hasSessionProblem =
    dashboard?.account_states.some(
      (account) =>
        account.status === "cookies_expired" ||
        account.status === "blocked" ||
        account.status === "error",
    ) ?? false;
  const hasProxyPause =
    dashboard?.account_states.some(
      (account) => account.status === "proxy_error",
    ) ?? false;

  const navigation: FloatingDockItem[] = [
    {
      label: "Проекты",
      to: "/app",
      icon: "home",
      end: true,
    },
    {
      label: "Обзор",
      to: projectBasePath,
      icon: "overview",
      end: true,
    },
    {
      label: "Посты",
      to: `${projectBasePath}/queue`,
      icon: "queue",
    },
    {
      label: "Идеи",
      to: `${projectBasePath}/trends`,
      icon: "trends",
    },
    {
      label: "Настройки",
      to: `${projectBasePath}/settings`,
      icon: "settings",
    },
  ];

  return (
    <AppShell navigation={navigation} title={projectTitle}>
      {hasSessionProblem ? (
        <SessionWarningBanner projectBasePath={projectBasePath} />
      ) : null}
      {!hasSessionProblem && hasProxyPause ? (
        <ProxyWarningBanner projectBasePath={projectBasePath} />
      ) : null}
      <Outlet />
    </AppShell>
  );
}

function SessionWarningBanner({
  projectBasePath,
}: {
  projectBasePath: string;
}) {
  return (
    <div className="mb-5 overflow-hidden rounded-[2rem] border border-[#ffd48a] bg-[#fff7e6] p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-[#ffb020]" />
          <div>
            <p className="text-base font-medium text-[#3b2a08]">
              Аккаунту нужна проверка
            </p>
            <p className="mt-1 text-sm leading-6 text-[#7a5b22]">
              Тексты сохранены. Откройте настройки и посмотрите причину паузы:
              может потребоваться повторный вход или проверка Threads.
            </p>
          </div>
        </div>
        <Link
          to={`${projectBasePath}/settings#profiles`}
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-[#141815] px-5 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e] sm:w-fit"
        >
          Проверить аккаунты
        </Link>
      </div>
    </div>
  );
}

function ProxyWarningBanner({ projectBasePath }: { projectBasePath: string }) {
  return (
    <div className="mb-5 overflow-hidden rounded-[2rem] border border-[#ffd48a] bg-[#fff7e6] p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-[#ffb020]" />
          <div>
            <p className="text-base font-medium text-[#3b2a08]">
              Соединение временно недоступно
            </p>
            <p className="mt-1 text-sm leading-6 text-[#7a5b22]">
              Публикации приостановлены из-за соединения. Сервис попробует восстановить его.
              Данные входа менять только из-за этой ошибки не нужно.
            </p>
          </div>
        </div>
        <Link
          to={`${projectBasePath}/settings`}
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-[#141815] px-5 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e] sm:w-fit"
        >
          Открыть настройки
        </Link>
      </div>
    </div>
  );
}
