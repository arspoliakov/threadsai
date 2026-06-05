import { useEffect, useState } from "react";

import { getBillingStatus, type BillingStatus } from "../api/client";

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

  useEffect(() => {
    void getBillingStatus()
      .then(setBilling)
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return <div className="rounded-[18px] border border-[#dfe4dc] bg-white p-6">Загружаем тарифы...</div>;
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
          <div className="mt-5 rounded-[16px] border border-[#e1e7dd] bg-[#f7faf4] p-4 text-sm leading-6 text-[#4f5a50]">
            Сейчас: {billing.subscription_status ? `тариф ${billing.tariff_plan}` : "подписка не активна"}. Настройки и
            тексты не пропадут, если подписка закончится: автопубликация просто встанет на паузу.
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {(billing?.plans || []).map((plan) => {
          const copy = planCopy[plan.name as keyof typeof planCopy] || planCopy.basic;
          return (
            <article key={plan.name} className={`rounded-[20px] border p-5 shadow-sm ${copy.tone}`}>
              <h2 className="font-display text-3xl text-[#111]">{copy.title}</h2>
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
                  className="mt-6 flex h-12 items-center justify-center rounded-full bg-[#111] px-5 text-sm font-semibold text-white transition hover:bg-[#70ff35] hover:text-[#07100e]"
                >
                  Перейти в Tribute
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
        </div>
      </section>
    </div>
  );
}
