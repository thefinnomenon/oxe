export interface ApplicationSqlResultV1<Row extends Record<string, unknown>> {
  readonly rowCount: number;
  readonly rows: readonly Row[];
}

export interface ApplicationSqlConnectionV1 {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    parameters?: readonly unknown[],
  ): Promise<ApplicationSqlResultV1<Row>>;
}

export interface ApplicationSqlPoolV1 extends ApplicationSqlConnectionV1 {
  close(): Promise<void>;
  transaction<Value>(
    run: (connection: ApplicationSqlConnectionV1) => Promise<Value>,
  ): Promise<Value>;
}
