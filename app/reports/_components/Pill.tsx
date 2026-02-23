import { APP_COLORS, type AppBaseColorKey, withAlpha } from "@/lib/color-palette";

type SemanticPillTone = "neutral" | "success" | "warning" | "danger" | "info";
export type PillTone = SemanticPillTone | AppBaseColorKey;

type PillProps = {
  label: string;
  tone?: PillTone;
};

const SEMANTIC_TONE_STYLES: Record<SemanticPillTone, { borderColor: string; backgroundColor: string }> = {
  neutral: {
    borderColor: APP_COLORS.darkGray,
    backgroundColor: withAlpha(APP_COLORS.lightGray, 0.5),
  },
  success: {
    borderColor: APP_COLORS.greenDark,
    backgroundColor: withAlpha(APP_COLORS.green, 0.2),
  },
  warning: {
    borderColor: APP_COLORS.yellowDark,
    backgroundColor: withAlpha(APP_COLORS.yellow, 0.2),
  },
  danger: {
    borderColor: APP_COLORS.redDark,
    backgroundColor: withAlpha(APP_COLORS.red, 0.2),
  },
  info: {
    borderColor: APP_COLORS.blueDark,
    backgroundColor: withAlpha(APP_COLORS.blue, 0.2),
  },
};

function resolveToneStyle(tone: PillTone): { borderColor: string; backgroundColor: string } {
  if (tone in SEMANTIC_TONE_STYLES) {
    return SEMANTIC_TONE_STYLES[tone as SemanticPillTone];
  }
  if (tone in APP_COLORS) {
    const color = APP_COLORS[tone as keyof typeof APP_COLORS];
    return {
      borderColor: color,
      backgroundColor: withAlpha(color, 0.2),
    };
  }
  return SEMANTIC_TONE_STYLES.neutral;
}

export function Pill({ label, tone = "neutral" }: PillProps) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{ ...resolveToneStyle(tone), color: "var(--app-text-strong)" }}
    >
      {label}
    </span>
  );
}
