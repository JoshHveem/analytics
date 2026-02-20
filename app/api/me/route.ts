import { NextResponse } from "next/server";
import { requireAuth, HttpError } from "@/lib/auth";

export async function GET() {
  try {
    const user = await requireAuth();
    return NextResponse.json({ ok: true, user });
  } catch (e: any) {
    if (e instanceof HttpError) {
      return NextResponse.json(e.payload, { status: e.status });
    }
    console.error("Auth error:", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
