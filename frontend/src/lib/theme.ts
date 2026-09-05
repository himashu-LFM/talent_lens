export type Theme = "dark" | "light";
export function getTheme(): Theme {
  try { return (localStorage.getItem("tl-theme") as Theme) || "dark"; } catch { return "dark"; }
}
export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("tl-theme", t); } catch { /* ignore */ }
}
