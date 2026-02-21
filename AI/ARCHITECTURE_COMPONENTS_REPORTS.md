```markdown
# Analytics Component Architecture
Client-Facing Reporting System – Declarative Join Model

---

## 1. Overview

This reporting system uses a **declarative component architecture**.

- All report data lives in the `data` schema.
- All reporting metadata lives in the `meta` schema.
- Components **do not store SQL**.
- Components define structured join specifications.
- SQL is generated server-side.
- Only a fixed set of join keys is allowed.

This ensures:

- Safe query generation
- No arbitrary SQL execution
- Predictable joins
- Automatic schema awareness
- Clear dependency tracking

---

## 2. Schemas

| Schema | Purpose |
|---------|----------|
| `auth`  | Authentication & user settings |
| `meta`  | Report and component metadata |
| `data`  | Warehouse-rendered reporting tables |

All component data sources are tables in `data`.

---

## 3. Core Principles

1. Every dataset is a table in `data`.
2. `meta.datasets.dataset_key` must match a real `data.<table>`.
3. No raw SQL is stored in metadata.
4. Only predefined join keys may be used.
5. Available join keys are derived from actual table columns.
6. Components are declarative and validated before execution.

---

## 4. Allowed Join Keys

Only these keys may be used in joins:

```

sis_user_id
course_code
program_code
major_code
department_code
academic_year
campus_code

````

Rules:

- A join may only use keys from this list.
- Join keys must exist in both tables.
- Keys are derived automatically from actual table columns.

---

## 5. Dataset Registry

### `meta.datasets`

Whitelists tables that can be used in components.

```sql
meta.datasets (
  dataset_key text primary key,  -- must match data.<table>
  name text,
  description text,
  is_active boolean default true
)
````

Constraints:

* `dataset_key` must correspond to an existing `data` table.
* All datasets are assumed to be tables in `data`.

---

## 6. Derived Available Keys

Available join keys are derived from real table columns using a view:

Conceptually:

```
available_keys =
  intersection(allowed_join_keys, actual table columns)
```

This ensures:

* No manual maintenance
* Automatic schema adaptation
* Safe join validation

---

## 7. Components

### `meta.components`

Defines reusable reporting components.

```sql
meta.components (
  component_key text primary key,
  name text,
  description text,
  base_dataset_key text references meta.datasets(dataset_key),
  spec jsonb not null,
  is_active boolean default true
)
```

Each component describes:

* A base dataset
* Optional joins
* Selected columns
* Parameterized filters
* Optional grouping and ordering

---

## 8. Component Spec Structure

Example:

```json
{
  "joins": [
    {
      "dataset_key": "courses",
      "type": "left",
      "on": ["course_code"]
    }
  ],
  "select": [
    {
      "dataset_key": "student_exit_status",
      "column": "exit_status",
      "as": "exit_status"
    }
  ],
  "filters": [
    {
      "dataset_key": "student_exit_status",
      "column": "academic_year",
      "op": "=",
      "param": "academic_year"
    }
  ],
  "group_by": [],
  "order_by": []
}
```

---

## 9. Component Rules

### Base Dataset

* Must exist in `meta.datasets`
* Must exist as `data.<dataset_key>`

---

### Joins

Each join must:

* Reference a valid dataset
* Use only allowed join keys
* Use keys that exist in both tables
* Be either `left` or `inner`

No expressions or arbitrary conditions allowed.

---

### Select Clause

Each select entry:

```
{
  "dataset_key": "...",
  "column": "...",
  "as": "optional_alias"
}
```

Rules:

* Column must exist in table
* No expressions or functions
* Aliases must be safe identifiers

---

### Filters

Each filter must:

* Use only allowed operators (`=`, `!=`, `in`, `between`, `>=`, `<=`)
* Be parameterized
* Not include raw SQL fragments
* Bind values safely in backend

---

## 10. Component Dependencies

`meta.component_dependencies` is derived from:

* `base_dataset_key`
* `spec.joins[*].dataset_key`

Used for:

* Impact analysis
* Cache invalidation
* Schema change auditing

---

## 11. SQL Compilation (Server-Side Only)

Process:

1. Validate component spec
2. Resolve base table (`data.<dataset_key>`)
3. Build joins using validated keys
4. Construct select clause
5. Apply parameterized filters
6. Bind parameters
7. Execute query

The system must never:

* Execute raw SQL from metadata
* Allow arbitrary schema access
* Accept unvalidated SQL fragments
* Use string concatenation for parameters

---

## 12. Validation Checklist

Before approving or generating a component:

**Datasets**

* [ ] Base dataset exists
* [ ] Join datasets exist
* [ ] Tables exist in `data`

**Joins**

* [ ] Join keys are allowed
* [ ] Join keys exist in both tables

**Columns**

* [ ] Selected columns exist
* [ ] No expressions used

**Filters**

* [ ] Operators allowed
* [ ] Parameterized only

---

## 13. Adding a New Component

1. Ensure table exists in `data`.
2. Add table to `meta.datasets`.
3. Confirm join keys exist.
4. Insert component spec into `meta.components`.
5. Validate.
6. Attach to report via `meta.report_components`.
7. Test and deploy.

---

## 14. System Intent

This architecture intentionally:

* Restricts query flexibility for safety
* Eliminates arbitrary SQL storage
* Forces joins on stable business keys
* Enables safe AI-assisted component creation
* Keeps metadata structured and machine-readable

It is a controlled reporting composition system — not a general-purpose query engine.