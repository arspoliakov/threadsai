import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient, getApiErrorMessage } from '../../api/client';

type Overview = {
  checked_at: string;
  counts: Record<string, number>;
  tasks: Record<string, number>;
  accounts: Record<string, number>;
  operations: Record<string, number>;
  tribute_events: Record<string, number>;
  integrations: Record<string, boolean>;
  notes: string[];
};

type CohortDays = 0 | 7 | 30;
type ProductFunnel = {
  checked_at: string;
  cohort: { days: CohortDays; registered_since: string | null; users: number };
  stages: Array<{ key: string; label: string; users: number; percent_of_cohort: number }>;
  timings: {
    registration_to_trial_median_hours: number | null;
    registration_to_publication_median_hours: number | null;
  };
  paid_without_publication: number;
  blockers: Array<{ code: string; message: string; projects: number }>;
  notes: string[];
};

const panel = 'rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-panel)] p-5';
const muted = 'text-sm text-[var(--workspace-muted)]';
const labels: Record<string, string> = {
  users: 'Все пользователи', active_subscriptions: 'Активные подписки', projects: 'Все проекты', accounts: 'Все аккаунты',
  draft: 'Черновики', queued: 'В очереди', running: 'В работе', success: 'Выполнено', partial_success: 'Частично выполнено',
  failed: 'Ошибки', cancelled: 'Отменено', active: 'Активные', disabled: 'Отключены', error: 'Ошибка', warming_up: 'Подготовка',
  cookies_expired: 'Вход истёк', blocked: 'Ограничение', proxy_error: 'Ошибка прокси', pending: 'Ожидает', applied: 'Обработано',
  obsolete: 'Устарело', unknown_tariff: 'Неизвестный тариф',
};
const cohorts: Array<{ days: CohortDays; label: string }> = [
  { days: 7, label: 'За 7 дней' }, { days: 30, label: 'За 30 дней' }, { days: 0, label: 'Все пользователи' },
];

function formatDuration(hours: number | null): string {
  if (hours === null) return 'Недостаточно данных';
  if (hours < 1) return `${Math.round(hours * 60)} мин`;
  if (hours < 24) return `${hours.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ч`;
  return `${(hours / 24).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} дн`;
}

function StatusPanel({ title, values }: { title: string; values: Record<string, number> }) {
  return (
    <article className={panel}>
      <h3 className="mb-4 text-lg font-semibold">{title}</h3>
      {Object.keys(values).length === 0 ? <p className={muted}>Пока нет данных</p> : Object.entries(values).map(([key, count]) => (
        <div key={key} className="flex justify-between gap-3 py-1 text-sm">
          <span>{labels[key] || key}</span><strong>{count.toLocaleString('ru-RU')}</strong>
        </div>
      ))}
    </article>
  );
}

export default function AdminDashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [funnel, setFunnel] = useState<ProductFunnel | null>(null);
  const [days, setDays] = useState<CohortDays>(30);
  const [refresh, setRefresh] = useState(0);
  const [overviewError, setOverviewError] = useState('');
  const [funnelError, setFunnelError] = useState('');
  const [overviewBusy, setOverviewBusy] = useState(false);
  const [funnelBusy, setFunnelBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setOverviewBusy(true);
    setOverviewError('');
    apiClient.get<Overview>('/api/v1/admin/overview', { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setOverview(data); })
      .catch((error) => { if (!controller.signal.aborted) setOverviewError(getApiErrorMessage(error, 'Не удалось загрузить состояние сервиса.')); })
      .finally(() => { if (!controller.signal.aborted) setOverviewBusy(false); });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    setFunnel(null);
    setFunnelBusy(true);
    setFunnelError('');
    apiClient.get<ProductFunnel>('/api/v1/admin/product-funnel', { params: { days }, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setFunnel(data); })
      .catch((error) => { if (!controller.signal.aborted) setFunnelError(getApiErrorMessage(error, 'Не удалось загрузить путь пользователей.')); })
      .finally(() => { if (!controller.signal.aborted) setFunnelBusy(false); });
    return () => controller.abort();
  }, [days, refresh]);

  const busy = overviewBusy || funnelBusy;
  return (
    <section className="workspace-page space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Дашборд администратора</h1>
          <p className="mt-2 text-[var(--workspace-muted)]">Как люди начинают пользоваться ThreadsGo и что мешает получить первый результат.</p>
        </div>
        <button disabled={busy} onClick={() => setRefresh((value) => value + 1)} className="rounded-full border border-[var(--workspace-border)] px-5 py-2 disabled:opacity-40">
          {busy ? 'Обновляем…' : 'Обновить'}
        </button>
      </header>

      <section className={`${panel} space-y-5`} aria-labelledby="product-funnel-title" aria-busy={funnelBusy}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="product-funnel-title" className="text-xl font-semibold">От регистрации до публикаций</h2>
            <p className={`mt-2 ${muted}`}>Выберите пользователей по дате регистрации. Здесь учтены их действия до момента проверки.</p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Период регистрации">
            {cohorts.map((cohort) => (
              <button key={cohort.days} type="button" aria-pressed={days === cohort.days} onClick={() => setDays(cohort.days)}
                className={`rounded-full border px-3 py-2 text-sm ${days === cohort.days ? 'border-[var(--workspace-accent)] bg-[var(--workspace-accent)] text-[var(--workspace-accent-ink)]' : 'border-[var(--workspace-border)]'}`}>
                {cohort.label}
              </button>
            ))}
          </div>
        </div>
        {funnelBusy && <p className={muted} role="status">Собираем данные…</p>}
        {funnelError && <p role="alert" className="rounded-xl border border-[var(--workspace-border)] p-4">{funnelError}</p>}
        {funnel && <>
          <p className={muted}>В выбранной группе: <strong className="text-[var(--workspace-ink)]">{funnel.cohort.users}</strong> пользователей. Этапы накопительные: человек может оплатить до подключения аккаунта. Проценты считаются от всей выбранной группы.</p>
          {funnel.cohort.users === 0 ? <p className="py-3">За этот период пока никто не зарегистрировался.</p> : (
            <ol className="space-y-4">
              {funnel.stages.map((stage) => (
                <li key={stage.key}>
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                    <span>{stage.label}</span>
                    <span className="shrink-0"><strong>{stage.users}</strong> <span className="text-[var(--workspace-muted)]">· {stage.percent_of_cohort.toLocaleString('ru-RU')}%</span></span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--workspace-soft)]" role="progressbar" aria-label={stage.label}
                    aria-valuenow={stage.percent_of_cohort} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded-full bg-[var(--workspace-accent)]" style={{ width: `${stage.percent_of_cohort}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-[var(--workspace-border)] p-4">
              <p className={muted}>До первого пробного текста</p>
              <strong className="mt-2 block text-xl">{formatDuration(funnel.timings.registration_to_trial_median_hours)}</strong>
            </div>
            <div className="rounded-xl border border-[var(--workspace-border)] p-4">
              <p className={muted}>До первой публикации</p>
              <strong className="mt-2 block text-xl">{formatDuration(funnel.timings.registration_to_publication_median_hours)}</strong>
            </div>
            <div className="rounded-xl border border-[var(--workspace-border)] p-4">
              <p className={muted}>Оплатили, ещё не опубликовали</p>
              <strong className="mt-2 block text-2xl">{funnel.paid_without_publication}</strong>
              <Link to="/app/admin/users" className="mt-2 inline-block text-sm underline">Проверить пользователей</Link>
            </div>
          </div>
          <p className={muted}>Время указано от регистрации. Это медиана: половина пользователей с результатом получила его быстрее, половина — позже.</p>
          <div className="border-t border-[var(--workspace-border)] pt-4">
            <h3 className="font-semibold">Что мешает активным проектам</h3>
            <p className={`mt-1 ${muted}`}>Проекты пользователей выбранной группы. У одного проекта может быть несколько причин.</p>
            {funnel.blockers.length === 0 ? <p className={`mt-3 ${muted}`}>Для активных проектов этой группы препятствий не найдено. Проекты на паузе сюда не входят.</p> : (
              <ul className="mt-3 space-y-2">
                {funnel.blockers.map((blocker) => <li key={blocker.code} className="flex justify-between gap-3 text-sm"><span>{blocker.message}</span><strong className="shrink-0">{blocker.projects}</strong></li>)}
              </ul>
            )}
          </div>
          <details className={muted}>
            <summary className="cursor-pointer">Как считаются данные и что пока не учитывается</summary>
            <div className="mt-3 space-y-2">{funnel.notes.map((note) => <p key={note}>{note}</p>)}</div>
          </details>
          <p className={muted}>Проверено: {new Date(funnel.checked_at).toLocaleString('ru-RU')}</p>
        </>}
      </section>

      {overviewError && <p role="alert" className={panel}>{overviewError}</p>}
      {overview && <>
        <h2 className="pt-3 text-xl font-semibold">Состояние сервиса</h2>
        <p className={muted}>Все пользователи и проекты, независимо от выбранного выше периода.</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {['users', 'active_subscriptions', 'projects', 'accounts'].map((key) => <div key={key} className={panel}><p className={muted}>{labels[key]}</p><strong className="mt-2 block text-3xl">{overview.counts[key] || 0}</strong></div>)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <StatusPanel title="Задания" values={overview.tasks} />
          <StatusPanel title="Подключённые аккаунты" values={overview.accounts} />
          <StatusPanel title="Генерация и сбор данных" values={overview.operations} />
          <StatusPanel title="Уведомления Tribute" values={overview.tribute_events} />
        </div>
        <div className={`${panel} space-y-3`}>
          <h3 className="text-lg font-semibold">Что требует внимания</h3>
          <p>Ошибки заданий: {overview.tasks.failed || 0}. Аккаунты с истёкшим входом: {overview.accounts.cookies_expired || 0}. Ограничения: {overview.accounts.blocked || 0}. Ошибки прокси: {overview.accounts.proxy_error || 0}.</p>
          <p>Уведомления с неизвестным тарифом: {overview.tribute_events.unknown_tariff || 0}; ожидающие обработки: {overview.tribute_events.pending || 0}.</p>
          <div className="flex flex-wrap gap-4 text-sm underline">
            <Link to="/app/admin/users">Проверить пользователей</Link>
            <Link to="/app/admin/proxies">Открыть диагностику прокси</Link>
            <Link to="/app/admin/retention">Помочь начать работу</Link>
          </div>
        </div>
        <div className={`${panel} ${muted}`}>
          <p>Telegram: {overview.integrations.telegram_configured ? 'настроен' : 'не настроен'}. Ключ Tribute: {overview.integrations.tribute_key_configured ? 'настроен' : 'не настроен'}.</p>
          {overview.notes.map((note) => <p className="mt-2" key={note}>{note}</p>)}
          <p className="mt-3">Обновлено: {new Date(overview.checked_at).toLocaleString('ru-RU')}</p>
        </div>
      </>}
    </section>
  );
}
