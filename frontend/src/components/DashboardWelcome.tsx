export function DashboardIllustration() {
  return (
    <svg viewBox="0 0 340 220" className="dashboard-illustration tg-illustration" aria-hidden="true" focusable="false">
      <ellipse cx="174" cy="187" rx="117" ry="14" className="dashboard-art-shadow" />
      <path d="M53 79c0-26 27-51 59-53 54-5 60 31 102 23 42-8 82 23 77 65-5 44-40 73-100 72-70-1-138-54-138-107Z" className="dashboard-art-wash" />
      <g transform="rotate(-10 116 120)">
        <rect x="68" y="62" width="104" height="126" rx="15" className="dashboard-art-back" />
        <path d="M86 85h41M86 101h62M86 112h49" className="dashboard-art-soft-line" />
      </g>
      <g transform="rotate(8 226 124)">
        <rect x="188" y="70" width="85" height="111" rx="14" className="dashboard-art-back" />
        <circle cx="207" cy="91" r="7" className="dashboard-art-accent" />
        <path d="M203 117h52M203 128h35M203 151h43" className="dashboard-art-soft-line" />
      </g>
      <rect x="109" y="42" width="117" height="142" rx="18" className="dashboard-art-paper" />
      <rect x="126" y="59" width="29" height="29" rx="10" className="dashboard-art-accent" />
      <path d="M135 74h11M140.5 68.5v11" className="dashboard-art-ink" />
      <path d="M126 107h80M126 119h63M126 131h73" className="dashboard-art-line" />
      <rect x="126" y="147" width="53" height="17" rx="8.5" className="dashboard-art-wash" />
      <path d="m230 40 3.5 9.5L243 53l-9.5 3.5L230 66l-3.5-9.5L217 53l9.5-3.5L230 40Z" className="dashboard-art-spark" />
      <circle cx="73" cy="43" r="5" className="dashboard-art-accent" />
      <circle cx="279" cy="161" r="4" className="dashboard-art-muted" />
      <path d="m63 151 5 5-5 5M58 156h10" className="dashboard-art-soft-line" />
    </svg>
  );
}

export function DashboardWelcome({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="dashboard-welcome tg-reveal overflow-hidden rounded-[24px] border border-[#dbe6dd] bg-white shadow-sm lg:col-span-2 2xl:col-span-3">
      <div className="grid items-center gap-8 p-6 sm:p-10 lg:grid-cols-[1fr_20rem]">
        <div className="text-center lg:text-left">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#eef4ec] lg:mx-0" aria-hidden="true">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" focusable="false">
              <path d="M4 7.8A2.8 2.8 0 0 1 6.8 5h3l2 2h5.4A2.8 2.8 0 0 1 20 9.8v6.4a2.8 2.8 0 0 1-2.8 2.8H6.8A2.8 2.8 0 0 1 4 16.2V7.8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="mt-5 font-display text-3xl text-[#111]">Давайте создадим ваш первый проект</h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#667066] lg:mx-0">
            Начните с названия и темы. Настроить голос поможет нейросеть, а подключить профиль можно следующим шагом.
          </p>
          <button type="button" onClick={onCreate} className="tg-action mt-6 inline-flex h-12 items-center justify-center gap-3 rounded-full bg-[#141815] px-6 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e]">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            Создать проект
          </button>
        </div>
        <div className="min-w-0">
          <DashboardIllustration />
          <ol className="space-y-3 rounded-2xl bg-[#f1f6f2] p-5 text-left">
            {["Название и тема проекта", "Ваш стиль — вручную или с ИИ", "Профиль Threads и расписание"].map((step, i) => (
              <li key={step} className="flex items-center gap-3 text-sm text-[#49705a]">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-xs font-semibold" aria-hidden="true">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
