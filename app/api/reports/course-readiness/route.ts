import { NextResponse } from "next/server";
import { type Queryable } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { withSecureReport } from "@/lib/secure-report";

type ProgramOption = {
  program_code: string;
  program_name: string;
};

function parseBool(value: string | null): boolean {
  return value === "1" || value === "true";
}

function cleanFilter(value: string | null): string | null {
  const cleaned = String(value ?? "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

async function getYears(db: Queryable): Promise<string[]> {
  const { rows } = await db.query(
    `
    SELECT DISTINCT academic_year
    FROM public.canvas_course_readiness
    ORDER BY academic_year DESC
    `
  );

  return rows.map((row: { academic_year: string | number }) => String(row.academic_year));
}

async function getPrograms(db: Queryable, academicYear: string | null): Promise<ProgramOption[]> {
  const params: string[] = [];
  const clauses: string[] = [];

  if (academicYear) {
    params.push(academicYear);
    clauses.push(`ccr.academic_year = $${params.length}`);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const { rows } = await db.query(
    `
    SELECT DISTINCT
      ccr.program_code,
      p.program_name
    FROM public.canvas_course_readiness ccr
    INNER JOIN public.programs p
      ON p.program_code = ccr.program_code
     AND p.academic_year = ccr.academic_year
    ${whereClause}
    ORDER BY program_name, ccr.program_code
    `,
    params
  );

  return rows.map((row: { program_code: string | null; program_name: string | null }) => {
    const code = String(row.program_code ?? "").trim();
    return {
      program_code: code,
      program_name: String(row.program_name ?? code),
    };
  });
}

async function getCourseTypes(
  db: Queryable,
  academicYear: string | null,
  programCode: string | null
): Promise<string[]> {
  const params: string[] = [];
  const clauses: string[] = [];

  if (academicYear) {
    params.push(academicYear);
    clauses.push(`ccr.academic_year = $${params.length}`);
  }
  if (programCode) {
    params.push(programCode);
    clauses.push(`ccr.program_code = $${params.length}`);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await db.query(
    `
    SELECT DISTINCT ccr.course_type
    FROM public.canvas_course_readiness ccr
    ${whereClause}
    ORDER BY ccr.course_type
    `,
    params
  );

  return rows
    .map((row: { course_type: string | null }) => String(row.course_type ?? "").trim())
    .filter((value) => value.length > 0);
}

async function resolveCourseNameExpression(db: Queryable): Promise<string> {
  const { rows } = await db.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'courses'
      AND column_name IN ('course_name', 'course_title', 'name')
    `
  );

  const available = new Set(rows.map((row: { column_name: string }) => String(row.column_name)));

  if (available.has("course_name")) {
    return "c.course_name";
  }
  if (available.has("course_title")) {
    return "c.course_title";
  }
  if (available.has("name")) {
    return "c.name";
  }

  return "NULL::text";
}

async function getRows(
  db: Queryable,
  academicYear: string | null,
  programCode: string | null,
  courseType: string | null
) {
  const params: string[] = [];
  const clauses: string[] = [];

  if (academicYear) {
    params.push(academicYear);
    clauses.push(`ccr.academic_year = $${params.length}`);
  }
  if (programCode) {
    params.push(programCode);
    clauses.push(`ccr.program_code = $${params.length}`);
  }
  if (courseType) {
    params.push(courseType);
    clauses.push(`ccr.course_type = $${params.length}`);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const courseNameExpression = await resolveCourseNameExpression(db);

  const { rows } = await db.query(
    `
    SELECT
      ccr.canvas_course_id,
      ccr.course_code,
      COALESCE(${courseNameExpression}, ccr.course_code) AS course_name,
      ccr.program_code,
      p.program_name,
      ccr.academic_year,
      ccr.creation_source,
      ccr.course_type,
      ccr.course_status,
      ccr.syllabus_status,
      ccr.course_evaluation_status,
      ccr.instructor_evaluation_status,
      ccr.employment_skills_evaluation_status,
      ccr.canvas_content_status,
      ccr.total_group_weights
    FROM public.canvas_course_readiness ccr
    LEFT JOIN public.courses c
      ON c.course_code = ccr.course_code
     AND c.academic_year = ccr.academic_year
    INNER JOIN public.programs p
      ON p.program_code = ccr.program_code
     AND p.academic_year = ccr.academic_year
    ${whereClause}
    ORDER BY ccr.academic_year DESC, ccr.program_code, ccr.course_code
    `,
    params
  );

  return rows;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedAcademicYear = cleanFilter(url.searchParams.get("academic_year"));
    const requestedProgramCode = cleanFilter(url.searchParams.get("program_code"));
    const requestedCourseType = cleanFilter(url.searchParams.get("course_type"));
    const includeMeta = parseBool(url.searchParams.get("include_meta"));
    const includeRows = parseBool(url.searchParams.get("include_rows"));

    const payload = await withSecureReport(
      request,
      "course-readiness",
      async ({ db, anonymizeRows, meta }) => {
        if (includeMeta) {
          const years = await getYears(db);
          const selectedAcademicYear =
            requestedAcademicYear && years.includes(requestedAcademicYear)
              ? requestedAcademicYear
              : (years[0] ?? null);

          const programs = await getPrograms(db, selectedAcademicYear);
          const selectedProgramCode =
            requestedProgramCode && programs.some((program) => program.program_code === requestedProgramCode)
              ? requestedProgramCode
              : null;
          const courseTypes = await getCourseTypes(db, selectedAcademicYear, selectedProgramCode);
          const selectedCourseType =
            requestedCourseType && courseTypes.includes(requestedCourseType)
              ? requestedCourseType
              : null;

          let rows: Record<string, unknown>[] = [];
          if (includeRows) {
            const rawRows = await getRows(
              db,
              selectedAcademicYear,
              selectedProgramCode,
              selectedCourseType
            );
            rows = rawRows as Record<string, unknown>[];
          }

          return {
            ok: true,
            count: rows.length,
            data: anonymizeRows(rows),
            meta: {
              years,
              programs,
              course_types: courseTypes,
              campuses: [],
              ...meta,
              selected: {
                academic_year: selectedAcademicYear,
                program_code: selectedProgramCode,
                course_type: selectedCourseType,
                campus: null,
              },
            },
          };
        }

        const rawRows = await getRows(
          db,
          requestedAcademicYear,
          requestedProgramCode,
          requestedCourseType
        );
        const rows = anonymizeRows(rawRows as Record<string, unknown>[]);
        return { ok: true, count: rows.length, data: rows };
      }
    );

    return NextResponse.json(payload);
  } catch (e: unknown) {
    if (e instanceof HttpError) {
      return NextResponse.json(e.payload, { status: e.status });
    }

    console.error("Course readiness report error:", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}


