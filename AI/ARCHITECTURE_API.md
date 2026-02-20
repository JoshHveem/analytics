## API Architecture

### Purpose
- Define one standard pattern for report API endpoints.
- Ensure auth context, security validation, and anonymization are always applied.
- Prevent per-route security drift.

### Core pattern
- All report endpoints must use `withSecureReport` from `lib/secure-report.ts`.
- `withSecureReport` is the required entry point for:
  - authenticated DB access (`withAuthedDb`)
  - RLS context validation (`assertAuthedDbContext`)
  - anonymize flag parsing (`anonymize=1|0`)
  - global PII policy loading (`meta.pii_columns`)
  - row-level anonymization (`anonymizeRows(...)`)
  - standardized metadata (`meta.anonymized`, `meta.pii_columns`)

### Current structure
- Auth:
  - `lib/auth.ts` (`requireAuth`)
- DB user context:
  - `lib/db.ts` (`withDbUserContext`)
  - `lib/authed-db.ts` (`withAuthedDb`)
- Report security + anonymization wrapper:
  - `lib/secure-report.ts` (`withSecureReport`)
- PII rules + transformation:
  - `lib/anonymize.ts`

### Required implementation strategy for new report APIs
1. Parse report-specific query params in the route handler.
2. Wrap route logic in `withSecureReport(request, "<route-name>", async (...) => { ... })`.
3. Execute report-specific SQL/filtering inside the callback.
4. Always pass row results through `anonymizeRows(...)` before returning `data`.
5. For `include_meta=1`, merge `...meta` into route metadata payload.
6. Return JSON with the existing API envelope (`ok`, `data`, `count`, optional `meta`).

### Required implementation strategy for non-report APIs
- If endpoint returns report-like row data or any potential PII, it must use the same secure wrapper pattern.
- If endpoint is utility-only and does not return row-level person data, document why anonymization is not required.

### Non-negotiable rule
- New report API routes must not call `withAuthedDb` directly.
- New report API routes must not manually duplicate auth-context checks or anonymization logic.
- `withSecureReport` is the single approved path for report data APIs.

### Migration rule
- Any existing report route still using route-local auth checks or route-local anonymization must be migrated to `withSecureReport` before feature expansion.
