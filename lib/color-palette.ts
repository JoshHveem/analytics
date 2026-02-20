type BaseAppColors = {
  green: "#22c55e",
  greenDark: "#15803d",
  yellow: "#facc15",
  yellowDark: "#a16207",
  red: "#ef4444",
  redDark: "#b91c1c",
  orange: "#f97316",
  orangeDark: "#c2410c",
  blue: "#3b82f6",
  blueDark: "#1d4ed8",
  purple: "#8b5cf6",
  purpleDark: "#6d28d9",
  gray: "#a3a3a3",
  darkGray: "#525252",
  lightGray: "#e5e7eb",
  ink: "#111827",
  black: "#0a0a0a",
  white: "#ffffff",
};

type SemanticThemeColors = {
  background: string;
  foreground: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  textStrong: string;
  textMuted: string;
  overlay: string;
  controlTrack: string;
  controlTrackActive: string;
  controlThumb: string;
  hoverSurface: string;
};

type AppThemePalette = BaseAppColors & SemanticThemeColors;

const BASE_STATUS_COLORS: BaseAppColors = {
  green: "#22c55e",
  greenDark: "#15803d",
  yellow: "#facc15",
  yellowDark: "#a16207",
  red: "#ef4444",
  redDark: "#b91c1c",
  orange: "#f97316",
  orangeDark: "#c2410c",
  blue: "#3b82f6",
  blueDark: "#1d4ed8",
  purple: "#8b5cf6",
  purpleDark: "#6d28d9",
  gray: "#a3a3a3",
  darkGray: "#525252",
  lightGray: "#e5e7eb",
  ink: "#111827",
  black: "#0a0a0a",
  white: "#ffffff",
};

export const LIGHT_APP_COLORS: AppThemePalette = {
  ...BASE_STATUS_COLORS,
  background: "#ffffff",
  foreground: "#111827",
  surface: "#ffffff",
  surfaceMuted: "#f4f4f5",
  border: "#e4e4e7",
  textStrong: "#111827",
  textMuted: "#52525b",
  overlay: "rgba(24, 24, 27, 0.6)",
  controlTrack: "#d4d4d8",
  controlTrackActive: "#18181b",
  controlThumb: "#ffffff",
  hoverSurface: "#f4f4f5",
};

export const DARK_APP_COLORS: AppThemePalette = {
  ...BASE_STATUS_COLORS,
  background: "#09090b",
  foreground: "#f4f4f5",
  surface: "#18181b",
  surfaceMuted: "#27272a",
  border: "#3f3f46",
  textStrong: "#f4f4f5",
  textMuted: "#a1a1aa",
  overlay: "rgba(0, 0, 0, 0.7)",
  controlTrack: "#3f3f46",
  controlTrackActive: "#f4f4f5",
  controlThumb: "#09090b",
  hoverSurface: "#27272a",
};

export type AppThemeMode = "light" | "dark";

export function getAppColors(mode: AppThemeMode): AppThemePalette {
  return mode === "dark" ? DARK_APP_COLORS : LIGHT_APP_COLORS;
}

function toCssVarName(key: string): string {
  return `--app-${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`;
}

export function applyAppTheme(root: HTMLElement, mode: AppThemeMode): void {
  const palette = getAppColors(mode);
  for (const [key, value] of Object.entries(palette)) {
    root.style.setProperty(toCssVarName(key), value);
  }
}

export const APP_COLORS = LIGHT_APP_COLORS;

function normalizeHex(hex: string): string {
  const cleaned = hex.trim().replace(/^#/, "");
  if (cleaned.length === 3) {
    return cleaned
      .split("")
      .map((char) => `${char}${char}`)
      .join("");
  }
  return cleaned;
}

export function withAlpha(hex: string, alpha: number): string {
  const normalized = normalizeHex(hex);
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return hex;
  }

  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
