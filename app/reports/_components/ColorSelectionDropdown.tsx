"use client";

import type { CSSProperties } from "react";
import { APP_COLORS, BASE_APP_COLOR_KEYS } from "@/lib/color-palette";

type SemanticColorName = "neutral" | "success" | "warning" | "danger" | "info";

export type ColorSelectionGroup = {
  label: string;
  colors: readonly string[];
};

const PILL_SEMANTIC_COLOR_OPTIONS = ["neutral", "success", "warning", "danger", "info"] as const;
const PILL_SEMANTIC_COLOR_SWATCH: Record<SemanticColorName, string> = {
  neutral: APP_COLORS.darkGray,
  success: APP_COLORS.green,
  warning: APP_COLORS.yellowDark,
  danger: APP_COLORS.red,
  info: APP_COLORS.blue,
};

export const PILL_COLOR_GROUPS: readonly ColorSelectionGroup[] = [
  { label: "Semantic", colors: PILL_SEMANTIC_COLOR_OPTIONS },
  { label: "Base Colors", colors: BASE_APP_COLOR_KEYS },
];

export const BASE_COLOR_GROUPS: readonly ColorSelectionGroup[] = [
  { label: "Base Colors", colors: BASE_APP_COLOR_KEYS },
];

function colorHexForOption(colorName: string): string {
  const normalized = String(colorName ?? "").trim();
  if (!normalized) {
    return APP_COLORS.darkGray;
  }
  if (normalized in PILL_SEMANTIC_COLOR_SWATCH) {
    return PILL_SEMANTIC_COLOR_SWATCH[normalized as SemanticColorName];
  }
  if (normalized in APP_COLORS) {
    return APP_COLORS[normalized as keyof typeof APP_COLORS];
  }
  return APP_COLORS.darkGray;
}

export default function ColorSelectionDropdown(args: {
  value: string;
  onChange: (nextValue: string) => void;
  groups: readonly ColorSelectionGroup[];
  includeDefaultOption?: boolean;
  defaultOptionLabel?: string;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  optionLabelPrefix?: string;
}) {
  const {
    value,
    onChange,
    groups,
    includeDefaultOption = false,
    defaultOptionLabel = "Default",
    className = "",
    style,
    disabled = false,
    optionLabelPrefix = "",
  } = args;

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={className}
      style={style}
      disabled={disabled}
    >
      {includeDefaultOption && <option value="">{defaultOptionLabel}</option>}
      {groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.colors.map((colorName) => (
            <option
              key={`${group.label}-${colorName}`}
              value={colorName}
              style={{ color: colorHexForOption(colorName) }}
            >
              {`${optionLabelPrefix}${colorName}`}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
