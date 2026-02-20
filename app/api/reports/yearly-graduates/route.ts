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
    `SELECT DISTINCT academic_year FROM student_exit_status ORDER BY academic_year DESC`
  );
  return rows.map((r: { academic_year: string | number }) => String(r.academic_year));
}

async function getPrograms(db: Queryable, academicYear: string | null) {
  const params: string[] = [];
  const whereClause = academicYear ? `WHERE s.academic_year = $1` : "";
  if (academicYear) {
    params.push(academicYear);
  }

  const result = await db.query(
    `
    SELECT DISTINCT s.program_code, COALESCE(p.program_name, s.program_code) AS program_name
    FROM student_exit_status s
    LEFT JOIN programs p ON p.program_code = s.program_code
    ${whereClause}
    ORDER BY program_name NULLS LAST, s.program_code
    `,
    params
  );
  const rows = result.rows as Array<{ program_code: string; program_name: string | null }>;

  return rows.map((r: { program_code: string; program_name: string | null }) => ({
    program_code: String(r.program_code),
    program_name: String(r.program_name ?? r.program_code),
  })) as ProgramOption[];
}

async function getCampuses(
  db: Queryable,
  academicYear: string | null,
  programCode: string | null
) {
  if (!programCode) {
    return [];
  }

  const params: string[] = [programCode];
  const clauses: string[] = [`s.program_code = $1`];

  if (academicYear) {
    params.push(academicYear);
    clauses.push(`s.academic_year = $${params.length}`);
  }

  const { rows } = await db.query(
    `
    SELECT DISTINCT s.campus
    FROM student_exit_status s
    WHERE ${clauses.join(" AND ")}
    ORDER BY s.campus
    `,
    params
  );

  return rows.map((r: { campus: string }) => String(r.campus));
}

async function getReportRows(
  db: Queryable,
  programCode: string,
  campus: string,
  academicYear: string
) {
  const columnCheck = await db.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'student_exit_status'
      AND column_name = 'chance_to_graduate'
    LIMIT 1
    `
  );
  const hasChanceToGraduate = columnCheck.rowCount > 0;
  const chanceToGraduateSelect = hasChanceToGraduate
    ? "s.chance_to_graduate::double precision AS chance_to_graduate"
    : "NULL::double precision AS chance_to_graduate";

  const usersColumnCheck = await db.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name IN ('sis_user_id', 'first_name', 'last_name')
    `
  );
  const userColumns = new Set(
    usersColumnCheck.rows.map((r: { column_name: string }) => String(r.column_name))
  );
  const canJoinUsers =
    userColumns.has("sis_user_id") && userColumns.has("first_name") && userColumns.has("last_name");
  const userJoin = canJoinUsers ? "LEFT JOIN users u ON u.sis_user_id = s.sis_user_id" : "";
  const userNameSelect = canJoinUsers
    ? `
      u.first_name,
      u.last_name,
    `
    : `
      NULL::text AS first_name,
      NULL::text AS last_name,
    `;

  const { rows } = await db.query(
    `
    SELECT
      s.sis_user_id,
      ${userNameSelect}
      s.program_code,
      COALESCE(p.program_name, s.program_code) AS program_name,
      s.campus,
      s.academic_year,
      s.exit_date,
      s.days_remaining,
      s.credits_remaining,
      s.projected_exit_date,
      s.is_exited,
      s.is_graduate,
      s.is_nongrad_related_completer,
      s.is_completer,
      s.academic_year_end,
      s.buffer_days,
      s.cutoff_prob,
      s.late_window_days,
      s.buffer_start_date,
      ${chanceToGraduateSelect},
      s.chance_to_complete::double precision AS chance_to_complete
    FROM student_exit_status s
    LEFT JOIN programs p ON p.program_code = s.program_code
    ${userJoin}
    WHERE s.program_code = $1
      AND s.campus = $2
      AND s.academic_year = $3
    ORDER BY s.exit_date NULLS LAST, s.sis_user_id
    `,
    [programCode, campus, academicYear]
  );

  return rows;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    const requestedProgramCode = url.searchParams.get("program_code");
    const requestedCampus = url.searchParams.get("campus");
    const requestedAcademicYear = url.searchParams.get("academic_year");
    const includeMeta = parseBool(url.searchParams.get("include_meta"));
    const includeRows = parseBool(url.searchParams.get("include_rows"));
    const payload = await withSecureReport(request, "yearly-graduates", async ({ db, anonymizeRows, meta }) => {
        if (!includeMeta && !requestedProgramCode && !requestedCampus && !requestedAcademicYear) {
          const fiscalCutoff = "2026-07-01";
          const { rows } = await db.query(
            `
            SELECT
              COUNT(*) FILTER (WHERE is_graduate = true) AS graduates,
              COUNT(*) FILTER (WHERE is_exited = true AND is_graduate = false) AS exited,
              COUNT(*) FILTER (
                WHERE is_exited = false
                  AND is_graduate = false
                  AND projected_exit_date <= $1
              ) AS on_track
            FROM student_exit_status
            `,
            [fiscalCutoff]
          );

          return {
            ok: true,
            fiscal_cutoff: fiscalCutoff,
            data: rows[0],
          };
        }

        if (includeMeta) {
          const years = await getYears(db);
          const selectedAcademicYear = requestedAcademicYear && years.includes(requestedAcademicYear)
            ? requestedAcademicYear
            : years[0] ?? null;

          const programs = await getPrograms(db, selectedAcademicYear);
          const selectedProgramCode = requestedProgramCode && programs.some((p) => p.program_code === requestedProgramCode)
            ? requestedProgramCode
            : programs[0]?.program_code ?? null;

          const campuses = await getCampuses(db, selectedAcademicYear, selectedProgramCode);
          const selectedCampus = requestedCampus && campuses.includes(requestedCampus)
            ? requestedCampus
            : campuses[0] ?? null;

          let rows: any[] = [];
          if (includeRows && selectedProgramCode && selectedCampus && selectedAcademicYear) {
            const rawRows = await getReportRows(
              db,
              selectedProgramCode,
              selectedCampus,
              selectedAcademicYear
            );
            rows = anonymizeRows(rawRows as Record<string, unknown>[]);
          }

          return {
            ok: true,
            count: rows.length,
            data: rows,
            meta: {
              years,
              programs,
              campuses,
              ...meta,
              selected: {
                academic_year: selectedAcademicYear,
                program_code: selectedProgramCode,
                campus: selectedCampus,
              },
            },
          };
        }

        if (!requestedProgramCode || !requestedCampus || !requestedAcademicYear) {
          throw new HttpError(400, { error: "Missing required query parameters: program_code, campus, academic_year" });
        }

        const rawRows = await getReportRows(db, requestedProgramCode, requestedCampus, requestedAcademicYear);
        const rows = anonymizeRows(rawRows as Record<string, unknown>[]);
        return { ok: true, count: rows.length, data: rows };
      });

    return NextResponse.json(payload);
  } catch (e: unknown) {
    if (e instanceof HttpError) {
      return NextResponse.json(e.payload, { status: e.status });
    }

    console.error("Exit report error:", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
