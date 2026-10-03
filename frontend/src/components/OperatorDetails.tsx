export const operator = {
  name: "ThreadsGo",
  supportUrl: "https://t.me/cuartenlol",
  supportLabel: "поддержку ThreadsGo в Telegram",
};

export function OperatorDetails() {
  return (
    <section className="operator-details">
      <h2>Связь с поддержкой</h2>
      <p>
        Вопросы о сервисе, обработке данных, их исправлении, удалении и отзыве
        согласия можно направить в{" "}
        <a href={operator.supportUrl} className="underline">
          {operator.supportLabel}
        </a>
        .
      </p>
    </section>
  );
}
