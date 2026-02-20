import type { ReactNode } from "react";

type MetaChipProps = {
  children: ReactNode;
  className?: string;
};

function joinClasses(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function MetaChip({ children, className }: MetaChipProps) {
  return (
    <span
      className={joinClasses("rounded-full border px-2 py-1 text-xs", className)}
      style={{
        backgroundColor: "var(--app-surface-muted)",
        borderColor: "var(--app-border)",
        color: "var(--app-text-muted)",
      }}
    >
      {children}
    </span>
  );
}
