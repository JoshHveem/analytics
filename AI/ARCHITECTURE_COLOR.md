## Color Palette + Dark Mode Architecture

### Source of truth
- All theme tokens are defined in `lib/color-palette.ts`.
- We keep two semantic palettes:
  - `LIGHT_APP_COLORS`
  - `DARK_APP_COLORS`
- `getAppColors(mode)` returns the active palette object.
- `applyAppTheme(root, mode)` writes palette values to CSS variables on the root element (`--app-*`).

### Token model
- We use semantic tokens (not raw utility colors) for UI surfaces:
  - `--app-background`
  - `--app-foreground`
  - `--app-surface`
  - `--app-surface-muted`
  - `--app-border`
  - `--app-text-strong`
  - `--app-text-muted`
  - `--app-overlay`
  - `--app-control-track`
  - `--app-control-track-active`
  - `--app-control-thumb`
- Status/accent colors (`green`, `yellow`, `red`, etc.) remain in the palette for charts/metrics, but surface/text/border decisions should use semantic tokens.

### Runtime behavior
- Dark mode is controlled from sidebar settings (`app/dashboard/SidebarClient.tsx`).
- Toggle writes to `localStorage` (`analytics-theme`) and applies:
  - `document.documentElement.classList.toggle("dark", ...)`
  - `document.documentElement.style.colorScheme = ...`
  - `applyAppTheme(document.documentElement, mode)`
- On load, theme is restored from storage (or system preference fallback).

### CSS integration
- `app/globals.css` defines root fallback values for all `--app-*` variables.
- Components should render using token-driven styles (`var(--app-...)`) instead of hardcoded utility colors.

### Component structure
- Theme-aware reusable primitives:
  - `CenteredModal`
  - `InfoModalTrigger`
  - `ReportContainer`
  - `MetaChip`
  - `ReportErrorBanner`
- These components encapsulate token usage so feature pages stay consistent and require minimal styling duplication.

### Implementation rule
- Do not introduce new hardcoded `zinc`/`white`/`black` UI colors in components.
- New UI should consume semantic palette tokens via inline style or shared component primitives.
- If a new visual state is needed, add a semantic token in `lib/color-palette.ts` rather than ad-hoc color values.

### Anonymize linkage
- `Anonymize` is a global UI setting (`data-anonymize="1"` on root).
- `ReportTable` observes this attribute and masks sensitive columns (`name`, `instructor`, `sis_user_id`, `*user*`), ensuring anonymization is centralized and theme-independent.
