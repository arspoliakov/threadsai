import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { planCopy } from "../billingPlans";

import { getApiErrorMessage, getBillingStatus, refreshBillingStatus, type BillingStatus } from "../api/client";
import { trackSeoEvent, trackSeoEventOnce } from "../components/SeoAnalytics";

const PENDING_TRIBUTE = "threadsgo.pending_tribute";


export default function BillingPage() {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isRefreshingSubscription, setIsRefreshingSubscription] = useState(false);

  const refreshLock = useRef(false);
  const automaticChecks = useRef(0);
  const mounted = useRef(true);
  const [activationMessage, setActivationMessage] = useState("");

  async function loadBilling() {
    setIsLoading(true);
    setLoadError(false);

    try {
      setBilling(await getBillingStatus());
    } catch {
      setLoadError(true);
      toast.error("Не удалось загрузить тарифы. Попробуйте ещё раз.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    trackSeoEvent("billing_view", { source: "billing_page" });
    void loadBilling();
  }, []);

  useEffect(() => {
    if (billing?.subscription_status) {
      trackSeoEventOnce("subscription_active", {
        source: "billing_page",
        plan: billing.tariff_plan,
      });
    }
    if (billing?.subscription_status && billing.subscription_phase === "trial") {
      trackSeoEventOnce("trial_activated", { plan: billing.tariff_plan });
    }
  }, [billing?.subscription_status, billing?.tariff_plan, billing?.subscription_phase]);

  const checkSubscription = useCallback(async (automatic = false) => {
    if (refreshLock.current) return;
    refreshLock.current = true;
    setIsRefreshingSubscription(true);
    if (automatic) setActivationMessage("Вы вернулись из Tribute. Проверяем доступ…");
    try {
      const refreshed = await refreshBillingStatus();
      if (!mounted.current) return;
      setBilling(refreshed);
      if (refreshed.subscription_status) {
        try { sessionStorage.removeItem(PENDING_TRIBUTE); } catch { /* Optional return marker. */ }
        setActivationMessage("Доступ включён. Можно переходить к первому проекту.");
        toast.success("Тариф подтверждён, доступ открыт");
      } else {
        const message = "Доступ пока не найден. Завершите активацию в Tribute и вступите в канал тарифа, затем повторите проверку.";
        setActivationMessage(message);
        if (!automatic) toast.message(message);
      }
    } catch (error) {
      if (!mounted.current) return;
      setActivationMessage("Не удалось проверить доступ. Повторите проверку или напишите в поддержку.");
      if (!automatic) toast.error(getApiErrorMessage(error, "Не удалось проверить оплату. Попробуйте ещё раз через минуту."));
    } finally {
      refreshLock.current = false;
      if (mounted.current) setIsRefreshingSubscription(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const onReturn = () => {
      if (document.visibilityState !== "visible" || refreshLock.current || automaticChecks.current >= 3) return;
      try {
        const started = Number(sessionStorage.getItem(PENDING_TRIBUTE));
        if (!started) return;
        if (Date.now() - started > 30 * 60_000) { sessionStorage.removeItem(PENDING_TRIBUTE); return; }
      } catch { return; }
      automaticChecks.current += 1;
      void checkSubscription(true);
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    // A return may reload the tab; wait until the initial status request is finished.
    if (!isLoading) onReturn();
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [checkSubscription, isLoading]);

  if (isLoading) {
    return <div className="rounded-[18px] border border-[#dfe4dc] bg-white p-6">Загружаем тарифы...</div>;
  }

  if (loadError) {
    return (
      <section className="rounded-[22px] border border-[#e8c7c2] bg-[#fff7f5] p-6 shadow-sm sm:p-8">
        <h1 className="font-display text-4xl text-[#111]">Тарифы временно не загрузились</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#665d5a]">
          Данные и настройки аккаунта в безопасности. Повторите запрос; если ошибка останется, напишите в поддержку.
        </p>
        <button
          type="button"
          onClick={() => void loadBilling()}
          className="mt-5 h-12 rounded-full bg-[#111] px-6 text-sm font-semibold text-white transition hover:bg-[#70ff35] hover:text-[#07100e]"
        >
          Попробовать снова
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[22px] border border-[#dfe4dc] bg-white/88 p-5 shadow-sm sm:p-7">
        <div className="max-w-3xl">
          <h1 className="font-display text-4xl leading-tight text-[#111] sm:text-5xl">Выберите свой формат работы</h1>
          <p className="mt-4 text-base leading-7 text-[#5f675f]">
            Подключение через Tribute занимает три шага. После возвращения на сайт мы автоматически проверим доступ.
          </p>
        </div>

        {billing?.subscription_status ? (
          <Link to="/app" className="mt-5 inline-flex rounded-full bg-[#111] px-6 py-3 text-sm font-semibold text-white">Перейти к проектам →</Link>
        ) : (
          <ol className="mt-5 grid gap-3 rounded-2xl bg-[#f7faf4] p-5 text-sm leading-6 text-[#4f5a50] md:grid-cols-3">
            <li><strong className="block text-[#111]">1. Выберите тариф</strong>Откроется Tribute. Завершите привязку карты и активацию.</li>
            <li><strong className="block text-[#111]">2. Вступите в канал</strong>Нажмите кнопку доступа к каналу тарифа в Tribute. Одной привязки карты недостаточно для резервной проверки.</li>
            <li><strong className="block text-[#111]">3. Вернитесь сюда</strong>Мы проверим доступ автоматически. Если он не появился, нажмите «Проверить доступ».</li>
          </ol>
        )}
        {activationMessage ? <p role="status" className="mt-4 text-sm leading-6 text-[#4f5a50]">{activationMessage}</p> : null}

        {billing ? (
          <div className="mt-5 flex flex-col gap-4 rounded-[16px] border border-[#e1e7dd] bg-[#f7faf4] p-4 text-sm leading-6 text-[#4f5a50] sm:flex-row sm:items-center sm:justify-between">
            <p>
              Сейчас: {billing.subscription_status ? formatSubscriptionLabel(billing) : "подписка не активна"}. Настройки и
              тексты не пропадут, если подписка закончится: автопубликация просто встанет на паузу.
            </p>
            <button
              type="button"
              onClick={() => void checkSubscription()}
              disabled={isRefreshingSubscription}
              className="h-11 shrink-0 rounded-full border border-[#cfd6cc] bg-white px-5 text-sm font-medium text-[#111] transition hover:border-[#111] hover:bg-[#111] hover:text-white disabled:cursor-wait disabled:opacity-50"
            >
              {isRefreshingSubscription ? "Проверяем..." : "Проверить доступ"}
            </button>
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {(billing?.plans || []).map((plan) => {
          const copy = planCopy[plan.name as keyof typeof planCopy] || planCopy.basic;
          const isCurrentPlan = billing?.subscription_status && billing.tariff_plan === plan.name;
          return (
            <article key={plan.name} className={`relative rounded-[20px] border p-5 shadow-sm ${copy.tone} ${isCurrentPlan ? "ring-2 ring-[#07100e] ring-offset-2" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-3xl text-[#111]">{copy.title}</h2>
                {isCurrentPlan ? (
                  <span className="rounded-full bg-[#07100e] px-3 py-1 text-xs text-white">Ваш тариф</span>
                ) : null}
              </div>
              <p className="mt-2 text-sm font-medium text-[#343b34]">{copy.subtitle}</p>
              <p className="mt-4 text-sm leading-6 text-[#5f675f]">{copy.body}</p>
              <p className="mt-5 text-base font-semibold text-[#111]">{copy.price}</p>

              <dl className="mt-5 space-y-2 text-sm text-[#374037]">
                <div className="flex justify-between gap-4">
                  <dt>Аккаунты</dt>
                  <dd>{plan.accounts}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Проекты</dt>
                  <dd>{plan.projects}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Постов в день на аккаунт</dt>
                  <dd>{plan.posts}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Очередь вперед</dt>
                  <dd>{plan.queue_days} дн.</dd>
                </div>
              </dl>

              {plan.tribute_url ? (
                <a
                  href={plan.tribute_url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => {
                    trackSeoEvent(isCurrentPlan ? "subscription_manage_click" : "tribute_click", { plan: plan.name, source: "billing_page" });
                    if (!isCurrentPlan) {
                      automaticChecks.current = 0;
                      try { sessionStorage.setItem(PENDING_TRIBUTE, String(Date.now())); } catch { /* Manual check remains available. */ }
                      setActivationMessage("Завершите активацию и вступите в канал тарифа в Tribute, затем вернитесь сюда.");
                    }
                  }}
                  className="mt-6 flex h-12 items-center justify-center rounded-full bg-[#111] px-5 text-sm font-semibold text-white transition hover:bg-[#70ff35] hover:text-[#07100e]"
                >
                  {isCurrentPlan ? "Управлять подпиской" : `Выбрать ${copy.title}`}
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  className="mt-6 flex h-12 w-full items-center justify-center rounded-full border border-[#cfd6cc] bg-white px-5 text-sm text-[#8a9288]"
                >
                  Ссылка Tribute скоро появится
                </button>
              )}
            </article>
          );
        })}
      </section>

      <section className="rounded-[22px] border border-[#dfe4dc] bg-white/88 p-5 shadow-sm sm:p-7">
        <h2 className="font-display text-3xl text-[#111]">Частые вопросы</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-[16px] border border-[#e1e7dd] bg-[#fbfcf7] p-4">
            <h3 className="text-base font-semibold text-[#111]">Как работает бесплатный период?</h3>
            <p className="mt-2 text-sm leading-6 text-[#5f675f]">
              Вы выбираете Basic в Tribute. Первые 3 дня бесплатные, затем 1 490 ₽ в месяц. Проверьте дату следующего списания в Tribute; там же можно отменить продление. Подарочные дни ThreadsGo не меняют дату списания в Tribute.
            </p>
          </div>
          <div className="rounded-[16px] border border-[#e1e7dd] bg-[#fbfcf7] p-4">
            <h3 className="text-base font-semibold text-[#111]">Что будет после отмены?</h3>
            <p className="mt-2 text-sm leading-6 text-[#5f675f]">
              Проекты, стиль и тексты останутся. Мы просто остановим генерацию, парсинг и автопубликацию до новой
              подписки.
            </p>
          </div>
          <div className="rounded-[16px] border border-[#e1e7dd] bg-[#fbfcf7] p-4">
            <h3 className="text-base font-semibold text-[#111]">Когда включится доступ после оплаты?</h3>
            <p className="mt-2 text-sm leading-6 text-[#5f675f]">
              После привязки карты завершите активацию в Tribute и нажмите кнопку доступа к закрытому каналу. Затем
              вернитесь в ThreadsGo: мы проверим доступ автоматически. При необходимости нажмите «Проверить доступ».
            </p>
          </div>
          <div className="rounded-[16px] border border-[#e1e7dd] bg-[#fbfcf7] p-4">
            <h3 className="text-base font-semibold text-[#111]">Куда писать, если доступ не появился?</h3>
            <p className="mt-2 text-sm leading-6 text-[#5f675f]">
              Напишите в <a href="https://t.me/cuartenlol" target="_blank" rel="noreferrer" className="underline underline-offset-4">поддержку Telegram</a>. Проекты и тексты при этом остаются в безопасности.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function formatSubscriptionLabel(billing: BillingStatus) {
  const phaseLabel =
    billing.subscription_phase === "trial"
      ? "пробный период"
      : billing.subscription_phase === "gift"
        ? "подарочный доступ"
        : billing.subscription_phase === "cancelled"
          ? "доступ до конца оплаченного периода"
          : "активный доступ";
  const expiresLabel = billing.subscription_expires_at
    ? ` до ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(new Date(billing.subscription_expires_at))}`
    : "";

  return `тариф ${billing.tariff_plan}, ${phaseLabel}${expiresLabel}`;
}
