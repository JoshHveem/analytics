# Report Metadata Builder Plan

## Goals
- Make report query generation metadata-driven.
- Eliminate duplicate maintenance between API SQL and dependency docs.
- Let analysts/admins see if a report already uses a table before requesting a new one.
- Keep existing secure API standards (`withSecureReport`, RLS, anonymize) intact.

## Metadata Model (single source of truth)
- `meta.report_dependencies`: source graph per report (base + join nodes).
- `meta.report_dependency_joins`: join predicates between aliases.
- `meta.report_dependency_fields`: output fields and shape.
- `meta.report_dependency_filter_bindings`: filter-to-column predicates.
- `meta.report_dependency_grouping`: optional group-by definitions.
- `meta.report_dependency_sorting`: optional default sort definitions.
- `meta.v_report_table_usage`: table lineage view (reports by table).

## Query Builder Contract
For a report route, runtime should:
1. Resolve `report_id` from `meta.reports`.
2. Load active dependency graph (`base` + `join` rows).
3. Build `FROM ... JOIN ... ON ...` from dependency tables.
4. Build `SELECT` from `meta.report_dependency_fields`.
5. Build `WHERE` from active filter bindings + user params.
6. Apply `GROUP BY` / `ORDER BY` from metadata tables.
7. Execute inside `withSecureReport`; anonymize output rows before response.

## Guardrails
- Only allow whitelisted operators in metadata (`=`, `!=`, `in`, `ilike`, etc.).
- Validate source schema/table/column references against `information_schema` before execution.
- Require exactly one active `base` source per report.
- Reject dangling join aliases.
- Keep `execution_mode='custom'` fallback for complex legacy reports.

## UI Plan: Report Metadata Builder

### Route
- `app/reports/admin/metadata/page.tsx` (admin-only)

### UX Layout
- Left rail: report list + status (`draft`, `published`, `disabled`).
- Main workspace tabs:
  1. `Definition`
  2. `Sources & Joins`
  3. `Fields`
  4. `Filters`
  5. `Grouping & Sort`
  6. `Preview`

### Tab Details
1. Definition
- Edit `title`, `route`, `category`, `description`, active flag.

2. Sources & Joins
- Add base source (schema/table/alias).
- Add joined sources (join type, join target alias, priority).
- Add join predicates (`left_alias.left_col operator right_alias.right_col`).
- Real-time graph preview (alias nodes + joins).

3. Fields
- Add output fields from source aliases.
- Configure output key/label/type/order/aggregate/sortable/filterable.
- Show duplicate output key validation.

4. Filters
- Bind existing `meta.filters.filter_code` to source alias + column + operator.
- Optional transforms (identity/csv_to_array/lowercase/trim).

5. Grouping & Sort
- Pick output keys for group and default sort direction/order.

6. Preview
- `Generated SQL` preview (read-only).
- `Sample rows` preview (small limit, secure context).
- `Dependency summary` (tables used + reports already using them).

## API Endpoints for Builder
- `GET /api/reports/admin/metadata/catalog`
- `GET /api/reports/admin/metadata/:reportId`
- `PUT /api/reports/admin/metadata/:reportId`
- `POST /api/reports/admin/metadata/:reportId/validate`
- `POST /api/reports/admin/metadata/:reportId/preview`

All admin endpoints should:
- require authenticated admin user
- run with same DB user context protections
- avoid raw SQL input from client

## Rollout Sequence
1. Apply `tools/sql/meta_report_dependencies.sql`.
2. Backfill dependencies for 2-3 existing reports.
3. Build read-only table lineage UI first (reports-by-table).
4. Build metadata editor tabs next.
5. Switch one simple report to metadata-driven execution.
6. Iterate until custom endpoints are only edge-case exceptions.
