/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1f2421",
        paper: "#f6f1e8",
        line: "#ded5c8",
        moss: "#63745c",
        clay: "#b76e4c",
        slateblue: "#56657a",
      },
      fontFamily: {
        display: ["Georgia", "Cambria", "Times New Roman", "serif"],
        body: ["Aptos", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        panel: "0 24px 70px rgba(60, 45, 31, 0.12)",
      },
    },
  },
  plugins: [],
};
