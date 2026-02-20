ARCHITECTURE_COLOR.md: check when updating color, styling, dark mode, accessibility, etc.
ARCHITECTURE_ANONYMIZE.md: check when updating or creating API calls, new reports, changing data for existing reports, etc.
ARCHITECTURE_API.md: check when updating or creating API calls or otherwise interfacing with the datbase


MANDATORY STANDARDS
-Abstract wherever possible. Any element that could be repeated in another report, page, etc, should be built as a component.
-All content must be designed to meet WCAG 2.1 AA accessibility at a minimum.
-All API queries must use the auth process to ensure RLS is applied and the anonymize process to ensure PII columns are anonymized.
-Content needs to be desktop and mobile friendly