import { useEffect, useRef, useState } from "react";
import { AppIcon } from "./AppIcons";
import "./AnimatedWorkflow.css";

const stages = [
  { title: "Идея", label: "Выберите, о чём рассказать", icon: "spark" as const,
    text: "Что я понял после первого разговора с клиентом?", detail: "Начните с вашей темы. Личные наблюдения делают текст узнаваемым." },
  { title: "Черновик", label: "Сделайте текст своим", icon: "style" as const,
    text: "Раньше я начинал встречу с презентации. Теперь — с одного вопроса: «Что сейчас мешает вам больше всего?» Ответ часто меняет весь разговор.", detail: "Нейросеть предлагает текст. Вы можете поправить формулировки и проверить каждую часть." },
  { title: "Расписание", label: "Проверьте перед выходом", icon: "queue" as const,
    text: "Настройте часы публикации в проекте и проверьте рассчитанное время выхода поста.", detail: "У запланированного поста видны профиль и время выхода. До отправки его можно изменить или отменить." },
];

export function AnimatedWorkflow() {
  const [active, setActive] = useState(0);
  const [replay, setReplay] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const manuallySelected = useRef(false);

  const clearTimers = () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  };

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const run = () => {
      if (manuallySelected.current) return;
      clearTimers();
      if (motion.matches) { setActive(2); return; }
      setActive(0);
      timers.current = [window.setTimeout(() => setActive(1), 1500), window.setTimeout(() => setActive(2), 3300)];
    };
    const handleMotionChange = () => { if (motion.matches) { clearTimers(); setActive(2); } };
    motion.addEventListener("change", handleMotionChange);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { run(); observer?.disconnect(); }
    }, { threshold: 0.25 });
    if (observer) observer.observe(element); else run();
    return () => { observer?.disconnect(); clearTimers(); motion.removeEventListener("change", handleMotionChange); };
  }, [replay]);

  function selectStage(index: number) {
    manuallySelected.current = true;
    clearTimers();
    setActive(index);
  }

  return (
    <div ref={container} className="tg-workflow rounded-3xl border border-[#dbe6dd] bg-[#f8faf9] p-5 sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <p className="home-eyebrow">ПРИМЕР ОДНОГО ПОСТА</p>
        <button type="button" className="tg-action min-h-11 rounded-full border border-[#d5e0d9] px-3 py-2 text-xs font-medium text-[#49705a] transition hover:bg-[#edf3ef]"
          onClick={() => { manuallySelected.current = false; setReplay((current) => current + 1); }} aria-label="Повторить пример пути от идеи до расписания">
          Повторить ↻
        </button>
      </div>
      <div className="tg-workflow-track mt-6 grid grid-cols-3 gap-2" aria-label="Этапы подготовки поста">
        {stages.map((stage, index) => (
          <button key={stage.title} type="button" aria-pressed={active === index} onClick={() => selectStage(index)}
            className="tg-workflow-step relative flex min-w-0 flex-col items-center gap-2 rounded-2xl border border-[#e0e8e2] bg-white px-2 py-4 text-xs font-medium text-[#60716a]" data-active={active === index}>
            <AppIcon name={stage.icon} className="h-5 w-5" />
            <span>{stage.title}</span>
          </button>
        ))}
      </div>
      <div className="tg-workflow-paper mt-5 flex min-h-[22rem] flex-col rounded-2xl border border-[#e0e8e2] bg-white p-5 sm:min-h-[20rem] sm:p-6">
        <div className="flex items-center gap-2 text-xs text-[#738078]">
          <span className="h-2 w-2 rounded-full bg-[#5c8b71]" />
          Этап {active + 1} из 3 · пример, не публикация
        </div>
        <div className="tg-workflow-content mt-4 grid flex-1">
          {stages.map((stage, index) => (
            <div key={stage.title} className="tg-workflow-content-stage flex flex-col" data-active={active === index} aria-hidden={active !== index}>
              <h3 className="text-lg font-semibold tracking-tight text-[#162b25]">{stage.label}</h3>
              <p className="mb-5 mt-4 text-sm leading-7 text-[#315b46]">{stage.text}</p>
              <p className="mt-auto border-t border-[#e0e8e2] pt-4 text-xs leading-6 text-[#60716a]">{stage.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
