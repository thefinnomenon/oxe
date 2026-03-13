import { Client } from 'pg';

import type { PostgresConnectionOptions } from './types.js';

const resolveConnectionString = (options: PostgresConnectionOptions): string => {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'Missing Postgres connection string. Pass connectionString or set DATABASE_URL.',
    );
  }
  return connectionString;
};

export const connectPostgres = async (options: PostgresConnectionOptions): Promise<Client> => {
  const client = new Client({
    connectionString: resolveConnectionString(options),
  });
  await client.connect();
  return client;
};
