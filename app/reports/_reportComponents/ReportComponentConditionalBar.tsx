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
  const { rows = [], segments = [] } = args;

  if (rows.length === 0 && segments.length === 0) {
    return (
      <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
        No conditional-bar settings configured yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {segments.length > 0 && (
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
      )}

      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((item) => (
            <div key={item.key} className="grid grid-cols-[minmax(180px,1fr)_minmax(220px,3fr)_auto] items-center gap-3">
              <div className="truncate text-sm">{item.label}</div>
              <div className="h-3 w-full overflow-hidden rounded" style={{ backgroundColor: "var(--app-surface-muted)" }}>
                <div
                  className="h-full rounded"
                  style={{
                    width: `${item.widthPct}%`,
                    backgroundColor: item.color,
                  }}
                />
              </div>
              <div className="text-xs tabular-nums" style={{ color: "var(--app-text-muted)" }}>
                {item.valueLabel}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
