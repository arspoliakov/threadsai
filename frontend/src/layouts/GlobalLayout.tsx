import { Outlet } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import type { FloatingDockItem } from "../components/FloatingDock";
const navigation: FloatingDockItem[] = [
  { label: "Проекты", to: "/app", icon: "folder", end: true },
  { label: "Все аккаунты", to: "/app/infrastructure", icon: "accounts" },
  { label: "Настройки", to: "/app/settings", icon: "settings" },
];
export default function GlobalLayout() {
  return <AppShell navigation={navigation} title="Общее меню"><Outlet /></AppShell>;
}
