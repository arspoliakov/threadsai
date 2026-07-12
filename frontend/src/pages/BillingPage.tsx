import { useEffect, useState } from "react";
import { toast } from "sonner";

import { getApiErrorMessage, getBillingStatus, refreshBillingStatus, type BillingStatus } from "../api/client";
import { trackSeoEvent } from "../components/SeoAnalytics";

const planCopy = {
  basic: {
    title: "Basic",
    subtitle: "Для одного проекта и спокойного теста",
    price: "3 дня бесплатно, дальше 1 490 ₽ в месяц",
    body:
      "Подходит экспертам, авторам блогов и фрилансерам, которые ведут один проект и хотят стабильно выпускать контент без ручной рутины.",
    tone: "border-[#7adf8b] bg-[#f4fff5]",
  },
  pro: {
    title: "Pro",
    subtitle: "Рабочая база для маркетологов и SMM",
    price: "3 490 ₽ в месяц, квартал 9 490 ₽, год 34 990 ₽",
    body:
      "Для специалистов, которые ведут несколько проектов: стиль отдельно для каждого клиента, генерация и планирование внутри одной панели.",
    tone: "border-[#ead36a] bg-[#fffbed]",
  },
  agency: {
    title: "Agency",
    subtitle: "Масштаб без хаоса для команд",
    price: "8 990 ₽ в месяц, квартал 24 990 ₽, год 89 990 ₽",
    body:
      "Для агентств и команд: много профилей, раздельные проекты, плотный поток публикаций и очередь на две недели вперед.",
    tone: "border-[#f08d7f] bg-[#fff4f1]",
  },
} as const;

export default function BillingPage() {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isRefreshingSubscription, setIsRefreshingSubscription] = useState(false);

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

  async function checkSubscription() {
    setIsRefreshingSubscription(true);
    try {
      const refreshed = await refreshBillingStatus();
      setBilling(refreshed);
      toast.success(
        refreshed.subscription_status
          ? "Тариф подтвержден, лимиты обновлены"
          : "Оплата пока не найдена. Если вы только что оплатили, подождите минуту и повторите проверку.",
      );
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Не удалось проверить оплату. Попробуйте ещё раз через минуту."));
    } finally {
      setIsRefreshingSubscription(false);
    }
  }

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
            Оплата идет через Telegram-сервис Tribute. Он сам выдает доступ, управляет пробным периодом и отменой
            подписки. ThreadsGo просто смотрит, есть ли вы в закрытом канале тарифа.
          </p>
        </div>

        {billing ? (
          <div className="mt-5 flex flex-col gap-4 rounded-[16px] border border-[#e1e7dd] bg-[#f7faf4] p-4 text-sm leading-6 text-[#4f5a50] sm:flex-row sm:items-center sm:justify-between">
            <p>
              Сейчас: {billing.subscription_status ? `тариф ${billing.tariff_plan}` : "подписка не активна"}. Настройки и
              тексты не пропадут, если подписка закончится: автопубликация просто встанет на паузу.
            </p>
            <button
              type="button"
              onClick={() => void checkSubscription()}
              disabled={isRefreshingSubscription}
              className="h-11 shrink-0 rounded-full border border-[#cfd6cc] bg-white px-5 text-sm font-medium text-[#111] transition hover:border-[#111] hover:bg-[#111] hover:text-white disabled:cursor-wait disabled:opacity-50"
            >
              {isRefreshingSubscription ? "Проверяем..." : "Проверить оплату"}
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
                  onClick={() => trackSeoEvent("tribute_click", { plan: plan.name, source: "billing_page" })}
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
              Вы выбираете Basic в Tribute. Первые 3 дня бесплатные, а отменить подписку можно в самом Telegram-боте.
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
              Обычно сразу после вступления в закрытый Telegram-канал тарифа. Если кабинет уже открыт, нажмите
              «Проверить оплату» выше. Резервная автоматическая сверка выполняется каждые 15 минут.
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
