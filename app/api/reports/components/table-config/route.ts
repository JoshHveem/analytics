import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";
import { withAuthedDb } from "@/lib/authed-db";
import { BASE_APP_COLOR_KEYS } from "@/lib/color-palette";
import { type Queryable } from "@/lib/db";

type JsonObject = Record<string, unknown>;

type ComponentSourceSpec = {
  dataset_key: string;
  is_base: boolean;
  source_schema?: string;
};

type ComponentJoinSpec = {
  dataset_key: string;
  type: "left" | "inner";
  on: string[];
};

type ComponentSelectSpec = {
  dataset_key: string;
  column: string;
  as?: string;
};

type ComponentOrderSpec = {
  dataset_key: string;
  column: string;
  direction?: "asc" | "desc";
};

type ComponentSpec = {
  sources: ComponentSourceSpec[];
  joins?: ComponentJoinSpec[];
  select: ComponentSelectSpec[];
};

type ResolvedComponent = {
  reportId: string;
  reportComponentId: string;
  route: string;
  componentCode: string;
  settings: JsonObject;
  legacySourceSchema?: string;
  legacyOrderBy?: ComponentOrderSpec[];
  spec: ComponentSpec;
};

type AvailableColumn = {
  key: string;
  dataset_key: string;
  column: string;
  source_schema: string;
  selected: boolean;
};

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;
const DEFAULT_SOURCE_SCHEMA = "dataset";
const PILL_ALLOWED_COLORS = new Set([
  ...BASE_APP_COLOR_KEYS,
  "neutral",
  "success",
  "warning",
  "danger",
  "info",
]);
const BAR_ALLOWED_COLORS = new Set<string>([...BASE_APP_COLOR_KEYS]);

const AUTO_HYDRATION_JOINS: Array<{
  datasetKey: string;
  sourceSchema: string;
  requiredKeys: string[];
}> = [
  {
    datasetKey: "users",
    sourceSchema: "ref",
    requiredKeys: ["sis_user_id"],
  },
  {
    datasetKey: "programs",
    sourceSchema: "ref",
    requiredKeys: ["program_code", "academic_year"],
  },
  {
    datasetKey: "courses",
    sourceSchema: "ref",
    requiredKeys: ["course_code", "academic_year"],
  },
];

function assertSafeIdentifier(value: string, kind: string): string {
  const cleaned = String(value ?? "").trim();
  if (!SAFE_IDENT.test(cleaned)) {
    throw new HttpError(400, { error: `Invalid ${kind}: ${value}` });
  }
  return cleaned;
}

function isObjectRecord(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(raw: unknown, kind: string): JsonObject {
  if (raw === null || raw === undefined) {
    return {};
  }
  if (!isObjectRecord(raw)) {
    throw new HttpError(400, { error: `${kind} must be a JSON object` });
  }
  return raw;
}

function parseSources(raw: unknown): ComponentSourceSpec[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpError(400, { error: "Component spec requires non-empty sources[]" });
  }

  const parsed = raw
    .filter((item): item is JsonObject => isObjectRecord(item))
    .map((item) => ({
      dataset_key: assertSafeIdentifier(String(item.dataset_key ?? ""), "spec.sources[].dataset_key"),
      is_base: item.is_base === true,
      source_schema:
        typeof item.source_schema === "string" && item.source_schema.trim().length > 0
          ? assertSafeIdentifier(item.source_schema, "spec.sources[].source_schema")
          : (typeof item.schema === "string" && item.schema.trim().length > 0
              ? assertSafeIdentifier(item.schema, "spec.sources[].schema")
              : undefined),
    }));

  if (parsed.length !== raw.length) {
    throw new HttpError(400, { error: "Each spec.sources[] entry must be an object" });
  }
  return parsed;
}

function parseJoins(raw: unknown): ComponentJoinSpec[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  if (raw.length === 0) {
    return [];
  }

  const parsed = raw
    .filter((item): item is JsonObject => isObjectRecord(item))
    .map((item) => {
      const type = String(item.type ?? "").trim().toLowerCase();
      const joinType: ComponentJoinSpec["type"] = type === "inner" ? "inner" : "left";
      const on = Array.isArray(item.on)
        ? item.on.map((key) => assertSafeIdentifier(String(key ?? ""), "spec.joins[].on[]"))
        : [];
      if (on.length === 0) {
        throw new HttpError(400, { error: "Each spec.joins[] entry must include at least one key in on[]" });
      }
      return {
        dataset_key: assertSafeIdentifier(String(item.dataset_key ?? ""), "spec.joins[].dataset_key"),
        type: joinType,
        on,
      };
    });

  if (parsed.length !== raw.length) {
    throw new HttpError(400, { error: "Each spec.joins[] entry must be an object" });
  }
  return parsed;
}

function parseOrderBy(raw: unknown): ComponentOrderSpec[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  if (raw.length === 0) {
    return [];
  }

  const parsed = raw
    .filter((item): item is JsonObject => isObjectRecord(item))
    .map((item) => {
      const direction: ComponentOrderSpec["direction"] =
        String(item.direction ?? "").trim().toLowerCase() === "desc" ? "desc" : "asc";
      return {
        dataset_key: assertSafeIdentifier(String(item.dataset_key ?? ""), "order_by[].dataset_key"),
        column: assertSafeIdentifier(String(item.column ?? ""), "order_by[].column"),
        direction,
      };
    });

  if (parsed.length !== raw.length) {
    throw new HttpError(400, { error: "Each order_by[] entry must be an object" });
  }
  return parsed;
}

function parseSpec(raw: unknown): ComponentSpec {
  if (!isObjectRecord(raw)) {
    throw new HttpError(400, { error: "Component spec must be an object" });
  }

  const select = Array.isArray(raw.select) ? (raw.select as ComponentSelectSpec[]) : [];
  const normalizedSelect = select.map((item) => ({
    dataset_key: assertSafeIdentifier(String(item.dataset_key ?? ""), "spec.select[].dataset_key"),
    column: assertSafeIdentifier(String(item.column ?? ""), "spec.select[].column"),
    as:
      typeof item.as === "string" && item.as.trim().length > 0
        ? assertSafeIdentifier(item.as, "spec.select[].as")
        : undefined,
  }));

  return {
    sources: parseSources(raw.sources),
    joins: parseJoins(raw.joins),
    select: normalizedSelect,
  };
}

function resolveBaseDatasetKey(sources: ComponentSourceSpec[]): string {
  const bases = sources.filter((source) => source.is_base);
  if (bases.length !== 1) {
    throw new HttpError(400, { error: "Component spec must have exactly one sources[] entry with is_base=true" });
  }
  return bases[0].dataset_key;
}

function readStringSetting(settings: JsonObject, key: string): string | undefined {
  const value = settings[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function resolveSourceSchema(settings: JsonObject, legacySourceSchema?: string): string {
  const candidate =
    readStringSetting(settings, "source_schema") ??
    readStringSetting(settings, "dataset_schema") ??
    legacySourceSchema ??
    DEFAULT_SOURCE_SCHEMA;
  return assertSafeIdentifier(candidate, "source schema");
}

function buildSourceSchemaMap(args: {
  sources: ComponentSourceSpec[];
  defaultSourceSchema: string;
}): Map<string, string> {
  const byDataset = new Map<string, string>();
  for (const source of args.sources) {
    const sourceSchema = source.source_schema ?? args.defaultSourceSchema;
    const existing = byDataset.get(source.dataset_key);
    if (existing && existing !== sourceSchema) {
      throw new HttpError(400, {
        error: `Conflicting source schema for dataset "${source.dataset_key}": "${existing}" vs "${sourceSchema}"`,
      });
    }
    byDataset.set(source.dataset_key, sourceSchema);
  }
  return byDataset;
}

async function getAllowedJoinKeys(db: Queryable): Promise<Set<string>> {
  const hasIsActiveColumn = await db
    .query<{ found: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'meta'
          AND table_name = 'allowed_join_keys'
          AND column_name = 'is_active'
      ) AS found
      `
    )
    .then((result) => Boolean(result.rows[0]?.found));

  const { rows } = await db.query<{ key_name: string }>(
    hasIsActiveColumn
      ? `
        SELECT key_name
        FROM meta.allowed_join_keys
        WHERE is_active = true
        `
      : `
        SELECT key_name
        FROM meta.allowed_join_keys
        `
  );

  return new Set(rows.map((row) => String(row.key_name)));
}

async function getTableColumns(db: Queryable, schema: string, table: string): Promise<Set<string>> {
  const { rows } = await db.query<{ column_name: string }>(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name = $2
    ORDER BY ordinal_position
    `,
    [schema, table]
  );
  return new Set(rows.map((row) => String(row.column_name)));
}

async function resolveReportComponent(args: {
  db: Queryable;
  reportId: string;
  reportComponentId: string;
}): Promise<ResolvedComponent> {
  const { rows } = await args.db.query<{
    report_id: string;
    report_component_id: string;
    route: string;
    component_code: string;
    settings: unknown;
    spec: unknown;
  }>(
    `
    SELECT
      r.id AS report_id,
      rc.id AS report_component_id,
      trim(both '/' from r.route) AS route,
      rc.component_code,
      rc.settings,
      rc.spec
    FROM meta.reports r
    INNER JOIN meta.report_components rc
      ON rc.report_id = r.id
     AND COALESCE(rc.is_active, true) = true
    WHERE COALESCE(r.is_active, true) = true
      AND COALESCE(rc.is_active, true) = true
      AND (r.id = $1 OR trim(both '/' from r.route) = $1)
      AND rc.id = $2
    LIMIT 1
    `,
    [args.reportId, args.reportComponentId]
  );

  const row = rows[0];
  if (!row) {
    throw new HttpError(404, { error: "Report component not found" });
  }
  const specObject = parseJsonObject(row.spec, "report component spec");

  return {
    reportId: String(row.report_id),
    reportComponentId: String(row.report_component_id),
    route: String(row.route),
    componentCode: String(row.component_code),
    settings: parseJsonObject(row.settings, "report component settings"),
    legacySourceSchema: readStringSetting(specObject, "source_schema"),
    legacyOrderBy: parseOrderBy(specObject.order_by),
    spec: parseSpec(specObject),
  };
}

async function buildAvailableColumns(args: {
  db: Queryable;
  spec: ComponentSpec;
  settings: JsonObject;
  legacySourceSchema?: string;
}): Promise<AvailableColumn[]> {
  const { db, spec, settings, legacySourceSchema } = args;
  const baseDataset = resolveBaseDatasetKey(spec.sources);
  const defaultSourceSchema = resolveSourceSchema(settings, legacySourceSchema);
  const sourceSchemaByDataset = buildSourceSchemaMap({
    sources: spec.sources,
    defaultSourceSchema,
  });
  const allowedJoinKeys = await getAllowedJoinKeys(db);

  function schemaFor(datasetKey: string): string {
    return sourceSchemaByDataset.get(datasetKey) ?? defaultSourceSchema;
  }

  const datasetColumnsByKey = new Map<string, Set<string>>();
  const datasetSourceByKey = new Map<string, string>();

  const baseSchema = schemaFor(baseDataset);
  const baseColumns = await getTableColumns(db, baseSchema, baseDataset);
  datasetColumnsByKey.set(baseDataset, baseColumns);
  datasetSourceByKey.set(baseDataset, baseSchema);

  const joins = [...(spec.joins ?? [])];
  const joinedDatasets = new Set(joins.map((join) => String(join.dataset_key)));

  for (const hydration of AUTO_HYDRATION_JOINS) {
    if (joinedDatasets.has(hydration.datasetKey)) {
      continue;
    }
    if (!hydration.requiredKeys.every((key) => baseColumns.has(key) && allowedJoinKeys.has(key))) {
      continue;
    }
    joins.push({
      dataset_key: hydration.datasetKey,
      type: "left",
      on: hydration.requiredKeys,
    });
    if (!sourceSchemaByDataset.has(hydration.datasetKey)) {
      sourceSchemaByDataset.set(hydration.datasetKey, hydration.sourceSchema);
    }
    joinedDatasets.add(hydration.datasetKey);
  }

  for (const join of joins) {
    const datasetKey = assertSafeIdentifier(join.dataset_key, "join dataset_key");
    const joinSchema = schemaFor(datasetKey);
    const joinColumns = await getTableColumns(db, joinSchema, datasetKey);
    datasetColumnsByKey.set(datasetKey, joinColumns);
    datasetSourceByKey.set(datasetKey, joinSchema);

    for (const keyRaw of join.on ?? []) {
      const key = assertSafeIdentifier(String(keyRaw), "join key");
      if (!allowedJoinKeys.has(key)) {
        throw new HttpError(400, { error: `Join key "${key}" is not allowed` });
      }
      if (!baseColumns.has(key) || !joinColumns.has(key)) {
        throw new HttpError(400, {
          error: `Join key "${key}" does not exist in both ${baseDataset} and ${datasetKey}`,
        });
      }
    }
  }

  const selectedKeys = new Set(
    spec.select.map((item) => `${assertSafeIdentifier(item.dataset_key, "select dataset_key")}.${assertSafeIdentifier(item.column, "select column")}`)
  );

  const rows: AvailableColumn[] = [];
  const datasets = Array.from(datasetColumnsByKey.keys()).sort((a, b) => a.localeCompare(b));
  for (const datasetKey of datasets) {
    const columns = Array.from(datasetColumnsByKey.get(datasetKey) ?? []).sort((a, b) => a.localeCompare(b));
    const sourceSchema = datasetSourceByKey.get(datasetKey) ?? defaultSourceSchema;
    for (const column of columns) {
      const key = `${datasetKey}.${column}`;
      rows.push({
        key,
        dataset_key: datasetKey,
        column,
        source_schema: sourceSchema,
        selected: selectedKeys.has(key),
      });
    }
  }

  return rows;
}

function parseColumnKey(value: string): { dataset_key: string; column: string } {
  const [datasetRaw, columnRaw, ...rest] = String(value ?? "").trim().split(".");
  if (!datasetRaw || !columnRaw || rest.length > 0) {
    throw new HttpError(400, { error: `Invalid selected column key "${value}"` });
  }
  return {
    dataset_key: assertSafeIdentifier(datasetRaw, "selected dataset_key"),
    column: assertSafeIdentifier(columnRaw, "selected column"),
  };
}

function parseColumnOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return Array.from(
    new Set(
      raw
        .map((value) => String(value ?? "").trim())
        .filter((value) => value.length > 0)
    )
  );
}

function keyFromSelect(item: ComponentSelectSpec): string {
  return `${item.dataset_key}.${item.column}`;
}

function resolveSelectedColumnsInDisplayOrder(args: {
  spec: ComponentSpec;
  settings: JsonObject;
  availableKeySet: Set<string>;
}): string[] {
  const specKeys = args.spec.select.map((item) => keyFromSelect(item));
  const specKeySet = new Set(specKeys);
  const configuredOrder = parseColumnOrder(args.settings.column_order);

  const orderedFromSettings = configuredOrder.filter(
    (key) => specKeySet.has(key) && args.availableKeySet.has(key)
  );

  const remaining = specKeys.filter(
    (key) => !orderedFromSettings.includes(key) && args.availableKeySet.has(key)
  );

  return [...orderedFromSettings, ...remaining];
}

function compareSelectSpecs(left: ComponentSelectSpec, right: ComponentSelectSpec): number {
  const datasetCompare = left.dataset_key.localeCompare(right.dataset_key);
  if (datasetCompare !== 0) {
    return datasetCompare;
  }
  return left.column.localeCompare(right.column);
}

function sanitizeColumnTypes(raw: unknown, selectedKeys: Set<string>): JsonObject {
  if (!isObjectRecord(raw)) {
    return {};
  }

  const normalized: JsonObject = {};
  for (const [keyRaw, valueRaw] of Object.entries(raw)) {
    const key = String(keyRaw ?? "").trim();
    if (!selectedKeys.has(key)) {
      continue;
    }
    if (!isObjectRecord(valueRaw)) {
      continue;
    }

    const type = String(valueRaw.type ?? "").trim().toLowerCase();
    if (!type) {
      continue;
    }

    if (type === "percentage_of_total_bar") {
      normalized[key] = { type };
      continue;
    }

    if (type === "conditional_bar") {
      const threshold = isObjectRecord(valueRaw.threshold) ? valueRaw.threshold : {};
      const gte = typeof threshold.gte === "number" && Number.isFinite(threshold.gte) ? threshold.gte : undefined;
      const lte = typeof threshold.lte === "number" && Number.isFinite(threshold.lte) ? threshold.lte : undefined;

      const color = String(valueRaw.color ?? "").trim();
      const colorElse = String(valueRaw.color_else ?? "").trim();
      const display =
        valueRaw.display === "number" || valueRaw.display === "percentage"
          ? valueRaw.display
          : "percentage";
      const fractionDigits =
        typeof valueRaw.fraction_digits === "number" && Number.isFinite(valueRaw.fraction_digits)
          ? valueRaw.fraction_digits
          : undefined;
      const barMax =
        typeof valueRaw.bar_max === "number" && Number.isFinite(valueRaw.bar_max) && valueRaw.bar_max > 0
          ? valueRaw.bar_max
          : undefined;
      const valueFromRaw = String(valueRaw.value_from ?? "").trim();
      const thresholdFromRaw = String(valueRaw.threshold_from ?? "").trim();
      const labelFromRaw = String(valueRaw.label_from ?? "").trim();
      const valueFrom = selectedKeys.has(valueFromRaw) ? valueFromRaw : undefined;
      const thresholdFrom = selectedKeys.has(thresholdFromRaw) ? thresholdFromRaw : undefined;
      const labelFrom = selectedKeys.has(labelFromRaw) ? labelFromRaw : undefined;
      const rawConditions = Array.isArray(valueRaw.conditions) ? valueRaw.conditions : [];
      const conditions = rawConditions
        .filter((item): item is JsonObject => isObjectRecord(item))
        .map((item) => {
          const include = item.include !== false;
          const ruleColor = String(item.color ?? "").trim();
          const allRaw = Array.isArray(item.all) ? item.all : [];
          const all = allRaw
            .filter((clause): clause is JsonObject => isObjectRecord(clause))
            .map((clause) => {
              const field = String(clause.field ?? "").trim();
              const op = String(clause.op ?? "").trim().toLowerCase() === "neq" ? "neq" : "eq";
              const value = String(clause.value ?? "");
              if (!field || !selectedKeys.has(field)) {
                return null;
              }
              return { field, op, value };
            })
            .filter((clause): clause is { field: string; op: "eq" | "neq"; value: string } => clause !== null);
          if (all.length === 0) {
            return null;
          }
          return {
            include,
            ...(BAR_ALLOWED_COLORS.has(ruleColor) ? { color: ruleColor } : {}),
            all,
          };
        })
        .filter(
          (
            item
          ): item is {
            include: boolean;
            color?: string;
            all: Array<{ field: string; op: "eq" | "neq"; value: string }>;
          } => item !== null
        );

      normalized[key] = {
        type,
        ...((gte !== undefined || lte !== undefined)
          ? {
              threshold: {
                ...(gte !== undefined ? { gte } : {}),
                ...(lte !== undefined ? { lte } : {}),
              },
            }
          : {}),
        ...(BAR_ALLOWED_COLORS.has(color) ? { color } : {}),
        ...(BAR_ALLOWED_COLORS.has(colorElse) ? { color_else: colorElse } : {}),
        display,
        ...(fractionDigits !== undefined ? { fraction_digits: fractionDigits } : {}),
        ...(barMax !== undefined ? { bar_max: barMax } : {}),
        ...(valueFrom ? { value_from: valueFrom } : {}),
        ...(thresholdFrom ? { threshold_from: thresholdFrom } : {}),
        ...(labelFrom ? { label_from: labelFrom } : {}),
        ...(conditions.length > 0 ? { conditions } : {}),
      };
      continue;
    }

    if (type === "threshold") {
      const threshold = isObjectRecord(valueRaw.threshold) ? valueRaw.threshold : {};
      const gte = typeof threshold.gte === "number" && Number.isFinite(threshold.gte) ? threshold.gte : undefined;
      const lte = typeof threshold.lte === "number" && Number.isFinite(threshold.lte) ? threshold.lte : undefined;
      if (gte === undefined && lte === undefined) {
        continue;
      }
      const display =
        valueRaw.display === "percentage" || valueRaw.display === "number"
          ? valueRaw.display
          : undefined;
      const fractionDigits =
        typeof valueRaw.fraction_digits === "number" && Number.isFinite(valueRaw.fraction_digits)
          ? valueRaw.fraction_digits
          : undefined;
      normalized[key] = {
        type,
        threshold: {
          ...(gte !== undefined ? { gte } : {}),
          ...(lte !== undefined ? { lte } : {}),
        },
        ...(display ? { display } : {}),
        ...(fractionDigits !== undefined ? { fraction_digits: fractionDigits } : {}),
      };
      continue;
    }

    if (type === "pill") {
      const display = valueRaw.display === "title_case" ? "title_case" : "raw";
      const sourceMap = isObjectRecord(valueRaw.colors_by_value)
        ? valueRaw.colors_by_value
        : (isObjectRecord(valueRaw.tones_by_value) ? valueRaw.tones_by_value : {});
      const colorsByValue: Record<string, string> = {};
      for (const [valueKeyRaw, colorRaw] of Object.entries(sourceMap)) {
        const valueKey = String(valueKeyRaw ?? "");
        const color = String(colorRaw ?? "").trim();
        if (!color || !PILL_ALLOWED_COLORS.has(color)) {
          continue;
        }
        colorsByValue[valueKey] = color;
      }
      normalized[key] = {
        type,
        display,
        ...(Object.keys(colorsByValue).length > 0 ? { colors_by_value: colorsByValue } : {}),
      };
      continue;
    }

    if (type === "text" || type === "number" || type === "percent") {
      normalized[key] = { type };
    }
  }

  return normalized;
}

function isPgPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { code?: unknown };
  return String(candidate.code ?? "") === "42501";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const reportId = String(url.searchParams.get("report_id") ?? "").trim();
    const reportComponentId = String(url.searchParams.get("report_component_id") ?? "").trim();
    if (!reportId || !reportComponentId) {
      throw new HttpError(400, { error: "Missing required query parameters: report_id, report_component_id" });
    }

    const payload = await withAuthedDb(async ({ db, user }) => {
      if (!user.is_admin) {
        throw new HttpError(403, { error: "Forbidden" });
      }

      const component = await resolveReportComponent({ db, reportId, reportComponentId });
      const availableColumns = await buildAvailableColumns({
        db,
        spec: component.spec,
        settings: component.settings,
        legacySourceSchema: component.legacySourceSchema,
      });
      const availableKeySet = new Set(availableColumns.map((item) => item.key));
      const selectedColumns = resolveSelectedColumnsInDisplayOrder({
        spec: component.spec,
        settings: component.settings,
        availableKeySet,
      });

      return {
        ok: true,
        config: {
          report_id: component.reportId,
          report_component_id: component.reportComponentId,
          route: component.route,
          component_code: component.componentCode,
          selected_columns: selectedColumns,
          available_columns: availableColumns,
          column_types: isObjectRecord(component.settings.column_types) ? component.settings.column_types : {},
        },
      };
    });

    return NextResponse.json(payload);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    console.error("Table config GET error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const url = new URL(request.url);
    const reportId = String(url.searchParams.get("report_id") ?? "").trim();
    const reportComponentId = String(url.searchParams.get("report_component_id") ?? "").trim();
    if (!reportId || !reportComponentId) {
      throw new HttpError(400, { error: "Missing required query parameters: report_id, report_component_id" });
    }

    const body = (await request.json()) as {
      selected_columns?: unknown;
      column_types?: unknown;
    };

    const payload = await withAuthedDb(async ({ db, user }) => {
      if (!user.is_admin) {
        throw new HttpError(403, { error: "Forbidden" });
      }

      const component = await resolveReportComponent({ db, reportId, reportComponentId });
      const availableColumns = await buildAvailableColumns({
        db,
        spec: component.spec,
        settings: component.settings,
        legacySourceSchema: component.legacySourceSchema,
      });
      const availableKeySet = new Set(availableColumns.map((item) => item.key));

      if (!Array.isArray(body.selected_columns)) {
        throw new HttpError(400, { error: "selected_columns must be an array" });
      }

      const selectedKeys = Array.from(
        new Set(
          body.selected_columns
            .map((value) => String(value ?? "").trim())
            .filter((value) => value.length > 0)
        )
      );

      if (selectedKeys.length === 0) {
        throw new HttpError(400, { error: "At least one selected column is required" });
      }

      for (const key of selectedKeys) {
        if (!availableKeySet.has(key)) {
          throw new HttpError(400, { error: `Selected column "${key}" is not available for this component` });
        }
      }

      const existingAliasByKey = new Map<string, string>();
      for (const item of component.spec.select) {
        const key = `${item.dataset_key}.${item.column}`;
        if (item.as && item.as !== item.column) {
          existingAliasByKey.set(key, item.as);
        }
      }

      const nextSelect: ComponentSelectSpec[] = selectedKeys.map((key) => {
        const parsed = parseColumnKey(key);
        const as = existingAliasByKey.get(key);
        return {
          dataset_key: parsed.dataset_key,
          column: parsed.column,
          ...(as ? { as } : {}),
        };
      });
      const nextSelectSorted = [...nextSelect].sort(compareSelectSpecs);

      const selectedKeySet = new Set(selectedKeys);
      const nextColumnTypes =
        body.column_types === undefined
          ? sanitizeColumnTypes(
              isObjectRecord(component.settings.column_types) ? component.settings.column_types : {},
              selectedKeySet
            )
          : sanitizeColumnTypes(body.column_types, selectedKeySet);
      const nextSettings: JsonObject = {
        ...component.settings,
        column_types: nextColumnTypes,
        column_order: selectedKeys,
      };
      if (!readStringSetting(nextSettings, "source_schema") && component.legacySourceSchema) {
        nextSettings.source_schema = component.legacySourceSchema;
      }
      if (!Array.isArray(nextSettings.order_by) && component.legacyOrderBy && component.legacyOrderBy.length > 0) {
        nextSettings.order_by = component.legacyOrderBy;
      }

      const nextSpec: JsonObject = {
        sources: component.spec.sources,
        ...(component.spec.joins ? { joins: component.spec.joins } : {}),
        select: nextSelectSorted,
      };

      const updateResult = await db.query<{ id: string }>(
        `
        UPDATE meta.report_components
        SET spec = $1::jsonb,
            settings = $2::jsonb
        WHERE report_id = $3
          AND id = $4
        RETURNING id
        `,
        [JSON.stringify(nextSpec), JSON.stringify(nextSettings), component.reportId, component.reportComponentId]
      );

      if (!updateResult.rows[0]?.id) {
        throw new HttpError(409, {
          error: "Update did not apply. The report component may have changed or you may not have permission.",
        });
      }

      return {
        ok: true,
        config: {
          report_id: component.reportId,
          report_component_id: component.reportComponentId,
          route: component.route,
          component_code: component.componentCode,
          selected_columns: selectedKeys,
          column_types: nextColumnTypes,
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
        {
          error:
            "Database role does not have UPDATE permission on meta.report_components. Grant UPDATE(spec, settings) to the app role.",
        },
        { status: 403 }
      );
    }
    console.error("Table config PUT error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
