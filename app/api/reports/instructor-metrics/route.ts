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

async function getPrograms(db: Queryable, academicYear: string | null) {
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
      p.program_code,
      p.program_name
    FROM public.programs p
    INNER JOIN public.instructor_metrics im
      ON im.program_code = p.program_code
    ${whereClause}
    ORDER BY p.program_name, p.program_code
    `,
    params
  );

  return rows.map((row: { program_code: string | null; program_name: string | null }) => {
    const code = String(row.program_code ?? "").trim();
    return {
      program_code: code,
      program_name: String(row.program_name ?? code),
    };
  }) as ProgramOption[];
}

async function getRows(
  db: Queryable,
  academicYear: string | null,
  programCode: string | null
) {
  const params: string[] = [];
  const clauses: string[] = [];

  if (academicYear) {
    params.push(academicYear);
    clauses.push(`im.academic_year = $${params.length}`);
  }
  if (programCode) {
    params.push(programCode);
    clauses.push(`im.program_code = $${params.length}`);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await db.query(
    `
    SELECT
      im.sis_user_id,
      u.first_name,
      u.last_name,
      im.academic_year,
      im.program_code,
      COALESCE(p.program_name, im.program_code) AS program_name,
      im.assignments_graded,
      im.average_score,
      im.days_to_grade,
      im.perc_graded_with_rubric,
      im.num_replies_to_students,
      im.days_to_reply,
      im.credits_overseen,
      im.credits_graded
    FROM public.instructor_metrics im
    LEFT JOIN public.users u
      ON u.sis_user_id = im.sis_user_id
    LEFT JOIN public.programs p
      ON p.program_code = im.program_code
    ${whereClause}
    ORDER BY im.academic_year DESC, im.program_code, u.last_name NULLS LAST, u.first_name NULLS LAST, im.sis_user_id
    `,
    params
  );

  return rows;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedAcademicYear = String(url.searchParams.get("academic_year") ?? "").trim() || null;
    const requestedProgramCode = String(url.searchParams.get("program_code") ?? "").trim() || null;
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

        const programs = await getPrograms(db, selectedAcademicYear);
        const selectedProgramCode =
          requestedProgramCode &&
          programs.some((program) => program.program_code === requestedProgramCode)
            ? requestedProgramCode
            : (programs[0]?.program_code ?? null);

        let rows: any[] = [];
        if (includeRows) {
          const rawRows = await getRows(db, selectedAcademicYear, selectedProgramCode);
          rows = anonymizeRows(rawRows as Record<string, unknown>[]);
        }

        return {
          ok: true,
          count: rows.length,
          data: rows,
          meta: {
            years,
            programs,
            campuses: [],
            ...meta,
            selected: {
              academic_year: selectedAcademicYear,
              program_code: selectedProgramCode,
              campus: null,
            },
          },
        };
      }

      const rawRows = await getRows(db, requestedAcademicYear, requestedProgramCode);
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
