import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";
import { withAuthedDb } from "@/lib/authed-db";

export async function GET() {
  try {
    const { user, dbContext, visiblePrograms } = await withAuthedDb(async ({ db, user }) => {
      const { rows } = await db.query(
        `
        SELECT
          current_user AS current_user,
          session_user AS session_user,
          current_setting('app.sis_user_id', true) AS app_sis_user_id,
          current_setting('app.is_admin', true) AS app_is_admin
        `
      );

      const visibleRes = await db.query(
        `
        SELECT DISTINCT s.program_code
        FROM student_exit_status s
        ORDER BY s.program_code
        `
      );

      return {
        user,
        dbContext: rows[0],
        visiblePrograms: visibleRes.rows.map((r: { program_code: string }) => r.program_code),
      };
    });

    return NextResponse.json({
      ok: true,
      auth_user: user,
      db_context: dbContext,
      rls_visible_program_codes: visiblePrograms,
      note: "Use this endpoint to verify request identity and RLS-visible programs.",
    });
  } catch (e: unknown) {
    if (e instanceof HttpError) {
      return NextResponse.json(e.payload, { status: e.status });
    }
    console.error("Auth context debug error:", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
