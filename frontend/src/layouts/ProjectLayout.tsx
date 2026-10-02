import { useEffect, useState } from "react";
import { Link, Outlet, useParams } from "react-router-dom";

import { getProjectDashboard, type ProjectDashboard } from "../api/client";
import { AppShell } from "../components/AppShell";
import { type FloatingDockItem } from "../components/FloatingDock";

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
              Профилю нужен повторный вход
            </p>
            <p className="mt-1 text-sm leading-6 text-[#7a5b22]">
              Тексты и расписание сохранены. Публикации продолжатся после
              проверки доступа.
            </p>
          </div>
        </div>
        <Link
          to={`${projectBasePath}/settings`}
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-[#141815] px-5 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e] sm:w-fit"
        >
          Обновить доступ
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
              Прокси временно не отвечает
            </p>
            <p className="mt-1 text-sm leading-6 text-[#7a5b22]">
              Данные входа в порядке. Система сама проверяет соединение и вернёт
              профиль в работу, когда оно стабилизируется.
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
