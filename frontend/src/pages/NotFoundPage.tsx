import { Link } from "react-router-dom";
import { ThemeToggle } from "../components/ThemeToggle";

export default function NotFoundPage() {
  return (
    <main className="home-refresh public-reader grid min-h-screen place-items-center bg-[#f5f6f1] px-5 text-[#07100e]">
      <section className="max-w-xl text-center">
        <div className="mb-8 flex justify-center"><ThemeToggle /></div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#69766e]">Ошибка 404</p>
        <h1 className="mt-5 font-display text-6xl leading-none">Такой страницы нет</h1>
        <p className="mt-6 leading-7 text-[#526056]">
          Возможно, ссылка устарела. Вернитесь на главную или найдите нужную тему в нашем блоге.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/" className="rounded-full bg-[#07100e] px-6 py-3 text-white">На главную</Link>
          <Link to="/blog/" className="rounded-full border border-[#aeb8b0] px-6 py-3">
            Читать блог
          </Link>
        </div>
      </section>
    </main>
  );
}
