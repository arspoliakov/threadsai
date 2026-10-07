import { Link } from "react-router-dom";

export default function HowItWorksPage() {
  return (
    <section className="space-y-5">
      <header className="tg-reveal grid items-center gap-5 rounded-[24px] border border-[#dfe4dc] bg-white p-5 shadow-sm sm:p-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="max-w-3xl">
          <h1 className="font-display text-4xl leading-[0.95] tracking-[-0.04em] text-[#111] sm:text-5xl">
            Как начать работу
          </h1>
          <p className="mt-5 text-sm leading-7 text-[#667066]">
            Расскажите ИИ о своей теме, подключите Threads и выберите расписание.
            ИИ сможет писать и публиковать посты сам. Если хотите проверять каждый текст, выберите режим с вашей проверкой.
          </p>
        </div>
        <img src="/images/threadsgo-creative-flow-v1.webp" width="1536" height="1024" alt="" loading="lazy" decoding="async" className="tg-illustration mx-auto w-full max-w-sm object-contain" />
      </header>

      <section className="rounded-[28px] border border-[#dfe4dc] bg-[#fbfcf7] p-6 shadow-sm">
        <h2 className="font-display text-3xl leading-none text-[#111]">Четыре шага до публикаций</h2>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <SmallCard
            title="1. Расскажите о теме"
            text="Укажите тему, аудиторию и желаемый тон. Если сложно описать стиль, ответьте на вопросы ИИ-помощника."
          />
          <SmallCard
            title="2. Выберите стиль"
            text="Выберите тон и дайте пример своего текста. Стиль сохраняется только для этого проекта."
          />
          <SmallCard
            title="3. Посмотрите пробный пост"
            text="ИИ подготовит текст по вашим ответам. Можно поправить тему или стиль и попробовать ещё раз."
          />
          <SmallCard title="4. Подключите публикации" text="Подключите аккаунт Threads, выберите расписание и режим: с вашей проверкой или автоматически. Для этого нужна подписка." />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <SmallCard
          title="ИИ пишет и публикует сам"
          text="ИИ готовит новые посты по настройкам проекта и отправляет их по расписанию. Создавать отдельный черновик для каждого поста не нужно. Готовые посты можно посмотреть в проекте."
        />
        <SmallCard
          title="С моей проверкой"
          text="ИИ регулярно готовит тексты. Проверяйте их в разделе «Посты» и назначайте время выхода. Подготовка сама по себе не отправляет пост."
        />
      </section>

      <section className="rounded-[28px] border border-[#dfe4dc] bg-white p-6 shadow-sm">
        <h2 className="font-display text-3xl leading-none text-[#111]">А если хочется свой пост?</h2>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-[#667066]">
          Напишите его в проекте и сохраните черновиком. Можно также попросить ИИ подготовить один текст
          или план недели. Эти черновики ждут вашего подтверждения и выбора времени даже в автоматическом режиме.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            to="/app"
            className="inline-flex h-11 items-center justify-center rounded-full bg-[#141815] px-5 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e]"
          >
            Перейти к проектам
          </Link>
          <Link
            to="/app/setup"
            className="inline-flex h-11 items-center justify-center rounded-full border border-[#141815] px-5 text-sm text-[#141815] transition hover:bg-[#141815] hover:text-white"
          >
            Настроить тему и попробовать текст
          </Link>
        </div>
      </section>

      <p className="text-sm leading-6 text-[#667066]">Идеи из ленты доступны после подключения рабочего аккаунта Threads. Без него ИИ опирается на тему и настройки проекта.</p>
    </section>
  );
}

function SmallCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-[22px] border border-[#e2e6df] bg-white p-4">
      <p className="text-base text-[#151815]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[#667066]">{text}</p>
    </div>
  );
}
