type PageShellProps = {
  eyebrow: string;
  title: string;
  description: string;
};

export default function PageShell({ eyebrow, title, description }: PageShellProps) {
  return (
    <section className="rounded-[24px] border border-line bg-white/80 p-5 shadow-panel sm:p-6">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-clay">{eyebrow}</p>
      <h3 className="mt-3 font-display text-3xl">{title}</h3>
      <p className="mt-4 max-w-2xl text-base leading-7 text-ink/65">{description}</p>
      <div className="mt-5 rounded-[20px] border border-dashed border-line bg-paper/70 p-5 text-sm text-ink/50">
        Раздел готов к подключению данных из API.
      </div>
    </section>
  );
}
