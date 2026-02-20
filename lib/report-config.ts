import { withAuthedDb } from "./authed-db";

export type ReportFilterConfig = {
  filter_code: string;
  type: string;
  default_value: string | null;
  label: string;
  description: string | null;
  table: string | null;
  column: string | null;
};

export type ReportConfig = {
  id: string;
  title: string;
  category: string;
  route: string;
  description: string | null;
  filters: ReportFilterConfig[];
};

function normalizeRoute(route: string): string {
  return String(route ?? "").trim().replace(/^\/+|\/+$/g, "");
}

export async function getReportConfigByRoute(route: string): Promise<ReportConfig | null> {
  const normalizedRoute = normalizeRoute(route);
  if (!normalizedRoute) {
    return null;
  }

  return withAuthedDb(async ({ db }) => {
    const reportResult = await db.query<{
      id: string;
      title: string;
      category: string;
      route: string;
      description: string | null;
    }>(
      `
      SELECT id, title, category, route, description
      FROM meta.reports
      WHERE is_active = true
        AND trim(both '/' from route) = $1
      LIMIT 1
      `,
      [normalizedRoute]
    );

    const report = reportResult.rows[0];
    if (!report) {
      return null;
    }

    const filterResult = await db.query<{
      filter_code: string;
      type: string | null;
      default_value: string | null;
      label: string | null;
      description: string | null;
      table: string | null;
      column: string | null;
    }>(
      `
      SELECT
        rf.filter_code,
        COALESCE(rf.type, f.type, 'select') AS type,
        rf.default_value,
        f.label,
        f.description,
        f."table" AS table,
        f."column" AS column
      FROM meta.report_filters rf
      LEFT JOIN meta.filters f
        ON f.filter_code = rf.filter_code
      WHERE rf.report_id = $1
      ORDER BY rf.filter_code
      `,
      [report.id]
    );

    return {
      id: String(report.id),
      title: String(report.title ?? normalizedRoute),
      category: String(report.category ?? ""),
      route: normalizeRoute(report.route),
      description: report.description ?? null,
      filters: filterResult.rows.map((row: {
        filter_code: string;
        type: string | null;
        default_value: string | null;
        label: string | null;
        description: string | null;
        table: string | null;
        column: string | null;
      }) => ({
        filter_code: String(row.filter_code),
        type: String(row.type ?? "select"),
        default_value: row.default_value ?? null,
        label: String(row.label ?? row.filter_code),
        description: row.description ?? null,
        table: row.table ?? null,
        column: row.column ?? null,
      })),
    };
  });
}
