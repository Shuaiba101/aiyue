"use client";

import type { ScreenTheme } from "@/lib/theme";

type ThemeToggleProps = {
  theme: ScreenTheme;
  onToggle: () => void;
  className?: string;
};

export function ThemeToggle({ theme, onToggle, className = "" }: ThemeToggleProps) {
  const nextLabel = theme === "night" ? "日间" : "夜间";
  const currentLabel = theme === "night" ? "夜间" : "日间";

  return (
    <button
      aria-label={`当前${currentLabel}模式，切换为${nextLabel}`}
      className={`themeToggle ${className}`.trim()}
      onClick={onToggle}
      title={`切换为${nextLabel}模式`}
      type="button"
    >
      <span className="themeToggleIcon" aria-hidden="true">
        {theme === "night" ? "☀" : "☽"}
      </span>
      <span className="themeToggleLabel">{nextLabel}</span>
    </button>
  );
}
