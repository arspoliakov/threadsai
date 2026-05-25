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
        "relative overflow-hidden rounded-[2rem] border border-[#151b17] bg-[#080d0b] text-white shadow-[0_24px_90px_rgba(10,10,10,0.18)]",
        compact ? "p-5" : "p-6 sm:p-7",
        className,
      ].join(" ")}
    >
      <div className="absolute right-[-5rem] top-[-7rem] h-60 w-60 rounded-full bg-[#70ff35]/16 blur-3xl" />
      <div className="absolute bottom-[-7rem] left-[25%] h-64 w-64 rounded-full bg-[#0076ff]/20 blur-3xl" />

      <div className="relative">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#70ff35] opacity-70" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-[#70ff35]" />
            </span>
            <span className="text-sm text-white/68">бот работает</span>
          </div>
          <span className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-[#70ff35]">
            <AppIcon name="spark" />
          </span>
        </div>

        <h2 className={compact ? "mt-5 font-display text-3xl leading-none" : "mt-7 font-display text-4xl leading-[0.92] tracking-[-0.055em] sm:text-5xl"}>
          {currentAction}
        </h2>

        <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.045] p-5">
          <div className="flex items-center gap-3 text-white/62">
            <AppIcon name="refresh" className="h-5 w-5" />
            <span className="text-sm">{nextActionLabel}</span>
          </div>
          <p className="mt-3 text-xl text-white sm:text-2xl">{formatDateTime(nextTrendCheck)}</p>
        </div>
      </div>
    </article>
  );
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "не запланировано";
  }

  return new Date(value).toLocaleString("ru-RU");
}
