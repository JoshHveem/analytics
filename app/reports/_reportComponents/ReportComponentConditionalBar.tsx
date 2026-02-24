"use client";

type ConditionalBarRow = {
  key: string;
  label: string;
  valueLabel: string;
  widthPct: number;
  color: string;
};

type ConditionalBarSegment = {
  key: string;
  color: string;
  title?: string;
};

export default function ReportComponentConditionalBar(args: {
  rows?: ConditionalBarRow[];
  segments?: ConditionalBarSegment[];
}) {
  const { segments = [] } = args;

  if (segments.length === 0) {
    return (
      <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
        No conditional-bar settings configured yet.
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        className="relative h-5 overflow-hidden rounded-full"
        style={{ backgroundColor: "var(--app-surface-muted)" }}
        aria-label="Conditional bar segments"
      >
        <div className="absolute inset-0 flex">
          {segments.map((segment) => (
            <div
              key={segment.key}
              title={segment.title}
              className="h-full border-r border-white/60 last:border-r-0"
              style={{
                flex: "1 1 0",
                backgroundColor: segment.color,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
