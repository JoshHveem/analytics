NAVIGATION DESIGN PHILOSOPHY
Use this document when changing sidebar behavior, navigation hierarchy, or edit/save UX.

CORE GOALS
- Make navigation predictable: users should always know where they are and what a click will do.
- Separate global movement from local context: page links and menu-body modes are different concerns.
- Keep density manageable as features grow: avoid cramming controls into one row or one visual cluster.
- Minimize accidental data loss: editing flows should have one clear save model.

INFORMATION ARCHITECTURE
- Two-pane sidebar model:
  - Left icon rail: global mode and quick-navigation controls.
  - Right panel: contextual content for the selected mode.
- Home is a navigation link, not a mode:
  - It routes to `/`.
  - It does not own or represent a right-panel content state.
- Sidebar modes represent panel state:
  - `Reports`, `Filters`, `Columns`, `Settings`.
- Contextual visibility rules:
  - `Filters` appears only when a report context exists.
  - `Columns` appears only in component-edit context.
  - If an active mode becomes invalid due to route/context changes, fallback to `Reports`.

VISUAL HIERARCHY
- Use icon rail for fast mode switching and stable muscle memory.
- Keep active-state emphasis on true modes only (not links like Home).
- Active mode highlight should be full-width within the rail for clear state readability.
- Maintain strong contrast and cross-theme clarity:
  - Rail is inverse of app dark mode.
  - Active icon tile matches panel surface to visually connect rail and panel.

INTERACTION MODEL
- Clicking a mode changes panel content, not route (unless mode action explicitly navigates).
- Clicking Home navigates only; it should not force mode changes.
- Report list includes a direct “All Reports” entry to re-anchor users quickly.
- Mobile and desktop should preserve behavior parity, even if presentation differs.

EDITING + SAVE PHILOSOPHY
- One save surface per editing context: sidebar save bar is the single commit point.
- Field-level edits (filters, columns, report name, etc.) should mark global dirty state.
- “Save Changes” commits all pending edits for current context.
- “Undo Changes” reverts local drafts to persisted server state.
- Avoid distributed save buttons that fragment user mental model.

ADMIN CREATION FLOW
- Report creation entry point is lightweight and obvious (`+` in Reports header).
- Creating a report should:
  - Create a valid `meta.reports` row.
  - Return the new report id.
  - Route directly to the report edit page.
- Default metadata should be safe, valid, and immediately editable.

IMPLEMENTATION STANDARDS
- Keep route parsing and mode availability explicit (no hidden side effects).
- Prefer event-driven sync for decoupled editor UIs and global sidebar save state.
- Ensure all navigation changes remain keyboard-accessible and screen-reader friendly.
- Preserve desktop + mobile support when adding or moving controls.
