import { Link } from "react-router-dom";
import { AppIcon, type AppIconName } from "../../components/AppIcons";

const sections: { title: string; description: string; to: string; icon: AppIconName }[] = [
  { title: "Аккаунты Threads", description: "Все подключённые аккаунты, проверка входа и подключение новых.", to: "/app/infrastructure", icon: "accounts" },
  { title: "Мой шаблон стиля", description: "Сохраните, как ИИ должен писать. Этот шаблон можно выбрать для нового проекта.", to: "/app/settings/style", icon: "style" },
  { title: "Подписка и оплата", description: "Ваш тариф, срок доступа и управление подпиской.", to: "/app/billing", icon: "user" },
  { title: "Сообщения от ThreadsGo", description: "Включите или выключите помощь, новости и предложения в Telegram.", to: "/app/settings?profile=messages", icon: "send" },
];

export default function GlobalSettingsPage() {
  return <section className="workspace-page space-y-5">
    <header>
      <h1 className="font-display text-4xl">Настройки сервиса</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--workspace-muted)]">Здесь настройки для всего вашего кабинета. Темы постов, расписание и режим публикации меняются внутри выбранного проекта.</p>
    </header>
    <div className="grid gap-4 sm:grid-cols-2">
      {sections.map(section => <Link key={section.title} to={section.to} className="rounded-2xl border border-[var(--workspace-border)] bg-[var(--workspace-panel)] p-5 transition hover:border-[var(--workspace-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--workspace-ring)]">
        <div className="flex items-center justify-between gap-3"><AppIcon name={section.icon} /><span aria-hidden="true">→</span></div>
        <h2 className="mt-4 text-lg font-semibold">{section.title}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--workspace-muted)]">{section.description}</p>
      </Link>)}
    </div>
    <p className="text-sm leading-6 text-[var(--workspace-muted)]">Светлая и тёмная тема переключаются кнопкой в правом верхнем углу. <Link className="underline" to="/app/how-it-works">Нужна помощь с сервисом?</Link></p>
  </section>;
}
