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
    setDashboard(null);
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
  const navigation: FloatingDockItem[] = [
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
      label: "Настройки",
      to: `${projectBasePath}/settings`,
      icon: "settings",
    },
  ];

  return (
    <AppShell navigation={navigation} title={projectTitle}>
      {pathname.replace(/\/$/, "") !== projectBasePath && dashboard?.workflow?.blockers?.length ? <div className="mb-5 space-y-3" aria-label="Что мешает работе проекта">{dashboard.workflow.blockers.map(blocker => <div key={blocker.code} className="flex flex-col gap-3 rounded-2xl border border-[var(--workspace-warning-border)] bg-[var(--workspace-warning-bg)] p-4 text-[var(--workspace-warning-ink)] sm:flex-row sm:items-center sm:justify-between"><p className="text-sm leading-6">{blocker.message}</p><Link to={blocker.action_href} className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-current px-4 text-sm font-medium">{blocker.action_label}</Link></div>)}</div> : null}
      <Outlet />
    </AppShell>
  );
}
