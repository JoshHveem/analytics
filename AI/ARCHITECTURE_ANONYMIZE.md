## Anonymize Architecture

### Goal
- Provide a single, global anonymization mechanism for report data.
- Ensure PII masking happens server-side before data is returned to the client.
- Keep rules standardized across all reports by using one shared metadata table.

### Source of truth
- PII column policy lives in `meta.pii_columns`.
- Policy shape:
  - `column_name`
  - `alternate_column`
  - `redacted_value`
- Rules are global (not report-specific).

### Core implementation
- Shared module: `lib/anonymize.ts`
  - `getPiiColumnsForReport(...)`: reads global `meta.pii_columns` rules.
  - `anonymizeRowsWithRules(rows, piiColumns, enabled)`: applies replacement logic row-by-row.

### Replacement algorithm
- For each row and each rule:
  1. If `column_name` does not exist on the row, skip.
  2. If `alternate_column` exists and that column is present on the row, set:
     - `row[column_name] = row[alternate_column]`
  3. Else set:
     - `row[column_name] = redacted_value` (or `null` if missing)

### Request flow
1. User toggles Anonymize in `app/dashboard/SidebarClient.tsx`.
2. Toggle state is written to root attribute `data-anonymize` and localStorage.
3. Pages send `anonymize=1|0` to report APIs.
4. Report API route loads global PII rules and anonymizes `data` before `NextResponse.json(...)`.
5. Response includes `meta.anonymized` and `meta.pii_columns` (when `include_meta=1`).

### Current integration points
- API routes:
  - `app/api/reports/instructor-metrics/route.ts`
  - `app/api/reports/yearly-graduates/route.ts`
  - `app/api/reports/yearly-completers/route.ts` (re-exports yearly-graduates handler)
- Client pages passing anonymize param and refetching on toggle:
  - `app/reports/instructor-metrics/page.tsx`
  - `app/reports/yearly-graduates/page.tsx`
  - `app/reports/yearly-completers/page.tsx`

### Design constraints
- Only columns present in API row payloads can be anonymized.
- Derived display fields (example: computed `name` from `first_name` + `last_name`) are not directly affected unless the target key exists in row data.
- API response is authoritative; client should not re-implement masking logic.

### Implementation strategy for new reports
1. Standardize report SQL aliases so row keys match global `column_name` standards.
2. Add route support for `anonymize` query param.
3. Call shared anonymize helper before returning `data`.
4. Include `meta.anonymized` in metadata response.
5. Verify derived UI fields do not reconstruct redacted values unintentionally.

### Operational guidance
- Prefer setting `alternate_column` to stable non-PII identifiers when needed for analysis continuity.
- Use explicit `redacted_value` placeholders for human-readable masking in tables.
- Keep `meta.pii_columns` minimal and canonical; avoid duplicate semantics under different column names.
