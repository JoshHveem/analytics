type ReportErrorBannerProps = {
  message: string;
  className?: string;
};

function joinClasses(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function ReportErrorBanner({ message, className }: ReportErrorBannerProps) {
  return (
    <div
      className={joinClasses("rounded-md border px-3 py-2 text-sm", className)}
      style={{
        borderColor: "var(--app-border)",
        backgroundColor: "var(--app-surface-muted)",
        color: "var(--app-text-strong)",
      }}
    >
      Error: {message}
    </div>
  );
}
