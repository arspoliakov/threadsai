import { useEffect, useState } from "react";
import { apiClient, getApiErrorMessage } from "../../api/client";

type Account = { id: number; owner_id: number; username: string; provider: string; session_id: number | null; status: string; estimated_bytes: number; check_status: string; checked_at: string | null };
type Summary = { config: { configured: boolean; package_gb?: number; package_cost_rub?: number; next_session_id?: number }; accounts: Account[]; users: {owner_id: number | null; provider: string; estimated_bytes: number; estimated_cost_rub: number}[]; services: { service: string; provider: string; estimated_bytes: number; estimated_cost_rub: number }[] };
const panel = "rounded-2xl border border-[#e0e8e2] bg-white p-5";
const button = "rounded-xl border border-[#e0e8e2] px-4 py-2 text-sm disabled:opacity-40";
const bytes = (value: number) => `${(value / 1_000_000).toFixed(3)} МБ`;
export default function ProxyAdminPage() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  async function load() { const response = await apiClient.get<Summary>("/api/v1/admin/proxies"); setData(response.data); }
  useEffect(() => { void load().catch(e => setError(getApiErrorMessage(e, "Доступ разрешён только владельцу сервиса."))); }, []);
  async function action(fn: () => Promise<unknown>, success: string) {
    setBusy(true); setError(""); setNotice("");
    try { await fn(); setNotice(success); await load(); } catch(e) { setError(getApiErrorMessage(e, "Не удалось выполнить действие.")); }
    finally { setBusy(false); }
  }
  return <section className="workspace-page space-y-6">
    <header><p className="text-sm text-[#67786e]">Только для владельца</p><h1 className="text-3xl font-semibold">Прокси и расход трафика</h1><p className="mt-2">Пилот Proxly без массового переключения клиентов.</p></header>
    {error && <p role="alert" className={`${panel} text-red-700`}>{error}</p>}
    {notice && <p role="status" className={panel}>{notice}</p>}
    {!data ? <p>{error ? "" : "Загружаем данные…"}</p> : <>
      <div className="grid gap-4 md:grid-cols-3">
        <div className={panel}><p>Общий приобретённый пакет</p><strong className="text-2xl">{data.config.package_gb ?? 10} ГБ</strong><p className="mt-2 text-sm">На ThreadsGo и ThreadsClinic вместе. Это размер пакета, не текущий остаток.</p></div>
        <div className={panel}><p>Ставка Proxly</p><strong className="text-2xl">{((data.config.package_cost_rub ?? 1120) / (data.config.package_gb ?? 10)).toFixed(0)} ₽/ГБ</strong><p className="mt-2 text-sm">Параметры купленного пакета; баланс провайдера не подключён.</p></div>
        <div className={panel}><p>Закрепление IP</p><strong className="text-2xl">≈30 минут</strong><p className="mt-2 text-sm">Session ID сохраняется, IP может меняться. Разные сессии могут получить один IP.</p></div>
      </div>
      <form className={`${panel} space-y-4`} onSubmit={e => { e.preventDefault(); void action(async () => { await apiClient.put("/api/v1/admin/proxies/config", { access_login: login, password: password || null }); setLogin(""); setPassword(""); }, "Доступ сохранён зашифрованно. Аккаунты автоматически не переключены."); }}>
        <h2 className="text-xl font-semibold">Защищённые настройки Proxly</h2>
        <p className="text-sm">proxly.ru:8080 · Нидерланды · HTTP · ID 1–10 зарезервированы для клиники. Настройки применяются к аккаунту только кнопкой подключения ниже.</p>
        <div className="grid gap-4 md:grid-cols-2"><label>Базовый логин доступа<input type="password" autoComplete="off" required value={login} onChange={e => setLogin(e.target.value)} className="mt-2 w-full rounded-xl border p-3" /></label><label>Пароль<input type="password" autoComplete="new-password" required={!data.config.configured} value={password} onChange={e => setPassword(e.target.value)} placeholder={data.config.configured ? "Оставьте пустым, чтобы сохранить пароль" : "Пароль Proxly"} className="mt-2 w-full rounded-xl border p-3" /></label></div>
        <div className="flex flex-wrap gap-3"><button disabled={busy} className={button}>Сохранить доступ</button>
        <button type="button" disabled={busy || !data.config.configured} className={button} onClick={() => void action(async () => {
          const response = await apiClient.post("/api/v1/admin/proxies/probe");
          const sessions = response.data.sessions;
          if (!sessions.A.complete || !sessions.B.complete) throw new Error("probe_failed");
        }, "Две параллельные сессии подключились. Проверка была без входа в Threads; стабильность на 30 минут и сохранение входа ещё не подтверждены.")}>Проверить две сессии без входа</button></div>
      </form>
      <div className={panel}><h2 className="text-xl font-semibold">Наблюдаемый расход по сервисам</h2><p className="my-3 text-sm">Неполная оценка полученных браузером байтов, без части запросов, TLS и прочих расходов. Ноль не означает отсутствие оплаченного трафика. Данные ThreadsClinic пока не подключены.</p>
        {data.services.map(s => <p key={`${s.service}-${s.provider}`}>{s.service} · {s.provider}: {bytes(s.estimated_bytes)} · оценка {s.estimated_cost_rub.toFixed(2)} ₽</p>)}
        {!data.services.length && <p>Измерения начнут накапливаться после новых заданий и проверок.</p>}
        <h3 className="mb-2 mt-5 font-semibold">По пользователям</h3>
        {data.users.map(u => <p key={`${u.owner_id}-${u.provider}`}>{u.owner_id ? `Пользователь #${u.owner_id}` : "Общие проверки"} · {u.provider}: {bytes(u.estimated_bytes)} · оценка {u.estimated_cost_rub.toFixed(2)} ₽</p>)}
      </div>
      <div className="space-y-4"><h2 className="text-xl font-semibold">Аккаунты и пилот</h2><p className="text-sm">Переключайте только выбранный тестовый аккаунт. Проверка соединения не подтверждает вход в Threads. Перед расширением пилота проверьте сохранение входа и публикацию.</p>
        {data.accounts.map(a => <article key={a.id} className={`${panel} space-y-3`}><div className="flex flex-wrap justify-between gap-3"><h3 className="font-semibold">@{a.username} <span className="font-normal">· #{a.id} · пользователь #{a.owner_id}</span></h3><span>{a.provider} · {a.status}</span></div><p>Session ID: {a.session_id ?? "не назначен"} · наблюдаемый расход: {bytes(a.estimated_bytes)}</p><p className="text-sm">Соединение: {a.check_status === "connected" ? "доступно" : a.check_status === "connection_failed" ? "ошибка" : "не проверено"}{a.checked_at ? ` · ${new Date(a.checked_at).toLocaleString("ru-RU")}` : ""}</p><div className="flex flex-wrap gap-2">
          <button className={button} disabled={busy || !data.config.configured} onClick={() => { if (window.confirm(`Переключить только аккаунт @${a.username} на Proxly? IP и страна подключения изменятся; профиль будет поставлен на паузу для проверки.`)) void action(() => apiClient.put(`/api/v1/admin/proxies/accounts/${a.id}`, {provider:"proxly"}), "Привязка Proxly сохранена, профиль на паузе. Проверьте соединение, затем вход на странице «Аккаунты» и включите работу вручную."); }}>Подключить Proxly к этому аккаунту</button>
          <button className={button} disabled={busy} onClick={() => void action(() => apiClient.post(`/api/v1/admin/proxies/accounts/${a.id}/check`), "Проверка завершена, результат отображён у аккаунта.")}>Проверить соединение</button>
          {a.provider === "proxly" && <button className={button} disabled={busy} onClick={() => void action(() => apiClient.put(`/api/v1/admin/proxies/accounts/${a.id}`, {provider:"legacy"}), "Возвращено прежнее подключение; ID Proxly сохранён.")}>Вернуть прежний прокси</button>}
        </div></article>)}
        {!data.accounts.length && <p className={panel}>Нет подключённых Threads-аккаунтов.</p>}
      </div>
    </>}
  </section>;
}
