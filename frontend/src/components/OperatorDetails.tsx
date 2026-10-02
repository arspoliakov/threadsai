export const operator = {
  name: "Поляков Арсений Александрович",
  status: "самозанятый (плательщик налога на профессиональный доход)",
  address: "город Москва, улица Учинская, дом 1, квартира 141",
  email: "arspoliakov@mail.ru",
};

export function OperatorDetails() {
  return (
    <section className="operator-details">
      <h2>Оператор сервиса и персональных данных</h2>
      <p>
        {operator.name}, {operator.status}.
      </p>
      <p>Адрес для обращений: {operator.address}.</p>
      <p>
        Вопросы о сервисе, обработке данных, их исправлении, удалении и отзыве
        согласия:{" "}
        <a href={`mailto:${operator.email}`} className="underline">
          {operator.email}
        </a>
        .
      </p>
    </section>
  );
}
