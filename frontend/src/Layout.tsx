import { NavLink, Outlet } from "react-router-dom";

const navigation = [
  { label: "Дашборд", to: "/" },
  { label: "Очередь", to: "/queue" },
  { label: "Тренды", to: "/trends" },
  { label: "Промпты", to: "/prompts" },
];

export default function Layout() {
  return (
    <div className="min-h-screen bg-[#e8e8e4] text-[#151515]">
      <div className="grid min-h-screen lg:grid-cols-[260px_1fr]">
        <aside className="border-r border-black bg-[#111111] text-[#f4f1ea]">
          <div className="border-b border-white/10 px-6 py-7">
            <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-white/45">
              JIT SYSTEM
            </p>
            <h1 className="mt-4 font-display text-2xl leading-none text-white">
              Auto Poster
            </h1>
          </div>

          <nav className="grid border-b border-white/10">
            {navigation.map((item, index) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  [
                    "group grid grid-cols-[34px_1fr] border-t border-white/10 px-6 py-4 text-sm transition",
                    isActive
                      ? "bg-[#f4f1ea] text-[#111111]"
                      : "text-white/62 hover:bg-white/[0.06] hover:text-white",
                  ].join(" ")
                }
              >
                <span className="font-mono text-[11px] opacity-50">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="px-6 py-8">
            <p className="font-mono text-[11px] uppercase leading-6 tracking-[0.18em] text-white/35">
              Backend
              <br />
              127.0.0.1:8000
            </p>
          </div>
        </aside>

        <main className="min-w-0 bg-[#f6f6f2]">
          <header className="grid gap-3 border-b border-[#c9c9c3] px-6 py-6 md:grid-cols-[1fr_auto] md:px-10">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-[#77766f]">
                Web control plane
              </p>
              <h2 className="mt-2 font-display text-4xl leading-none tracking-tight">
                Панель управления
              </h2>
            </div>
            <div className="self-end border border-[#151515] px-3 py-2 font-mono text-xs uppercase tracking-[0.16em]">
              dev-admin-token
            </div>
          </header>

          <section className="px-6 py-8 md:px-10">
            <Outlet />
          </section>
        </main>
      </div>
    </div>
  );
}
