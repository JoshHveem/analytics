"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type StudentRow = {
  sis_user_id: string;
  first_name?: string | null;
  last_name?: string | null;
  program_code: string;
  program_name?: string | null;
  campus: string;
  academic_year: number;
  exit_date: string | null;
  days_remaining: number | null;
  credits_remaining: number | null;
  projected_exit_date: string | null;
  is_exited: boolean;
  is_graduate: boolean;
  is_completer: boolean;
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
      campus: string | null;
    };
  };
  error?: string;
};

type Bucket = "green" | "yellow" | "orange" | "red" | "none";

const COLORS = {
  green: "#16a34a",
  yellow: "#eab308",
  orange: "#f97316",
  red: "#dc2626",
  gray: "#a3a3a3",
  darkGray: "#525252",
  black: "#0a0a0a",
  white: "#ffffff",
};

const BUCKET_THRESHOLDS = {
  green: 0.75,
  yellow: 0.55,
  orange: 0.35,
};

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

function bucketLabel(bucket: Bucket): string {
  if (bucket === "green") {
    return "Likely graduate this year";
  }
  if (bucket === "yellow") {
    return "Possible graduate this year";
  }
  if (bucket === "orange") {
    return "Unlikely this year";
  }
  if (bucket === "red") {
    return "Very unlikely this year";
  }
  return "No likelihood score";
}

function bucketColor(bucket: Bucket): string {
  if (bucket === "green") {
    return COLORS.green;
  }
  if (bucket === "yellow") {
    return COLORS.yellow;
  }
  if (bucket === "orange") {
    return COLORS.orange;
  }
  if (bucket === "red") {
    return COLORS.red;
  }
  return COLORS.gray;
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

function ratePillClasses(rate: number | null, minimumRate: number): string {
  const yellowMin = minimumRate;
  const greenMin = Math.min(1, minimumRate + 0.05);

  if (!Number.isFinite(rate)) {
    return "bg-zinc-300 text-zinc-900";
  }
  if ((rate as number) > greenMin) {
    return "bg-green-600 text-white";
  }
  if ((rate as number) >= yellowMin) {
    return "bg-yellow-400 text-zinc-900";
  }
  return "bg-red-600 text-white";
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

export default function ProgramExitStatusPage() {
  const [programCode, setProgramCode] = useState("");
  const [campus, setCampus] = useState("");
  const [academicYear, setAcademicYear] = useState("");
  const [years, setYears] = useState<string[]>([]);
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [campuses, setCampuses] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<StudentRow[] | null>(null);
  const [whatIfDrops, setWhatIfDrops] = useState(0);
  const [minimumRate, setMinimumRate] = useState(0.6);
  const isBusy = loading || loadingMeta;
  const [isDraggingTarget, setIsDraggingTarget] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);

  async function fetchPayload(options: {
    includeRows: boolean;
    nextAcademicYear?: string;
    nextProgramCode?: string;
    nextCampus?: string;
  }) {
    const ay = options.nextAcademicYear ?? academicYear;
    const pc = options.nextProgramCode ?? programCode;
    const cp = options.nextCampus ?? campus;

    const params = new URLSearchParams({
      include_meta: "1",
      include_rows: options.includeRows ? "1" : "0",
    });

    if (ay) {
      params.set("academic_year", ay);
    }
    if (pc) {
      params.set("program_code", pc);
    }
    if (cp) {
      params.set("campus", cp);
    }

    const res = await fetch(`/api/reports/yearly-completers?${params.toString()}`);
    const json = (await res.json()) as ExitStatusResponse;

    if (!res.ok) {
      throw new Error(json.error || "Request failed");
    }

    const meta = json.meta;
    if (meta) {
      setYears(meta.years ?? []);
      setPrograms(meta.programs ?? []);
      setCampuses(meta.campuses ?? []);
      setAcademicYear(meta.selected.academic_year ?? "");
      setProgramCode(meta.selected.program_code ?? "");
      setCampus(meta.selected.campus ?? "");
    }

    if (options.includeRows) {
      setRows(Array.isArray(json.data) ? json.data : []);
    }
  }

  useEffect(() => {
    void fetchReport();
  }, []);

  async function fetchReport(options?: {
    nextAcademicYear?: string;
    nextProgramCode?: string;
    nextCampus?: string;
  }) {
    setError(null);
    setLoading(true);
    setLoadingMeta(true);
    setRows(null);
    try {
      await fetchPayload({
        includeRows: true,
        nextAcademicYear: options?.nextAcademicYear,
        nextProgramCode: options?.nextProgramCode,
        nextCampus: options?.nextCampus,
      });
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoadingMeta(false);
      setLoading(false);
    }
  }

  const finishedRows = useMemo(
    () => (rows ?? []).filter((r) => r.is_exited).slice().sort((a, b) => dateText(b.exit_date).localeCompare(dateText(a.exit_date))),
    [rows]
  );
  const exitedGreenRows = useMemo(() => finishedRows.filter((r) => r.is_completer), [finishedRows]);
  const exitedGrayRows = useMemo(() => finishedRows.filter((r) => !r.is_completer), [finishedRows]);
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
    const completers = finishedRows.filter((r) => r.is_completer);
    const nonCompleters = finishedRows.filter((r) => !r.is_completer);
    const candidates = activeRows
      .map((s) => {
        const chance = studentChance(s);
        return { student: s, chance: clampChance(chance), bucket: chanceBucket(chance) };
      })
      .filter((x) => x.bucket !== "none")
      .sort((a, b) => (b.chance ?? -1) - (a.chance ?? -1));
    const greenCandidates = candidates.filter((x) => x.bucket === "green");

    const baseE = finishedRows.length;
    const baseC = completers.length;
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
      completers,
      nonCompleters,
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

    for (const s of metrics.completers) {
      segments.push({
        key: `completer-${s.sis_user_id}`,
        color: bucketColor("green"),
        opacity: 0.35,
        title: `${s.sis_user_id}: Completed`,
      });
    }

    for (const c of metrics.chosenForTarget) {
      segments.push({
        key: `cand-${c.student.sis_user_id}`,
        color: bucketColor(c.bucket),
        opacity: 1,
        title: `${c.student.sis_user_id}: ${bucketLabel(c.bucket)}`,
      });
    }

    for (const s of metrics.nonCompleters) {
      segments.push({
        key: `noncompleter-${s.sis_user_id}`,
        color: COLORS.gray,
        opacity: 1,
        title: `${s.sis_user_id}: Did not complete`,
      });
    }

    for (let i = 0; i < whatIfDrops; i += 1) {
      segments.push({
        key: `drop-${i}`,
        color: COLORS.darkGray,
        opacity: 1,
        title: "What-if non-graduate exiter",
      });
    }

    return segments;
  }, [metrics, whatIfDrops]);

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
      <h1 className="text-2xl font-bold">Program Yearly Completers Report</h1>

      <div className={`mt-4 flex flex-wrap gap-3 transition-opacity ${isBusy ? "opacity-60" : "opacity-100"}`}>
        <label className="flex flex-col text-sm">
          Program
          {programs.length > 0 ? (
            <select
              value={programCode}
              onChange={(e) => {
                const nextProgram = e.target.value;
                setProgramCode(nextProgram);
                setRows(null);
                setWhatIfDrops(0);
                void fetchReport({
                  nextAcademicYear: academicYear,
                  nextProgramCode: nextProgram,
                  nextCampus: "",
                });
              }}
              className="mt-1 rounded border px-2 py-1"
              disabled={isBusy}
            >
              {programs.map((p) => (
                <option key={p.program_code} value={p.program_code}>
                  {p.program_name}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={programCode}
              onChange={(e) => setProgramCode(e.target.value)}
              className="mt-1 rounded border px-2 py-1"
              disabled={isBusy}
            />
          )}
        </label>

        <label className="flex flex-col text-sm">
          Campus
          {campuses.length > 0 ? (
            <select
              value={campus}
              onChange={(e) => {
                const nextCampus = e.target.value;
                setCampus(nextCampus);
                setRows(null);
                setWhatIfDrops(0);
                void fetchReport({
                  nextAcademicYear: academicYear,
                  nextProgramCode: programCode,
                  nextCampus,
                });
              }}
              className="mt-1 rounded border px-2 py-1"
              disabled={isBusy}
            >
              {campuses.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={campus}
              onChange={(e) => setCampus(e.target.value)}
              className="mt-1 rounded border px-2 py-1"
              disabled={isBusy}
            />
          )}
        </label>

        <label className="flex flex-col text-sm">
          Academic year
          {years.length > 0 ? (
            <select
              value={academicYear}
              onChange={(e) => {
                const nextYear = e.target.value;
                setAcademicYear(nextYear);
                setRows(null);
                setWhatIfDrops(0);
                void fetchReport({
                  nextAcademicYear: nextYear,
                  nextProgramCode: programCode,
                  nextCampus: "",
                });
              }}
              className="mt-1 rounded border px-2 py-1"
              disabled={isBusy}
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              className="mt-1 rounded border px-2 py-1"
              disabled={isBusy}
            />
          )}
        </label>

      </div>

      {error && <div className="mt-4 text-red-600">Error: {error}</div>}

      {rows && (
        <div className="mt-5 rounded-lg border border-zinc-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span>Current Completion Rate:</span>
            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${ratePillClasses(metrics.currentRate, minimumRate)}`}>
              {percentText(metrics.currentRate, 0)}
            </span>
            <span className="ml-2">Projected:</span>
            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${ratePillClasses(metrics.projectedRate, minimumRate)}`}>
              {percentText(metrics.projectedRate, 1)}
            </span>
            <span className="ml-2 rounded-full bg-zinc-100 px-2 py-1 text-xs">
              Minimum: {percentText(minimumRate, 0)}
            </span>
          </div>

          <div className="mb-6 grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
            <div className="relative pb-7">
              <div className="relative h-5">
                <div
                  ref={barRef}
                  className="h-5 select-none touch-none overflow-hidden rounded-full bg-zinc-100"
                  style={{ cursor: isDraggingTarget ? "grabbing" : "grab" }}
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
                  className="pointer-events-auto absolute top-0 z-30 h-5 w-[3px] bg-zinc-900"
                  style={{ cursor: isDraggingTarget ? "grabbing" : "grab", left: progressLinePercent, transform: "translateX(-50%)" }}
                  title={`${Math.round(minimumRate * 100)}% requirement`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setIsDraggingTarget(true);
                  }}
                />
              </div>
              <span
                className="absolute z-20 h-3 w-3 rounded-full border border-zinc-700 bg-white shadow-sm"
                style={{ left: progressLinePercent, height: "100%", top: "0rem", transform: "translateX(-50%)" }}
              />
              <span
                className="absolute top-8 z-10 select-none bg-white px-1 text-[10px] font-semibold text-zinc-700"
                style={{ left: progressLinePercent, transform: "translateX(-50%)" }}
              >
                {Math.round(minimumRate * 100)}%
              </span>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <span>What-if drop:</span>
              <button
                type="button"
                className="h-6 w-6 rounded border border-zinc-300 bg-white text-sm"
                onClick={() => setWhatIfDrops((n) => Math.max(0, n - 1))}
                disabled={whatIfDrops <= 0}
              >
                -
              </button>
              <b className="min-w-6 text-center">{whatIfDrops}</b>
              <button
                type="button"
                className="h-6 w-6 rounded border border-zinc-300 bg-white text-sm"
                onClick={() => setWhatIfDrops((n) => n + 1)}
              >
                +
              </button>
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold">Active students</h4>
            <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs">Rows: {activeRows.length}</span>
          </div>
          <div className="overflow-auto">
            <table className="w-full table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-16" />
                <col className="w-64" />
                <col className="w-32" />
                <col className="w-36" />
              </colgroup>
              <thead>
                <tr className="text-left">
                  <th className="border-b p-2">Status</th>
                  <th className="border-b p-2">Name</th>
                  <th className="border-b p-2">SIS User</th>
                  <th className="border-b p-2">End Date</th>
                </tr>
              </thead>
              <tbody>
                {activeRows.map((r, i) => {
                  const chance = studentChance(r);
                  const bucket = chanceBucket(chance);
                  return (
                    <tr key={`${r.sis_user_id}-${i}`} className="odd:bg-zinc-50">
                      <td className="p-2">
                        <span
                          title={bucketLabel(bucket)}
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: bucketColor(bucket) }}
                        />
                      </td>
                      <td className="p-2">{studentDisplayName(r)}</td>
                      <td className="p-2">{r.sis_user_id}</td>
                      <td className="p-2">{dateText(r.projected_exit_date)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mb-2 mt-5 flex items-center justify-between">
            <h4 className="text-sm font-semibold">Exited students</h4>
            <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs">Rows: {finishedRows.length}</span>
          </div>
          <div className="overflow-auto">
            <table className="w-full table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-16" />
                <col className="w-64" />
                <col className="w-32" />
                <col className="w-36" />
              </colgroup>
              <thead>
                <tr className="text-left">
                  <th className="border-b p-2">Status</th>
                  <th className="border-b p-2">Name</th>
                  <th className="border-b p-2">SIS User</th>
                  <th className="border-b p-2">End Date</th>
                </tr>
              </thead>
              <tbody>
                {exitedGreenRows.length > 0 && (
                  <tr>
                    <td className="bg-zinc-100 p-2 text-xs font-semibold text-zinc-700" colSpan={4}>
                      Completers 
                    </td>
                  </tr>
                )}
                {exitedGreenRows.map((r, i) => (
                  <tr key={`green-${r.sis_user_id}-${i}`} className="odd:bg-zinc-50 opacity-80">
                    <td className="p-2">
                      <span
                        title="Completer"
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: bucketColor("green") }}
                      />
                    </td>
                    <td className="p-2">{studentDisplayName(r)}</td>
                    <td className="p-2">{r.sis_user_id}</td>
                    <td className="p-2">{dateText(r.exit_date)}</td>
                  </tr>
                ))}
                {exitedGrayRows.length > 0 && (
                  <tr>
                    <td className="bg-zinc-100 p-2 text-xs font-semibold text-zinc-700" colSpan={4}>
                      Non-completer Exiters 
                    </td>
                  </tr>
                )}
                {exitedGrayRows.map((r, i) => (
                  <tr key={`gray-${r.sis_user_id}-${i}`} className="odd:bg-zinc-50 opacity-80">
                    <td className="p-2">
                      <span
                        title="Non-completer exiter"
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: COLORS.gray }}
                      />
                    </td>
                    <td className="p-2">{studentDisplayName(r)}</td>
                    <td className="p-2">{r.sis_user_id}</td>
                    <td className="p-2">{dateText(r.exit_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-zinc-500">
            Uses `is_exited`, `is_completer`, `projected_exit_date`, and `chance_to_graduate ?? chance_to_complete` from server data.
          </div>
        </div>
      )}
    </div>
  );
}
