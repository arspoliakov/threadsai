import { useState } from "react";
import type { PostingTask } from "../api/client";

export function WeekCalendar({ tasks, selected, onSelect, showDraftFilter = true }: { tasks: PostingTask[]; selected: string | null; onSelect: (day: string | null) => void; showDraftFilter?: boolean }) {
  const [offset, setOffset] = useState(0);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7 + offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
  const nav = "rounded-xl border border-[#d8e2da] px-3 py-2 text-sm";
  return <section className="rounded-2xl border border-[#d8e2da] bg-white p-4" aria-label="Календарь публикаций">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Неделя {start.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</h2>
      <p className="mt-1 text-xs text-[#67786e]">Время в календаре: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Нажмите день, чтобы открыть его посты.</p></div>
      <div className="flex gap-2"><button className={nav} onClick={() => { setOffset(value => value - 1); onSelect(null); }} aria-label="Предыдущая неделя">←</button>
        <button className={nav} onClick={() => { setOffset(0); onSelect(null); }}>Сегодня</button><button className={nav} onClick={() => { setOffset(value => value + 1); onSelect(null); }} aria-label="Следующая неделя">→</button></div></div>
    <div className="grid grid-cols-[repeat(7,minmax(76px,1fr))] gap-2 overflow-x-auto pb-2">
      {days.map(day => { const key = localDay(day); const list = tasks.filter(t => t.status !== "draft" && getTaskCalendarDate(t) && localDay(new Date(getTaskCalendarDate(t)!)) === key && t.status !== "cancelled").sort((a, b) => new Date(getTaskCalendarDate(a)!).getTime() - new Date(getTaskCalendarDate(b)!).getTime());
        return <button type="button" key={key} aria-label={`${day.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}: ${list.length} публикаций`} aria-pressed={selected === key} onClick={() => onSelect(selected === key ? null : key)}
          className={`min-h-32 min-w-[76px] rounded-xl border p-2 text-left ${selected === key ? "border-[#315b46] bg-[#e9f1eb]" : "border-[#e0e8e2]"}`}>
          <span className="block text-xs capitalize text-[#67786e]">{day.toLocaleDateString("ru-RU", { weekday: "short" })}</span><span className="mt-1 block text-xl font-semibold">{day.getDate()}</span>
          {list.slice(0, 3).map(t => <span key={t.id} className="mt-2 block truncate rounded bg-[#f5f8f6] p-1 text-[10px]">{new Date(getTaskCalendarDate(t)!).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} · {t.generation_metadata?.publication_confirmation_pending ? "проверяем" : t.status === "success" ? "готово" : t.status === "partial_success" ? "частично" : t.status === "failed" ? "ошибка" : t.status === "running" ? "в работе" : "пост"}</span>)}
          {list.length > 3 && <span className="mt-1 block text-xs">Ещё {list.length - 3}</span>}
          {!list.length && <span className="mt-3 block text-[10px] text-[#67786e]">Свободно</span>}
        </button>;
      })}
    </div>
    <div className="mt-3 flex flex-wrap gap-2"><button className={nav} aria-pressed={selected === null} onClick={() => onSelect(null)}>Все посты</button>
      {showDraftFilter && <button className={nav} aria-pressed={selected === "drafts"} onClick={() => onSelect("drafts")}>Черновики · {tasks.filter(t => t.status === "draft").length}</button>}</div>
  </section>;
}

export function localDay(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }

export function getTaskCalendarDate(task: PostingTask) { return task.status === "success" || task.status === "partial_success" ? task.finished_at || task.scheduled_at : task.scheduled_at; }
