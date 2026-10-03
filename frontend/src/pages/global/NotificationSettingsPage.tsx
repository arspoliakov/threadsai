import { useEffect, useState } from "react";
import { apiClient, getApiErrorMessage } from "../../api/client";

type Preferences = { marketing_consent: boolean; onboarding_consent: boolean; bot_reachable: boolean; bot_blocked: boolean; bot_url?: string | null };
const panel = "rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-panel)] p-5 sm:p-6";

export default function NotificationSettingsPage() {
  const [saved, setSaved] = useState<Preferences | null>(null);
  const [marketing, setMarketing] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    void apiClient.get<Preferences>("/api/v1/retention/preferences").then(({ data }) => {
      setSaved(data); setMarketing(data.marketing_consent); setOnboarding(data.onboarding_consent);
    }).catch(e => setError(getApiErrorMessage(e, "Не удалось загрузить настройки сообщений.")));
  }, []);
  async function refresh() {
    setBusy(true); setError("");
    try { const { data } = await apiClient.get<Preferences>("/api/v1/retention/preferences"); setSaved(data); setNotice("Статус бота обновлён."); }
    catch (e) { setError(getApiErrorMessage(e, "Не удалось обновить статус бота.")); }
    finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      const { data } = await apiClient.put<Preferences>("/api/v1/retention/preferences", { marketing_consent: marketing, onboarding_consent: onboarding });
      setSaved(data); setNotice("Настройки сохранены.");
    } catch (e) { setError(getApiErrorMessage(e, "Не удалось сохранить настройки. Попробуйте снова.")); }
    finally { setBusy(false); }
  }
  return <section className="workspace-page space-y-5">
    <header><p className="text-sm text-[var(--workspace-muted)]">Вы выбираете, что получать</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Сообщения в Telegram</h1><p className="mt-3 max-w-2xl text-[var(--workspace-muted)]">Можно включить помощь со стартом и новости ThreadsGo. Это необязательно: доступ к сервису не зависит от вашего выбора.</p></header>
    {error && <p role="alert" className={panel}>{error}</p>}
    {notice && <p role="status" className={panel}>{notice}</p>}
    {!saved ? !error && <p>Загружаем настройки…</p> : <form className={`${panel} space-y-6`} onSubmit={e => { e.preventDefault(); void save(); }}>
      <label className="flex cursor-pointer items-start gap-4"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[#315b46]" checked={onboarding} disabled={busy} onChange={e => { setOnboarding(e.target.checked); setNotice(""); }} /><span><strong className="block">Помощь с началом работы</strong><span className="mt-2 block text-sm leading-6 text-[var(--workspace-muted)]">Разрешаю присылать подсказки в Telegram, если я зарегистрировался, но ещё не создал проект или не опубликовал первый пост.</span></span></label>
      <label className="flex cursor-pointer items-start gap-4"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[#315b46]" checked={marketing} disabled={busy} onChange={e => { setMarketing(e.target.checked); setNotice(""); }} /><span><strong className="block">Новости и предложения ThreadsGo</strong><span className="mt-2 block text-sm leading-6 text-[var(--workspace-muted)]">Согласен получать в Telegram новости, полезные материалы и рекламные предложения сервиса. Можно отказаться в любой момент здесь или в боте.</span></span></label>
      <p className="border-t border-[var(--workspace-border)] pt-4 text-sm leading-6 text-[var(--workspace-muted)]">Сообщения о безопасности, оплате и выполнении ваших заданий относятся к работе сервиса и управляются отдельно.</p>
      {(!saved.bot_reachable || saved.bot_blocked) && <div className="rounded-xl bg-[var(--workspace-soft)] p-4 text-sm leading-6">{saved.bot_blocked ? "Бот недоступен: возможно, он заблокирован в Telegram." : "Чтобы бот мог написать вам, откройте его и нажмите «Начать» в Telegram. Вход на сайт сам по себе не всегда разрешает боту отправлять сообщения."} Затем вернитесь сюда.<div className="mt-3 flex flex-wrap gap-3">{saved.bot_url && <a href={saved.bot_url} target="_blank" rel="noreferrer" className="rounded-full border border-[var(--workspace-border)] px-4 py-2 font-medium">Открыть бот в Telegram ↗</a>}<button type="button" disabled={busy} onClick={() => void refresh()} className="rounded-full border border-[var(--workspace-border)] px-4 py-2 font-medium">Проверить статус бота</button></div></div>}
      <button disabled={busy || (marketing === saved.marketing_consent && onboarding === saved.onboarding_consent)} className="rounded-full bg-[var(--workspace-accent)] px-6 py-3 font-medium text-[var(--workspace-accent-ink)] disabled:opacity-40">{busy ? "Сохраняем…" : "Сохранить выбор"}</button>
      <p className="text-xs text-[var(--workspace-muted)]">Чтобы отключить рассылки, снимите отметки и сохраните выбор.</p>
    </form>}
  </section>;
}
