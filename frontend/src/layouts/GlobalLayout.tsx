import { Outlet } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import type { FloatingDockItem } from "../components/FloatingDock";

const navigation: FloatingDockItem[] = [
  { label: "Черновики", to: "/app/studio", icon: "spark" },
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
    <AppShell navigation={navigation}>
      <Outlet />
    </AppShell>
  );
}
