import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";
import { withAuthedDb } from "@/lib/authed-db";

function isPgPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return String((error as { code?: unknown }).code ?? "") === "42501";
}

export async function GET() {
  try {
    const payload = await withAuthedDb(async ({ db, user }) => {
      if (!user.is_admin) {
        throw new HttpError(403, { error: "Forbidden" });
      }

      const { rows } = await db.query<{ table_name: string }>(
        `
        SELECT table_name::text
        FROM information_schema.tables
        WHERE table_schema = 'dataset'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name ASC
        `
      );

      return {
        ok: true,
        tables: rows.map((row) => String(row.table_name)),
      };
    });

    return NextResponse.json(payload);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    if (isPgPermissionError(error)) {
      return NextResponse.json(
        { error: "Database role lacks SELECT permission on information_schema.tables." },
        { status: 403 }
      );
    }
    console.error("Report editor dataset tables GET error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
