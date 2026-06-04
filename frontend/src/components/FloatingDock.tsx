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
    <nav className="fixed inset-x-0 bottom-3 z-40 px-3 pb-[env(safe-area-inset-bottom)] sm:bottom-4">
      <div className="mx-auto flex max-w-[42rem] items-center justify-center gap-1 rounded-[1.6rem] border border-white/55 bg-white/90 p-1 shadow-[0_18px_60px_rgba(8,14,12,0.16)] backdrop-blur-2xl sm:gap-1.5 sm:rounded-[1.9rem] sm:p-1.5">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              [
                "group flex min-h-[3.4rem] flex-1 flex-col items-center justify-center gap-1 rounded-[1.25rem] px-2 text-[11px] font-medium transition-all duration-200 sm:min-h-11 sm:flex-none sm:flex-row sm:gap-2 sm:px-4 sm:text-sm",
                isActive
                  ? "bg-[#07100e] text-white shadow-[0_12px_35px_rgba(7,16,14,0.22)]"
                  : "text-[#687168] hover:bg-[#eef4ec] hover:text-[#07100e]",
              ].join(" ")
            }
          >
            <span className="grid h-7 w-7 place-items-center rounded-xl bg-current/[0.08] sm:h-8 sm:w-8">
              <AppIcon name={item.icon} className="h-4 w-4 sm:h-5 sm:w-5" />
            </span>
            <span className="max-w-16 truncate sm:max-w-none">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
