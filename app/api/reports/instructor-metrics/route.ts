import { NextResponse } from "next/server";
import { type Queryable } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { withSecureReport } from "@/lib/secure-report";

type DepartmentOption = {
  department_code: string;
  department_name: string;
};

function parseBool(value: string | null): boolean {
  return value === "1" || value === "true";
}

async function getYears(db: Queryable) {
  const { rows } = await db.query(
    `
    SELECT DISTINCT academic_year
    FROM public.instructor_metrics
    ORDER BY academic_year DESC
    `
  );
  return rows.map((row: { academic_year: string | number }) => String(row.academic_year));
}

async function getDepartments(db: Queryable, academicYear: string | null) {
  const params: string[] = [];
  const clauses: string[] = [];

  if (academicYear) {
    params.push(academicYear);
    clauses.push(`im.academic_year = $${params.length}`);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await db.query(
    `
    SELECT DISTINCT
      d.department_code,
      d.department_name
    FROM public.departments d
    INNER JOIN public.instructor_metrics im
      ON im.department_code = d.department_code
    ${whereClause}
    ORDER BY d.department_name, d.department_code
    `,
    params
  );

  return rows.map((row: { department_code: string | null; department_name: string | null }) => {
    const code = String(row.department_code ?? "").trim();
    return {
      department_code: code,
      department_name: String(row.department_name ?? code),
    };
  }) as DepartmentOption[];
}

async function getRows(
  db: Queryable,
  academicYear: string | null,
  departmentCode: string | null
) {
  const params: string[] = [];
  const clauses: string[] = [];

  if (academicYear) {
    params.push(academicYear);
    clauses.push(`im.academic_year = $${params.length}`);
  }
  if (departmentCode) {
    params.push(departmentCode);
    clauses.push(`im.department_code = $${params.length}`);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await db.query(
    `
    SELECT
      im.sis_user_id,
      u.first_name,
      u.last_name,
      im.academic_year,
      im.department_code,
      COALESCE(d.department_name, im.department_code) AS department_name,
      im.assignments_graded,
      im.average_score,
      im.average_attempts,
      im.comments_per_submission_graded,
      im.days_to_grade,
      im.perc_graded_with_rubric,
      im.num_replies_to_students,
      im.days_to_reply,
      im.teacher_support_hours
    FROM public.instructor_metrics im
    LEFT JOIN public.users u
      ON u.sis_user_id = im.sis_user_id
    LEFT JOIN public.departments d
      ON d.department_code = im.department_code
    ${whereClause}
    ORDER BY im.academic_year DESC, im.department_code, u.last_name NULLS LAST, u.first_name NULLS LAST, im.sis_user_id
    `,
    params
  );

  return rows;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedAcademicYear = String(url.searchParams.get("academic_year") ?? "").trim() || null;
    const requestedDepartmentCode = String(url.searchParams.get("department_code") ?? "").trim() || null;
    const includeMeta = parseBool(url.searchParams.get("include_meta"));
    const includeRows = parseBool(url.searchParams.get("include_rows"));
    const payload = await withSecureReport(
      request,
      "instructor-metrics",
      async ({ db, anonymizeRows, meta }) => {

      if (includeMeta) {
        const years = await getYears(db);
        const selectedAcademicYear =
          requestedAcademicYear && years.includes(requestedAcademicYear)
            ? requestedAcademicYear
            : (years[0] ?? null);

        const departments = await getDepartments(db, selectedAcademicYear);
        const selectedDepartmentCode =
          requestedDepartmentCode &&
          departments.some((department) => department.department_code === requestedDepartmentCode)
            ? requestedDepartmentCode
            : (departments[0]?.department_code ?? null);

        let rows: any[] = [];
        if (includeRows) {
          const rawRows = await getRows(db, selectedAcademicYear, selectedDepartmentCode);
          rows = anonymizeRows(rawRows as Record<string, unknown>[]);
        }

        return {
          ok: true,
          count: rows.length,
          data: rows,
          meta: {
            years,
            programs: [],
            campuses: [],
            departments,
            ...meta,
            selected: {
              academic_year: selectedAcademicYear,
              program_code: null,
              campus: null,
              department_code: selectedDepartmentCode,
            },
          },
        };
      }

      const rawRows = await getRows(db, requestedAcademicYear, requestedDepartmentCode);
      const rows = anonymizeRows(rawRows as Record<string, unknown>[]);
      return { ok: true, count: rows.length, data: rows };
      }
    );

    return NextResponse.json(payload);
  } catch (e: unknown) {
    if (e instanceof HttpError) {
      return NextResponse.json(e.payload, { status: e.status });
    }
    console.error("Instructor metrics report error:", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
