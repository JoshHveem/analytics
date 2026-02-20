declare module "pg" {
  export interface QueryResultRow {
    [column: string]: any;
  }

  export interface QueryResult<R = any> {
    rows: R[];
    rowCount: number;
  }

  export interface PoolClient {
    query: <R = any>(
      text: string,
      values?: unknown[]
    ) => Promise<QueryResult<R>>;
    release: () => void;
  }

  export class Pool {
    constructor(config?: { connectionString?: string });
    connect: () => Promise<PoolClient>;
    query: <R = any>(
      text: string,
      values?: unknown[]
    ) => Promise<QueryResult<R>>;
  }
}
