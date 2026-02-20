import { APP_COLORS, withAlpha } from "@/lib/color-palette";

export type PillTone = "neutral" | "success" | "warning" | "danger" | "info";

type PillProps = {
  label: string;
  tone?: PillTone;
};

const TONE_STYLES: Record<PillTone, { borderColor: string; backgroundColor: string }> = {
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

export function Pill({ label, tone = "neutral" }: PillProps) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{ ...TONE_STYLES[tone], color: "var(--app-text-strong)" }}
    >
      {label}
    </span>
  );
}
