import { APP_COLORS } from "@/lib/color-palette";

type ThresholdMetricValueProps = {
  value: number | null | undefined;
  cutoff: number;
  format?: "number" | "percent";
  fractionDigits?: number;
  comparison?: "gte" | "lte";
};

type ThresholdStatus = "meets" | "below" | "none";

function resolveStatus(
  value: number | null | undefined,
  cutoff: number,
  comparison: "gte" | "lte"
): ThresholdStatus {
  if (!Number.isFinite(value)) {
    return "none";
  }

  if (comparison === "lte") {
    return (value as number) <= cutoff ? "meets" : "below";
  }

  return (value as number) >= cutoff ? "meets" : "below";
}

function formatMetricValue(
  value: number | null | undefined,
  format: "number" | "percent",
  fractionDigits: number
): string {
  if (!Number.isFinite(value)) {
    return "-";
  }

  if (format === "percent") {
    return `${((value as number) * 100).toFixed(fractionDigits)}%`;
  }

  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: fractionDigits,
  });
}

function ThresholdMarker({ status }: { status: ThresholdStatus }) {
  if (status === "meets") {
    return (
      <span title="Meets standard" aria-label="Meets standard" className="inline-flex h-3 w-3 items-center justify-center">
        <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
          <circle cx="6" cy="6" r="5" fill={APP_COLORS.greenDark} />
        </svg>
      </span>
    );
  }

  if (status === "below") {
    return (
      <span title="Below standard" aria-label="Below standard" className="inline-flex h-3 w-3 items-center justify-center">
        <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
          <path d="M6 1 11 10H1L6 1Z" fill={APP_COLORS.redDark} />
        </svg>
      </span>
    );
  }

  return null;
}

export function ThresholdMetricValue({
  value,
  cutoff,
  format = "number",
  fractionDigits = 1,
  comparison = "gte",
}: ThresholdMetricValueProps) {
  const status = resolveStatus(value, cutoff, comparison);
  const text = formatMetricValue(value, format, fractionDigits);

  return (
    <div className="flex items-center justify-between gap-2">
      <span>{text}</span>
      <ThresholdMarker status={status} />
    </div>
  );
}
