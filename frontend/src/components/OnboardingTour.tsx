import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const ONBOARDING_STORAGE_KEY = "threadsgo.onboarding.completed";
export const RESTART_ONBOARDING_EVENT = "threadsgo:onboarding:restart";

const steps = [
  {
    title: "Создайте первый проект",
    text: "Расскажите, о чём хотите писать и для кого. Эти настройки помогут ИИ готовить посты по вашей теме.",
    action: "Мастер настройки сохранит тему, стиль и пробный результат. ИИ поможет подобрать формулировки.",
    image: "/interface/project-library.webp",
    to: "/app/setup",
    button: "Начать настройку",
  },
  {
    title: "Подключите аккаунт Threads",
    text: "Аккаунт нужен для чтения ленты и публикаций. Подготовить текст можно и без него.",
    action:
      "В настройках проекта откройте подключение аккаунта, войдите в Threads через отдельное окно или перенесите данные входа. Затем добавьте аккаунт в настройки проекта.",
    image: "/interface/accounts-health.webp",
    to: "/app/infrastructure",
    button: "Подключить аккаунт",
  },
  {
    title: "Выберите, как публиковать",
    text: "В автоматическом режиме ИИ пишет новые посты и публикует их по расписанию. Если хотите проверять каждый текст, выбирайте режим с вашей проверкой.",
    action:
      "В настройках проекта выберите режим и расписание. Для публикаций нужна действующая подписка. Свой текст можно отдельно сохранить черновиком и назначить время выхода.",
    image: "/interface/queue-timeline.webp",
    to: "/app",
    button: "Перейти к проектам",
  },
];

export function OnboardingTour() {
  const [isOpen, setIsOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;

  useEffect(() => {
    function handleRestart() {
      setStepIndex(0);
      setIsOpen(true);
    }

    window.addEventListener(RESTART_ONBOARDING_EVENT, handleRestart);
    return () =>
      window.removeEventListener(RESTART_ONBOARDING_EVENT, handleRestart);
  }, []);

  function completeTour() {
    try { window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true"); } catch { /* Closing remains available when storage is blocked. */ }
    setIsOpen(false);
  }

  function nextStep() {
    if (isLastStep) {
      completeTour();
      return;
    }

    setStepIndex((current) => current + 1);
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-end bg-[#07100e]/58 p-3 backdrop-blur-sm sm:place-items-center sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Быстрый старт"
        onKeyDown={(event) => {
          if (event.key === "Escape") completeTour();
          if (event.key !== "Tab") return;
          const fields = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>("button, [href]"),
          );
          const first = fields[0];
          const last = fields[fields.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl overflow-y-auto rounded-[2rem] border border-white/20 bg-[#f5f6f1] shadow-[0_34px_120px_rgba(0,0,0,0.32)] sm:rounded-[2.4rem]"
      >
        <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
          <div className="relative hidden min-h-56 overflow-hidden lg:block bg-[#07100e] sm:min-h-72 lg:min-h-full">
            <img
              src={step.image}
              alt=""
              className="h-full w-full object-cover opacity-85"
            />
            <div className="absolute inset-0 bg-gradient-to-tr from-[#07100e] via-[#07100e]/35 to-transparent" />
            <img
              src="/threadsgo-logo.png"
              alt=""
              className="absolute left-6 top-6 h-14 w-14 rounded-2xl border border-white/12 bg-white/8 p-2"
            />
            <div className="absolute bottom-6 left-6 right-6">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/48">
                Быстрый старт
              </p>
              <p className="mt-2 font-display text-4xl leading-none tracking-[-0.05em] text-white">
                {String(stepIndex + 1).padStart(2, "0")} /{" "}
                {String(steps.length).padStart(2, "0")}
              </p>
            </div>
          </div>

          <div className="p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#6d746d]">
                  Первые шаги
                </p>
                <h2 className="mt-4 font-display text-2xl leading-tight tracking-[-0.04em] text-[#07100e] sm:text-3xl">
                  {step.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={completeTour}
                autoFocus
                className="rounded-full border border-[#d6ddd2] px-4 py-2 text-xs text-[#687168] transition hover:border-[#07100e] hover:text-[#07100e]"
              >
                Закрыть
              </button>
            </div>

            <p className="mt-6 text-base leading-7 text-[#4f584f]">
              {step.text}
            </p>

            <div className="mt-6 rounded-[1.5rem] border border-[#dfe4dc] bg-white p-4">
              <p className="text-sm font-medium text-[#07100e]">Подсказка</p>
              <p className="mt-2 text-sm leading-6 text-[#687168]">
                {step.action}
              </p>
            </div>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-2">
                {steps.map((item, index) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => setStepIndex(index)}
                    className={[
                      "h-2.5 rounded-full transition-all",
                      index === stepIndex
                        ? "w-9 bg-[#07100e]"
                        : "w-2.5 bg-[#cfd8cc] hover:bg-[#98a394]",
                    ].join(" ")}
                    aria-label={`Шаг ${index + 1}`}
                  />
                ))}
              </div>

              <div className="grid gap-2 sm:flex">
                <Link
                  to={step.to}
                  onClick={completeTour}
                  className="inline-flex h-12 items-center justify-center rounded-full border border-[#d6ddd2] px-5 text-sm text-[#07100e] transition hover:border-[#07100e]"
                >
                  {step.button}
                </Link>
                <button
                  type="button"
                  onClick={nextStep}
                  className="inline-flex h-12 items-center justify-center rounded-full bg-[#07100e] px-6 text-sm text-white transition hover:bg-[#70ff35] hover:text-[#07100e]"
                >
                  {isLastStep ? "Понятно" : "Дальше"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
