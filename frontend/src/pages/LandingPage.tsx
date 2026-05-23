import { Link } from "react-router-dom";

const features = [
  {
    title: "Тренды",
    text: "Система собирает живую ленту Threads, отсекает мусор и вытаскивает рабочие паттерны: хук, структуру, ритм.",
  },
  {
    title: "Генерация",
    text: "ИИ не копирует чужой текст. Он берет механику тренда и адаптирует ее под проект, стиль и стоп-слова.",
  },
  {
    title: "Публикация",
    text: "Очередь, расписание, cookies-сессии, прокси и ручной контроль перед публикацией собраны в одной панели.",
  },
];

const workflow = [
  "собираем свежие сигналы из ленты",
  "разбираем, почему это сработало",
  "генерируем пост под голос проекта",
  "даем человеку отредактировать",
  "публикуем по расписанию",
];

export default function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#0d0d0c] text-[#f5f0e7]">
      <section className="relative border-b border-white/10">
        <div className="absolute left-[-18rem] top-[-18rem] h-[38rem] w-[38rem] rounded-full bg-[#d9f36a]/10 blur-3xl" />
        <div className="absolute bottom-[-24rem] right-[-12rem] h-[40rem] w-[40rem] rounded-full bg-[#b76e4c]/20 blur-3xl" />

        <div className="relative mx-auto grid min-h-screen max-w-7xl px-6 py-8 md:px-10 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="flex flex-col">
            <header className="flex items-center justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-white/40">
                  ThreadsAI
                </p>
                <p className="mt-2 font-display text-2xl leading-none">threadsgo.ru</p>
              </div>
              <Link
                to="/login"
                className="rounded-full border border-white/20 px-5 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-white/70 transition hover:border-white hover:text-white"
              >
                Войти
              </Link>
            </header>

            <div className="my-auto max-w-4xl py-20">
              <p className="w-fit rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-white/50">
                AI content ops for Threads
              </p>
              <h1 className="mt-8 max-w-4xl font-display text-6xl leading-[0.9] tracking-[-0.05em] md:text-8xl">
                автопостинг, который сначала смотрит на рынок
              </h1>
              <p className="mt-8 max-w-2xl text-lg leading-8 text-white/62">
                SaaS-панель для проектов, аккаунтов и контента. Система собирает тренды,
                синтезирует паттерны, генерирует посты в живом стиле и держит публикации
                под человеческим контролем.
              </p>

              <div className="mt-10 flex flex-wrap gap-3">
                <Link
                  to="/login"
                  className="rounded-full bg-[#f5f0e7] px-7 py-4 font-mono text-xs uppercase tracking-[0.18em] text-[#101010] transition hover:bg-[#d9f36a]"
                >
                  Открыть кабинет
                </Link>
                <a
                  href="#product"
                  className="rounded-full border border-white/20 px-7 py-4 font-mono text-xs uppercase tracking-[0.18em] text-white/70 transition hover:border-white hover:text-white"
                >
                  Как работает
                </a>
              </div>
            </div>
          </div>

          <div className="flex items-center pb-14 lg:pb-0">
            <div className="w-full rounded-[2rem] border border-white/12 bg-[#171716]/80 p-4 shadow-[0_40px_120px_rgba(0,0,0,0.45)] backdrop-blur">
              <div className="rounded-[1.5rem] border border-white/10 bg-[#f4f1ea] p-5 text-[#151515]">
                <div className="flex items-center justify-between border-b border-[#d8d3c8] pb-4">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#77766f]">
                      Project pulse
                    </p>
                    <h2 className="mt-2 font-display text-3xl">MosRiders</h2>
                  </div>
                  <span className="rounded-full bg-[#0f0f0e] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-white">
                    online
                  </span>
                </div>

                <div className="mt-5 grid gap-3">
                  <Metric label="Новые тренды" value="10" />
                  <Metric label="Следующий пост" value="сегодня, 18:40" />
                  <Metric label="Сессия Threads" value="активна" />
                </div>

                <div className="mt-5 rounded-3xl bg-[#151515] p-5 text-white">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">
                    AI draft
                  </p>
                  <p className="mt-4 text-sm leading-7 text-white/76">
                    Нас уже 20 человек на воскресный круг. Стартуем в 12:30, спокойно
                    катим по маршруту и потом садимся за пиццу. Если хочешь влиться —
                    напиши, скину детали.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="product" className="mx-auto max-w-7xl px-6 py-24 md:px-10">
        <div className="grid gap-4 lg:grid-cols-3">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="rounded-[2rem] border border-white/10 bg-white/[0.035] p-7 transition hover:bg-white/[0.06]"
            >
              <p className="font-display text-4xl leading-none">{feature.title}</p>
              <p className="mt-6 text-sm leading-7 text-white/56">{feature.text}</p>
            </article>
          ))}
        </div>

        <div className="mt-4 rounded-[2rem] border border-white/10 bg-[#f4f1ea] p-8 text-[#151515] md:p-10">
          <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-[#77766f]">
            Production workflow
          </p>
          <div className="mt-8 grid gap-3 md:grid-cols-5">
            {workflow.map((item, index) => (
              <div key={item} className="rounded-3xl border border-[#ddd6c8] bg-white/60 p-5">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#77766f]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <p className="mt-5 text-sm leading-6">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center rounded-2xl border border-[#ddd6c8] bg-white px-4 py-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#77766f]">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
