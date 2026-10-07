import { useEffect, useState } from "react";
import { apiClient, getApiErrorMessage } from "../api/client";

type Source = { key: string; label: string; registered: number; confirmed_paid_users: number; confirmed_payment_events: number; repeat_paid_users: number; published_users: number };
type Retention = { day: number; eligible_users: number; retained_users: number; rate_percent: number | null; status: string; window: string };
type Analytics = {
  checked_at: string;
  cohort: { days: number; registered_since: string | null; users: number; excluded_users: number };
  sources: Source[];
  payments: { confirmed_events: number; paying_users: number; repeat_paid_users: number; users_with_renewal_event: number; revenue: number | null; revenue_status: string; events_with_amount_currency: number; history_status: string };
  retention: Retention[];
  economics: { cac: number | null; cac_status: string; ltv: number | null; ltv_status: string };
  coverage: { attributed_users: number; unknown_source_users: number; payment_history_started_at: string | null; publication_history_started_at: string | null };
  notes: string[];
};
const panel = "rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-panel)] p-5";
const muted = "text-sm leading-6 text-[var(--workspace-muted)]";
const count = (value: number) => value.toLocaleString("ru-RU");

function SourceCard({ source }: { source: Source }) {
  return <article className="rounded-xl border border-[var(--workspace-border)] p-4">
    <h4 className="break-words font-semibold">{source.label}</h4>
    {source.key === "unknown" && <p className={`mt-1 ${muted}`}>Источник не сохранился; это не обязательно прямой заход.</p>}
    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">{[["Зарегистрировались", source.registered], ["Оплатили", source.confirmed_paid_users], ["Оплатили повторно", source.repeat_paid_users], ["Опубликовали", source.published_users]].map(([label, value]) => <div key={label}><dt className="text-[var(--workspace-muted)]">{label}</dt><dd className="mt-1 font-semibold">{count(Number(value))}</dd></div>)}</dl>
  </article>;
}

export default function ProductAnalyticsPanel({ days, refresh }: { days: number; refresh: number }) {
  const [data, setData] = useState<Analytics | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setData(null); setError("");
    void apiClient.get<Analytics>("/api/v1/admin/product-analytics", { params: { days }, signal: controller.signal })
      .then(response => {
        const value = response.data;
        if (!value?.cohort || !value.payments || !value.coverage || !Array.isArray(value.sources) || !Array.isArray(value.retention) || !Array.isArray(value.notes)) throw new Error("Ответ аналитики неполный. Попробуйте обновить данные.");
        if (!controller.signal.aborted) setData(value);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(getApiErrorMessage(cause, "Не удалось загрузить источники и оплаты.")); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [days, refresh, retry]);

  return <section className={`${panel} space-y-5`} aria-labelledby="product-analytics-title" aria-busy={busy}>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 id="product-analytics-title" className="text-xl font-semibold">Источники, оплаты и публикации</h2><p className={`mt-2 ${muted}`}>Та же группа пользователей, что в воронке выше. Здесь показано только то, что сохранилось в сервисе.</p></div>
      <div className="flex flex-wrap gap-2 text-sm"><a href="https://metrika.yandex.ru/overview?id=109911353" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-full border border-[var(--workspace-border)] px-4">Открыть Метрику ↗</a><a href="https://metrika.yandex.ru/goals?id=109911353" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-full border border-[var(--workspace-border)] px-4">Проверить цели ↗</a></div>
    </header>
    {busy && <p className={muted} role="status">Загружаем источники и оплаты…</p>}
    {error && <div role="alert" className="rounded-xl border border-[var(--workspace-warning-border)] bg-[var(--workspace-warning-bg)] p-4 text-sm text-[var(--workspace-warning-ink)]"><p>{error}</p><button type="button" className="mt-2 min-h-11 underline" onClick={() => setRetry(value => value + 1)}>Попробовать снова</button></div>}
    {data && <>
      <p className={muted}>Пользователей: <strong className="text-[var(--workspace-ink)]">{count(data.cohort.users)}</strong>. Исключены владелец и тестовые аккаунты: <strong>{count(data.cohort.excluded_users)}</strong>.</p>
      <div className="rounded-xl bg-[var(--workspace-soft)] p-4 text-sm leading-6"><p>Источник записан у {count(data.coverage.attributed_users)} пользователей; у {count(data.coverage.unknown_source_users)} он неизвестен. Это сохранённый utm_source или домен первого внешнего перехода. Эти данные не совпадают с атрибуцией Метрики.</p>{data.payments.history_status === "no_confirmed_payment_events" ? <p className="mt-2 font-medium">В этой группе пока нет подтверждённых событий оплаты в истории сервиса. Это не означает, что никто не платил.</p> : <p className="mt-2">История оплат может быть неполной. Первое сохранённое событие: {data.coverage.payment_history_started_at ? new Date(data.coverage.payment_history_started_at).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" }) : "дата неизвестна"}.</p>}</div>
      <div>
        <h3 className="mb-3 font-semibold">Откуда пришли пользователи</h3>
        {data.sources.length === 0 ? <p className={muted}>В выбранной группе пока нет пользователей.</p> : <>
          <div className="grid gap-3 lg:hidden">{data.sources.map(source => <SourceCard key={source.key} source={source} />)}</div>
          <div className="hidden lg:block"><table className="w-full table-fixed text-left text-sm"><thead><tr className="border-b border-[var(--workspace-border)] text-[var(--workspace-muted)]"><th className="w-[30%] py-3 pr-3 font-normal">Источник</th>{["Регистрации", "Оплатили", "Повторная оплата", "Опубликовали"].map(label => <th key={label} className="px-2 py-3 font-normal">{label}</th>)}</tr></thead><tbody>{data.sources.map(source => <tr key={source.key} className="border-b border-[var(--workspace-border)]"><th scope="row" className="break-words py-4 pr-3 font-medium">{source.label}</th>{[source.registered, source.confirmed_paid_users, source.repeat_paid_users, source.published_users].map((value, index) => <td key={index} className="px-2 py-4">{count(value)}</td>)}</tr>)}</tbody></table></div>
        </>}
      </div>
      <div>
        <h3 className="mb-3 font-semibold">Подтверждённые оплаты</h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Событий оплаты", data.payments.confirmed_events], ["Пользователей с оплатой", data.payments.paying_users], ["Две оплаты и больше", data.payments.repeat_paid_users], ["Пользователей с событием продления", data.payments.users_with_renewal_event]].map(([label, value]) => <div key={label} className="rounded-xl border border-[var(--workspace-border)] p-4"><p className={muted}>{label}</p><strong className="mt-2 block text-2xl">{count(Number(value))}</strong></div>)}</div>
        <p className={`mt-3 ${muted}`}>Продление после пробного периода может быть первой оплатой. В «Две оплаты и больше» попадают только пользователи с двумя подтверждёнными платными событиями. Подарочные дни и пробный доступ не считаются оплатой.</p>
      </div>
      <div>
        <h3 className="mb-3 font-semibold">Публикации сервиса на D7 и D30</h3><p className={`mb-3 ${muted}`}>Был ли подтверждённый пост в течение 24 часов после 7 или 30 суток от регистрации. Это работа сервиса, включая автоматическую публикацию, а не личное возвращение человека на сайт.</p>
        <div className="grid gap-3 sm:grid-cols-2">{data.retention.map(row => <article key={row.day} className="rounded-xl border border-[var(--workspace-border)] p-4"><h4 className="font-semibold">D{row.day}</h4><strong className="mt-2 block text-2xl">{row.rate_percent === null ? "Недостаточно данных" : `${row.rate_percent.toLocaleString("ru-RU")}%`}</strong><p className={`mt-2 ${muted}`}>{row.status === "window_not_elapsed" ? `Ни у одного пользователя ещё не закончилось полное окно D${row.day}.` : row.status === "no_publication_history" ? "Подтверждённая история публикаций пока отсутствует." : `Опубликовали ${count(row.retained_users)} из ${count(row.eligible_users)} пользователей, у которых окно полностью закончилось.`}</p></article>)}</div>
      </div>
      <div>
        <h3 className="mb-3 font-semibold">Деньги и привлечение</h3>
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
          ["Выручка", "Суммы и единицы платежей ещё не проверены. Цена тарифа не подставляется вместо выручки."],
          ["Чистые выплаты", "Нет полной сверки комиссий, возвратов и фактических выплат."],
          ["Стоимость клиента · CAC", "Расходы на рекламу пока не записаны."],
          ["Доход от клиента · LTV", "Нужны проверенные суммы и полная история оплат."],
        ].map(([label, reason]) => <div key={label} className="rounded-xl border border-[var(--workspace-border)] p-4"><dt className={muted}>{label}</dt><dd className="mt-2 font-semibold">Нет данных</dd><p className={`mt-2 ${muted}`}>{reason}</p></div>)}</dl>
      </div>
      <details className={muted}><summary className="cursor-pointer">Как считаем и где есть пробелы</summary><div className="mt-3 space-y-2">{data.notes.map(note => <p key={note}>{note}</p>)}</div></details>
      <p className={muted}>Проверено: {new Date(data.checked_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}</p>
    </>}
  </section>;
}
