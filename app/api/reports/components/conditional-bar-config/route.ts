import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";
import { withAuthedDb } from "@/lib/authed-db";
import { GET as getTableConfig, PUT as putTableConfig } from "../table-config/route";

async function assertConditionalBarComponent(args: { reportId: string; reportComponentId: string }) {
  await withAuthedDb(async ({ db, user }) => {
    if (!user.is_admin) {
      throw new HttpError(403, { error: "Forbidden" });
    }

    const { rows } = await db.query<{ component_code: string }>(
      `
      SELECT rc.component_code
      FROM meta.reports r
      INNER JOIN meta.report_components rc
        ON rc.report_id = r.id
       AND COALESCE(rc.is_active, true) = true
      WHERE COALESCE(r.is_active, true) = true
        AND (r.id = $1 OR trim(both '/' from r.route) = $1)
        AND rc.id = $2
      LIMIT 1
      `,
      [args.reportId, args.reportComponentId]
    );

    const code = rows[0]?.component_code;
    if (typeof code !== "string" || code.length === 0) {
      throw new HttpError(404, { error: "Report component not found" });
    }
    if (code !== "conditional_bar") {
      throw new HttpError(400, {
        error: `Component "${code}" is not a conditional_bar component.`,
      });
    }
  });
}

function requiredIdsFrom(request: Request): { reportId: string; reportComponentId: string } {
  const url = new URL(request.url);
  const reportId = String(url.searchParams.get("report_id") ?? "").trim();
  const reportComponentId = String(url.searchParams.get("report_component_id") ?? "").trim();
  if (!reportId || !reportComponentId) {
    throw new HttpError(400, { error: "Missing required query parameters: report_id, report_component_id" });
  }
  return { reportId, reportComponentId };
}

export async function GET(request: Request) {
  try {
    const { reportId, reportComponentId } = requiredIdsFrom(request);
    await assertConditionalBarComponent({ reportId, reportComponentId });
    return getTableConfig(request);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { reportId, reportComponentId } = requiredIdsFrom(request);
    await assertConditionalBarComponent({ reportId, reportComponentId });
    return putTableConfig(request);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
