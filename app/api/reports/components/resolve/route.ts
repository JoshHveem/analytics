import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";
import { withSecureReport } from "@/lib/secure-report";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const route = String(url.searchParams.get("route") ?? "").trim().replace(/^\/+|\/+$/g, "");
    if (!route) {
      throw new HttpError(400, { error: "Missing required query parameter: route" });
    }

    const payload = await withSecureReport(request, route, async ({ db }) => {
      const { rows } = await db.query<{
        component_code: string;
        report_component_id: string;
        report_id: string;
        component_order: number;
      }>(
        `
        SELECT
          rc.component_code,
          rc.id AS report_component_id,
          r.id AS report_id,
          COALESCE(
            CASE
              WHEN (rc.settings->>'component_order') ~ '^-?\\d+$'
              THEN (rc.settings->>'component_order')::int
              ELSE NULL
            END,
            100000
          ) AS component_order
        FROM meta.reports r
        INNER JOIN meta.report_components rc
          ON rc.report_id = r.id
         AND COALESCE(rc.is_active, true) = true
        INNER JOIN meta.components c
          ON c.component_code = rc.component_code
         AND COALESCE(c.is_active, true) = true
        WHERE COALESCE(r.is_active, true) = true
          AND (trim(both '/' from r.route) = $1 OR r.id = $1)
        ORDER BY
          component_order ASC,
          rc.id ASC
        `,
        [route]
      );

      const row = rows[0];
      if (!row) {
        throw new HttpError(404, { error: `No active component configured for route "${route}"` });
      }

      return {
        ok: true,
        component_code: String(row.component_code ?? ""),
        report_component_id: String(row.report_component_id ?? ""),
        report_id: String(row.report_id ?? ""),
        components: rows.map((componentRow) => ({
          component_code: String(componentRow.component_code ?? ""),
          report_component_id: String(componentRow.report_component_id ?? ""),
          report_id: String(componentRow.report_id ?? ""),
          component_order: Number(componentRow.component_order ?? 100000),
        })),
      };
    });

    return NextResponse.json(payload);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
