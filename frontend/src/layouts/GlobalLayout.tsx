import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { getCurrentUser, getProjects } from "../api/client";
import { AppShell } from "../components/AppShell";
import type { FloatingDockItem } from "../components/FloatingDock";
export default function GlobalLayout() {
  const [projectId, setProjectId] = useState<number | null>(null);
  useEffect(() => { let active = true; void Promise.all([getProjects(), getCurrentUser()]).then(([items, user]) => { if (active) { try { const selected = Number(window.sessionStorage.getItem(`threadsgo.current-project.${user.id}`)); setProjectId(items.some(item => item.id === selected) ? selected : items[0]?.id ?? null); } catch { setProjectId(items[0]?.id ?? null); } } }).catch(() => {}); return () => { active = false; }; }, []);
  const base = projectId ? `/app/projects/${projectId}` : "/app/setup";
  const navigation: FloatingDockItem[] = projectId ? [
    { label: "Обзор", to: base, icon: "overview", end: true },
    { label: "Посты", to: `${base}/queue`, icon: "queue" },
    { label: "Настройки", to: `${base}/settings`, icon: "settings" },
  ] : [{ label: "Начать", to: "/app/setup", icon: "spark" }, { label: "Проекты", to: "/app?manage=1", icon: "home", end: true }];
  return <AppShell navigation={navigation}><Outlet /></AppShell>;
}
