import { Link } from "react-router-dom";
import { operator } from "./OperatorDetails";

/** Public links remain available without registration or an active subscription. */
export function PublicLegalLinks() {
  return (
    <nav aria-label="Документы и поддержка" className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
      <Link to="/privacy/" className="underline underline-offset-4">Политика конфиденциальности</Link>
      <Link to="/terms/" className="underline underline-offset-4">Пользовательское соглашение</Link>
      <Link to="/pricing/" className="underline underline-offset-4">Цены и тарифы</Link>
      <a href={operator.supportUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">Поддержка @cuartenlol</a>
    </nav>
  );
}
