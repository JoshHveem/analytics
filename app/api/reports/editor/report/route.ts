import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";
import { withAuthedDb } from "@/lib/authed-db";
import type { Queryable } from "@/lib/db";

function normalizeRoute(route: string): string {
  return String(route ?? "").trim().replace(/^\/+|\/+$/g, "");
}

async function ensureUniqueRoute(db: Queryable, base: string): Promise<string> {
  let candidate = normalizeRoute(base);
  let suffix = 2;
  while (true) {
    const { rows } = await db.query(
      `
      SELECT EXISTS (
        SELECT 1
        FROM meta.reports
        WHERE trim(both '/' from route) = $1
      ) AS exists
      `,
      [candidate]
    );
    if (!rows[0]?.exists) {
      return candidate;
    }
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

function isPgPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return String((error as { code?: unknown }).code ?? "") === "42501";
}

async function resolveReport(db: Queryable, reportRef: string): Promise<{ report_id: string; route: string }> {
  const normalized = String(reportRef ?? "").trim();
  if (!normalized) {
    throw new HttpError(400, { error: "Missing report_id" });
  }

  const { rows } = await db.query<{ report_id: string; route: string }>(
    `
    SELECT
      r.id AS report_id,
      trim(both '/' from r.route) AS route
    FROM meta.reports r
    WHERE COALESCE(r.is_active, true) = true
      AND (r.id = $1 OR trim(both '/' from r.route) = $1)
    LIMIT 1
    `,
    [normalized]
  );

  const row = rows[0];
  if (!row?.report_id) {
    throw new HttpError(404, { error: "Report not found" });
  }
  return {
    report_id: String(row.report_id),
    route: String(row.route ?? ""),
  };
}

export async function POST() {
  try {
    const payload = await withAuthedDb(async ({ db, user }) => {
      if (!user.is_admin) {
        throw new HttpError(403, { error: "Forbidden" });
      }

      const reportId = randomUUID();
      const baseRoute = `report-${reportId.split("-")[0]}`;
      const route = await ensureUniqueRoute(db, baseRoute);

      const { rows } = await db.query<{ report_id: string; route: string }>(
        `
        INSERT INTO meta.reports (id, title, category, route, description, is_active)
        VALUES ($1, $2, $3, $4, $5, true)
        RETURNING id AS report_id, trim(both '/' from route) AS route
        `,
        [reportId, "New Report", "other", route, "New report"]
      );

      const created = rows[0];
      if (!created?.report_id) {
        throw new HttpError(500, { error: "Failed to create report" });
      }

      return {
        ok: true,
        report: {
          report_id: String(created.report_id),
          route: String(created.route ?? route),
        },
      };
    });

    return NextResponse.json(payload);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    if (isPgPermissionError(error)) {
      return NextResponse.json(
        { error: "Database role lacks INSERT permission on meta.reports." },
        { status: 403 }
      );
    }
    console.error("Report editor create report error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      report_id?: unknown;
      title?: unknown;
    };
    const reportRef = String(body.report_id ?? "").trim();
    const title = String(body.title ?? "").trim();
    if (!title) {
      throw new HttpError(400, { error: "title is required" });
    }

    const payload = await withAuthedDb(async ({ db, user }) => {
      if (!user.is_admin) {
        throw new HttpError(403, { error: "Forbidden" });
      }

      const report = await resolveReport(db, reportRef);
      await db.query(
        `
        UPDATE meta.reports
        SET title = $2
        WHERE id = $1
        `,
        [report.report_id, title]
      );

      return {
        ok: true,
        report: {
          report_id: report.report_id,
          route: report.route,
          title,
        },
      };
    });

    return NextResponse.json(payload);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    if (isPgPermissionError(error)) {
      return NextResponse.json(
        { error: "Database role lacks UPDATE permission on meta.reports." },
        { status: 403 }
      );
    }
    console.error("Report editor update report error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
