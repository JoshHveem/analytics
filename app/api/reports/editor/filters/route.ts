import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";
import { withAuthedDb } from "@/lib/authed-db";
import { type Queryable } from "@/lib/db";

type ReportRecord = {
  report_id: string;
  route: string;
};

type AvailableFilterRecord = {
  filter_code: string;
  label: string | null;
  description: string | null;
  type: string | null;
  table: string | null;
  column: string | null;
  settings: {
    default_value: string | null;
    include_all: boolean;
  } | null;
};

type ReportFilterColumnCapabilities = {
  hasType: boolean;
  hasSettings: boolean;
};

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

function isPgPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return String((error as { code?: unknown }).code ?? "") === "42501";
}

function normalizeFilterCode(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!SAFE_IDENT.test(normalized)) {
    throw new HttpError(400, { error: `Invalid filter_code: ${value}` });
  }
  return normalized;
}

function normalizeFilterType(value: unknown): "select" | "multi_select" | "text" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "multi_select") {
    return "multi_select";
  }
  if (normalized === "text") {
    return "text";
  }
  return "select";
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeSelectFilterSettings(value: unknown): {
  default_value: string | null;
  include_all: boolean;
} {
  const raw = parseJsonObject(value);
  const defaultValueRaw = raw.default_value;
  const default_value =
    defaultValueRaw === null || defaultValueRaw === undefined
      ? null
      : String(defaultValueRaw).trim() || null;
  const include_all = raw.include_all === true;
  return {
    default_value,
    include_all,
  };
}

async function resolveReport(db: Queryable, reportRef: string): Promise<ReportRecord> {
  const normalized = String(reportRef ?? "").trim();
  if (!normalized) {
    throw new HttpError(400, { error: "Missing report_id" });
  }

  const { rows } = await db.query<ReportRecord>(
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
  if (!row) {
    throw new HttpError(404, { error: "Report not found" });
  }
  return row;
}

async function hasFiltersIsActiveColumn(db: Queryable): Promise<boolean> {
  const { rows } = await db.query<{ found: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'meta'
        AND table_name = 'filters'
        AND column_name = 'is_active'
    ) AS found
    `
  );
  return Boolean(rows[0]?.found);
}

async function listAvailableFilters(db: Queryable): Promise<AvailableFilterRecord[]> {
  const includeOnlyActive = await hasFiltersIsActiveColumn(db);
  const { rows } = await db.query<AvailableFilterRecord>(
    includeOnlyActive
      ? `
        SELECT filter_code, label, description, type, "table", "column"
        FROM meta.filters
        WHERE COALESCE(is_active, true) = true
        ORDER BY filter_code
        `
      : `
        SELECT filter_code, label, description, type, "table", "column"
        FROM meta.filters
        ORDER BY filter_code
        `
  );
  return rows.map((row) => ({
    filter_code: normalizeFilterCode(row.filter_code),
    label: row.label ?? null,
    description: row.description ?? null,
    type: normalizeFilterType(row.type),
    table: row.table ?? null,
    column: row.column ?? null,
    settings: null,
  }));
}

async function listSelectedFilterRows(
  db: Queryable,
  reportId: string
): Promise<Array<{ filter_code: string; settings: unknown }>> {
  const { rows } = await db.query<{ filter_code: string; settings: unknown }>(
    `
    SELECT filter_code, settings
    FROM meta.report_filters
    WHERE report_id = $1
    ORDER BY filter_code
    `,
    [reportId]
  );
  const deduped = new Map<string, { filter_code: string; settings: unknown }>();
  for (const row of rows) {
    const filterCode = normalizeFilterCode(row.filter_code);
    if (!deduped.has(filterCode)) {
      deduped.set(filterCode, { filter_code: filterCode, settings: row.settings });
    }
  }
  return Array.from(deduped.values());
}

async function listSelectedFilters(db: Queryable, reportId: string): Promise<string[]> {
  const selectedRows = await listSelectedFilterRows(db, reportId);
  return selectedRows.map((row) => row.filter_code);
}

async function listSelectedFilterSettings(
  db: Queryable,
  reportId: string
): Promise<Map<string, { default_value: string | null; include_all: boolean }>> {
  const selectedRows = await listSelectedFilterRows(db, reportId);
  const byFilter = new Map<string, { default_value: string | null; include_all: boolean }>();
  for (const row of selectedRows) {
    byFilter.set(row.filter_code, normalizeSelectFilterSettings(row.settings));
  }
  return byFilter;
}

async function getReportFilterColumnCapabilities(
  db: Queryable
): Promise<ReportFilterColumnCapabilities> {
  const { rows } = await db.query<{ column_name: string; is_nullable: string }>(
    `
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'meta'
      AND table_name = 'report_filters'
      AND column_name IN ('type', 'settings')
    `
  );
  const byName = new Map(rows.map((row) => [String(row.column_name), String(row.is_nullable)] as const));
  return {
    hasType: byName.has("type"),
    hasSettings: byName.has("settings"),
  };
}

async function applyReportFilters(args: {
  db: Queryable;
  reportId: string;
  selectedFilters: string[];
  capabilities: ReportFilterColumnCapabilities;
  settingsByFilter: Map<string, { default_value: string | null; include_all: boolean }>;
}): Promise<void> {
  const { db, reportId, selectedFilters, capabilities, settingsByFilter } = args;

  if (selectedFilters.length === 0) {
    await db.query(
      `
      DELETE FROM meta.report_filters
      WHERE report_id = $1
      `,
      [reportId]
    );
    return;
  }

  await db.query(
    `
    DELETE FROM meta.report_filters
    WHERE report_id = $1
      AND NOT (filter_code = ANY($2::text[]))
    `,
    [reportId, selectedFilters]
  );

  if (capabilities.hasType && capabilities.hasSettings) {
    await db.query(
      `
      INSERT INTO meta.report_filters (report_id, filter_code, type, settings)
      SELECT
        $1,
        f.filter_code,
        COALESCE(NULLIF(trim(f.type), ''), 'select'),
        '{}'::jsonb
      FROM meta.filters f
      WHERE f.filter_code = ANY($2::text[])
        AND NOT EXISTS (
          SELECT 1
          FROM meta.report_filters rf
          WHERE rf.report_id = $1
            AND rf.filter_code = f.filter_code
        )
      `,
      [reportId, selectedFilters]
    );
  } else if (capabilities.hasType) {
    await db.query(
      `
      INSERT INTO meta.report_filters (report_id, filter_code, type)
      SELECT
        $1,
        f.filter_code,
        COALESCE(NULLIF(trim(f.type), ''), 'select')
      FROM meta.filters f
      WHERE f.filter_code = ANY($2::text[])
        AND NOT EXISTS (
          SELECT 1
          FROM meta.report_filters rf
          WHERE rf.report_id = $1
            AND rf.filter_code = f.filter_code
        )
      `,
      [reportId, selectedFilters]
    );
  } else if (capabilities.hasSettings) {
    await db.query(
      `
      INSERT INTO meta.report_filters (report_id, filter_code, settings)
      SELECT
        $1,
        f.filter_code,
        '{}'::jsonb
      FROM meta.filters f
      WHERE f.filter_code = ANY($2::text[])
        AND NOT EXISTS (
          SELECT 1
          FROM meta.report_filters rf
          WHERE rf.report_id = $1
            AND rf.filter_code = f.filter_code
        )
      `,
      [reportId, selectedFilters]
    );
  } else {
    await db.query(
      `
      INSERT INTO meta.report_filters (report_id, filter_code)
      SELECT
        $1,
        f.filter_code
      FROM meta.filters f
      WHERE f.filter_code = ANY($2::text[])
        AND NOT EXISTS (
          SELECT 1
          FROM meta.report_filters rf
          WHERE rf.report_id = $1
            AND rf.filter_code = f.filter_code
        )
      `,
      [reportId, selectedFilters]
    );
  }

  if (!capabilities.hasSettings) {
    return;
  }
  for (const [filterCode, settings] of settingsByFilter.entries()) {
    if (!selectedFilters.includes(filterCode)) {
      continue;
    }
    await db.query(
      `
      UPDATE meta.report_filters
      SET settings = $3::jsonb
      WHERE report_id = $1
        AND filter_code = $2
      `,
      [reportId, filterCode, JSON.stringify(settings)]
    );
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const reportRef = String(url.searchParams.get("report_id") ?? "").trim();

    const payload = await withAuthedDb(async ({ db, user }) => {
      if (!user.is_admin) {
        throw new HttpError(403, { error: "Forbidden" });
      }

      const report = await resolveReport(db, reportRef);
      const availableFilters = await listAvailableFilters(db);
      const selectedFilters = await listSelectedFilters(db, report.report_id);
      const selectedSet = new Set(selectedFilters);
      const settingsByFilter = await listSelectedFilterSettings(db, report.report_id);

      return {
        ok: true,
        report: {
          report_id: report.report_id,
          route: report.route,
        },
        selected_filters: selectedFilters,
        available_filters: availableFilters.map((filter) => ({
          ...filter,
          selected: selectedSet.has(filter.filter_code),
          settings: settingsByFilter.get(filter.filter_code) ?? null,
        })),
      };
    });

    return NextResponse.json(payload);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    console.error("Report editor filters GET error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      report_id?: unknown;
      selected_filters?: unknown;
      filter_settings?: unknown;
    };

    const reportRef = String(body.report_id ?? "").trim();
    if (!Array.isArray(body.selected_filters)) {
      throw new HttpError(400, { error: "selected_filters must be an array" });
    }

    const selectedFilters = Array.from(
      new Set(
        body.selected_filters
          .map((value) => normalizeFilterCode(value))
          .filter((value) => value.length > 0)
      )
    ).sort((left, right) => left.localeCompare(right));

    const payload = await withAuthedDb(async ({ db, user }) => {
      if (!user.is_admin) {
        throw new HttpError(403, { error: "Forbidden" });
      }

      const report = await resolveReport(db, reportRef);
      const availableFilters = await listAvailableFilters(db);
      const availableByCode = new Map(
        availableFilters.map((filter) => [filter.filter_code, filter] as const)
      );
      const availableSet = new Set(availableFilters.map((filter) => filter.filter_code));
      for (const filterCode of selectedFilters) {
        if (!availableSet.has(filterCode)) {
          throw new HttpError(400, { error: `Unknown filter_code: ${filterCode}` });
        }
      }

      const filterSettingsRaw = parseJsonObject(body.filter_settings);
      const settingsByFilter = new Map<string, { default_value: string | null; include_all: boolean }>();
      for (const [rawFilterCode, rawSettings] of Object.entries(filterSettingsRaw)) {
        const filterCode = normalizeFilterCode(rawFilterCode);
        if (!selectedFilters.includes(filterCode)) {
          throw new HttpError(400, {
            error: `filter_settings provided for unselected filter_code: ${filterCode}`,
          });
        }
        const filter = availableByCode.get(filterCode);
        if (!filter) {
          throw new HttpError(400, { error: `Unknown filter_code in filter_settings: ${filterCode}` });
        }
        const filterType = normalizeFilterType(filter.type);
        if (filterType !== "select") {
          throw new HttpError(400, {
            error: `filter_settings only supported for select filters: ${filterCode}`,
          });
        }
        settingsByFilter.set(filterCode, normalizeSelectFilterSettings(rawSettings));
      }

      const capabilities = await getReportFilterColumnCapabilities(db);
      await applyReportFilters({
        db,
        reportId: report.report_id,
        selectedFilters,
        capabilities,
        settingsByFilter,
      });

      const persistedSelectedFilters = await listSelectedFilters(db, report.report_id);
      const persistedSelectedSet = new Set(persistedSelectedFilters);
      const persistedSettingsByFilter = await listSelectedFilterSettings(db, report.report_id);
      return {
        ok: true,
        report: {
          report_id: report.report_id,
          route: report.route,
        },
        selected_filters: persistedSelectedFilters,
        available_filters: availableFilters.map((filter) => ({
          ...filter,
          selected: persistedSelectedSet.has(filter.filter_code),
          settings: persistedSettingsByFilter.get(filter.filter_code) ?? null,
        })),
      };
    });

    return NextResponse.json(payload);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    if (isPgPermissionError(error)) {
      return NextResponse.json(
        {
          error: "Database role lacks SELECT/INSERT/DELETE/UPDATE permission on meta.report_filters.",
        },
        { status: 403 }
      );
    }
    console.error("Report editor filters PUT error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
