import { useEffect, useState } from "react";
import { Link, Outlet, useParams } from "react-router-dom";

import { getProjectDashboard, type ProjectDashboard } from "../api/client";
import { AppIcon } from "../components/AppIcons";
import { FloatingDock, type FloatingDockItem } from "../components/FloatingDock";
import { OnboardingTour } from "../components/OnboardingTour";
import { ProfileMenu } from "../components/ProfileMenu";

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
  const hasSessionProblem =
    dashboard?.account_states.some(
      (account) => account.status === "cookies_expired" || account.status === "blocked",
    ) ?? false;
  const hasProxyPause = dashboard?.account_states.some((account) => account.status === "proxy_error") ?? false;

  const navigation: FloatingDockItem[] = [
    {
      label: "Все проекты",
      to: "/app",
      icon: "home",
    },
    {
      label: "Обзор",
      to: projectBasePath,
      icon: "overview",
      end: true,
    },
    {
      label: "Расписание постов",
      to: `${projectBasePath}/queue`,
      icon: "queue",
    },
    {
      label: "Актуальные темы",
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
    <div className="min-h-screen bg-[#f5f6f1] text-[#111]">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_16%_0%,rgba(0,118,255,0.14),transparent_34%),radial-gradient(circle_at_82%_8%,rgba(112,255,53,0.14),transparent_30%)]" />

      <header className="sticky top-0 z-30 border-b border-[#d9ddd4]/85 bg-[#f5f6f1]/82 px-4 py-3 backdrop-blur-2xl sm:px-6 lg:px-10 lg:py-4">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/app"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#dfe4dc] bg-white shadow-sm transition hover:bg-[#07100e] hover:text-white"
              aria-label="Все проекты"
            >
              <AppIcon name="home" className="h-5 w-5" />
            </Link>
            <div className="min-w-0">
              <p className="text-xs leading-none text-[#6d746d]">проект</p>
              <h1 className="truncate font-display text-2xl leading-none tracking-[-0.04em] sm:text-3xl">
                {projectTitle}
              </h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <ProfileMenu />
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-[1440px] px-4 pb-32 pt-5 sm:px-6 sm:pb-36 sm:pt-8 lg:px-10">
        {hasSessionProblem ? <SessionWarningBanner projectBasePath={projectBasePath} /> : null}
        {!hasSessionProblem && hasProxyPause ? <ProxyWarningBanner projectBasePath={projectBasePath} /> : null}
        <Outlet />
        <FooterUtility />
      </main>

      <FloatingDock items={navigation} />
      <OnboardingTour />
    </div>
  );
}

function FooterUtility() {
  return (
    <footer className="mt-12 flex flex-col gap-3 border-t border-[#d9ddd4] pt-5 text-xs leading-5 text-[#747d73] sm:flex-row sm:items-center sm:justify-between">
      <p>*Деятельность Meta (соцсети Facebook, Threads и Instagram) запрещена в России как экстремистская.</p>
      <div className="flex flex-wrap gap-2">
        <Link
          to="/terms"
          className="w-fit rounded-full border border-[#cfd6cc] bg-white px-4 py-2 text-[#07100e] transition hover:border-[#07100e] hover:bg-[#07100e] hover:text-white"
        >
          Условия и политика
        </Link>
        <a
          href="https://t.me/cuartenlol"
          target="_blank"
          rel="noreferrer"
          className="w-fit rounded-full border border-[#cfd6cc] bg-white px-4 py-2 text-[#07100e] transition hover:border-[#07100e] hover:bg-[#07100e] hover:text-white"
        >
          Связь с разработчиком
        </a>
      </div>
    </footer>
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
              Генерация работает, но публикация остановлена до обновления доступа.
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
            <p className="text-base font-medium text-[#3b2a08]">Прокси временно не отвечает</p>
            <p className="mt-1 text-sm leading-6 text-[#7a5b22]">
              Cookies не слетели. Система сама перепроверяет порт и вернет профиль в работу, когда прокси снова начнет отдавать IP.
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
