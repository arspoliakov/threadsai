import { useEffect, useState } from "react";

export function PostComposer({ busy, onGenerate, onSave, onDirtyChange, initialMode = "ai" }: {
  busy: boolean;
  onGenerate: () => Promise<void>;
  onSave: (text: string) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
  initialMode?: "ai" | "own";
}) {
  const [mode, setMode] = useState<"ai" | "own">(initialMode);
  const [text, setText] = useState("");
  useEffect(() => { onDirtyChange(Boolean(text.trim())); }, [text, onDirtyChange]);
  return <div className="space-y-5">
    <div className="flex gap-2" aria-label="Способ создания поста">
      {(["ai", "own"] as const).map(value => <button key={value} type="button" disabled={busy} aria-pressed={mode === value}
        className={`rounded-full border px-4 py-2 text-sm ${mode === value ? "bg-[var(--workspace-ink)] text-[var(--workspace-canvas)]" : "text-[var(--workspace-ink)]"}`}
        onClick={() => setMode(value)}>{value === "ai" ? "Помочь написать с ИИ" : "Написать самому"}</button>)}
    </div>
    {mode === "ai" ? <div className="space-y-4">
      <p className="text-sm leading-6 text-[var(--workspace-muted)]">ИИ подготовит текст по теме и стилю этого проекта. Вы сможете изменить его и выбрать время публикации.</p>
      <button type="button" disabled={busy} onClick={() => void onGenerate()} className="rounded-full bg-[var(--workspace-ink)] px-5 py-3 text-sm text-[var(--workspace-canvas)] disabled:opacity-50">
        {busy ? "ИИ пишет…" : "Подготовить пост"}</button>
    </div> : <form className="space-y-3" onSubmit={event => { event.preventDefault(); void onSave(text.trim()).then(saved => { if (saved) setText(""); }); }}>
      <label className="grid gap-2 text-sm">Ваш текст<textarea autoFocus className="min-h-52 w-full rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-panel)] p-4 text-sm leading-6"
        value={text} maxLength={500} disabled={busy} onChange={event => setText(event.target.value)} placeholder="Напишите пост или вставьте готовый текст…" /></label>
      <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-[var(--workspace-muted)]">{text.length}/500 · Сохранение не запускает публикацию</span>
        <button type="submit" disabled={!text.trim() || busy} className="rounded-full bg-[var(--workspace-ink)] px-5 py-3 text-sm text-[var(--workspace-canvas)] disabled:opacity-50">{busy ? "Сохраняем…" : "Сохранить пост"}</button></div>
    </form>}
  </div>;
}
