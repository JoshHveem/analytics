import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";
import { withAuthedDb } from "@/lib/authed-db";
import { type Queryable } from "@/lib/db";

type JsonObject = Record<string, unknown>;

type ReportRecord = {
  report_id: string;
  title: string;
  route: string;
};

type ReportComponentRow = {
  report_component_id: string;
  component_code: string;
  component_name: string | null;
  component_description: string | null;
  component_order: number;
  settings: unknown;
  spec: unknown;
};

type AvailableComponentRow = {
  component_code: string;
  name: string | null;
  description: string | null;
  component_settings: unknown;
  spec: unknown;
};

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;
const SAFE_COMPONENT_CODE = /^[a-z0-9_-]+$/;
const DEFAULT_SOURCE_SCHEMA = "dataset";

function isObjectRecord(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(raw: unknown): JsonObject {
  if (!raw || !isObjectRecord(raw)) {
    return {};
  }
  return raw;
}

function assertSafeIdentifier(value: string, kind: string): string {
  const cleaned = String(value ?? "").trim().toLowerCase();
  if (!SAFE_IDENT.test(cleaned)) {
    throw new HttpError(400, { error: `Invalid ${kind}: ${value}` });
  }
  return cleaned;
}

function assertSafeComponentCode(value: string): string {
  const cleaned = String(value ?? "").trim().toLowerCase();
  if (!SAFE_COMPONENT_CODE.test(cleaned)) {
    throw new HttpError(400, { error: `Invalid component_code: ${value}` });
  }
  return cleaned;
}

function parseOrderFromSettings(raw: unknown): number | null {
  const settings = parseJsonObject(raw);
  const value = settings.component_order;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
}

function isValidTableSpec(raw: unknown): boolean {
  const spec = parseJsonObject(raw);
  const sources = Array.isArray(spec.sources) ? spec.sources : [];
  const select = Array.isArray(spec.select) ? spec.select : [];
  if (sources.length === 0 || select.length === 0) {
    return false;
  }
  const baseCount = sources.filter((item) => isObjectRecord(item) && item.is_base === true).length;
  return baseCount === 1;
}

function sanitizeSpecStructure(raw: unknown): JsonObject {
  const spec = parseJsonObject(raw);
  const sources = Array.isArray(spec.sources) ? spec.sources : [];
  const joins = Array.isArray(spec.joins) ? spec.joins : [];
  const select = Array.isArray(spec.select) ? spec.select : [];
  return {
    sources,
    ...(joins.length > 0 ? { joins } : {}),
    select,
  };
}

function isPgPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return String((error as { code?: unknown }).code ?? "") === "42501";
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
      r.title,
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

async function getComponentsSettingsColumn(db: Queryable): Promise<"default_settings" | "settings"> {
  const { rows } = await db.query<{ column_name: string }>(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'meta'
      AND table_name = 'components'
      AND column_name IN ('default_settings', 'settings')
    `
  );
  const names = new Set(rows.map((row) => String(row.column_name)));
  if (names.has("default_settings")) {
    return "default_settings";
  }
  if (names.has("settings")) {
    return "settings";
  }
  throw new HttpError(500, { error: 'meta.components missing "default_settings" (or legacy "settings")' });
}

async function getReportComponentRows(db: Queryable, reportId: string): Promise<ReportComponentRow[]> {
  const { rows } = await db.query<ReportComponentRow>(
    `
    SELECT
      rc.id AS report_component_id,
      rc.component_code,
      c.name AS component_name,
      c.description AS component_description,
      COALESCE(
        CASE
          WHEN (rc.settings->>'component_order') ~ '^-?\\d+$'
          THEN (rc.settings->>'component_order')::int
          ELSE NULL
        END,
        100000
      ) AS component_order,
      rc.settings,
      rc.spec
    FROM meta.report_components rc
    LEFT JOIN meta.components c
      ON c.component_code = rc.component_code
     AND COALESCE(c.is_active, true) = true
    WHERE rc.report_id = $1
      AND COALESCE(rc.is_active, true) = true
    ORDER BY component_order ASC, rc.component_code ASC, rc.id ASC
    `,
    [reportId]
  );
  return rows;
}

async function getAvailableComponents(
  db: Queryable
): Promise<Array<Pick<AvailableComponentRow, "component_code" | "name" | "description">>> {
  const { rows } = await db.query<Pick<AvailableComponentRow, "component_code" | "name" | "description">>(
    `
    SELECT component_code, name, description
    FROM meta.components
    WHERE COALESCE(is_active, true) = true
    ORDER BY component_code ASC
    `
  );
  return rows.map((row) => ({
    component_code: String(row.component_code),
    name: row.name ?? null,
    description: row.description ?? null,
  }));
}

async function getFirstTableColumn(
  db: Queryable,
  schema: string,
  table: string
): Promise<string | null> {
  const { rows } = await db.query<{ column_name: string }>(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name = $2
    ORDER BY ordinal_position
    LIMIT 1
    `,
    [schema, table]
  );
  return rows[0]?.column_name ? String(rows[0].column_name) : null;
}

async function getNextComponentOrder(db: Queryable, reportId: string): Promise<number> {
  const { rows } = await db.query<{ max_order: number }>(
    `
    SELECT COALESCE(MAX(
      CASE
        WHEN (settings->>'component_order') ~ '^-?\\d+$'
        THEN (settings->>'component_order')::int
        ELSE 0
      END
    ), 0) AS max_order
    FROM meta.report_components
    WHERE report_id = $1
      AND COALESCE(is_active, true) = true
    `,
    [reportId]
  );
  const maxOrder = Number(rows[0]?.max_order ?? 0);
  return Number.isFinite(maxOrder) ? maxOrder + 1 : 1;
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
      const components = await getReportComponentRows(db, report.report_id);
      const availableComponents = await getAvailableComponents(db);

      return {
        ok: true,
        report: {
          report_id: report.report_id,
          title: report.title,
          route: report.route,
        },
        components: components.map((row) => ({
          report_component_id: String(row.report_component_id),
          component_code: String(row.component_code),
          component_name: row.component_name ?? null,
          component_description: row.component_description ?? null,
          component_order: parseOrderFromSettings(row.settings) ?? Number(row.component_order ?? 100000),
          settings: parseJsonObject(row.settings),
          spec: parseJsonObject(row.spec),
        })),
        available_components: availableComponents,
      };
    });

    return NextResponse.json(payload);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    console.error("Report editor GET error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      report_id?: unknown;
      component_code?: unknown;
      base_dataset_key?: unknown;
      source_schema?: unknown;
    };

    const reportRef = String(body.report_id ?? "").trim();
    const componentCode = assertSafeComponentCode(String(body.component_code ?? ""));
    const baseDatasetKeyRaw = String(body.base_dataset_key ?? "").trim();
    const sourceSchemaRaw = String(body.source_schema ?? "").trim();
    const baseDatasetKey = baseDatasetKeyRaw ? assertSafeIdentifier(baseDatasetKeyRaw, "base_dataset_key") : null;
    const sourceSchema = sourceSchemaRaw ? assertSafeIdentifier(sourceSchemaRaw, "source_schema") : null;

    const payload = await withAuthedDb(async ({ db, user }) => {
      if (!user.is_admin) {
        throw new HttpError(403, { error: "Forbidden" });
      }

      const report = await resolveReport(db, reportRef);
      const settingsColumn = await getComponentsSettingsColumn(db);
      const nextOrder = await getNextComponentOrder(db, report.report_id);

      const { rows } = await db.query<AvailableComponentRow>(
        `
        SELECT component_code, name, description, ${settingsColumn} AS component_settings, spec
        FROM meta.components
        WHERE component_code = $1
          AND COALESCE(is_active, true) = true
        LIMIT 1
        `,
        [componentCode]
      );
      const template = rows[0];
      if (!template) {
        throw new HttpError(404, { error: `Component "${componentCode}" not found` });
      }

      const templateSettings = parseJsonObject(template.component_settings);
      const nextSettings: JsonObject = {
        ...templateSettings,
        component_order: nextOrder,
      };

      let nextSpec = sanitizeSpecStructure(template.spec);

      if (componentCode === "table" && !isValidTableSpec(nextSpec)) {
        if (!baseDatasetKey) {
          throw new HttpError(400, {
            error:
              'Table component template has no usable spec. Provide "base_dataset_key" when creating.',
          });
        }
        const baseSchema = sourceSchema ?? DEFAULT_SOURCE_SCHEMA;
        const firstColumn = await getFirstTableColumn(db, baseSchema, baseDatasetKey);
        if (!firstColumn) {
          throw new HttpError(400, {
            error: `Unable to infer initial select column for ${baseSchema}.${baseDatasetKey}`,
          });
        }
        nextSpec = {
          sources: [
            {
              dataset_key: baseDatasetKey,
              is_base: true,
              ...(sourceSchema ? { source_schema: sourceSchema } : {}),
            },
          ],
          select: [
            {
              dataset_key: baseDatasetKey,
              column: firstColumn,
            },
          ],
        };
      }

      if (componentCode === "table" && sourceSchema) {
        nextSettings.source_schema = sourceSchema;
      }

      const insertResult = await db.query<{ id: string }>(
        `
        INSERT INTO meta.report_components (report_id, component_code, settings, spec, is_active)
        VALUES ($1, $2, $3::jsonb, $4::jsonb, true)
        RETURNING id
        `,
        [report.report_id, componentCode, JSON.stringify(nextSettings), JSON.stringify(nextSpec)]
      );

      const createdId = String(insertResult.rows[0]?.id ?? "").trim();
      if (!createdId) {
        throw new HttpError(500, { error: "Failed to create report component" });
      }

      const components = await getReportComponentRows(db, report.report_id);
      return {
        ok: true,
        created_report_component_id: createdId,
        components: components.map((row) => ({
          report_component_id: String(row.report_component_id),
          component_code: String(row.component_code),
          component_name: row.component_name ?? null,
          component_description: row.component_description ?? null,
          component_order: parseOrderFromSettings(row.settings) ?? Number(row.component_order ?? 100000),
          settings: parseJsonObject(row.settings),
          spec: parseJsonObject(row.spec),
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
          error:
            "Database role lacks INSERT/UPDATE permission on meta.report_components.",
        },
        { status: 403 }
      );
    }
    console.error("Report editor POST error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      report_id?: unknown;
      component_ids?: unknown;
    };
    const reportRef = String(body.report_id ?? "").trim();
    if (!Array.isArray(body.component_ids)) {
      throw new HttpError(400, { error: "component_ids must be an array" });
    }

    const componentIds = body.component_ids
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0);
    if (componentIds.length === 0) {
      throw new HttpError(400, { error: "component_ids cannot be empty" });
    }
    if (new Set(componentIds).size !== componentIds.length) {
      throw new HttpError(400, { error: "component_ids contains duplicates" });
    }

    const payload = await withAuthedDb(async ({ db, user }) => {
      if (!user.is_admin) {
        throw new HttpError(403, { error: "Forbidden" });
      }

      const report = await resolveReport(db, reportRef);
      const existingRows = await getReportComponentRows(db, report.report_id);
      const existingIds = existingRows.map((row) => String(row.report_component_id));
      if (existingIds.length !== componentIds.length) {
        throw new HttpError(400, { error: "component_ids must include all active components for this report" });
      }
      const existingIdSet = new Set(existingIds);
      for (const componentId of componentIds) {
        if (!existingIdSet.has(componentId)) {
          throw new HttpError(400, { error: `Unknown component id in list: ${componentId}` });
        }
      }

      for (let index = 0; index < componentIds.length; index += 1) {
        await db.query(
          `
          UPDATE meta.report_components
          SET settings = jsonb_set(
            COALESCE(settings, '{}'::jsonb),
            '{component_order}',
            to_jsonb($1::int),
            true
          )
          WHERE report_id = $2
            AND id = $3
            AND COALESCE(is_active, true) = true
          `,
          [index + 1, report.report_id, componentIds[index]]
        );
      }

      const components = await getReportComponentRows(db, report.report_id);
      return {
        ok: true,
        components: components.map((row) => ({
          report_component_id: String(row.report_component_id),
          component_code: String(row.component_code),
          component_name: row.component_name ?? null,
          component_description: row.component_description ?? null,
          component_order: parseOrderFromSettings(row.settings) ?? Number(row.component_order ?? 100000),
          settings: parseJsonObject(row.settings),
          spec: parseJsonObject(row.spec),
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
          error:
            "Database role lacks UPDATE permission on meta.report_components.settings.",
        },
        { status: 403 }
      );
    }
    console.error("Report editor PATCH error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
