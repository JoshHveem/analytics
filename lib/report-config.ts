import { withAuthedDb } from "./authed-db";

export type ReportFilterConfig = {
  filter_code: string;
  type: string;
  settings: {
    default_value: string | null;
    include_all: boolean;
  };
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

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

function normalizeFilterCode(args: {
  filterCode: string | null;
  filterType: string | null;
  column: string | null;
}): string {
  const column = String(args.column ?? "").trim().toLowerCase();
  if (column && SAFE_IDENT.test(column)) {
    return column;
  }

  const filterType = String(args.filterType ?? "").trim().toLowerCase();
  if (filterType && SAFE_IDENT.test(filterType) && (filterType.endsWith("_code") || filterType.endsWith("_id"))) {
    return filterType;
  }

  const filterCode = String(args.filterCode ?? "").trim().toLowerCase();
  if (filterCode === "program") {
    throw new Error('Invalid filter_code "program"; use "program_code"');
  }
  return filterCode;
}

function parseFilterSettings(raw: unknown): {
  default_value: string | null;
  include_all: boolean;
} {
  const settings =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const defaultValueRaw = settings.default_value;
  const default_value =
    defaultValueRaw === null || defaultValueRaw === undefined
      ? null
      : String(defaultValueRaw).trim() || null;
  const include_all = settings.include_all === true;
  return {
    default_value,
    include_all,
  };
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
        AND (trim(both '/' from route) = $1 OR id = $1)
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
      settings: unknown;
      label: string | null;
      description: string | null;
      table: string | null;
      column: string | null;
    }>(
      `
      SELECT
        rf.filter_code,
        COALESCE(rf.type, f.type, 'select') AS type,
        rf.settings,
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
        settings: unknown;
        label: string | null;
        description: string | null;
        table: string | null;
        column: string | null;
      }) => ({
        filter_code: normalizeFilterCode({
          filterCode: row.filter_code,
          filterType: row.type,
          column: row.column,
        }),
        type: String(row.type ?? "select"),
        settings: parseFilterSettings(row.settings),
        label: String(row.label ?? row.filter_code),
        description: row.description ?? null,
        table: row.table ?? null,
        column: row.column ?? null,
      })),
    };
  });
}
