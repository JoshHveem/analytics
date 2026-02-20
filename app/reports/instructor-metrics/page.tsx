"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ReportHeader } from "../_components/ReportHeader";
import { ReportTable, type ReportTableColumn } from "../_components/ReportTable";
import { ReportContainer } from "../_components/ReportContainer";
import { MetaChip } from "../_components/MetaChip";
import { ReportErrorBanner } from "../_components/ReportErrorBanner";
import { APP_COLORS, withAlpha } from "@/lib/color-palette";

type InstructorMetricRow = {
  sis_user_id: string;
  first_name: string | null;
  last_name: string | null;
  academic_year: number | string;
  department_code: string;
  department_name: string | null;
  assignments_graded: number | string | null;
  average_score: number | string | null;
  average_attempts: number | string | null;
  comments_per_submission_graded: number | string | null;
  days_to_grade: number | string | null;
  perc_graded_with_rubric: number | string | null;
  num_replies_to_students: number | string | null;
  days_to_reply: number | string | null;
  teacher_support_hours: number | string | null;
};

type DepartmentOption = {
  department_code: string;
  department_name: string;
};

type InstructorMetricsResponse = {
  ok: boolean;
  count: number;
  data: InstructorMetricRow[];
  meta?: {
    years: string[];
    departments: DepartmentOption[];
    selected: {
      academic_year: string | null;
      department_code: string | null;
    };
  };
  error?: string;
};

type ReportConfigResponse = {
  ok: boolean;
  config?: {
    title: string;
    description: string | null;
  };
  error?: string;
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmtNumber(value: number | null, fractionDigits = 2): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: fractionDigits });
}

function fmtPercent(value: number | null): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function getAnonymizeEnabled(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.documentElement.getAttribute("data-anonymize") === "1";
}

const RUBRIC_STANDARD = 0.9;
const DAYS_TO_REPLY_STANDARD = 2;

function instructorDisplayName(row: InstructorMetricRow): string {
  const last = String(row.last_name ?? "").trim();
  const first = String(row.first_name ?? "").trim();
  if (last && first) {
    return `${last}, ${first}`;
  }
  if (last) {
    return last;
  }
  if (first) {
    return first;
  }
  return `SIS ${row.sis_user_id}`;
}

export default function InstructorMetricsPage() {
  const searchParams = useSearchParams();
  const [reportTitle, setReportTitle] = useState("Instructor Metrics");
  const [reportDescription, setReportDescription] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<InstructorMetricRow[]>([]);

  useEffect(() => {
    void fetchReportConfig();
  }, []);

  useEffect(() => {
    void fetchReport();
  }, [searchParams]);

  async function fetchReportConfig() {
    try {
      const res = await fetch("/api/reports/config?route=instructor-metrics");
      const json = (await res.json()) as ReportConfigResponse;
      if (!res.ok) {
        throw new Error(json.error || "Request failed");
      }
      if (json.config) {
        setReportTitle(String(json.config.title ?? reportTitle));
        setReportDescription(json.config.description ?? null);
      }
    } catch {
      // Keep static fallback title/description on metadata load failures.
    }
  }

  async function fetchReport() {
    setError(null);
    setLoading(true);

    try {
      const params = new URLSearchParams({
        include_meta: "1",
        include_rows: "1",
        anonymize: getAnonymizeEnabled() ? "1" : "0",
      });
      const year = searchParams.get("academic_year");
      const department = searchParams.get("department_code");
      if (year) {
        params.set("academic_year", year);
      }
      if (department) {
        params.set("department_code", department);
      }

      const res = await fetch(`/api/reports/instructor-metrics?${params.toString()}`);
      const json = (await res.json()) as InstructorMetricsResponse;
      if (!res.ok) {
        throw new Error(json.error || "Request failed");
      }

      setRows(Array.isArray(json.data) ? json.data : []);
    } catch (e: unknown) {
      setRows([]);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const summary = useMemo(() => {
    const instructorIds = new Set(rows.map((row) => String(row.sis_user_id)));
    const totalAssignments = rows.reduce((sum, row) => sum + (toNumber(row.assignments_graded) ?? 0), 0);

    const avgScoreValues = rows.map((row) => toNumber(row.average_score)).filter((v): v is number => v !== null);
    const avgScore =
      avgScoreValues.length > 0
        ? avgScoreValues.reduce((sum, value) => sum + value, 0) / avgScoreValues.length
        : null;

    const avgDaysToGradeValues = rows
      .map((row) => toNumber(row.days_to_grade))
      .filter((v): v is number => v !== null);
    const avgDaysToGrade =
      avgDaysToGradeValues.length > 0
        ? avgDaysToGradeValues.reduce((sum, value) => sum + value, 0) / avgDaysToGradeValues.length
        : null;

    return {
      instructors: instructorIds.size,
      totalAssignments,
      avgScore,
      avgDaysToGrade,
    };
  }, [rows]);

  const supportHoursByDepartment = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of rows) {
      const key = String(row.department_code ?? "");
      const value = toNumber(row.teacher_support_hours) ?? 0;
      totals.set(key, (totals.get(key) ?? 0) + value);
    }
    return totals;
  }, [rows]);

  const columns = useMemo<ReportTableColumn<InstructorMetricRow>[]>(() => {
    return [
      {
        id: "instructor",
        header: "Instructor",
        columnType: "custom",
        sortValue: (row) => instructorDisplayName(row),
        render: (row) => instructorDisplayName(row),
      },
      // {
      //   id: "assignments_graded",
      //   header: "Assignments",
      //   accessor: "assignments_graded",
      //   columnType: "number",
      //   fractionDigits: 0,
      // },
      {
        id: "average_score",
        header: "Avg Score",
        accessor: "average_score",
        columnType: "percent",
        fractionDigits: 1,
      },
      {
        id: "average_attempts",
        header: "Avg Attempts",
        accessor: "average_attempts",
        columnType: "number",
        fractionDigits: 2,
      },
      {
        id: "comments_per_submission_graded",
        header: "Comments / Submission",
        accessor: "comments_per_submission_graded",
        columnType: "number",
        fractionDigits: 3,
      },
      {
        id: "days_to_grade",
        header: "Days to Grade",
        accessor: "days_to_grade",
        columnType: "number",
        fractionDigits: 2,
      },
      {
        id: "perc_graded_with_rubric",
        header: "% Rubric",
        accessor: "perc_graded_with_rubric",
        columnType: "threshold",
        threshold: {
          cutoff: RUBRIC_STANDARD,
          comparison: "gte",
          format: "percent",
          fractionDigits: 1,
        },
      },
      {
        id: "num_replies_to_students",
        header: "Replies",
        accessor: "num_replies_to_students",
        columnType: "number",
        fractionDigits: 0,
      },
      {
        id: "days_to_reply",
        header: "Days to Reply",
        accessor: "days_to_reply",
        columnType: "threshold",
        threshold: {
          cutoff: DAYS_TO_REPLY_STANDARD,
          comparison: "lte",
          format: "number",
          fractionDigits: 2,
        },
      },
      {
        id: "support_hour_share",
        header: "Grading Share",
        columnType: "custom",
        sortValue: (row) => {
          const hours = toNumber(row.teacher_support_hours) ?? 0;
          const deptTotal = supportHoursByDepartment.get(String(row.department_code ?? "")) ?? 0;
          return deptTotal > 0 ? hours / deptTotal : null;
        },
        render: (row) => {
          const hours = toNumber(row.teacher_support_hours) ?? 0;
          const deptTotal = supportHoursByDepartment.get(String(row.department_code ?? "")) ?? 0;
          const share = deptTotal > 0 ? hours / deptTotal : null;
          const sharePercent = share === null ? 0 : Math.max(0, Math.min(100, share * 100));
          const shareText = share === null ? "No data" : `${sharePercent.toFixed(1)}%`;

          return (
            <div className="min-w-40" title={`Grading share: ${shareText}`}>
              <div
                className="h-2 overflow-hidden rounded-full"
                style={{ backgroundColor: withAlpha(APP_COLORS.lightGray, 0.8) }}
                role="img"
                aria-label={`Grading share: ${shareText}`}
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${sharePercent}%`, backgroundColor: APP_COLORS.darkGray }}
                />
              </div>
            </div>
          );
        },
      },
    ];
  }, [supportHoursByDepartment]);

  useEffect(() => {
    function onAnonymizeChange() {
      void fetchReport();
    }

    window.addEventListener("analytics:anonymize-change", onAnonymizeChange);
    return () => {
      window.removeEventListener("analytics:anonymize-change", onAnonymizeChange);
    };
  }, [searchParams]);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <ReportHeader title={reportTitle} description={reportDescription} />

      {error && <ReportErrorBanner className="mt-4" message={error} />}

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ReportContainer>
          <div className="text-xs" style={{ color: "var(--app-text-muted)" }}>
            Instructors
          </div>
          <div className="mt-1 text-2xl font-semibold">{fmtNumber(summary.instructors, 0)}</div>
        </ReportContainer>
        <ReportContainer>
          <div className="text-xs" style={{ color: "var(--app-text-muted)" }}>
            Assignments Graded
          </div>
          <div className="mt-1 text-2xl font-semibold">{fmtNumber(summary.totalAssignments, 0)}</div>
        </ReportContainer>
        <ReportContainer>
          <div className="text-xs" style={{ color: "var(--app-text-muted)" }}>
            Average Score
          </div>
          <div className="mt-1 text-2xl font-semibold">{fmtPercent(summary.avgScore)}</div>
        </ReportContainer>
        <ReportContainer>
          <div className="text-xs" style={{ color: "var(--app-text-muted)" }}>
            Days to Grade
          </div>
          <div className="mt-1 text-2xl font-semibold">{fmtNumber(summary.avgDaysToGrade, 2)}</div>
        </ReportContainer>
      </div>

      <ReportContainer className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Instructor Metrics</h2>
          <MetaChip>Rows: {rows.length}</MetaChip>
        </div>

        {loading && <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>Loading...</div>}

        {!loading && rows.length === 0 && (
          <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
            No data found for the selected filters.
          </div>
        )}

        {rows.length > 0 && (
          <ReportTable
            rows={rows}
            columns={columns}
            defaultSort={{ columnId: "instructor", direction: "asc" }}
            rowKey={(row, index) =>
              `${row.sis_user_id}-${row.academic_year}-${row.department_code}-${index}`
            }
          />
        )}
      </ReportContainer>
    </div>
  );
}
