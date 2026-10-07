import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { getCurrentUser, getProjects, type Project } from "../api/client";

export function ProjectSwitcher() {
  const location = useLocation();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [storedId, setStoredId] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const selectedId = Number(location.pathname.match(/\/projects\/(\d+)/)?.[1]);
  useEffect(() => {
    let alive = true;
    const refresh = () => { void Promise.all([getProjects(), getCurrentUser()]).then(([items, user]) => { if (alive) { setProjects(items); setError(false); try { const key = `threadsgo.current-project.${user.id}`; if (Number.isFinite(selectedId) && items.some(item => item.id === selectedId)) { window.sessionStorage.setItem(key, String(selectedId)); setStoredId(selectedId); } else { const previous = Number(window.sessionStorage.getItem(key)); setStoredId(items.some(item => item.id === previous) ? previous : items[0]?.id ?? null); } } catch { setStoredId(items[0]?.id ?? null); } } }).catch(() => { if (alive) setError(true); }); };
    refresh();
    window.addEventListener("threadsgo:project-updated", refresh);
    return () => { alive = false; window.removeEventListener("threadsgo:project-updated", refresh); };
  }, [location.pathname]);
  const selected = projects.find(project => project.id === (Number.isFinite(selectedId) ? selectedId : storedId));
  return <details className="relative w-full min-w-0" key={location.pathname} onKeyDown={event => { if (event.key === "Escape") event.currentTarget.open = false; }}>
    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl border border-[var(--workspace-border)] bg-[var(--workspace-panel)] px-3 text-sm" aria-label="Выбрать проект">
      <span className="truncate">{selected?.name ?? "Выбрать проект"}</span><span aria-hidden="true">⌄</span>
    </summary>
    <div className="absolute left-0 top-full z-50 mt-2 max-h-[65dvh] w-full min-w-56 overflow-y-auto rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-panel)] p-2 shadow-xl">
      {projects.map(project => <Link key={project.id} to={`/app/projects/${project.id}`} className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-black/5"><span className="truncate">{project.name}</span>{!project.is_active && <span className="shrink-0 text-xs opacity-60">Пауза</span>}</Link>)}
      {error && <button className="p-3 text-sm" onClick={() => navigate("/app?manage=1")}>Не удалось загрузить. Открыть проекты</button>}
      {!error && !projects.length && <p className="p-3 text-sm opacity-60">Первый проект пока не создан</p>}
      <div className="mt-2 border-t border-[var(--workspace-border)] pt-2">
        <Link to="/app/setup?new=1" className="block rounded-lg p-3 text-sm font-semibold">＋ Создать проект</Link>
        {selected && <Link to={`/app/projects/${selected.id}/settings#project-management`} className="block rounded-lg p-3 text-sm">Название и пауза проекта</Link>}
        <Link to="/app?manage=1" className="block rounded-lg p-3 text-sm">Все проекты</Link>
      </div>
    </div>
  </details>;
}
