import { NavLink } from "react-router-dom";

import { AppIcon, type AppIconName } from "./AppIcons";

export type MobileTabItem = {
  label: string;
  to: string;
  icon: AppIconName;
  end?: boolean;
};

export function MobileTabBar({ items }: { items: MobileTabItem[] }) {
  return (
    <nav aria-label="Навигация кабинета" className="fixed inset-x-0 bottom-0 z-40 border-t border-[#dfe4dc] bg-white/90 px-2 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-18px_50px_rgba(0,0,0,0.08)] backdrop-blur-2xl lg:hidden">
      <div className="mx-auto grid max-w-md gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))` }}>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              [
                "group flex min-h-[4.2rem] flex-col items-center justify-center gap-1 rounded-[1.4rem] px-2 text-[11px] font-medium transition-all duration-200",
                isActive
                  ? "bg-[#07100e] text-white shadow-[0_12px_35px_rgba(7,16,14,0.22)]"
                  : "text-[#737b73] hover:bg-[#eef4ec] hover:text-[#07100e]",
              ].join(" ")
            }
          >
            <span className="grid h-8 w-8 place-items-center rounded-2xl bg-current/[0.08]">
              <AppIcon name={item.icon} className="h-5 w-5" />
            </span>
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
