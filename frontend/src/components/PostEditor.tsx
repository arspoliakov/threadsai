import { useEffect, useRef, useState, type ReactNode } from "react";

export function PostEditor({ title, children, busy = false, hasUnsaved = false, onClose }: {
  title: string; children: ReactNode; busy?: boolean; hasUnsaved?: boolean; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const stateRef = useRef({ busy, hasUnsaved });
  closeRef.current = onClose; stateRef.current = { busy, hasUnsaved };
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  function requestClose() {
    if (stateRef.current.busy) return;
    if (stateRef.current.hasUnsaved) setConfirmDiscard(true);
    else closeRef.current();
  }
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("button, textarea, input, select, a[href]")?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); requestClose(); }
      if (event.key !== "Tab") return;
      const focusable = [...(panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex='0']") || [])]
        .filter(element => element.getClientRects().length > 0);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    function beforeUnload(event: BeforeUnloadEvent) { if (stateRef.current.hasUnsaved) { event.preventDefault(); event.returnValue = ""; } }
    window.addEventListener("beforeunload", beforeUnload);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKey); window.removeEventListener("beforeunload", beforeUnload); previousFocus?.focus(); };
  }, []);
  return <div style={{ margin: 0 }} className="fixed inset-0 z-[100] flex justify-end bg-black/45" onMouseDown={event => { if (event.target === event.currentTarget) requestClose(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="post-editor-title" style={{ maxHeight: "100dvh", borderRadius: 0 }} className="flex h-[100dvh] w-full flex-col bg-[var(--workspace-panel)] text-[var(--workspace-ink)] shadow-2xl md:max-w-2xl">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--workspace-border)] px-5 py-4"><h2 id="post-editor-title" className="font-display text-2xl">{title}</h2>
        <button type="button" disabled={busy} className="rounded-full border border-[var(--workspace-border)] px-4 py-2 text-sm disabled:opacity-50" onClick={requestClose}>Закрыть</button></header>
      {confirmDiscard && <div role="alert" className="shrink-0 border-b border-[var(--workspace-border)] bg-[var(--workspace-canvas)] p-4 text-sm">
        <p>Есть несохранённый текст. Закрыть редактор и потерять изменения?</p><div className="mt-3 flex gap-2">
          <button className="rounded-full border px-3 py-2" type="button" onClick={() => setConfirmDiscard(false)}>Продолжить писать</button>
          <button className="rounded-full border px-3 py-2" type="button" disabled={busy} onClick={onClose}>Закрыть без сохранения</button></div></div>}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
    </div>
  </div>;
}
