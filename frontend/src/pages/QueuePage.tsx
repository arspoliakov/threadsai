import PageShell from "./PageShell";

export default function QueuePage() {
  return (
    <PageShell
      eyebrow="Публикации"
      title="Очередь публикаций"
      description="Здесь будет список задач, фильтры по проектам и статусы queued/running/success/failed."
    />
  );
}
