"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ReportHeader } from "../_components/ReportHeader";
import { ReportTable, type ReportTableColumn } from "../_components/ReportTable";
import { ReportContainer } from "../_components/ReportContainer";
import { MetaChip } from "../_components/MetaChip";
import { ReportErrorBanner } from "../_components/ReportErrorBanner";
import { ReportPageSuspense } from "../_components/ReportPageSuspense";
import { Pill } from "../_components/Pill";
import { useReportPageData } from "../_hooks/useReportPageData";

type CourseReadinessRow = {
  canvas_course_id: number | string;
  course_code: string;
  course_name: string | null;
  program_code: string;
  program_name: string | null;
  academic_year: number | string;
  creation_source: string | null;
  course_type: string | null;
  course_status: string | null;
  syllabus_status: string | null;
  course_evaluation_status: string | null;
  instructor_evaluation_status: string | null;
  employment_skills_evaluation_status: string | null;
  canvas_content_status: string | null;
  total_group_weights: number | string | null;
};

type CourseReadinessResponse = {
  ok: boolean;
  count: number;
  data: CourseReadinessRow[];
  meta?: {
    years: string[];
    programs: Array<{ program_code: string; program_name: string }>;
    course_types?: string[];
    selected: {
      academic_year: string | null;
      program_code: string | null;
      course_type?: string | null;
    };
  };
  error?: string;
};

const EMPTY_ROWS: CourseReadinessRow[] = [];

function toLabel(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : "N/A";
}

function statusTone(value: string | null | undefined, readyState: "published" | "approved") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return "neutral" as const;
  }

  if (readyState === "published" && normalized === "published") {
    return "success" as const;
  }
  if (readyState === "approved" && normalized === "approved") {
    return "success" as const;
  }
  if (normalized === "pending approval") {
    return "warning" as const;
  }
  if (normalized === "n/a") {
    return "neutral" as const;
  }
  return "danger" as const;
}

function toWeight(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function CourseReadinessPageInner() {
  const searchParams = useSearchParams();

  const fetchRows = useCallback(
    async ({ searchParams, anonymize }: { searchParams: URLSearchParams | Readonly<URLSearchParams>; anonymize: boolean }) => {
      const params = new URLSearchParams({
        include_meta: "1",
        include_rows: "1",
        anonymize: anonymize ? "1" : "0",
      });

      const year = searchParams.get("academic_year");
      const program = searchParams.get("program_code");
      const courseType = searchParams.get("course_type");

      if (year) {
        params.set("academic_year", year);
      }
      if (program) {
        params.set("program_code", program);
      }
      if (courseType) {
        params.set("course_type", courseType);
      }

      const res = await fetch(`/api/reports/course-readiness?${params.toString()}`);
      const json = (await res.json()) as CourseReadinessResponse;

      if (!res.ok) {
        throw new Error(json.error || "Request failed");
      }

      return Array.isArray(json.data) ? json.data : [];
    },
    []
  );

  const { reportTitle, reportDescription, loading, error, rows } = useReportPageData<CourseReadinessRow>({
    route: "course-readiness",
    searchParams,
    initialTitle: "Canvas Course Readiness",
    initialDescription: null,
    initialRows: EMPTY_ROWS,
    rowsOnFetchError: EMPTY_ROWS,
    fetchRows,
  });

  const safeRows = rows ?? EMPTY_ROWS;

  const columns = useMemo<ReportTableColumn<CourseReadinessRow>[]>(() => {
    return [
      {
        id: "course_code",
        header: "Course Code",
        accessor: "course_code",
        columnType: "text",
      },
      {
        id: "course_name",
        header: "Name",
        accessor: "course_name",
        columnType: "text",
      },
      {
        id: "course_type",
        header: "Type",
        accessor: "course_type",
        columnType: "text",
      },
      {
        id: "course_status",
        header: "Course",
        accessor: "course_status",
        columnType: "pill",
        pill: {
          getLabel: (value) => toLabel(value as string | null),
          getTone: (value) => statusTone(value as string | null, "published"),
        },
      },
      {
        id: "syllabus_status",
        header: "Syllabus",
        accessor: "syllabus_status",
        columnType: "pill",
        pill: {
          getLabel: (value) => toLabel(value as string | null),
          getTone: (value) => statusTone(value as string | null, "approved"),
        },
      },
      {
        id: "course_evaluation_status",
        header: "Course Eval",
        accessor: "course_evaluation_status",
        columnType: "pill",
        pill: {
          getLabel: (value) => toLabel(value as string | null),
          getTone: (value) => statusTone(value as string | null, "published"),
        },
      },
      {
        id: "instructor_evaluation_status",
        header: "Instructor Eval",
        accessor: "instructor_evaluation_status",
        columnType: "pill",
        pill: {
          getLabel: (value) => toLabel(value as string | null),
          getTone: (value) => statusTone(value as string | null, "published"),
        },
      },
      {
        id: "employment_skills_evaluation_status",
        header: "Employment Skills Eval",
        accessor: "employment_skills_evaluation_status",
        columnType: "pill",
        pill: {
          getLabel: (value) => toLabel(value as string | null),
          getTone: (value) => statusTone(value as string | null, "published"),
        },
      },
      {
        id: "canvas_content_status",
        header: "Canvas Content",
        accessor: "canvas_content_status",
        columnType: "pill",
        pill: {
          getLabel: (value) => toLabel(value as string | null),
          getTone: (value) => statusTone(value as string | null, "published"),
        },
      },
      {
        id: "total_group_weights",
        header: "Group Weights",
        columnType: "custom",
        sortValue: (row) => toWeight(row.total_group_weights),
        render: (row) => {
          const weights = toWeight(row.total_group_weights);
          if (weights === null) {
            return <Pill label="N/A" tone="danger" />;
          }
          const isReady = Math.abs(weights - 100) <= 0.01;
          return <Pill label={`${weights.toFixed(0)}%`} tone={isReady ? "success" : "danger"} />;
        },
      },
    ];
  }, []);

  return (
    <div className="mx-auto w-full max-w-7xl">
      <ReportHeader title={reportTitle} description={reportDescription} />

      {error && <ReportErrorBanner className="mt-4" message={error} />}

      <ReportContainer className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Canvas Course Readiness</h2>
          <MetaChip>Rows: {safeRows.length}</MetaChip>
        </div>

        {loading && <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>Loading...</div>}

        {!loading && safeRows.length === 0 && (
          <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
            No course readiness rows found for the selected filters.
          </div>
        )}

        {safeRows.length > 0 && (
          <ReportTable
            rows={safeRows}
            columns={columns}
            defaultSort={{ columnId: "course_code", direction: "asc" }}
            rowKey={(row, index) => `${row.canvas_course_id}-${row.academic_year}-${index}`}
          />
        )}
      </ReportContainer>
    </div>
  );
}

export default function CourseReadinessPage() {
  return (
    <ReportPageSuspense title="Canvas Course Readiness" maxWidthClassName="max-w-7xl">
      <CourseReadinessPageInner />
    </ReportPageSuspense>
  );
}
