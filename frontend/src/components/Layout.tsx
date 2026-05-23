import { NavLink, Outlet } from "react-router-dom";

const navigation = [
  { label: "Дашборд", to: "/" },
  { label: "Очередь публикаций", to: "/queue" },
  { label: "База трендов", to: "/trends" },
  { label: "Настройки промптов", to: "/prompts" },
];

export default function Layout() {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex min-h-screen max-w-7xl">
        <aside className="hidden w-72 shrink-0 border-r border-line/80 px-6 py-8 lg:block">
          <div className="mb-10">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-moss">
              Auto Poster
            </p>
            <h1 className="mt-3 font-display text-3xl leading-tight">
              Панель управления
            </h1>
          </div>

          <nav className="space-y-2">
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  [
                    "block rounded-2xl px-4 py-3 text-sm font-medium transition",
                    isActive
                      ? "bg-ink text-paper shadow-panel"
                      : "text-ink/70 hover:bg-white/70 hover:text-ink",
                  ].join(" ")
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="flex-1 px-5 py-6 sm:px-8 lg:px-10">
          <header className="mb-8 rounded-[2rem] border border-line bg-white/65 px-6 py-5 shadow-panel backdrop-blur">
            <p className="text-sm font-medium text-moss">Backend: http://127.0.0.1:8000</p>
            <h2 className="mt-2 font-display text-4xl">JIT Content System</h2>
          </header>

          <div className="lg:hidden">
            <nav className="mb-6 grid grid-cols-2 gap-2">
              {navigation.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    [
                      "rounded-2xl px-4 py-3 text-center text-sm font-medium",
                      isActive ? "bg-ink text-paper" : "bg-white/70 text-ink/70",
                    ].join(" ")
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <Outlet />
        </main>
      </div>
    </div>
  );
}
