import { Pool, type PoolConfig, type QueryResultRow } from 'pg';

import type {
  ApplicationSqlConnectionV1,
  ApplicationSqlPoolV1,
  ApplicationSqlResultV1,
} from './types.js';

const resultValue = <Row extends Record<string, unknown>>(result: {
  readonly rowCount: number | null;
  readonly rows: readonly QueryResultRow[];
}): ApplicationSqlResultV1<Row> => ({
  rowCount: result.rowCount ?? 0,
  rows: result.rows as readonly Row[],
});

/** Thin Node PostgreSQL transport. OXE owns every query and migration above this boundary. */
export const createNodePostgresPool = (configuration: PoolConfig): ApplicationSqlPoolV1 => {
  const pool = new Pool(configuration);
  return Object.freeze({
    close: async (): Promise<void> => pool.end(),
    query: async <Row extends Record<string, unknown>>(
      statement: string,
      parameters: readonly unknown[] = [],
    ): Promise<ApplicationSqlResultV1<Row>> =>
      resultValue<Row>(await pool.query(statement, [...parameters])),
    transaction: async <Value>(
      run: (connection: ApplicationSqlConnectionV1) => Promise<Value>,
    ): Promise<Value> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const connection: ApplicationSqlConnectionV1 = {
          query: async <Row extends Record<string, unknown>>(
            statement: string,
            parameters: readonly unknown[] = [],
          ): Promise<ApplicationSqlResultV1<Row>> =>
            resultValue<Row>(await client.query(statement, [...parameters])),
        };
        const result = await run(connection);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  });
};
