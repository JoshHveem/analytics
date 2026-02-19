import { Pool } from "pg";

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
