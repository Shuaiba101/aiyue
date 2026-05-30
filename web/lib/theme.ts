export type ScreenTheme = "day" | "night";

export const THEME_STORAGE_KEY = "iyue_theme_v1";

export function readStoredTheme(): ScreenTheme {
  if (typeof window === "undefined") return "night";
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "day" ? "day" : "night";
  } catch {
    return "night";
  }
}

export function applyScreenTheme(theme: ScreenTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 本地存储不可用时仍应用当前会话主题。
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "day" ? "#f6f1e8" : "#000000");
}

export function toggleScreenTheme(current: ScreenTheme): ScreenTheme {
  const next: ScreenTheme = current === "night" ? "day" : "night";
  applyScreenTheme(next);
  return next;
}
