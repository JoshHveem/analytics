-- Metadata-driven report dependency model
-- Purpose:
-- 1) Make report query structure derive from metadata (no endpoint-specific duplication).
-- 2) Enable lineage queries like: "which reports use data.<table>?"
-- 3) Support staged authoring (draft/published) for safe rollout.

BEGIN;

CREATE SCHEMA IF NOT EXISTS meta;

-- ---------------------------------------------------------------------------
-- 1) Per-report source graph (base + joins)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta.report_dependencies (
  dependency_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES meta.reports(id) ON DELETE CASCADE,
  source_alias TEXT NOT NULL,
  source_schema TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'table',
  relation_role TEXT NOT NULL DEFAULT 'join',
  join_type TEXT NULL,
  join_to_alias TEXT NULL,
  join_priority INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_dependencies_source_kind_check
    CHECK (source_kind IN ('table', 'view', 'materialized_view')),
  CONSTRAINT report_dependencies_relation_role_check
    CHECK (relation_role IN ('base', 'join')),
  CONSTRAINT report_dependencies_join_type_check
    CHECK (
      join_type IS NULL
      OR join_type IN ('inner', 'left', 'right', 'full', 'cross')
    ),
  CONSTRAINT report_dependencies_alias_format_check
    CHECK (source_alias ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT report_dependencies_base_join_shape_check
    CHECK (
      (relation_role = 'base' AND join_type IS NULL AND join_to_alias IS NULL)
      OR (relation_role = 'join' AND join_type IS NOT NULL AND join_to_alias IS NOT NULL)
    ),
  CONSTRAINT report_dependencies_schema_format_check
    CHECK (source_schema ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT report_dependencies_name_format_check
    CHECK (source_name ~ '^[a-z][a-z0-9_]*$')
);

CREATE UNIQUE INDEX IF NOT EXISTS report_dependencies_report_alias_uidx
  ON meta.report_dependencies (report_id, source_alias);

CREATE INDEX IF NOT EXISTS report_dependencies_report_active_idx
  ON meta.report_dependencies (report_id, is_active);

CREATE INDEX IF NOT EXISTS report_dependencies_table_lookup_idx
  ON meta.report_dependencies (source_schema, source_name, is_active);

-- ---------------------------------------------------------------------------
-- 2) Join predicates for each JOIN dependency
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta.report_dependency_joins (
  join_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dependency_id BIGINT NOT NULL REFERENCES meta.report_dependencies(dependency_id) ON DELETE CASCADE,
  left_alias TEXT NOT NULL,
  left_column TEXT NOT NULL,
  operator TEXT NOT NULL DEFAULT '=',
  right_alias TEXT NOT NULL,
  right_column TEXT NOT NULL,
  predicate_order INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_dependency_joins_operator_check
    CHECK (operator IN ('=', '!=', '>', '>=', '<', '<=')),
  CONSTRAINT report_dependency_joins_column_format_check
    CHECK (
      left_column ~ '^[a-z][a-z0-9_]*$'
      AND right_column ~ '^[a-z][a-z0-9_]*$'
    )
);

CREATE INDEX IF NOT EXISTS report_dependency_joins_dependency_idx
  ON meta.report_dependency_joins (dependency_id, is_active, predicate_order);

-- ---------------------------------------------------------------------------
-- 3) Selected output fields (drives SELECT + output schema)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta.report_dependency_fields (
  field_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES meta.reports(id) ON DELETE CASCADE,
  source_alias TEXT NOT NULL,
  source_column TEXT NOT NULL,
  output_key TEXT NOT NULL,
  output_label TEXT NOT NULL,
  data_type TEXT NOT NULL DEFAULT 'text',
  expression_type TEXT NOT NULL DEFAULT 'column',
  aggregate_fn TEXT NULL,
  format_hint TEXT NULL,
  output_order INTEGER NOT NULL DEFAULT 100,
  sortable BOOLEAN NOT NULL DEFAULT TRUE,
  filterable BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_dependency_fields_expression_type_check
    CHECK (expression_type IN ('column', 'aggregate')),
  CONSTRAINT report_dependency_fields_data_type_check
    CHECK (data_type IN ('text', 'number', 'percent', 'date', 'boolean', 'json')),
  CONSTRAINT report_dependency_fields_aggregate_check
    CHECK (
      aggregate_fn IS NULL
      OR aggregate_fn IN ('count', 'sum', 'avg', 'min', 'max')
    ),
  CONSTRAINT report_dependency_fields_source_column_format_check
    CHECK (source_column ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT report_dependency_fields_output_key_format_check
    CHECK (output_key ~ '^[a-z][a-z0-9_]*$')
);

CREATE UNIQUE INDEX IF NOT EXISTS report_dependency_fields_output_key_uidx
  ON meta.report_dependency_fields (report_id, output_key);

CREATE INDEX IF NOT EXISTS report_dependency_fields_report_idx
  ON meta.report_dependency_fields (report_id, is_active, output_order);

-- ---------------------------------------------------------------------------
-- 4) Filter bindings (drives WHERE using existing meta.filters / meta.report_filters)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta.report_dependency_filter_bindings (
  binding_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES meta.reports(id) ON DELETE CASCADE,
  filter_code TEXT NOT NULL REFERENCES meta.filters(filter_code) ON DELETE CASCADE,
  source_alias TEXT NOT NULL,
  source_column TEXT NOT NULL,
  operator TEXT NOT NULL DEFAULT '=',
  value_transform TEXT NOT NULL DEFAULT 'identity',
  predicate_order INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_dependency_filter_bindings_operator_check
    CHECK (operator IN ('=', '!=', '>', '>=', '<', '<=', 'in', 'ilike')),
  CONSTRAINT report_dependency_filter_bindings_transform_check
    CHECK (
      value_transform IN ('identity', 'csv_to_array', 'lowercase', 'trim')
    ),
  CONSTRAINT report_dependency_filter_bindings_column_format_check
    CHECK (source_column ~ '^[a-z][a-z0-9_]*$')
);

CREATE UNIQUE INDEX IF NOT EXISTS report_dependency_filter_bindings_uidx
  ON meta.report_dependency_filter_bindings (report_id, filter_code, source_alias, source_column);

CREATE INDEX IF NOT EXISTS report_dependency_filter_bindings_report_idx
  ON meta.report_dependency_filter_bindings (report_id, is_active);

-- ---------------------------------------------------------------------------
-- 5) Optional grouping/sorting metadata for query builder
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta.report_dependency_grouping (
  grouping_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES meta.reports(id) ON DELETE CASCADE,
  output_key TEXT NOT NULL,
  grouping_order INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS report_dependency_grouping_uidx
  ON meta.report_dependency_grouping (report_id, output_key);

CREATE TABLE IF NOT EXISTS meta.report_dependency_sorting (
  sorting_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES meta.reports(id) ON DELETE CASCADE,
  output_key TEXT NOT NULL,
  sort_direction TEXT NOT NULL DEFAULT 'asc',
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT report_dependency_sorting_direction_check
    CHECK (sort_direction IN ('asc', 'desc'))
);

CREATE UNIQUE INDEX IF NOT EXISTS report_dependency_sorting_uidx
  ON meta.report_dependency_sorting (report_id, output_key);

-- ---------------------------------------------------------------------------
-- 6) Lightweight updated_at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION meta.set_updated_at_now()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_report_dependencies_updated_at ON meta.report_dependencies;
CREATE TRIGGER set_report_dependencies_updated_at
BEFORE UPDATE ON meta.report_dependencies
FOR EACH ROW EXECUTE FUNCTION meta.set_updated_at_now();

DROP TRIGGER IF EXISTS set_report_dependency_joins_updated_at ON meta.report_dependency_joins;
CREATE TRIGGER set_report_dependency_joins_updated_at
BEFORE UPDATE ON meta.report_dependency_joins
FOR EACH ROW EXECUTE FUNCTION meta.set_updated_at_now();

DROP TRIGGER IF EXISTS set_report_dependency_fields_updated_at ON meta.report_dependency_fields;
CREATE TRIGGER set_report_dependency_fields_updated_at
BEFORE UPDATE ON meta.report_dependency_fields
FOR EACH ROW EXECUTE FUNCTION meta.set_updated_at_now();

DROP TRIGGER IF EXISTS set_report_dependency_filter_bindings_updated_at ON meta.report_dependency_filter_bindings;
CREATE TRIGGER set_report_dependency_filter_bindings_updated_at
BEFORE UPDATE ON meta.report_dependency_filter_bindings
FOR EACH ROW EXECUTE FUNCTION meta.set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 7) Views to support discovery + "which report uses this table?"
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW meta.v_report_table_usage AS
SELECT
  r.id AS report_id,
  r.route,
  r.title,
  r.category,
  d.source_schema,
  d.source_name,
  d.source_alias,
  d.source_kind,
  d.relation_role,
  d.join_type,
  d.join_to_alias,
  d.join_priority
FROM meta.report_dependencies d
INNER JOIN meta.reports r
  ON r.id = d.report_id
WHERE d.is_active = TRUE
  AND r.is_active = TRUE;

CREATE OR REPLACE VIEW meta.v_report_dependency_detail AS
SELECT
  d.report_id,
  r.route,
  d.source_alias,
  d.source_schema,
  d.source_name,
  d.relation_role,
  d.join_type,
  d.join_to_alias,
  d.join_priority,
  j.left_alias,
  j.left_column,
  j.operator,
  j.right_alias,
  j.right_column,
  j.predicate_order
FROM meta.report_dependencies d
INNER JOIN meta.reports r
  ON r.id = d.report_id
LEFT JOIN meta.report_dependency_joins j
  ON j.dependency_id = d.dependency_id
 AND j.is_active = TRUE
WHERE d.is_active = TRUE
  AND r.is_active = TRUE;

COMMIT;

-- Example:
-- SELECT * FROM meta.v_report_table_usage
-- WHERE source_schema = 'data' AND source_name = 'student_exit_status'
-- ORDER BY route;
