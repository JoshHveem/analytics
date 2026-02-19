import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";
import { withAuthedDb } from "@/lib/authed-db";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const academic_year = url.searchParams.get("academic_year");
    const program_code = url.searchParams.get("program_code");

    const rows = await withAuthedDb(async ({ db }) => {
      // Build query depending on provided params
      if (academic_year && program_code) {
        const result = await db.query(
          `SELECT DISTINCT campus FROM student_exit_status WHERE academic_year = $1 AND program_code = $2 ORDER BY campus`,
          [academic_year, program_code]
        );
        return result.rows;
      }

      if (academic_year) {
        const result = await db.query(
          `SELECT DISTINCT campus FROM student_exit_status WHERE academic_year = $1 ORDER BY campus`,
          [academic_year]
        );
        return result.rows;
      }

      if (program_code) {
        const result = await db.query(
          `SELECT DISTINCT campus FROM student_exit_status WHERE program_code = $1 ORDER BY campus`,
          [program_code]
        );
        return result.rows;
      }

      const result = await db.query(`SELECT DISTINCT campus FROM student_exit_status ORDER BY campus`);
      return result.rows;
    });
    return NextResponse.json({
      ok: true,
      count: rows.length,
      data: rows.map((r: { campus: string }) => r.campus),
    });
  } catch (e: any) {
    if (e instanceof HttpError) {
      return NextResponse.json(e.payload, { status: e.status });
    }

    console.error("Campuses error:", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
