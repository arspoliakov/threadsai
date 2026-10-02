import { Link } from "react-router-dom";

export default function AccountRiskNotice() {
  return (
    <p className="rounded-2xl border border-[#e1e1dc] bg-[#fbfaf5] px-4 py-3 text-xs leading-5 text-[#66645d]">
      Мы активно совершенствуем наши системы защиты от блокировок. Однако это не исключает ограничений. Meta постоянно меняет
      правила и системы обнаружения автоматизации: аккаунт может быть ограничен или заблокирован,
      в том числе без возможности восстановления. Учитывайте этот риск при подключении профиля.{' '}
      <Link to="/terms" className="underline underline-offset-2">Условия использования</Link>
    </p>
  );
}
