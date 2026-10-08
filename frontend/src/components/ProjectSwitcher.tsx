import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getCurrentUser, getProjects, type Project } from "../api/client";

export function ProjectSwitcher() {
  const location = useLocation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState(false);
  const selectedId = Number(location.pathname.match(/\/projects\/(\d+)/)?.[1]);
  useEffect(() => {
    let alive = true;
    const refresh = () => { void Promise.all([getProjects(), getCurrentUser()]).then(([items, user]) => { if (alive) { setProjects(items); setError(false); try { if (items.some(item => item.id === selectedId)) window.sessionStorage.setItem(`threadsgo.current-project.${user.id}`, String(selectedId)); } catch { /* The route remains the source of truth without session storage. */ } } }).catch(() => { if (alive) setError(true); }).finally(() => { if (alive) setLoading(false); }); };
    refresh();
    window.addEventListener("threadsgo:project-updated", refresh);
    return () => { alive = false; window.removeEventListener("threadsgo:project-updated", refresh); };
  }, [selectedId, retry]);
  const selected = projects.find(project => project.id === selectedId);
  const inProject = Number.isFinite(selectedId);
  return <details className="relative w-full min-w-0" key={location.pathname + location.search} onClick={event => { if ((event.target as HTMLElement).closest("a")) event.currentTarget.open = false; }} onKeyDown={event => { if (event.key === "Escape") event.currentTarget.open = false; }}>
    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl border border-[var(--workspace-border)] bg-[var(--workspace-panel)] px-3 py-2 text-sm" aria-label="Выбрать общее меню или проект">
      <span className="min-w-0"><span className="block text-[10px] text-[var(--workspace-muted)]">{inProject ? "Проект" : "ThreadsGo"}</span><span className="block truncate font-medium">{inProject ? selected?.name ?? (loading ? "Загружаем проект…" : "Текущий проект") : "Общее меню"}</span></span><span aria-hidden="true">⌄</span>
    </summary>
    <div className="absolute left-0 top-full z-50 mt-2 max-h-[65dvh] w-full min-w-56 overflow-y-auto rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-panel)] p-2 shadow-xl">
      <Link to="/app" aria-current={!inProject ? "page" : undefined} className="block rounded-lg p-3 text-sm hover:bg-[var(--workspace-soft)]"><span className="block font-semibold">Общее меню</span><span className="mt-1 block text-xs text-[var(--workspace-muted)]">Проекты, все аккаунты и настройки</span></Link>
      <p className="mb-1 mt-2 border-t border-[var(--workspace-border)] px-3 pt-3 text-xs text-[var(--workspace-muted)]">Ваши проекты</p>
      {projects.map(project => <Link key={project.id} aria-current={project.id === selectedId ? "page" : undefined} to={`/app/projects/${project.id}`} className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-[var(--workspace-soft)]"><span className="truncate">{project.name}</span>{!project.is_active && <span className="shrink-0 text-xs opacity-60">Пауза</span>}</Link>)}
      {error && <button type="button" className="p-3 text-left text-sm underline" onClick={() => { setLoading(true); setRetry(value => value + 1); }}>Проекты не загрузились. Попробовать снова</button>}
      {!error && loading && <p className="p-3 text-sm opacity-60">Загружаем проекты…</p>}
      {!error && !loading && !projects.length && <p className="p-3 text-sm opacity-60">Первый проект пока не создан</p>}
      <div className="mt-2 border-t border-[var(--workspace-border)] pt-2">
        <Link to="/app/setup?new=1" className="block rounded-lg p-3 text-sm font-semibold">＋ Создать проект</Link>
        {selected && <Link to={`/app/projects/${selected.id}/settings#project-management`} className="block rounded-lg p-3 text-sm">Название и пауза проекта</Link>}
      </div>
    </div>
  </details>;
}
