"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ReportHeader } from "../_components/ReportHeader";
import { ReportTable, type ReportTableColumn } from "../_components/ReportTable";
import { ReportContainer } from "../_components/ReportContainer";
import { MetaChip } from "../_components/MetaChip";
import { ReportErrorBanner } from "../_components/ReportErrorBanner";
import { ReportPageSuspense } from "../_components/ReportPageSuspense";
import { useReportPageData } from "../_hooks/useReportPageData";
import { APP_COLORS, withAlpha } from "@/lib/color-palette";

type StudentRow = {
  sis_user_id: string;
  first_name?: string | null;
  last_name?: string | null;
  program_code: string;
  program_name?: string | null;
  campus_code: string;
  academic_year: number;
  exit_date: string | null;
  days_remaining: number | null;
  credits_remaining: number | null;
  projected_exit_date: string | null;
  is_exited: boolean;
  is_graduate: boolean;
  chance_to_graduate?: number | string | null;
  chance_to_complete: number | string | null;
};

type ProgramOption = {
  program_code: string;
  program_name: string;
};

type ExitStatusResponse = {
  ok: boolean;
  count: number;
  data: StudentRow[];
  meta?: {
    years: string[];
    programs: ProgramOption[];
    campuses: string[];
    selected: {
      academic_year: string | null;
      program_code: string | null;
      campus_code: string | null;
    };
  };
  error?: string;
};

type Bucket = "green" | "yellow" | "orange" | "red" | "none";

const BUCKET_THRESHOLDS = {
  green: 0.75,
  yellow: 0.55,
  orange: 0.35,
};

const CHANCE_STANDARD = 0.9;

function clampChance(chance: number | string | null | undefined): number | null {
  if (chance === null || chance === undefined || chance === "") {
    return null;
  }

  const value = Number(chance);
  if (!Number.isFinite(value)) {
    return null;
  }

  if (value > 1) {
    return Math.min(value / 100, 1);
  }
  return Math.max(value, 0);
}

function chanceBucket(chance: number | string | null): Bucket {
  const value = clampChance(chance);
  if (value === null) {
    return "none";
  }
  if (value >= BUCKET_THRESHOLDS.green) {
    return "green";
  }
  if (value >= BUCKET_THRESHOLDS.yellow) {
    return "yellow";
  }
  if (value >= BUCKET_THRESHOLDS.orange) {
    return "orange";
  }
  return "red";
}

function percentText(value: number | null, digits = 1): string {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function dateText(value: string | null): string {
  if (!value) {
    return "-";
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return "-";
  }
  return d.toISOString().slice(0, 10);
}

function dateSortValue(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function endDatePillStyle(args: {
  lockedIn: boolean;
  lockedOutcome?: "success" | "failure";
  chance?: number | string | null;
}): { borderColor: string; backgroundColor: string; color: string } {
  const greenStyle = {
    borderColor: APP_COLORS.greenDark,
    backgroundColor: withAlpha(APP_COLORS.green, 0.2),
    color: "var(--app-text-strong)",
  };
  const grayStyle = {
    borderColor: APP_COLORS.darkGray,
    backgroundColor: withAlpha(APP_COLORS.lightGray, 0.5),
    color: "var(--app-text-strong)",
  };
  if (args.lockedIn) {
    if (args.lockedOutcome === "failure") {
      return grayStyle;
    }
    return greenStyle;
  }

  const chance = clampChance(args.chance ?? null);
  if (chance !== null && chance >= CHANCE_STANDARD) {
    return greenStyle;
  }
  return {
    borderColor: APP_COLORS.yellowDark,
    backgroundColor: withAlpha(APP_COLORS.yellow, 0.2),
    color: "var(--app-text-strong)",
  };
}

function barColorForChance(chance: number | string | null | undefined): string {
  const value = clampChance(chance);
  if (value !== null && value >= CHANCE_STANDARD) {
    return APP_COLORS.green;
  }
  return APP_COLORS.yellow;
}

function ratePillStyle(rate: number | null, minimumRate: number): { backgroundColor: string; color: string } {
  const yellowMin = minimumRate;
  const greenMin = Math.min(1, minimumRate + 0.05);

  if (!Number.isFinite(rate)) {
    return { backgroundColor: APP_COLORS.gray, color: "var(--app-text-strong)" };
  }
  if ((rate as number) > greenMin) {
    return { backgroundColor: APP_COLORS.greenDark, color: APP_COLORS.white };
  }
  if ((rate as number) >= yellowMin) {
    return { backgroundColor: APP_COLORS.yellow, color: "var(--app-text-strong)" };
  }
  return { backgroundColor: APP_COLORS.redDark, color: APP_COLORS.white };
}

function studentChance(student: StudentRow): number | string | null {
  return student.chance_to_graduate ?? student.chance_to_complete;
}

function studentDisplayName(student: StudentRow): string {
  const last = String(student.last_name ?? "").trim();
  const first = String(student.first_name ?? "").trim();
  if (last && first) {
    return `${last}, ${first}`;
  }
  if (last) {
    return last;
  }
  if (first) {
    return first;
  }
  return `SIS ${student.sis_user_id}`;
}

function ProgramExitStatusPageInner() {
  const searchParams = useSearchParams();
  const [whatIfDrops, setWhatIfDrops] = useState(0);
  const [minimumRate, setMinimumRate] = useState(0.5);
  const [isDraggingTarget, setIsDraggingTarget] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);

  const fetchRows = useCallback(
    async ({ searchParams, anonymize }: { searchParams: URLSearchParams | Readonly<URLSearchParams>; anonymize: boolean }) => {
      const params = new URLSearchParams({
        include_meta: "1",
        include_rows: "1",
        anonymize: anonymize ? "1" : "0",
      });

      const ay = searchParams.get("academic_year");
      const pc = searchParams.get("program_code");
      const cp = searchParams.get("campus_code");

      if (ay) {
        params.set("academic_year", ay);
      }
      if (pc) {
        params.set("program_code", pc);
      }
      if (cp) {
        params.set("campus_code", cp);
      }

      const res = await fetch(`/api/reports/yearly-graduates?${params.toString()}`);
      const json = (await res.json()) as ExitStatusResponse;

      if (!res.ok) {
        throw new Error(json.error || "Request failed");
      }

      const meta = json.meta;
      if (meta) {
        // Metadata is currently consumed by external filters UI.
      }

      return Array.isArray(json.data) ? json.data : [];
    },
    []
  );

  const { reportTitle, reportDescription, loading, error, rows } = useReportPageData<StudentRow>({
    route: "yearly-graduates",
    searchParams,
    initialTitle: "Loading...",
    initialDescription: null,
    initialRows: null,
    resetRowsBeforeFetch: null,
    rowsOnFetchError: null,
    fetchRows,
  });

  const finishedRows = useMemo(
    () => (rows ?? []).filter((r) => r.is_exited).slice().sort((a, b) => dateText(b.exit_date).localeCompare(dateText(a.exit_date))),
    [rows]
  );
  const exitedGreenRows = useMemo(() => finishedRows.filter((r) => r.is_graduate), [finishedRows]);
  const exitedGrayRows = useMemo(() => finishedRows.filter((r) => !r.is_graduate), [finishedRows]);
  const activeRows = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => !r.is_exited)
        .slice()
        .sort((a, b) => {
          const aTime = a.projected_exit_date ? new Date(a.projected_exit_date).getTime() : Number.POSITIVE_INFINITY;
          const bTime = b.projected_exit_date ? new Date(b.projected_exit_date).getTime() : Number.POSITIVE_INFINITY;
          if (aTime !== bTime) {
            return aTime - bTime;
          }
          return String(a.sis_user_id).localeCompare(String(b.sis_user_id));
        }),
    [rows]
  );

  const metrics = useMemo(() => {
    const graduates = finishedRows.filter((r) => r.is_graduate);
    const nonGraduates = finishedRows.filter((r) => !r.is_graduate);
    const candidates = activeRows
      .map((s) => {
        const chance = studentChance(s);
        return { student: s, chance: clampChance(chance), bucket: chanceBucket(chance) };
      })
      .filter((x) => x.bucket !== "none")
      .sort((a, b) => (b.chance ?? -1) - (a.chance ?? -1));
    const greenCandidates = candidates.filter((x) => x.bucket === "green");

    const baseE = finishedRows.length;
    const baseC = graduates.length;
    const currentRate = baseE > 0 ? baseC / baseE : null;

    const projectedDenom = baseE + greenCandidates.length + Math.max(0, whatIfDrops);
    const projectedNum = baseC + greenCandidates.length;
    const projectedRate = projectedDenom > 0 ? projectedNum / projectedDenom : null;

    const chosenForTarget: Array<{ student: StudentRow; bucket: Bucket }> = [];
    const baseDenom = baseE + Math.max(0, whatIfDrops);
    const baseRate = baseDenom > 0 ? baseC / baseDenom : null;

    if (!(baseRate !== null && baseRate >= minimumRate)) {
      let add = 0;
      for (const c of candidates) {
        chosenForTarget.push({ student: c.student, bucket: c.bucket });
        add += 1;
        const denom = baseE + add + Math.max(0, whatIfDrops);
        const num = baseC + add;
        if (denom > 0 && num / denom >= minimumRate) {
          break;
        }
      }
    }

    return {
      baseE,
      baseC,
      graduates,
      nonGraduates,
      candidates,
      greenCandidates,
      currentRate,
      projectedRate,
      chosenForTarget,
    };
  }, [activeRows, finishedRows, minimumRate, whatIfDrops]);

  const progressLinePercent = useMemo(() => {
    const clamped = Math.max(0, Math.min(100, minimumRate * 100));
    return `${clamped}%`;
  }, [minimumRate]);

  const barSegments = useMemo(() => {
    const segments: Array<{ key: string; color: string; opacity: number; title: string }> = [];

    for (const s of metrics.graduates) {
      segments.push({
        key: `grad-${s.sis_user_id}`,
        color: APP_COLORS.green,
        opacity: 0.35,
        title: `${s.sis_user_id}: Graduated`,
      });
    }

    for (const c of metrics.chosenForTarget) {
      const isHighChance = clampChance(studentChance(c.student)) !== null && (clampChance(studentChance(c.student)) as number) >= CHANCE_STANDARD;
      segments.push({
        key: `cand-${c.student.sis_user_id}`,
        color: barColorForChance(studentChance(c.student)),
        opacity: 1,
        title: `${c.student.sis_user_id}: ${isHighChance ? "90%+ likelihood" : "Below 90% likelihood"}`,
      });
    }

    for (const s of metrics.nonGraduates) {
      segments.push({
        key: `nongrad-${s.sis_user_id}`,
        color: APP_COLORS.gray,
        opacity: 1,
        title: `${s.sis_user_id}: Did not graduate`,
      });
    }

    for (let i = 0; i < whatIfDrops; i += 1) {
      segments.push({
        key: `drop-${i}`,
        color: APP_COLORS.darkGray,
        opacity: 1,
        title: "What-if non-graduate exiter",
      });
    }

    return segments;
  }, [metrics, whatIfDrops]);

  const activeStudentColumns = useMemo<ReportTableColumn<StudentRow>[]>(() => {
    return [
      {
        id: "name",
        header: "Name",
        columnType: "custom",
        sortValue: (row) => studentDisplayName(row),
        headerClassName: "w-72",
        cellClassName: "w-72",
        render: (row) => studentDisplayName(row),
      },
      {
        id: "sis_user_id",
        header: "SIS User",
        accessor: "sis_user_id",
        columnType: "text",
        headerClassName: "w-36",
        cellClassName: "w-36",
      },
      {
        id: "end_date",
        header: "End Date",
        columnType: "custom",
        sortValue: (row) => dateSortValue(row.projected_exit_date),
        headerClassName: "w-44",
        cellClassName: "w-44",
        render: (row) => {
          const text = dateText(row.projected_exit_date);
          return (
            <span
              className="inline-flex rounded-full border px-2 py-0.5 text-xs font-medium"
              style={endDatePillStyle({ lockedIn: false, chance: studentChance(row) })}
            >
              {text}
            </span>
          );
        },
      },
    ];
  }, []);

  const exitedGraduateColumns = useMemo<ReportTableColumn<StudentRow>[]>(() => {
    return [
      {
        id: "name",
        header: "Name",
        columnType: "custom",
        sortValue: (row) => studentDisplayName(row),
        headerClassName: "w-72",
        cellClassName: "w-72",
        render: (row) => studentDisplayName(row),
      },
      {
        id: "sis_user_id",
        header: "SIS User",
        accessor: "sis_user_id",
        columnType: "text",
        headerClassName: "w-36",
        cellClassName: "w-36",
      },
      {
        id: "end_date",
        header: "End Date",
        columnType: "custom",
        sortValue: (row) => dateSortValue(row.exit_date),
        headerClassName: "w-44",
        cellClassName: "w-44",
        render: (row) => {
          const text = dateText(row.exit_date);
          return (
            <span
              className="inline-flex rounded-full border px-2 py-0.5 text-xs font-medium"
              style={endDatePillStyle({ lockedIn: true, lockedOutcome: "success" })}
            >
              {text}
            </span>
          );
        },
      },
    ];
  }, []);

  const exitedNonGraduateColumns = useMemo<ReportTableColumn<StudentRow>[]>(() => {
    return [
      {
        id: "name",
        header: "Name",
        columnType: "custom",
        sortValue: (row) => studentDisplayName(row),
        headerClassName: "w-72",
        cellClassName: "w-72",
        render: (row) => studentDisplayName(row),
      },
      {
        id: "sis_user_id",
        header: "SIS User",
        accessor: "sis_user_id",
        columnType: "text",
        headerClassName: "w-36",
        cellClassName: "w-36",
      },
      {
        id: "end_date",
        header: "End Date",
        columnType: "custom",
        sortValue: (row) => dateSortValue(row.exit_date),
        headerClassName: "w-44",
        cellClassName: "w-44",
        render: (row) => {
          const text = dateText(row.exit_date);
          return (
            <span
              className="inline-flex rounded-full border px-2 py-0.5 text-xs font-medium"
              style={endDatePillStyle({ lockedIn: true, lockedOutcome: "failure" })}
            >
              {text}
            </span>
          );
        },
      },
    ];
  }, []);

  function setMinimumRateFromClientX(clientX: number) {
    const bar = barRef.current;
    if (!bar) {
      return;
    }

    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }

    const raw = (clientX - rect.left) / rect.width;
    const pct = Math.max(0, Math.min(100, Math.round(raw * 100)));
    setMinimumRate(pct / 100);
  }

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      if (!isDraggingTarget) {
        return;
      }
      setMinimumRateFromClientX(e.clientX);
    }

    function onPointerUp() {
      setIsDraggingTarget(false);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [isDraggingTarget]);

  useEffect(() => {
    if (!isDraggingTarget) {
      return;
    }

    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = "grabbing";

    return () => {
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [isDraggingTarget]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <ReportHeader title={reportTitle} description={reportDescription} />

      {error && <ReportErrorBanner className="mt-4" message={error} />}

      {rows && (
        <ReportContainer className="mt-5">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span>Current Graduation Rate:</span>
            <span
              className="rounded-full px-2 py-1 text-xs font-semibold"
              style={ratePillStyle(metrics.currentRate, minimumRate)}
            >
              {percentText(metrics.currentRate, 0)}
            </span>
            <span className="ml-2">Projected:</span>
            <span
              className="rounded-full px-2 py-1 text-xs font-semibold"
              style={ratePillStyle(metrics.projectedRate, minimumRate)}
            >
              {percentText(metrics.projectedRate, 1)}
            </span>
            <MetaChip className="ml-2">
              Minimum: {percentText(minimumRate, 0)}
            </MetaChip>
          </div>

          <div className="mb-6 grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
            <div className="relative pb-7">
              <div className="relative h-5">
                <div
                  ref={barRef}
                  className="h-5 select-none touch-none overflow-hidden rounded-full"
                  style={{ cursor: isDraggingTarget ? "grabbing" : "grab", backgroundColor: "var(--app-surface-muted)" }}
                  onPointerDown={(e) => {
                    setMinimumRateFromClientX(e.clientX);
                    setIsDraggingTarget(true);
                  }}
                >
                  <div className="absolute inset-0 flex">
                    {barSegments.map((segment) => (
                      <div
                        key={segment.key}
                        title={segment.title}
                        className="h-full border-r border-white/60"
                        style={{
                          flex: "1 1 0",
                          backgroundColor: segment.color,
                          opacity: segment.opacity,
                          cursor: isDraggingTarget ? "grabbing" : "grab",
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div
                  className="pointer-events-auto absolute top-0 z-30 h-5 w-[3px]"
                  style={{
                    cursor: isDraggingTarget ? "grabbing" : "grab",
                    left: progressLinePercent,
                    transform: "translateX(-50%)",
                    backgroundColor: "var(--app-text-strong)",
                  }}
                  title={`${Math.round(minimumRate * 100)}% requirement`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setIsDraggingTarget(true);
                  }}
                />
              </div>
              <span
                className="absolute z-20 h-3 w-3"
                style={{ left: progressLinePercent, height: "100%", top: "0rem", transform: "translateX(-50%)" }}
              />
              <span
                className="absolute top-8 z-10 select-none px-1 text-[10px] font-semibold"
                style={{ left: progressLinePercent, transform: "translateX(-50%)", backgroundColor: "var(--app-surface)", color: "var(--app-text-muted)" }}
              >
                {Math.round(minimumRate * 100)}%
              </span>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <span>What-if drop:</span>
              <button
                type="button"
                className="h-6 w-6 rounded border text-sm"
                style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }}
                onClick={() => setWhatIfDrops((n) => Math.max(0, n - 1))}
                disabled={whatIfDrops <= 0}
              >
                -
              </button>
              <b className="min-w-6 text-center">{whatIfDrops}</b>
              <button
                type="button"
                className="h-6 w-6 rounded border text-sm"
                style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)", color: "var(--app-text-strong)" }}
                onClick={() => setWhatIfDrops((n) => n + 1)}
              >
                +
              </button>
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold">Active students</h4>
            <MetaChip>Rows: {activeRows.length}</MetaChip>
          </div>
          <ReportTable
            rows={activeRows}
            columns={activeStudentColumns}
            defaultSort={{ columnId: "end_date", direction: "asc" }}
            rowKey={(row, index) => `${row.sis_user_id}-${index}`}
            emptyText="No active students found."
          />

          <div className="mb-2 mt-5 flex items-center justify-between">
            <h4 className="text-sm font-semibold">Exited students</h4>
            <MetaChip>Rows: {finishedRows.length}</MetaChip>
          </div>
          <div className="space-y-4">
            {exitedGreenRows.length > 0 && (
              <div>
                <div
                  className="border p-2 text-xs font-semibold"
                  style={{ backgroundColor: "var(--app-surface-muted)", borderColor: "var(--app-border)", color: "var(--app-text-muted)" }}
                >
                  Graduates
                </div>
                <ReportTable
                  rows={exitedGreenRows}
                  columns={exitedGraduateColumns}
                  defaultSort={{ columnId: "name", direction: "asc" }}
                  rowKey={(row, index) => `green-${row.sis_user_id}-${index}`}
                  rowClassName={() => "opacity-80"}
                />
              </div>
            )}

            {exitedGrayRows.length > 0 && (
              <div>
                <div
                  className="border p-2 text-xs font-semibold"
                  style={{ backgroundColor: "var(--app-surface-muted)", borderColor: "var(--app-border)", color: "var(--app-text-muted)" }}
                >
                  Non-graduate Exiters
                </div>
                <ReportTable
                  rows={exitedGrayRows}
                  columns={exitedNonGraduateColumns}
                  defaultSort={{ columnId: "name", direction: "asc" }}
                  rowKey={(row, index) => `gray-${row.sis_user_id}-${index}`}
                  rowClassName={() => "opacity-80"}
                />
              </div>
            )}

            {exitedGreenRows.length === 0 && exitedGrayRows.length === 0 && (
              <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>No exited students found.</div>
            )}
          </div>

          <div className="mt-3 text-xs" style={{ color: "var(--app-text-muted)" }}>
            Uses `is_exited`, `is_graduate`, `projected_exit_date`, and `chance_to_graduate ?? chance_to_complete` from server data.
          </div>
        </ReportContainer>
      )}
    </div>
  );
}

export default function ProgramExitStatusPage() {
  return (
    <ReportPageSuspense title="Yearly Graduates" maxWidthClassName="max-w-5xl">
      <ProgramExitStatusPageInner />
    </ReportPageSuspense>
  );
}
