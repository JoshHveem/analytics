import type { CSSProperties, ReactNode } from "react";

type ReportContainerProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  tone?: "surface" | "muted";
  padding?: "sm" | "md" | "lg";
  radius?: "md" | "lg";
};

function joinClasses(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function ReportContainer({
  children,
  className,
  style,
  tone = "surface",
  padding = "md",
  radius = "lg",
}: ReportContainerProps) {
  const paddingClass = padding === "sm" ? "p-3" : padding === "lg" ? "p-6" : "p-4";
  const radiusClass = radius === "md" ? "rounded-md" : "rounded-lg";

  return (
    <div
      className={joinClasses(radiusClass, "border", paddingClass, className)}
      style={{
        borderColor: "var(--app-border)",
        backgroundColor: tone === "muted" ? "var(--app-surface-muted)" : "var(--app-surface)",
        color: "var(--app-text-strong)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
