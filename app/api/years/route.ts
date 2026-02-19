import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";
import { withAuthedDb } from "@/lib/authed-db";

export async function GET() {
  try {
    const rows = await withAuthedDb(async ({ db }) => {
      const result = await db.query(
        `SELECT DISTINCT academic_year FROM student_exit_status ORDER BY academic_year DESC`
      );
      return result.rows;
    });
    return NextResponse.json({
      ok: true,
      count: rows.length,
      data: rows.map((r: { academic_year: string | number }) => r.academic_year),
    });
  } catch (e: any) {
    if (e instanceof HttpError) {
      return NextResponse.json(e.payload, { status: e.status });
    }

    console.error("Years error:", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
