import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET() {
  try {
    await pool.query("SELECT 1");
    return NextResponse.json({ ok: true, dbState: 1 });
  } catch {
    return NextResponse.json({ ok: false, dbState: 0, error: "db_unreachable" }, { status: 500 });
  }
}
