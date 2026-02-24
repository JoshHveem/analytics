import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";
import { withSecureReport } from "@/lib/secure-report";
import { buildTableComponentQuery } from "@/lib/report-component-table";
import { type Queryable } from "@/lib/db";

type ReportFilterDefinition = {
  filterCode: string;
  sourceSchema: string | null;
  sourceTable: string | null;
  sourceColumn: string | null;
};

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

function parseBool(value: string | null): boolean {
  return value === "1" || value === "true";
}

function assertSafeIdentifier(value: string, kind: string): string {
  const cleaned = String(value ?? "").trim();
  if (!SAFE_IDENT.test(cleaned)) {
    throw new Error(`Invalid ${kind}: ${value}`);
  }
  return cleaned;
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function pluralMetaKey(filterCode: string): string {
  const code = String(filterCode ?? "").trim().toLowerCase();
  if (code === "academic_year") {
    return "years";
  }
  if (code.endsWith("_code")) {
    return `${code.replace(/_code$/, "")}s`;
  }
  if (code.endsWith("y")) {
    return `${code.slice(0, -1)}ies`;
  }
  return `${code}s`;
}

function buildAcademicYearOptions(): string[] {
  const currentYear = new Date().getFullYear();
  const options: string[] = [];
  for (let year = currentYear; year >= currentYear - 10; year -= 1) {
    options.push(String(year));
  }
  return options;
}

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
  if (!SAFE_IDENT.test(filterCode)) {
    throw new Error(`Invalid filter_code: ${filterCode}`);
  }
  return filterCode;
}

function parseFilterTableReference(table: string | null): { sourceSchema: string; sourceTable: string } | null {
  const raw = String(table ?? "").trim().toLowerCase();
  if (!raw) {
    return null;
  }

  const dotParts = raw.split(".").map((part) => part.trim()).filter(Boolean);
  if (dotParts.length === 2) {
    const sourceSchema = assertSafeIdentifier(dotParts[0], "filter source schema");
    const sourceTable = assertSafeIdentifier(dotParts[1], "filter source table");
    return { sourceSchema, sourceTable };
  }

  if (dotParts.length === 1) {
    return {
      sourceSchema: "ref",
      sourceTable: assertSafeIdentifier(dotParts[0], "filter source table"),
    };
  }

  throw new Error(`Invalid filter table reference "${table}"`);
}

async function inferRefSourceTableForColumn(
  db: Queryable,
  column: string
): Promise<{ sourceSchema: string; sourceTable: string } | null> {
  const safeColumn = assertSafeIdentifier(column, "filter source column");
  const { rows } = await db.query<{ table_schema: string; table_name: string }>(
    `
    SELECT table_schema, table_name
    FROM information_schema.columns
    WHERE table_schema = 'ref'
      AND column_name = $1
    ORDER BY
      CASE table_name
        WHEN 'programs' THEN 1
        WHEN 'courses' THEN 2
        WHEN 'users' THEN 3
        ELSE 100
      END,
      table_name
    LIMIT 1
    `,
    [safeColumn]
  );

  const match = rows[0];
  if (!match) {
    return null;
  }

  return {
    sourceSchema: assertSafeIdentifier(String(match.table_schema), "inferred source schema"),
    sourceTable: assertSafeIdentifier(String(match.table_name), "inferred source table"),
  };
}

async function tableHasColumn(db: Queryable, schema: string, table: string, column: string): Promise<boolean> {
  const { rows } = await db.query<{ found: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
        AND column_name = $3
    ) AS found
    `,
    [schema, table, column]
  );
  return Boolean(rows[0]?.found);
}

async function loadReportFilterDefinitions(db: Queryable, route: string): Promise<ReportFilterDefinition[]> {
  const { rows } = await db.query<{
    filter_code: string;
    type: string | null;
    table: string | null;
    column: string | null;
  }>(
    `
    SELECT
      rf.filter_code,
      COALESCE(rf.type, f.type, 'select') AS type,
      f."table" AS table,
      f."column" AS column
    FROM meta.reports r
    INNER JOIN meta.report_filters rf
      ON rf.report_id = r.id
    LEFT JOIN meta.filters f
      ON f.filter_code = rf.filter_code
    WHERE COALESCE(r.is_active, true) = true
      AND (trim(both '/' from r.route) = $1 OR r.id = $1)
    ORDER BY rf.filter_code
    `,
    [route]
  );

  const deduped = new Map<string, ReportFilterDefinition>();
  for (const row of rows) {
    const filterCode = normalizeFilterCode({
      filterCode: row.filter_code,
      filterType: row.type,
      column: row.column,
    });
    const columnCandidate = String(row.column ?? "").trim().toLowerCase();
    const sourceColumn = columnCandidate && SAFE_IDENT.test(columnCandidate) ? columnCandidate : filterCode;
    const tableRef = parseFilterTableReference(row.table);
    const inferredTableRef = tableRef ?? (await inferRefSourceTableForColumn(db, sourceColumn));
    const resolvedTableRef = tableRef ?? inferredTableRef;

    const existing = deduped.get(filterCode);
    if (existing) {
      if (!existing.sourceSchema && resolvedTableRef?.sourceSchema) {
        existing.sourceSchema = resolvedTableRef?.sourceSchema ?? null;
      }
      if (!existing.sourceTable && resolvedTableRef?.sourceTable) {
        existing.sourceTable = resolvedTableRef.sourceTable;
      }
      if (!existing.sourceColumn && sourceColumn) {
        existing.sourceColumn = sourceColumn;
      }
      continue;
    }

    deduped.set(filterCode, {
      filterCode,
      sourceSchema: resolvedTableRef?.sourceSchema ?? null,
      sourceTable: resolvedTableRef?.sourceTable ?? null,
      sourceColumn,
    });
  }

  return Array.from(deduped.values());
}

async function optionsForFilterDefinition(args: {
  db: Queryable;
  filter: ReportFilterDefinition;
  routeRef: string;
  searchParams: URLSearchParams;
  allFilterCodes: string[];
}): Promise<unknown[]> {
  const { db, filter, routeRef, searchParams, allFilterCodes } = args;
  if (!filter.sourceSchema || !filter.sourceTable || !filter.sourceColumn) {
    return [];
  }

  const schema = assertSafeIdentifier(filter.sourceSchema, "source schema");
  const table = assertSafeIdentifier(filter.sourceTable, "filter source table");
  const column = assertSafeIdentifier(filter.sourceColumn, "filter source column");

  if (!(await tableHasColumn(db, schema, table, column))) {
    return [];
  }

  const isUserSisFilter =
    schema === "ref" && table === "users" && column === "sis_user_id";
  if (isUserSisFilter) {
    const scopedSearch = new URLSearchParams();
    for (const filterCode of allFilterCodes) {
      const value = String(searchParams.get(filterCode) ?? "").trim();
      if (value) {
        scopedSearch.set(filterCode, value);
      }
    }

    const compiled = await buildTableComponentQuery({
      db,
      route: routeRef,
      searchParams: scopedSearch,
      filterParams: allFilterCodes,
      selectMode: "all_available",
    });

    const idAlias = compiled.selectedAliases.find((alias) => alias === "users.sis_user_id");
    if (!idAlias) {
      return [];
    }

    const firstNameAlias = compiled.selectedAliases.find((alias) => alias === "users.first_name");
    const lastNameAlias = compiled.selectedAliases.find((alias) => alias === "users.last_name");
    if (!firstNameAlias || !lastNameAlias) {
      return [];
    }

    const { rows } = await db.query<Record<string, unknown>>(
      `
      SELECT DISTINCT
        q.${quoteIdentifier(idAlias)} AS ${quoteIdentifier("sis_user_id")},
        q.${quoteIdentifier(firstNameAlias)} AS ${quoteIdentifier("first_name")},
        q.${quoteIdentifier(lastNameAlias)} AS ${quoteIdentifier("last_name")}
      FROM (${compiled.sql}) q
      WHERE q.${quoteIdentifier(idAlias)} IS NOT NULL
        AND q.${quoteIdentifier(firstNameAlias)} IS NOT NULL
        AND q.${quoteIdentifier(lastNameAlias)} IS NOT NULL
      ORDER BY q.${quoteIdentifier(idAlias)}
      `,
      compiled.values
    );

    return rows
      .map((row) => {
        const sisUserId = String(row.sis_user_id ?? "").trim();
        if (!sisUserId) {
          return null;
        }
        const first = String(row.first_name ?? "").trim();
        const last = String(row.last_name ?? "").trim();
        if (!first || !last) {
          return null;
        }
        return {
          sis_user_id: sisUserId,
          label: `${first} ${last}`,
        };
      })
      .filter((row): row is { sis_user_id: string; label: string } => row !== null);
  }

  const nameColumn = column.endsWith("_code") ? column.replace(/_code$/, "_name") : "";
  const hasNameColumn = nameColumn ? await tableHasColumn(db, schema, table, nameColumn) : false;
  if (hasNameColumn) {
    const { rows } = await db.query<Record<string, unknown>>(
      `
      SELECT DISTINCT
        t.${quoteIdentifier(column)} AS ${quoteIdentifier(column)},
        t.${quoteIdentifier(nameColumn)} AS ${quoteIdentifier(nameColumn)}
      FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)} t
      WHERE t.${quoteIdentifier(column)} IS NOT NULL
      ORDER BY t.${quoteIdentifier(nameColumn)}, t.${quoteIdentifier(column)}
      `
    );

    return rows
      .map((row) => ({
        [column]: String(row[column] ?? "").trim(),
        [nameColumn]: String(row[nameColumn] ?? row[column] ?? "").trim(),
      }))
      .filter((row) => row[column].length > 0);
  }

  const { rows } = await db.query<{ value: unknown }>(
    `
    SELECT DISTINCT
      t.${quoteIdentifier(column)} AS value
    FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)} t
    WHERE t.${quoteIdentifier(column)} IS NOT NULL
    ORDER BY value
    `
  );

  return rows
    .map((row) => String(row.value ?? "").trim())
    .filter((value) => value.length > 0);
}

async function buildFilterMetaFromReportFilters(args: {
  db: Queryable;
  routeRef: string;
  searchParams: URLSearchParams;
  filters: ReportFilterDefinition[];
}) {
  const { db, routeRef, searchParams, filters } = args;
  const selected: Record<string, string | null> = {};
  const allFilterCodes = filters.map((filter) => filter.filterCode);
  for (const filter of filters) {
    selected[filter.filterCode] = String(searchParams.get(filter.filterCode) ?? "").trim() || null;
  }
  const filterMeta: Record<string, unknown> = { selected };

  for (const filter of filters) {
    const options =
      filter.filterCode === "academic_year"
        ? buildAcademicYearOptions()
        : await optionsForFilterDefinition({
            db,
            filter,
            routeRef,
            searchParams,
            allFilterCodes,
          });

    const filterCodeKey = filter.filterCode.trim().toLowerCase();
    const pluralKey = pluralMetaKey(filter.filterCode);
    filterMeta[filterCodeKey] = options;
    filterMeta[pluralKey] = options;
  }

  return filterMeta;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const route = String(url.searchParams.get("route") ?? "").trim().replace(/^\/+|\/+$/g, "");
    const componentCode = String(url.searchParams.get("component_code") ?? "").trim() || undefined;
    const includeMeta = parseBool(url.searchParams.get("include_meta"));
    const includeRows = parseBool(url.searchParams.get("include_rows"));
    const allColumns = parseBool(url.searchParams.get("all_columns"));

    if (!route) {
      throw new HttpError(400, { error: "Missing required query parameter: route" });
    }

    const payload = await withSecureReport(
      request,
      route,
      async ({ db, user, anonymizeRows, meta }) => {
        const normalizedSearch = new URLSearchParams(url.searchParams.toString());
        const reportFilters = await loadReportFilterDefinitions(db, route);
        if (allColumns && !user.is_admin) {
          throw new HttpError(403, { error: "Forbidden" });
        }
        const compiled = await buildTableComponentQuery({
          db,
          route,
          searchParams: normalizedSearch,
          componentCode,
          filterParams: reportFilters.map((f) => f.filterCode),
          selectMode: allColumns ? "all_available" : "spec",
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
                ...(await buildFilterMetaFromReportFilters({
                  db,
                  routeRef: route,
                  searchParams: normalizedSearch,
                  filters: reportFilters,
                })),
                ...meta,
                report_id: compiled.reportId,
                report_component_id: compiled.reportComponentId,
                component_code: compiled.componentCode,
                component_name: compiled.componentName,
                component_description: compiled.componentDescription,
                source_schema: compiled.sourceSchema,
                report_component_settings: compiled.reportSettings,
                component_settings: compiled.resolvedSettings,
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
