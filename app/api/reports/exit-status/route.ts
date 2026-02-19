import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAuth, HttpError } from "@/lib/auth";

export async function GET() {
  try {
    await requireAuth();

    const fiscalCutoff = "2026-07-01";

    const { rows } = await pool.query(
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

    return NextResponse.json({
      ok: true,
      fiscal_cutoff: fiscalCutoff,
      data: rows[0],
    });
  } catch (e: any) {
    if (e instanceof HttpError) {
      return NextResponse.json(e.payload, { status: e.status });
    }

    console.error("Exit report error:", e);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
