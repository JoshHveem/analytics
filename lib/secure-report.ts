import { HttpError, type AuthUser } from "@/lib/auth";
import { type Queryable } from "@/lib/db";
import { withAuthedDb } from "@/lib/authed-db";
import {
  anonymizeRowsWithRules,
  getPiiColumnsForReport,
  type PiiColumnRule,
} from "@/lib/anonymize";

type DataRow = Record<string, unknown>;

function parseBool(value: string | null): boolean {
  return value === "1" || value === "true";
}

export async function assertAuthedDbContext(db: Queryable, user: AuthUser) {
  const { rows } = await db.query(
    `
    SELECT
      current_setting('app.sis_user_id', true) AS app_sis_user_id,
      current_setting('app.is_admin', true) AS app_is_admin
    `
  );

  const appSisUserId = String(rows[0]?.app_sis_user_id ?? "").trim();
  const appIsAdmin = String(rows[0]?.app_is_admin ?? "").trim() === "true";

  if (!appSisUserId) {
    throw new HttpError(500, { error: "RLS context missing: app.sis_user_id is not set" });
  }

  if (appSisUserId !== String(user.sis_user_id)) {
    throw new HttpError(500, {
      error: "RLS context mismatch: app.sis_user_id does not match authenticated user",
    });
  }

  if (appIsAdmin !== Boolean(user.is_admin)) {
    throw new HttpError(500, {
      error: "RLS context mismatch: app.is_admin does not match authenticated user",
    });
  }
}

export async function withSecureReport<T>(
  request: Request,
  reportRoute: string,
  fn: (args: {
    db: Queryable;
    user: AuthUser;
    anonymize: boolean;
    piiColumns: PiiColumnRule[];
    anonymizeRows: <R extends DataRow>(rows: R[]) => R[];
    meta: {
      anonymized: boolean;
      pii_columns: PiiColumnRule[];
    };
  }) => Promise<T>
): Promise<T> {
  const url = new URL(request.url);
  const anonymize = parseBool(url.searchParams.get("anonymize"));

  return withAuthedDb(async ({ db, user }) => {
    await assertAuthedDbContext(db, user);
    const piiColumns = await getPiiColumnsForReport(db, reportRoute);

    function anonymizeRows<R extends DataRow>(rows: R[]): R[] {
      return anonymizeRowsWithRules(rows, piiColumns, anonymize) as R[];
    }

    return fn({
      db,
      user,
      anonymize,
      piiColumns,
      anonymizeRows,
      meta: {
        anonymized: anonymize,
        pii_columns: piiColumns,
      },
    });
  });
}
