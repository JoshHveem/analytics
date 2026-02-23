# Report Metadata Builder Plan

## Goals
- Build reports from server-side metadata only (no route-local SQL definitions).
- Treat components as reusable UI/query templates with defaults.
- Keep report-specific data binding and behavior in report-level metadata.
- Preserve secure runtime standards (`withSecureReport`, RLS context validation, anonymization).

## Metadata Model (Current)
- `meta.components`
  - `component_code`
  - `name`
  - `description`
  - `default_settings` (or legacy `settings`)
  - `is_active`
- `meta.report_components`
  - `report_id`
  - `component_code`
  - `settings` (instance overrides)
  - `spec` (data binding: includes `sources[]` with exactly one `is_base=true`, plus joins/fields/sort/group rules)
  - `is_active`

## Runtime Contract
For a report route, runtime should:
1. Load report + active component attachment from metadata (`meta.reports` + `meta.report_components`).
2. Build and execute dataset query strictly from `meta.report_components.spec` (with safe validation).
3. Apply `withSecureReport` protections and anonymization before returning rows.
4. Return optional debug metadata (`selected_columns`, `compiled_sql_preview`, resolved settings).

This intentionally avoids report-specific or dataset-specific API endpoints.

## Spec Ownership Rules
- `meta.components` defines reusable defaults and display metadata only.
- `meta.report_components.spec` defines table-level data wiring for that specific report instance.
- `meta.report_components.settings` defines per-report behavior overrides (pagination, schema overrides, UI options, etc.).
- No raw SQL fragments are accepted from client input.
- Base table is resolved only from `spec.sources[]` where `is_base=true` (exactly one required).

## Guardrails
- Only allow whitelisted operators (`=`, `!=`, `in`, `between`, `>=`, `<=`, etc. per component type).
- Require exactly one `spec.sources[]` row with `is_base=true` in each active table spec.
- Reject joins using unknown aliases/keys or keys missing from either table.
- Validate all identifiers with strict safe identifier rules.
- Keep `execution_mode='custom'` fallback for legacy exceptions while migrating.

## UI Plan: Metadata Builder

### Route
- `app/reports/admin/metadata/page.tsx` (admin-only)

### UX Layout
- Left rail: reports with status (`draft`, `published`, `disabled`).
- Main tabs:
  1. `Report Definition`
  2. `Component Instances`
  3. `Spec Builder`
  4. `Settings`
  5. `Preview`

### Tab Details
1. Report Definition
- Edit `title`, `route`, `category`, `description`, active flag.

2. Component Instances
- Attach/detach active `component_code` rows to a report.
- Toggle `is_active` and ordering (if ordering column exists in schema).

3. Spec Builder
- Edit `report_components.spec`:
  - base dataset
  - joins and join keys
  - select fields/aliases
  - filter bindings
  - sort/group definitions

4. Settings
- Show effective settings diff:
  - component defaults
  - report overrides
  - merged result preview

5. Preview
- `Generated SQL` preview (read-only).
- `Sample rows` (secured context).
- `Table lineage` summary (what tables are used and where else they are used).

## API Endpoints for Builder
- `GET /api/reports/admin/metadata/catalog`
- `GET /api/reports/admin/metadata/:reportId`
- `PUT /api/reports/admin/metadata/:reportId`
- `POST /api/reports/admin/metadata/:reportId/validate`
- `POST /api/reports/admin/metadata/:reportId/preview`

All admin endpoints should:
- require authenticated admin user
- run inside existing DB user-context protections
- reject raw SQL payloads

## Rollout Sequence
1. Finalize `meta.components` + `meta.report_components` schema contract.
2. Backfill 1-2 simple reports into `report_components.spec/settings`.
3. Switch `/api/reports/components/table` to compile from `report_components.spec`.
4. Add metadata editor read-only mode first (catalog + preview).
5. Enable write mode (update settings/spec with validation).
6. Migrate legacy custom report routes incrementally.
