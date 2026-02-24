import { type Queryable } from "@/lib/db";

type JsonObject = Record<string, unknown>;

type ComponentJoinSpec = {
  dataset_key: string;
  type: "left" | "inner";
  on: string[];
};

type ComponentSourceSpec = {
  dataset_key: string;
  is_base: boolean;
  source_schema?: string;
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
  // normalized internal base extracted from spec.sources[is_base=true]
  base_dataset_key: string;
  sources: ComponentSourceSpec[];
  joins?: ComponentJoinSpec[];
  select: ComponentSelectSpec[];
};

type TableComponentConfig = {
  report_id: string;
  report_component_id: string;
  component_code: string;
  component_name: string | null;
  component_description: string | null;
  report_settings: JsonObject;
  resolved_settings: JsonObject;
  legacy_source_schema?: string;
  legacy_order_by?: ComponentOrderSpec[];
  spec: ComponentSpec;
};

export type CompiledComponentQuery = {
  sql: string;
  values: string[];
  selectedAliases: string[];
  filterBindings: Array<{
    param: string;
    datasetKey: string;
    sourceSchema: string;
    column: string;
    operator: "=" | "in";
  }>;
  reportId: string;
  reportComponentId: string;
  componentCode: string;
  componentName: string | null;
  componentDescription: string | null;
  reportSettings: JsonObject;
  resolvedSettings: JsonObject;
  sourceSchema: string;
};

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;
const SAFE_COMPONENT_CODE = /^[a-z0-9_-]+$/;
const DEFAULT_SOURCE_SCHEMA = "dataset";
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
    throw new Error(`Invalid ${kind}: ${value}`);
  }
  return cleaned;
}

function assertSafeSelectAlias(value: string): string {
  const cleaned = String(value ?? "").trim();
  if (SAFE_IDENT.test(cleaned)) {
    return cleaned;
  }
  if (/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(cleaned)) {
    return cleaned;
  }
  throw new Error(`Invalid select alias: ${value}`);
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(raw: unknown, kind: string): JsonObject {
  if (raw === null || raw === undefined) {
    return {};
  }
  if (!isPlainObject(raw)) {
    throw new Error(`${kind} must be a JSON object`);
  }
  return raw;
}

function deepMergeObjects(base: JsonObject, override: JsonObject): JsonObject {
  const merged: JsonObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = merged[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      merged[key] = deepMergeObjects(existing, value);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function parseComponentSpec(raw: unknown): ComponentSpec {
  if (!isPlainObject(raw)) {
    throw new Error("Component spec must be an object");
  }

  const parsed = raw as Partial<ComponentSpec> & JsonObject;
  const parsedSources = parseComponentSources(parsed.sources);
  const baseDataset = resolveBaseDatasetKey(parsedSources);
  const parsedSelect = parseComponentSelect(parsed.select);
  if (parsedSelect.length === 0) {
    throw new Error("Component spec requires a non-empty select array");
  }

  return {
    base_dataset_key: baseDataset,
    sources: parsedSources,
    joins: parseComponentJoins(parsed.joins),
    select: parsedSelect,
  };
}

function parseComponentSources(raw: unknown): ComponentSourceSpec[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("Component spec requires non-empty sources[]");
  }

  const parsed = raw
    .filter((item): item is JsonObject => isPlainObject(item))
    .map((item) => ({
      dataset_key: assertSafeIdentifier(String(item.dataset_key ?? ""), "spec sources[].dataset_key"),
      is_base: item.is_base === true,
      source_schema:
        typeof item.source_schema === "string" && item.source_schema.trim().length > 0
          ? assertSafeIdentifier(item.source_schema, "spec sources[].source_schema")
          : (typeof item.schema === "string" && item.schema.trim().length > 0
              ? assertSafeIdentifier(item.schema, "spec sources[].schema")
              : undefined),
    }));

  if (parsed.length !== raw.length) {
    throw new Error("Each spec.sources[] entry must be an object");
  }

  return parsed;
}

function parseComponentJoins(raw: unknown): ComponentJoinSpec[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  if (raw.length === 0) {
    return [];
  }

  const parsed = raw
    .filter((item): item is JsonObject => isPlainObject(item))
    .map((item) => {
      const type = String(item.type ?? "").trim().toLowerCase();
      const joinType: ComponentJoinSpec["type"] = type === "inner" ? "inner" : "left";
      const on = Array.isArray(item.on)
        ? item.on.map((key) => assertSafeIdentifier(String(key ?? ""), "spec joins[].on[]"))
        : [];
      if (on.length === 0) {
        throw new Error("Each spec.joins[] entry must define at least one key in on[]");
      }
      return {
        dataset_key: assertSafeIdentifier(String(item.dataset_key ?? ""), "spec joins[].dataset_key"),
        type: joinType,
        on,
      };
    });

  if (parsed.length !== raw.length) {
    throw new Error("Each spec.joins[] entry must be an object");
  }
  return parsed;
}

function parseComponentSelect(raw: unknown): ComponentSelectSpec[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item) => {
    if (!isPlainObject(item)) {
      throw new Error("Each spec.select[] entry must be an object");
    }
    const aliasRaw = String(item.as ?? "").trim();
    return {
      dataset_key: assertSafeIdentifier(String(item.dataset_key ?? ""), "spec select[].dataset_key"),
      column: assertSafeIdentifier(String(item.column ?? ""), "spec select[].column"),
      ...(aliasRaw.length > 0
        ? { as: assertSafeIdentifier(aliasRaw, "spec select[].as") }
        : {}),
    };
  });
}

function parseOrderBy(raw: unknown): ComponentOrderSpec[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item) => {
    if (!isPlainObject(item)) {
      throw new Error("Each order_by[] entry must be an object");
    }
    return {
      dataset_key: assertSafeIdentifier(String(item.dataset_key ?? ""), "order_by[].dataset_key"),
      column: assertSafeIdentifier(String(item.column ?? ""), "order_by[].column"),
      direction: String(item.direction ?? "").trim().toLowerCase() === "desc" ? "desc" : "asc",
    };
  });
}

function buildSourceSchemaMap(args: {
  sources: ComponentSourceSpec[];
  defaultSourceSchema: string;
}): Map<string, string> {
  const { sources, defaultSourceSchema } = args;
  const byDataset = new Map<string, string>();

  for (const source of sources) {
    const datasetKey = source.dataset_key;
    const sourceSchema = source.source_schema ?? defaultSourceSchema;
    const existing = byDataset.get(datasetKey);
    if (existing && existing !== sourceSchema) {
      throw new Error(
        `Conflicting source schema for dataset "${datasetKey}": "${existing}" vs "${sourceSchema}"`
      );
    }
    byDataset.set(datasetKey, sourceSchema);
  }

  return byDataset;
}

function resolveBaseDatasetKey(sources: ComponentSourceSpec[]): string {
  const baseSources = sources.filter((source) => source.is_base);
  if (baseSources.length !== 1) {
    throw new Error("Component spec must have exactly one sources[] entry where is_base=true");
  }

  return baseSources[0].dataset_key;
}

function readStringSetting(settings: JsonObject, key: string): string | undefined {
  const value = settings[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function parseColumnOrder(settings: JsonObject): string[] {
  const raw = settings.column_order;
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

function keyFromSelectSpec(item: ComponentSelectSpec): string {
  return `${item.dataset_key}.${item.column}`;
}

function orderSelectSpecsBySettings(selectSpecs: ComponentSelectSpec[], settings: JsonObject): ComponentSelectSpec[] {
  const configuredOrder = parseColumnOrder(settings);
  if (configuredOrder.length === 0) {
    return selectSpecs;
  }

  const byKey = new Map<string, ComponentSelectSpec>();
  for (const item of selectSpecs) {
    byKey.set(keyFromSelectSpec(item), item);
  }

  const ordered: ComponentSelectSpec[] = [];
  const used = new Set<string>();
  for (const key of configuredOrder) {
    const item = byKey.get(key);
    if (!item) {
      continue;
    }
    ordered.push(item);
    used.add(key);
  }

  for (const item of selectSpecs) {
    const key = keyFromSelectSpec(item);
    if (used.has(key)) {
      continue;
    }
    ordered.push(item);
  }

  return ordered;
}

function resolveSourceSchema(settings: JsonObject, legacySourceSchema?: string): string {
  const candidate =
    readStringSetting(settings, "source_schema") ??
    readStringSetting(settings, "dataset_schema") ??
    legacySourceSchema ??
    DEFAULT_SOURCE_SCHEMA;
  return assertSafeIdentifier(candidate, "source schema");
}

function resolveOrderBy(settings: JsonObject, legacyOrderBy: ComponentOrderSpec[]): ComponentOrderSpec[] {
  const configured = parseOrderBy(settings.order_by);
  if (configured.length > 0) {
    return configured;
  }
  return legacyOrderBy;
}

async function getComponentDefaultsColumn(db: Queryable): Promise<"default_settings" | "settings"> {
  const { rows } = await db.query<{ column_name: string }>(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'meta'
      AND table_name = 'components'
      AND column_name IN ('default_settings', 'settings')
    `
  );

  const columns = new Set(rows.map((row) => String(row.column_name)));
  if (columns.has("default_settings")) {
    return "default_settings";
  }
  if (columns.has("settings")) {
    return "settings";
  }

  throw new Error('meta.components must have "default_settings" (or legacy "settings")');
}

async function getTableColumns(db: Queryable, schema: string, table: string): Promise<Set<string>> {
  const { rows } = await db.query<{ column_name: string }>(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name = $2
    `,
    [schema, table]
  );
  return new Set(rows.map((row) => String(row.column_name)));
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

async function resolveTableComponentForRoute(
  db: Queryable,
  route: string,
  componentCode?: string,
  reportComponentId?: string
): Promise<TableComponentConfig> {
  const normalizedComponentCode = String(componentCode ?? "").trim();
  if (normalizedComponentCode && !SAFE_COMPONENT_CODE.test(normalizedComponentCode)) {
    throw new Error(`Invalid component_code: ${componentCode}`);
  }
  const normalizedReportComponentId = String(reportComponentId ?? "").trim();

  const defaultSettingsColumn = await getComponentDefaultsColumn(db);
  const { rows } = await db.query<{
    report_id: string;
    report_component_id: string;
    component_code: string;
    component_name: string | null;
    component_description: string | null;
    component_default_settings: unknown;
    report_settings: unknown;
    report_spec: unknown;
  }>(
    `
    SELECT
      r.id AS report_id,
      rc.id AS report_component_id,
      c.component_code,
      c.name AS component_name,
      c.description AS component_description,
      c.${quoteIdentifier(defaultSettingsColumn)} AS component_default_settings,
      rc.settings AS report_settings,
      rc.spec AS report_spec
    FROM meta.reports r
    INNER JOIN meta.report_components rc
      ON rc.report_id = r.id
     AND COALESCE(rc.is_active, true) = true
    INNER JOIN meta.components c
      ON c.component_code = rc.component_code
     AND COALESCE(c.is_active, true) = true
    WHERE (trim(both '/' from r.route) = $1 OR r.id = $1)
      AND COALESCE(r.is_active, true) = true
      AND ($2::text IS NULL OR rc.component_code = $2::text)
      AND ($3::text IS NULL OR rc.id = $3::text)
    ORDER BY
      COALESCE(
        CASE
          WHEN (rc.settings->>'component_order') ~ '^-?\\d+$'
          THEN (rc.settings->>'component_order')::int
          ELSE NULL
        END,
        100000
      ) ASC,
      rc.id ASC
    LIMIT 1
    `,
    [route, normalizedComponentCode || null, normalizedReportComponentId || null]
  );

  const component = rows[0];
  if (!component) {
    const filters: string[] = [];
    if (normalizedComponentCode) {
      filters.push(`component_code "${normalizedComponentCode}"`);
    }
    if (normalizedReportComponentId) {
      filters.push(`report_component_id "${normalizedReportComponentId}"`);
    }
    throw new Error(
      `No active component is configured for report route "${route}"${
        filters.length > 0 ? ` with ${filters.join(" and ")}` : ""
      }`
    );
  }
  const defaultSettings = parseJsonObject(
    component.component_default_settings,
    "Component default settings"
  );
  const reportSettings = parseJsonObject(component.report_settings, "Report component settings");
  const resolvedSettings = deepMergeObjects(defaultSettings, reportSettings);
  const rawSpec = parseJsonObject(component.report_spec, "Report component spec");
  const legacySourceSchema = readStringSetting(rawSpec, "source_schema");
  const legacyOrderBy = parseOrderBy(rawSpec.order_by);

  return {
    report_id: String(component.report_id),
    report_component_id: String(component.report_component_id),
    component_code: String(component.component_code),
    component_name: component.component_name ?? null,
    component_description: component.component_description ?? null,
    report_settings: reportSettings,
    resolved_settings: resolvedSettings,
    legacy_source_schema: legacySourceSchema,
    legacy_order_by: legacyOrderBy,
    spec: parseComponentSpec(rawSpec),
  };
}

export async function buildTableComponentQuery(args: {
  db: Queryable;
  route: string;
  searchParams: URLSearchParams;
  componentCode?: string;
  reportComponentId?: string;
  filterParams?: string[];
  selectMode?: "spec" | "all_available";
}): Promise<CompiledComponentQuery> {
  const {
    db,
    route,
    searchParams,
    componentCode,
    reportComponentId,
    filterParams = [],
    selectMode = "spec",
  } = args;
  const component = await resolveTableComponentForRoute(db, route, componentCode, reportComponentId);
  const allowedJoinKeys = await getAllowedJoinKeys(db);
  const defaultSourceSchema = resolveSourceSchema(
    component.resolved_settings,
    component.legacy_source_schema
  );
  const sourceSchemaByDataset = buildSourceSchemaMap({
    sources: component.spec.sources,
    defaultSourceSchema: defaultSourceSchema,
  });
  const datasetAliasByKey = new Map<string, string>();
  const datasetColumnsByKey = new Map<string, Set<string>>();
  const datasetSourceSchemaByKey = new Map<string, string>();

  function sourceSchemaForDataset(datasetKey: string): string {
    return sourceSchemaByDataset.get(datasetKey) ?? defaultSourceSchema;
  }

  const baseDataset = component.spec.base_dataset_key;
  const baseDatasetSchema = sourceSchemaForDataset(baseDataset);
  datasetAliasByKey.set(baseDataset, "d0");
  datasetSourceSchemaByKey.set(baseDataset, baseDatasetSchema);
  const baseColumns = await getTableColumns(db, baseDatasetSchema, baseDataset);
  datasetColumnsByKey.set(baseDataset, baseColumns);

  const explicitJoins = component.spec.joins ?? [];
  const joinedDatasets = new Set<string>(explicitJoins.map((join) => String(join.dataset_key)));
  const joins: ComponentJoinSpec[] = [...explicitJoins];

  // Auto-hydrate canonical reference dimensions when keys exist on the base source.
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

  const joinClauses: string[] = [];

  for (let index = 0; index < joins.length; index += 1) {
    const join = joins[index];
    const joinDataset = assertSafeIdentifier(join.dataset_key, "join dataset_key");
    const joinType = join.type === "inner" ? "INNER JOIN" : "LEFT JOIN";

    if (!datasetAliasByKey.has(joinDataset)) {
      const joinDatasetSchema = sourceSchemaForDataset(joinDataset);
      datasetAliasByKey.set(joinDataset, `d${index + 1}`);
      datasetSourceSchemaByKey.set(joinDataset, joinDatasetSchema);
      datasetColumnsByKey.set(joinDataset, await getTableColumns(db, joinDatasetSchema, joinDataset));
    }

    const joinAlias = datasetAliasByKey.get(joinDataset)!;
    const joinSourceSchema = datasetSourceSchemaByKey.get(joinDataset) ?? sourceSchemaForDataset(joinDataset);
    const baseAlias = datasetAliasByKey.get(baseDataset)!;
    const joinColumns = datasetColumnsByKey.get(joinDataset)!;
    const baseColumns = datasetColumnsByKey.get(baseDataset)!;

    if (!Array.isArray(join.on) || join.on.length === 0) {
      throw new Error(`Join for dataset "${joinDataset}" must define at least one key in "on"`);
    }

    const predicates: string[] = [];
    for (const keyRaw of join.on) {
      const key = assertSafeIdentifier(keyRaw, "join key");
      if (!allowedJoinKeys.has(key)) {
        throw new Error(`Join key "${key}" is not allowed`);
      }
      if (!baseColumns.has(key) || !joinColumns.has(key)) {
        throw new Error(`Join key "${key}" does not exist in both ${baseDataset} and ${joinDataset}`);
      }
      predicates.push(
        `${baseAlias}.${quoteIdentifier(key)} = ${joinAlias}.${quoteIdentifier(key)}`
      );
    }

    joinClauses.push(
      `${joinType} ${quoteIdentifier(joinSourceSchema)}.${quoteIdentifier(joinDataset)} ${joinAlias} ON ${predicates.join(" AND ")}`
    );
  }

  const selectSpecs: ComponentSelectSpec[] =
    selectMode === "all_available"
      ? Array.from(datasetColumnsByKey.entries()).flatMap(([datasetKey, columns]) =>
          Array.from(columns)
            .sort((a, b) => a.localeCompare(b))
            .map((column) => ({
              dataset_key: datasetKey,
              column,
              as: `${datasetKey}.${column}`,
            }))
        )
      : orderSelectSpecsBySettings(component.spec.select, component.resolved_settings);
  const selectedAliases = new Set<string>();
  const selectClauses: string[] = [];

  for (const item of selectSpecs) {
    const datasetKey = assertSafeIdentifier(item.dataset_key, "select dataset_key");
    const column = assertSafeIdentifier(item.column, "select column");
    const alias = assertSafeSelectAlias(item.as ?? item.column);
    const datasetAlias = datasetAliasByKey.get(datasetKey);
    if (!datasetAlias) {
      throw new Error(`Select dataset "${datasetKey}" is not available in base/joins`);
    }

    const datasetColumns = datasetColumnsByKey.get(datasetKey) ?? new Set<string>();
    if (!datasetColumns.has(column)) {
      throw new Error(`Select column "${datasetKey}.${column}" does not exist`);
    }

    if (selectedAliases.has(alias)) {
      throw new Error(`Duplicate select alias "${alias}" in component spec`);
    }
    selectedAliases.add(alias);
    selectClauses.push(
      `${datasetAlias}.${quoteIdentifier(column)} AS ${quoteIdentifier(alias)}`
    );
  }

  const whereClauses: string[] = [];
  const values: string[] = [];
  const filterBindings: Array<{
    param: string;
    datasetKey: string;
    sourceSchema: string;
    column: string;
    operator: "=" | "in";
  }> = [];
  const requestedFilterParams = Array.from(
    new Set(
      filterParams
        .map((param) => String(param ?? "").trim().toLowerCase())
        .filter((param) => SAFE_IDENT.test(param))
    )
  );

  for (const param of requestedFilterParams) {
    const rawValue = String(searchParams.get(param) ?? "").trim();
    if (!rawValue) {
      continue;
    }

    let targetDatasetKey: string | null = null;
    for (const datasetKey of datasetAliasByKey.keys()) {
      const cols = datasetColumnsByKey.get(datasetKey);
      if (cols?.has(param)) {
        targetDatasetKey = datasetKey;
        break;
      }
    }
    if (!targetDatasetKey) {
      continue;
    }

    const targetAlias = datasetAliasByKey.get(targetDatasetKey);
    if (!targetAlias) {
      continue;
    }

    const parts = rawValue.split(",").map((value) => value.trim()).filter(Boolean);
    if (parts.length === 0) {
      continue;
    }

    if (parts.length === 1) {
      values.push(parts[0]);
      whereClauses.push(`${targetAlias}.${quoteIdentifier(param)} = $${values.length}`);
      filterBindings.push({
        param,
        datasetKey: targetDatasetKey,
        sourceSchema: datasetSourceSchemaByKey.get(targetDatasetKey) ?? sourceSchemaForDataset(targetDatasetKey),
        column: param,
        operator: "=",
      });
      continue;
    }

    const placeholders: string[] = [];
    for (const part of parts) {
      values.push(part);
      placeholders.push(`$${values.length}`);
    }
    whereClauses.push(`${targetAlias}.${quoteIdentifier(param)} IN (${placeholders.join(", ")})`);
    filterBindings.push({
      param,
      datasetKey: targetDatasetKey,
      sourceSchema: datasetSourceSchemaByKey.get(targetDatasetKey) ?? sourceSchemaForDataset(targetDatasetKey),
      column: param,
      operator: "in",
    });
  }

  const orderClauses: string[] = [];
  for (const item of resolveOrderBy(component.resolved_settings, component.legacy_order_by ?? [])) {
    const datasetKey = assertSafeIdentifier(item.dataset_key, "order_by dataset_key");
    const column = assertSafeIdentifier(item.column, "order_by column");
    const datasetAlias = datasetAliasByKey.get(datasetKey);
    if (!datasetAlias) {
      continue;
    }
    const datasetColumns = datasetColumnsByKey.get(datasetKey) ?? new Set<string>();
    if (!datasetColumns.has(column)) {
      throw new Error(`Order-by column "${datasetKey}.${column}" does not exist`);
    }
    const direction = item.direction === "desc" ? "DESC" : "ASC";
    orderClauses.push(`${datasetAlias}.${quoteIdentifier(column)} ${direction}`);
  }

  const sql = [
    `SELECT DISTINCT ${selectClauses.join(", ")}`,
    `FROM ${quoteIdentifier(baseDatasetSchema)}.${quoteIdentifier(baseDataset)} d0`,
    ...joinClauses,
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "",
    orderClauses.length > 0 ? `ORDER BY ${orderClauses.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    sql,
    values,
    selectedAliases: Array.from(selectedAliases),
    filterBindings,
    reportId: component.report_id,
    reportComponentId: component.report_component_id,
    componentCode: component.component_code,
    componentName: component.component_name,
    componentDescription: component.component_description,
    reportSettings: component.report_settings,
    resolvedSettings: component.resolved_settings,
    sourceSchema: defaultSourceSchema,
  };
}
