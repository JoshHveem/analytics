import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";
import { withSecureReport } from "@/lib/secure-report";
import { type Queryable } from "@/lib/db";

const LINK_FIELDS = [
  "sis_user_id",
  "course_code",
  "program_code",
  "department_code",
  "academic_year",
  "campus_code",
] as const;

const TARGET_SCHEMAS = ["dataset"] as const;

type TableSummaryRow = {
  table_schema: string;
  table_name: string;
  qualified_table: string;
  all_columns: string[];
  shared_fields: string[];
  shared_field_count: number;
};

type TableRelationshipRow = {
  table_a: string;
  table_b: string;
  shared_fields: string[];
  shared_field_count: number;
};

function parseBool(value: string | null): boolean {
  return value === "1" || value === "true";
}

async function getTableSummaries(db: Queryable): Promise<TableSummaryRow[]> {
  const { rows } = await db.query<{
    table_schema: string;
    table_name: string;
    qualified_table: string;
    all_columns: string[] | null;
    shared_fields: string[] | null;
  }>(
    `
    WITH target_schemas AS (
      SELECT unnest($1::text[]) AS schema_name
    ),
    target_fields AS (
      SELECT unnest($2::text[]) AS field_name
    ),
    target_tables AS (
      SELECT t.table_schema, t.table_name
      FROM information_schema.tables t
      INNER JOIN target_schemas ts
        ON ts.schema_name = t.table_schema
      WHERE t.table_type = 'BASE TABLE'
    ),
    table_columns AS (
      SELECT
        c.table_schema,
        c.table_name,
        c.column_name::text AS column_name,
        c.ordinal_position
      FROM information_schema.columns c
      INNER JOIN target_tables tt
        ON tt.table_schema = c.table_schema
       AND tt.table_name = c.table_name
    ),
    shared_columns AS (
      SELECT
        tc.table_schema,
        tc.table_name,
        tc.column_name AS field_name
      FROM table_columns tc
      INNER JOIN target_fields tf
        ON tf.field_name = tc.column_name
    )
    SELECT
      tt.table_schema,
      tt.table_name,
      (tt.table_schema || '.' || tt.table_name) AS qualified_table,
      (
        SELECT COALESCE(
          array_agg(tc2.column_name ORDER BY tc2.ordinal_position),
          ARRAY[]::text[]
        )
        FROM table_columns tc2
        WHERE tc2.table_schema = tt.table_schema
          AND tc2.table_name = tt.table_name
      ) AS all_columns,
      (
        SELECT COALESCE(
          array_agg(sc2.field_name ORDER BY array_position($2::text[], sc2.field_name)),
          ARRAY[]::text[]
        )
        FROM shared_columns sc2
        WHERE sc2.table_schema = tt.table_schema
          AND sc2.table_name = tt.table_name
      ) AS shared_fields
    FROM target_tables tt
    ORDER BY tt.table_schema, tt.table_name
    `,
    [TARGET_SCHEMAS, LINK_FIELDS]
  );

  return rows.map((row) => {
    const allColumns = Array.isArray(row.all_columns) ? row.all_columns : [];
    const sharedFields = Array.isArray(row.shared_fields) ? row.shared_fields : [];
    return {
      table_schema: String(row.table_schema),
      table_name: String(row.table_name),
      qualified_table: String(row.qualified_table),
      all_columns: allColumns,
      shared_fields: sharedFields,
      shared_field_count: sharedFields.length,
    };
  });
}

async function getRelationships(db: Queryable): Promise<TableRelationshipRow[]> {
  const { rows } = await db.query<{
    table_a: string;
    table_b: string;
    shared_fields: string[];
  }>(
    `
    WITH target_schemas AS (
      SELECT unnest($1::text[]) AS schema_name
    ),
    target_fields AS (
      SELECT unnest($2::text[]) AS field_name
    ),
    target_tables AS (
      SELECT t.table_schema, t.table_name
      FROM information_schema.tables t
      INNER JOIN target_schemas ts
        ON ts.schema_name = t.table_schema
      WHERE t.table_type = 'BASE TABLE'
    ),
    table_fields AS (
      SELECT
        c.table_schema,
        c.table_name,
        (c.table_schema || '.' || c.table_name) AS qualified_table,
        c.column_name::text AS field_name
      FROM information_schema.columns c
      INNER JOIN target_tables tt
        ON tt.table_schema = c.table_schema
       AND tt.table_name = c.table_name
      INNER JOIN target_fields tf
        ON tf.field_name = c.column_name::text
    ),
    pair_shared_fields AS (
      SELECT
        left_table.qualified_table AS table_a,
        right_table.qualified_table AS table_b,
        left_table.field_name
      FROM table_fields left_table
      INNER JOIN table_fields right_table
        ON right_table.field_name = left_table.field_name
       AND right_table.qualified_table > left_table.qualified_table
    )
    SELECT
      table_a,
      table_b,
      array_agg(field_name ORDER BY array_position($2::text[], field_name)) AS shared_fields
    FROM pair_shared_fields
    GROUP BY table_a, table_b
    ORDER BY COUNT(*) DESC, table_a, table_b
    `,
    [TARGET_SCHEMAS, LINK_FIELDS]
  );

  return rows.map((row) => {
    const sharedFields = Array.isArray(row.shared_fields) ? row.shared_fields : [];
    return {
      table_a: String(row.table_a),
      table_b: String(row.table_b),
      shared_fields: sharedFields,
      shared_field_count: sharedFields.length,
    };
  });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const includeMeta = parseBool(url.searchParams.get("include_meta"));
    const includeRows = parseBool(url.searchParams.get("include_rows"));

    const payload = await withSecureReport(
      request,
      "public-table-relationships",
      async ({ db }) => {
        const tables = await getTableSummaries(db);
        const relationships = await getRelationships(db);

        return {
          ok: true,
          count: includeRows ? relationships.length : 0,
          data: includeRows ? relationships : [],
          meta: includeMeta
            ? {
                key_fields: LINK_FIELDS,
                schemas: TARGET_SCHEMAS,
                table_count: tables.length,
                relationship_count: relationships.length,
                tables,
              }
            : undefined,
        };
      }
    );

    return NextResponse.json(payload);
  } catch (e: unknown) {
    if (e instanceof HttpError) {
      return NextResponse.json(e.payload, { status: e.status });
    }
    console.error("Public table relationships report error:", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
