// Apply the saved appearance before the first paint, including prerendered pages.
(function () {
  var preference;
  try { preference = localStorage.getItem("threadsgo.theme"); } catch (_) {}
  var dark = preference === "dark" || (preference !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
})();
