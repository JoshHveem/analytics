import { type Queryable } from "@/lib/db";

export type PiiColumnRule = {
  column_name: string;
  alternate_column: string | null;
  redacted_value: string | null;
};

type DataRow = Record<string, unknown>;

export function anonymizeRowsWithRules(
  rows: DataRow[],
  piiColumns: PiiColumnRule[],
  enabled: boolean
): DataRow[] {
  if (!enabled || rows.length === 0 || piiColumns.length === 0) {
    return rows;
  }

  return rows.map((row) => {
    const output: DataRow = { ...row };

    for (const rule of piiColumns) {
      const targetColumn = String(rule.column_name ?? "").trim();
      if (!targetColumn || !(targetColumn in output)) {
        continue;
      }

      const alternateColumn = String(rule.alternate_column ?? "").trim();
      if (alternateColumn && alternateColumn in output) {
        output[targetColumn] = output[alternateColumn];
        continue;
      }

      output[targetColumn] = rule.redacted_value ?? null;
    }

    return output;
  });
}

export async function getPiiColumnsForReport(
  db: Queryable,
  _reportRoute: string
): Promise<PiiColumnRule[]> {
  const queryText = `
    SELECT
      pc.column_name,
      pc.alternate_column,
      pc.redacted_value
    FROM meta.pii_columns pc
    ORDER BY pc.column_name
  `;

  const { rows } = await db.query<{
    column_name: string | null;
    alternate_column: string | null;
    redacted_value: string | null;
  }>(queryText);

  return rows
    .map((row: { column_name: string | null; alternate_column: string | null; redacted_value: string | null }) => ({
      column_name: String(row.column_name ?? "").trim(),
      alternate_column: row.alternate_column ?? null,
      redacted_value: row.redacted_value ?? null,
    }))
    .filter((row: PiiColumnRule) => row.column_name.length > 0);
}
