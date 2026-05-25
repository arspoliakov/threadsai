import { NavLink } from "react-router-dom";

import { AppIcon, type AppIconName } from "./AppIcons";

export type FloatingDockItem = {
  label: string;
  to: string;
  icon: AppIconName;
  end?: boolean;
};

export function FloatingDock({ items }: { items: FloatingDockItem[] }) {
  return (
    <nav className="fixed inset-x-0 bottom-3 z-40 px-3 pb-[env(safe-area-inset-bottom)] sm:bottom-5">
      <div className="mx-auto flex max-w-[44rem] items-center justify-center gap-1 rounded-[2rem] border border-white/55 bg-white/88 p-1.5 shadow-[0_24px_80px_rgba(8,14,12,0.18)] backdrop-blur-2xl sm:gap-2 sm:rounded-[2.3rem] sm:p-2">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              [
                "group flex min-h-[4rem] flex-1 flex-col items-center justify-center gap-1 rounded-[1.5rem] px-2 text-[11px] font-medium transition-all duration-200 sm:min-h-12 sm:flex-none sm:flex-row sm:gap-2 sm:px-5 sm:text-sm",
                isActive
                  ? "bg-[#07100e] text-white shadow-[0_12px_35px_rgba(7,16,14,0.22)]"
                  : "text-[#687168] hover:bg-[#eef4ec] hover:text-[#07100e]",
              ].join(" ")
            }
          >
            <span className="grid h-8 w-8 place-items-center rounded-2xl bg-current/[0.08] sm:h-9 sm:w-9">
              <AppIcon name={item.icon} className="h-5 w-5" />
            </span>
            <span className="max-w-16 truncate sm:max-w-none">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
