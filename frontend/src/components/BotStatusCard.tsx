import { AppIcon } from "./AppIcons";

export function BotStatusCard({
  nextTrendCheck,
  currentAction,
  nextActionLabel = "следующий сбор трендов",
  compact = false,
  className = "",
}: {
  nextTrendCheck: string | null | undefined;
  currentAction: string;
  nextActionLabel?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <article
      className={[
        "relative overflow-hidden rounded-[24px] border border-[#151b17] bg-[#080d0b] text-white shadow-[0_18px_60px_rgba(10,10,10,0.16)]",
        compact ? "p-5" : "p-6 sm:p-7",
        className,
      ].join(" ")}
    >
      <div className="absolute right-[-5rem] top-[-7rem] h-60 w-60 rounded-full bg-[#70ff35]/16 blur-3xl" />
      <div className="absolute bottom-[-7rem] left-[25%] h-64 w-64 rounded-full bg-[#0076ff]/20 blur-3xl" />

      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <h2 className={compact ? "font-display text-3xl leading-none" : "font-display text-4xl leading-[0.92] tracking-[-0.055em] sm:text-5xl"}>
            {currentAction}
          </h2>
          <span className={compact ? "grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-[#70ff35]" : "grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-[#70ff35]"}>
            <AppIcon name="spark" />
          </span>
        </div>

        <div className={compact ? "mt-5 rounded-2xl border border-white/10 bg-white/[0.045] p-4" : "mt-6 rounded-2xl border border-white/10 bg-white/[0.045] p-5"}>
          <div className="flex items-center gap-3 text-white/62">
            <AppIcon name="refresh" className="h-5 w-5" />
            <span className="text-sm">{nextActionLabel}</span>
          </div>
          <p className={compact ? "mt-3 text-lg text-white sm:text-xl" : "mt-3 text-xl text-white sm:text-2xl"}>{formatDateTime(nextTrendCheck)}</p>
        </div>
      </div>
    </article>
  );
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "не запланировано";
  }

  return new Date(value).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
