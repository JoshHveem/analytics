import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";
import { getReportConfigByRoute } from "@/lib/report-config";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const route = String(url.searchParams.get("route") ?? "").trim();

    if (!route) {
      throw new HttpError(400, { error: "Missing required query parameter: route" });
    }

    const config = await getReportConfigByRoute(route);
    if (!config) {
      throw new HttpError(404, { error: "Report not found" });
    }

    return NextResponse.json({ ok: true, config });
  } catch (e: unknown) {
    if (e instanceof HttpError) {
      return NextResponse.json(e.payload, { status: e.status });
    }
    console.error("Report config error:", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
