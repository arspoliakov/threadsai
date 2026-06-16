import { Link } from "react-router-dom";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#f5f6f1] px-5 py-8 text-[#07100e] sm:px-8">
      <article className="mx-auto max-w-4xl">
        <header className="flex items-center justify-between border-b border-[#d9ddd4] pb-6">
          <Link to="/" className="flex items-center gap-3 font-display text-2xl">
            <img src="/threadsgo-logo.png" alt="" className="h-9 w-9 object-contain" />
            ThreadsGo
          </Link>
          <Link to="/terms" className="text-sm text-[#526056] hover:text-[#07100e]">Условия использования</Link>
        </header>

        <nav className="mt-10 text-sm text-[#69766e]" aria-label="Хлебные крошки">
          <Link to="/">Главная</Link><span className="mx-2">/</span><span>Конфиденциальность</span>
        </nav>
        <h1 className="mt-7 font-display text-5xl leading-none sm:text-7xl">Политика конфиденциальности</h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-[#526056]">
          Здесь кратко описано, какие данные нужны ThreadsGo для работы и как ими управлять.
        </p>

        <div className="legal-copy mt-14 border-t border-[#d9ddd4] pt-4">
          <h3>Какие данные используются</h3>
          <p>
            Для входа сервис использует Telegram ID и доступные данные Telegram-профиля. Для работы проектов
            хранятся настройки контента, расписания, подключённые аккаунты, черновики, статусы публикаций и технические ошибки.
          </p>
          <h3>Зачем нужны данные</h3>
          <p>
            Данные используются для авторизации, генерации контента, ведения очереди, публикации и поддержки работы сервиса.
            ThreadsGo не продаёт пользовательские данные рекламным сетям.
          </p>
          <h3>Обработка текстов нейросетью</h3>
          <p>
            Описание проекта, настройки и тексты могут передаваться поставщику языковой модели для генерации и анализа.
            Не добавляйте в проект сведения, которые не должны обрабатываться сторонними сервисами.
          </p>
          <h3>Удаление данных</h3>
          <p>
            Чтобы запросить удаление профиля и связанных данных, напишите в поддержку:
            {" "}<a href="https://t.me/cuartenlol" className="underline">@cuartenlol</a>.
          </p>
        </div>
      </article>
    </main>
  );
}
