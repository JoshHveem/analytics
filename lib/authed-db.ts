import { type PoolClient } from "pg";
import { requireAuth, type AuthUser } from "./auth";
import { withDbUserContext } from "./db";

export async function withAuthedDb<T>(
  fn: (args: { db: PoolClient; user: AuthUser }) => Promise<T>
): Promise<T> {
  const user = await requireAuth();

  return withDbUserContext(
    { sis_user_id: user.sis_user_id, is_admin: user.is_admin },
    async (db) => fn({ db, user })
  );
}
