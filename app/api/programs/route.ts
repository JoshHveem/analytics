import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";
import { withAuthedDb } from "@/lib/authed-db";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const academic_year = url.searchParams.get("academic_year");

    const rows = await withAuthedDb(async ({ db }) => {
      if (academic_year) {
        const result = await db.query(
          `
          SELECT DISTINCT s.program_code, COALESCE(p.program_name, s.program_code) AS program_name
          FROM dataset.student_exit_status s
          LEFT JOIN ref.programs p ON p.program_code = s.program_code
          WHERE s.academic_year = $1
          ORDER BY program_name NULLS LAST, s.program_code
          `,
          [academic_year]
        );
        return result.rows;
      }

      const result = await db.query(
        `
        SELECT DISTINCT s.program_code, COALESCE(p.program_name, s.program_code) AS program_name
        FROM dataset.student_exit_status s
        LEFT JOIN ref.programs p ON p.program_code = s.program_code
        ORDER BY program_name NULLS LAST, s.program_code
        `
      );
      return result.rows;
    });

    return NextResponse.json({ ok: true, count: rows.length, data: rows });
  } catch (e: any) {
    if (e instanceof HttpError) {
      return NextResponse.json(e.payload, { status: e.status });
    }

    console.error("Programs error:", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
