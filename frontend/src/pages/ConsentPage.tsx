import { Link } from "react-router-dom";
import { OperatorDetails, operator } from "../components/OperatorDetails";
import { ThemeToggle } from "../components/ThemeToggle";

export default function ConsentPage() {
  return (
    <main className="home-refresh public-reader min-h-screen bg-[#f8faf9] px-5 py-8 text-[#162b25] sm:px-8">
      <article className="mx-auto max-w-3xl">
        <header className="flex items-center justify-between">
          <Link to="/" className="text-xl font-semibold">
            ThreadsGo
          </Link>
          <ThemeToggle />
        </header>
        <h1 className="mt-12 text-3xl font-semibold tracking-tight sm:text-4xl">
          Согласие на обработку персональных данных
        </h1>
        <p className="mt-4 text-sm text-[#60716a]">
          Редакция от 3 октября 2026 года. Согласие подтверждается отдельной
          отметкой при регистрации.
        </p>
        <div className="mt-8 space-y-6 rounded-2xl border border-[#dbe6dd] bg-white p-6 text-sm leading-7 sm:p-8">
          <OperatorDetails />
          <section>
            <h2 className="text-lg font-semibold">Для чего нужны данные</h2>
            <p className="mt-2">
              Я разрешаю сервису {operator.name} обрабатывать данные моего
              Telegram-профиля для создания и обслуживания кабинета ThreadsGo,
              проверки доступа, работы проектов и ответа на обращения в
              поддержку.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold">Какие данные и действия</h2>
            <p className="mt-2">
              Telegram ID, имя, username и доступная ссылка на изображение
              профиля. Сервис собирает, записывает, хранит, уточняет, использует
              и удаляет эти данные. Обработка выполняется автоматически; версия
              согласия и время подтверждения сохраняются после проверенного
              входа через Telegram.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold">Срок и отзыв</h2>
            <p className="mt-2">
              Согласие действует до его отзыва или удаления кабинета. Отзыв
              можно направить в{" "}
              <a href={operator.supportUrl} className="underline">
                {operator.supportLabel}
              </a>{" "}
              — по ссылке выше. После отзыва
              обработка прекращается, кроме случаев, когда хранение требуется
              законом или для исполнения сохраняющихся обязательств.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold">Отдельные настройки</h2>
            <p className="mt-2">
              Это согласие не включает рекламную рассылку и аналитику Яндекс
              Метрики. Аналитические cookie разрешаются отдельно в настройках
              cookie. Текущая серверная инфраструктура находится в Германии.
              Настройки, описание проекта и тексты могут передаваться
              ИИ-провайдеру для выполнения ваших запросов; не добавляйте в них
              чужие персональные или чувствительные данные.
            </p>
          </section>
          <p>
            Подробнее об инфраструктуре, данных и обращениях — в{" "}
            <Link to="/privacy" className="underline">
              политике конфиденциальности
            </Link>
            .
          </p>
        </div>
        <Link to="/register" className="home-primary mt-8 w-fit">
          Вернуться к регистрации →
        </Link>
      </article>
    </main>
  );
}
