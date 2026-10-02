import { Link } from "react-router-dom";

export function JourneyNextStep({ title, description, action, to, onAction, disabled = false }: {
  title: string;
  description: string;
  action: string;
  to?: string;
  onAction?: () => void;
  disabled?: boolean;
}) {
  const actionClass = "inline-flex min-h-11 items-center justify-center rounded-full bg-[#141815] px-5 py-3 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e] disabled:cursor-wait disabled:opacity-50";
  return (
    <section className="rounded-[24px] border border-[#dfe4dc] bg-[#fbfcf7] p-5 shadow-sm sm:p-6" aria-label="Следующий шаг">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-2xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77766f]">Следующий шаг</p>
          <h2 className="mt-2 font-display text-3xl text-[#111]">{title}</h2>
          <p className="mt-3 text-sm leading-6 text-[#66645d]">{description}</p>
        </div>
        <div className="shrink-0">
          {to ? <Link to={to} className={actionClass}>{action}</Link> : (
            <button type="button" onClick={onAction} disabled={disabled} className={actionClass}>{action}</button>
          )}
        </div>
      </div>
    </section>
  );
}
