import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";
import { withSecureReport } from "@/lib/secure-report";
import { buildTableComponentQuery } from "@/lib/report-component-table";

function parseBool(value: string | null): boolean {
  return value === "1" || value === "true";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const route = String(url.searchParams.get("route") ?? "").trim().replace(/^\/+|\/+$/g, "");
    const includeMeta = parseBool(url.searchParams.get("include_meta"));
    const includeRows = parseBool(url.searchParams.get("include_rows"));

    if (!route) {
      throw new HttpError(400, { error: "Missing required query parameter: route" });
    }

    const payload = await withSecureReport(
      request,
      route,
      async ({ db, anonymizeRows, meta }) => {
        const compiled = await buildTableComponentQuery({
          db,
          route,
          searchParams: url.searchParams,
        });

        let rows: Record<string, unknown>[] = [];
        if (includeRows) {
          const result = await db.query(compiled.sql, compiled.values);
          rows = anonymizeRows(result.rows as Record<string, unknown>[]);
        }

        return {
          ok: true,
          count: rows.length,
          data: rows,
          meta: includeMeta
            ? {
                ...meta,
                selected_columns: compiled.selectedAliases,
                compiled_sql_preview: compiled.sql,
              }
            : undefined,
        };
      }
    );

    return NextResponse.json(payload);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    console.error("Table component route error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
