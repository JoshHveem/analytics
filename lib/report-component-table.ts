import { type Queryable } from "@/lib/db";

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

type ComponentFilterSpec = {
  dataset_key: string;
  column: string;
  op: "=" | "!=" | "in" | "between" | ">=" | "<=";
  param: string;
};

type ComponentOrderSpec = {
  dataset_key: string;
  column: string;
  direction?: "asc" | "desc";
};

type ComponentSpec = {
  joins?: ComponentJoinSpec[];
  select: ComponentSelectSpec[];
  filters?: ComponentFilterSpec[];
  order_by?: ComponentOrderSpec[];
};

type TableComponentConfig = {
  component_key: string;
  base_dataset_key: string;
  spec: ComponentSpec;
};

type CompiledComponentQuery = {
  sql: string;
  values: string[];
  selectedAliases: string[];
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

function parseComponentSpec(raw: unknown): ComponentSpec {
  if (!raw || typeof raw !== "object") {
    throw new Error("Component spec must be an object");
  }
  const parsed = raw as ComponentSpec;
  if (!Array.isArray(parsed.select) || parsed.select.length === 0) {
    throw new Error("Component spec requires a non-empty select array");
  }
  return parsed;
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
  const { rows } = await db.query<{ key_name: string }>(
    `
    SELECT key_name
    FROM meta.allowed_join_keys
    WHERE is_active = true
    `
  );
  return new Set(rows.map((row) => String(row.key_name)));
}

async function resolveTableComponentForRoute(db: Queryable, route: string): Promise<TableComponentConfig> {
  const { rows } = await db.query<{
    component_key: string;
    base_dataset_key: string;
    spec: unknown;
  }>(
    `
    SELECT
      c.component_key,
      c.base_dataset_key,
      c.spec
    FROM meta.reports r
    INNER JOIN meta.report_components rc
      ON rc.report_id = r.id
     AND COALESCE(rc.is_active, true) = true
    INNER JOIN meta.components c
      ON c.component_key = rc.component_key
     AND COALESCE(c.is_active, true) = true
    INNER JOIN meta.component_types ct
      ON ct.component_type_id = c.component_type_id
    WHERE trim(both '/' from r.route) = $1
      AND COALESCE(r.is_active, true) = true
      AND ct.component_type_key = 'table'
    ORDER BY COALESCE(rc.component_order, 100), c.component_key
    LIMIT 1
    `,
    [route]
  );

  const component = rows[0];
  if (!component) {
    throw new Error(`No active table component is configured for report route "${route}"`);
  }

  return {
    component_key: assertSafeIdentifier(component.component_key, "component_key"),
    base_dataset_key: assertSafeIdentifier(component.base_dataset_key, "base_dataset_key"),
    spec: parseComponentSpec(component.spec),
  };
}

export async function buildTableComponentQuery(args: {
  db: Queryable;
  route: string;
  searchParams: URLSearchParams;
}): Promise<CompiledComponentQuery> {
  const { db, route, searchParams } = args;
  const component = await resolveTableComponentForRoute(db, route);
  const allowedJoinKeys = await getAllowedJoinKeys(db);
  const datasetAliasByKey = new Map<string, string>();
  const datasetColumnsByKey = new Map<string, Set<string>>();

  const baseDataset = component.base_dataset_key;
  datasetAliasByKey.set(baseDataset, "d0");
  datasetColumnsByKey.set(baseDataset, await getTableColumns(db, "data", baseDataset));

  const joins = component.spec.joins ?? [];
  const joinClauses: string[] = [];

  for (let index = 0; index < joins.length; index += 1) {
    const join = joins[index];
    const joinDataset = assertSafeIdentifier(join.dataset_key, "join dataset_key");
    const joinType = join.type === "inner" ? "INNER JOIN" : "LEFT JOIN";

    if (!datasetAliasByKey.has(joinDataset)) {
      datasetAliasByKey.set(joinDataset, `d${index + 1}`);
      datasetColumnsByKey.set(joinDataset, await getTableColumns(db, "data", joinDataset));
    }

    const joinAlias = datasetAliasByKey.get(joinDataset)!;
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
      `${joinType} ${quoteIdentifier("data")}.${quoteIdentifier(joinDataset)} ${joinAlias} ON ${predicates.join(" AND ")}`
    );
  }

  const selectSpecs = component.spec.select;
  const selectedAliases = new Set<string>();
  const selectClauses: string[] = [];

  for (const item of selectSpecs) {
    const datasetKey = assertSafeIdentifier(item.dataset_key, "select dataset_key");
    const column = assertSafeIdentifier(item.column, "select column");
    const alias = assertSafeIdentifier(item.as ?? item.column, "select alias");
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
  const filters = component.spec.filters ?? [];

  for (const filter of filters) {
    const paramName = assertSafeIdentifier(filter.param, "filter param");
    const rawValue = String(searchParams.get(paramName) ?? "").trim();
    if (!rawValue) {
      continue;
    }

    const datasetKey = assertSafeIdentifier(filter.dataset_key, "filter dataset_key");
    const column = assertSafeIdentifier(filter.column, "filter column");
    const datasetAlias = datasetAliasByKey.get(datasetKey);
    if (!datasetAlias) {
      throw new Error(`Filter dataset "${datasetKey}" is not available in base/joins`);
    }
    const datasetColumns = datasetColumnsByKey.get(datasetKey) ?? new Set<string>();
    if (!datasetColumns.has(column)) {
      throw new Error(`Filter column "${datasetKey}.${column}" does not exist`);
    }

    const op = filter.op;
    if (op === "between") {
      const parts = rawValue.split(",").map((value) => value.trim()).filter(Boolean);
      if (parts.length !== 2) {
        throw new Error(`Filter "${paramName}" with op "between" requires "min,max"`);
      }
      values.push(parts[0], parts[1]);
      const leftIdx = values.length - 1;
      const rightIdx = values.length;
      whereClauses.push(
        `${datasetAlias}.${quoteIdentifier(column)} BETWEEN $${leftIdx} AND $${rightIdx}`
      );
      continue;
    }

    if (op === "in") {
      const parts = rawValue.split(",").map((value) => value.trim()).filter(Boolean);
      if (parts.length === 0) {
        continue;
      }
      const placeholders: string[] = [];
      for (const part of parts) {
        values.push(part);
        placeholders.push(`$${values.length}`);
      }
      whereClauses.push(
        `${datasetAlias}.${quoteIdentifier(column)} IN (${placeholders.join(", ")})`
      );
      continue;
    }

    values.push(rawValue);
    whereClauses.push(
      `${datasetAlias}.${quoteIdentifier(column)} ${op} $${values.length}`
    );
  }

  const orderClauses: string[] = [];
  for (const item of component.spec.order_by ?? []) {
    const datasetKey = assertSafeIdentifier(item.dataset_key, "order_by dataset_key");
    const column = assertSafeIdentifier(item.column, "order_by column");
    const datasetAlias = datasetAliasByKey.get(datasetKey);
    if (!datasetAlias) {
      continue;
    }
    const direction = item.direction === "desc" ? "DESC" : "ASC";
    orderClauses.push(`${datasetAlias}.${quoteIdentifier(column)} ${direction}`);
  }

  const sql = [
    `SELECT ${selectClauses.join(", ")}`,
    `FROM ${quoteIdentifier("data")}.${quoteIdentifier(baseDataset)} d0`,
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
  };
}
