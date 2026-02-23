import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";
import { withAuthedDb } from "@/lib/authed-db";
import { type Queryable } from "@/lib/db";

type ReportFilterDefinition = {
  filterCode: string;
  sourceSchema: string | null;
  sourceTable: string | null;
  sourceColumn: string | null;
};

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

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

function splitFilterValues(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
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

async function loadReportFilterDefinitionsById(
  db: Queryable,
  reportId: string
): Promise<ReportFilterDefinition[]> {
  const reportExists = await db.query<{ found: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM meta.reports
      WHERE id = $1
        AND COALESCE(is_active, true) = true
    ) AS found
    `,
    [reportId]
  );

  if (!reportExists.rows[0]?.found) {
    throw new HttpError(404, { error: "Report not found" });
  }

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
    FROM meta.report_filters rf
    LEFT JOIN meta.filters f
      ON f.filter_code = rf.filter_code
    WHERE rf.report_id = $1
    ORDER BY rf.filter_code
    `,
    [reportId]
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
        existing.sourceSchema = resolvedTableRef.sourceSchema;
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
  selected: Record<string, string | null>;
}): Promise<unknown[]> {
  const { db, filter, selected } = args;
  if (!filter.sourceSchema || !filter.sourceTable || !filter.sourceColumn) {
    return [];
  }

  const schema = assertSafeIdentifier(filter.sourceSchema, "source schema");
  const table = assertSafeIdentifier(filter.sourceTable, "filter source table");
  const column = assertSafeIdentifier(filter.sourceColumn, "filter source column");
  if (!(await tableHasColumn(db, schema, table, column))) {
    return [];
  }

  const whereClauses: string[] = [`t.${quoteIdentifier(column)} IS NOT NULL`];
  const values: string[] = [];
  const selectedAcademicYearValues = splitFilterValues(selected.academic_year);
  const supportsAcademicYear = await tableHasColumn(db, schema, table, "academic_year");
  if (selectedAcademicYearValues.length > 0 && supportsAcademicYear && filter.filterCode !== "academic_year") {
    if (selectedAcademicYearValues.length === 1) {
      values.push(selectedAcademicYearValues[0]);
      whereClauses.push(`t.${quoteIdentifier("academic_year")} = $${values.length}`);
    } else {
      const placeholders: string[] = [];
      for (const year of selectedAcademicYearValues) {
        values.push(year);
        placeholders.push(`$${values.length}`);
      }
      whereClauses.push(`t.${quoteIdentifier("academic_year")} IN (${placeholders.join(", ")})`);
    }
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
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY t.${quoteIdentifier(nameColumn)}, t.${quoteIdentifier(column)}
      `,
      values
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
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY value
    `,
    values
  );

  return rows
    .map((row) => String(row.value ?? "").trim())
    .filter((value) => value.length > 0);
}

async function buildFilterMeta(args: {
  db: Queryable;
  searchParams: URLSearchParams;
  filters: ReportFilterDefinition[];
}): Promise<Record<string, unknown>> {
  const { db, searchParams, filters } = args;
  const selected: Record<string, string | null> = {};
  for (const filter of filters) {
    selected[filter.filterCode] = String(searchParams.get(filter.filterCode) ?? "").trim() || null;
  }
  const meta: Record<string, unknown> = { selected };

  for (const filter of filters) {
    const options =
      filter.filterCode === "academic_year"
        ? buildAcademicYearOptions()
        : await optionsForFilterDefinition({ db, filter, selected });
    const filterCodeKey = filter.filterCode.trim().toLowerCase();
    const pluralKey = pluralMetaKey(filter.filterCode);
    meta[filterCodeKey] = options;
    meta[pluralKey] = options;
  }

  return meta;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const reportId = String(url.searchParams.get("report_id") ?? "").trim();
    if (!reportId) {
      throw new HttpError(400, { error: "Missing required query parameter: report_id" });
    }

    const payload = await withAuthedDb(async ({ db }) => {
      const filters = await loadReportFilterDefinitionsById(db, reportId);
      const meta = await buildFilterMeta({
        db,
        searchParams: url.searchParams,
        filters,
      });
      return {
        ok: true,
        meta,
      };
    });

    return NextResponse.json(payload);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    console.error("Report filter-meta error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
