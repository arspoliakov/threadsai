import { ReactNode, useEffect, useState } from "react";

type DismissibleTipProps = {
  storageKey: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
};

export function DismissibleTip({ storageKey, title, children, action }: DismissibleTipProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(window.localStorage.getItem(storageKey) !== "1");
  }, [storageKey]);

  function dismiss() {
    window.localStorage.setItem(storageKey, "1");
    setIsVisible(false);
  }

  if (!isVisible) {
    return null;
  }

  return (
    <section className="rounded-[24px] border border-[#dfe4dc] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg text-[#111]">{title}</h2>
          <div className="mt-2 text-sm leading-6 text-[#667066]">{children}</div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={dismiss}
              className="inline-flex h-10 items-center justify-center rounded-full bg-[#141815] px-4 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e]"
            >
              Всё понятно
            </button>
            {action}
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#dfe4dc] text-lg leading-none text-[#667066] transition hover:border-[#141815] hover:text-[#141815]"
          aria-label="Закрыть подсказку"
        >
          ×
        </button>
      </div>
    </section>
  );
}
