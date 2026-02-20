import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

// Avoid creating a new pool on every hot reload in dev
declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

export const pool =
  global.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // If you need TLS:
    // ssl: { rejectUnauthorized: true },
  });

if (process.env.NODE_ENV !== "production") global.__pgPool = pool;

type DbContext = {
  sis_user_id: string | null;
  is_admin: boolean;
};

export async function withDbUserContext<T>(
  context: DbContext,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.sis_user_id', $1, true)`, [context.sis_user_id ?? ""]);
    await client.query(`SELECT set_config('app.is_admin', $1, true)`, [context.is_admin ? "true" : "false"]);

    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export type Queryable = {
  query: <R extends QueryResultRow = any>(
    text: string,
    values?: any[]
  ) => Promise<QueryResult<R>>;
};
