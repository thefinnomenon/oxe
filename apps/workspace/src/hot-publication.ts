import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { findPackageJSON } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { buildProject } from '@oxe/cli';
import {
  ApplicationPublicationError,
  compileApplicationPostgresSchema,
  type ApplicationPublicationAdapterV1,
  type ApplicationPublicationPreparationV1,
  type PreparedApplicationRuntimeV1,
} from '@oxe/compiler';
import { serializeApplicationGraph, type ApplicationGraphV1 } from '@oxe/graph';
import { Pool, type PoolClient } from 'pg';

import type {
  WorkspaceApplicationTarget,
  WorkspaceApplicationTargetV1,
} from './application-target.js';

const PUBLICATION_STATE_SCHEMA = 'oxe.hot-publication-state.v1' as const;
const runtimePackages = Object.freeze([
  '@oxe/auth',
  '@oxe/graph',
  '@oxe/postgres',
  '@oxe/router',
  '@oxe/server-functions',
  'pg',
]);

interface PersistedHotPublicationV1 {
  readonly candidateId: string;
  readonly databaseName: string;
  readonly directory: string;
  readonly revision: number;
  readonly schemaVersion: typeof PUBLICATION_STATE_SCHEMA;
}

interface RunningNodeCandidate {
  readonly origin: string;
  stop(): Promise<void>;
}

export interface HotApplicationPublicationOptionsV1 {
  readonly allowedOrigins: readonly string[];
  readonly applicationTarget: WorkspaceApplicationTarget;
  readonly authSecret: string;
  readonly databaseURL: string;
  readonly expectedActiveRevision: number;
  readonly nodeExecutable?: string;
  readonly projectDirectory: string;
  readonly stateDirectory?: string;
}

export interface HotApplicationPublicationControllerV1 {
  readonly adapter: ApplicationPublicationAdapterV1;
  readonly recoveredRuntime?: PreparedApplicationRuntimeV1;
}

interface CandidateResources {
  readonly buildDirectory: string;
  readonly candidateId: string;
  readonly databaseName: string;
  readonly databaseURL: string;
  readonly graph: ApplicationGraphV1;
  readonly persisted: PersistedHotPublicationV1;
  readonly serverEntry: string;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const exactOrigin = (value: string): string => {
  const url = new URL(value);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new TypeError('Hot publication origins must be exact HTTP or HTTPS origins.');
  return url.origin;
};

const safeStateDirectory = (projectDirectory: string, requested?: string): string => {
  const directory = resolve(projectDirectory, requested ?? '.oxe/hot-publication');
  const path = relative(projectDirectory, directory);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path))
    throw new TypeError('Hot publication state must stay inside the application project.');
  return directory;
};

const databaseURLFor = (source: string, databaseName: string): string => {
  const url = new URL(source);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:')
    throw new TypeError('Hot publication requires a PostgreSQL connection URL.');
  url.pathname = `/${encodeURIComponent(databaseName)}`;
  return url.href;
};

const databaseNameFromURL = (source: string): string => {
  const name = decodeURIComponent(new URL(source).pathname.slice(1));
  if (!name) throw new TypeError('The PostgreSQL connection URL must select a database.');
  return name;
};

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const adminPool = (databaseURL: string): Pool =>
  new Pool({ connectionString: databaseURLFor(databaseURL, 'postgres'), max: 1 });

const createCandidateDatabase = async (
  sourceDatabaseURL: string,
  databaseName: string,
): Promise<string> => {
  const sourceName = databaseNameFromURL(sourceDatabaseURL);
  if (sourceName === databaseName)
    throw new TypeError('Candidate database must differ from source.');
  const pool = adminPool(sourceDatabaseURL);
  try {
    await pool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)} TEMPLATE template0`);
  } finally {
    await pool.end();
  }
  return databaseURLFor(sourceDatabaseURL, databaseName);
};

const dropCandidateDatabase = async (
  sourceDatabaseURL: string,
  databaseName: string,
): Promise<void> => {
  if (databaseNameFromURL(sourceDatabaseURL) === databaseName) return;
  const pool = adminPool(sourceDatabaseURL);
  try {
    await pool.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await pool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  } finally {
    await pool.end();
  }
};

interface TableNameRow {
  readonly table_name: string;
}

interface ColumnNameRow {
  readonly column_name: string;
}

interface ForeignKeyRow {
  readonly child_table: string;
  readonly parent_table: string;
}

const tableNames = async (client: PoolClient, schema: string): Promise<readonly string[]> =>
  (
    await client.query<TableNameRow>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [schema],
    )
  ).rows.map(({ table_name }) => table_name);

const orderedTables = async (
  client: PoolClient,
  schema: string,
  tables: readonly string[],
): Promise<readonly string[]> => {
  const available = new Set(tables);
  const dependencies = new Map(tables.map((table) => [table, new Set<string>()]));
  const rows = (
    await client.query<ForeignKeyRow>(
      `SELECT tc.table_name AS child_table, ccu.table_name AS parent_table
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_schema = tc.constraint_schema
        AND ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1`,
      [schema],
    )
  ).rows;
  for (const { child_table, parent_table } of rows)
    if (child_table !== parent_table && available.has(child_table) && available.has(parent_table))
      dependencies.get(child_table)?.add(parent_table);
  const ordered: string[] = [];
  while (ordered.length < tables.length) {
    const ready = tables.filter(
      (table) =>
        !ordered.includes(table) &&
        [...(dependencies.get(table) ?? [])].every((dependency) => ordered.includes(dependency)),
    );
    if (ready.length === 0)
      throw new Error(`Schema ${JSON.stringify(schema)} contains a cyclic table dependency.`);
    ordered.push(...ready);
  }
  return ordered;
};

const copySchemaData = async (
  source: PoolClient,
  target: PoolClient,
  schema: string,
  maximumRows: number,
): Promise<number> => {
  const sourceTables = await tableNames(source, schema);
  const targetTableSet = new Set(await tableNames(target, schema));
  const commonTables = sourceTables.filter((table) => targetTableSet.has(table));
  let copied = 0;
  for (const table of await orderedTables(target, schema, commonTables)) {
    const sourceColumns = new Set(
      (
        await source.query<ColumnNameRow>(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2`,
          [schema, table],
        )
      ).rows.map(({ column_name }) => column_name),
    );
    const columns = (
      await target.query<ColumnNameRow>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [schema, table],
      )
    ).rows
      .map(({ column_name }) => column_name)
      .filter((column) => sourceColumns.has(column));
    if (columns.length === 0) continue;
    const identifiers = columns.map(quoteIdentifier).join(', ');
    const rows = (
      await source.query<Record<string, unknown>>(
        `SELECT ${identifiers} FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`,
      )
    ).rows;
    copied += rows.length;
    if (copied > maximumRows)
      throw new RangeError(`Hot publication data copy exceeds ${maximumRows} rows.`);
    for (const row of rows) {
      const values = columns.map((column) => row[column]);
      const parameters = values.map((_, index) => `$${index + 1}`).join(', ');
      await target.query(
        `INSERT INTO ${quoteIdentifier(schema)}.${quoteIdentifier(table)} (${identifiers}) VALUES (${parameters})`,
        values,
      );
    }
  }
  return copied;
};

const copyDevelopmentData = async (
  sourceDatabaseURL: string,
  targetDatabaseURL: string,
  graph: ApplicationGraphV1,
): Promise<void> => {
  const sourcePool = new Pool({ connectionString: sourceDatabaseURL, max: 1 });
  const targetPool = new Pool({ connectionString: targetDatabaseURL, max: 1 });
  const source = await sourcePool.connect();
  const target = await targetPool.connect();
  try {
    await target.query('BEGIN');
    const schemas = [
      ...(graph.app.authentication ? ['auth'] : []),
      compileApplicationPostgresSchema(graph).schemaName,
    ];
    for (const schema of schemas) await copySchemaData(source, target, schema, 100_000);
    await target.query('COMMIT');
  } catch (error) {
    await target.query('ROLLBACK');
    throw error;
  } finally {
    source.release();
    target.release();
    await Promise.all([sourcePool.end(), targetPool.end()]);
  }
};

const availablePort = async (): Promise<number> =>
  new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a candidate port.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });

const stopped = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));
  child.kill('SIGTERM');
  let timeoutId: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolveTimeout) => {
    timeoutId = setTimeout(() => resolveTimeout('timeout'), 5_000);
  });
  const outcome = await Promise.race([exited.then(() => 'exited' as const), timeout]);
  if (timeoutId) clearTimeout(timeoutId);
  if (outcome === 'timeout') {
    child.kill('SIGKILL');
    await exited;
  }
};

const startNodeCandidate = async (
  resources: CandidateResources,
  options: HotApplicationPublicationOptionsV1,
): Promise<RunningNodeCandidate> => {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(options.nodeExecutable ?? process.execPath, [resources.serverEntry], {
    cwd: resources.buildDirectory,
    env: {
      ...process.env,
      BETTER_AUTH_SECRET: options.authSecret,
      BETTER_AUTH_URL: origin,
      DATABASE_URL: resources.databaseURL,
      HOST: '127.0.0.1',
      NODE_ENV: 'development',
      OXE_ALLOWED_ORIGINS: options.allowedOrigins.map(exactOrigin).join(','),
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let startupError: Error | undefined;
  const capture = (chunk: Buffer): void => {
    output = `${output}${chunk.toString('utf8')}`.slice(-8_192);
  };
  child.once('error', (error) => {
    startupError = error;
  });
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Generated runtime exited before it became healthy. ${output.trim()}`.trim());
    try {
      const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1_000) });
      const health = (await response.json()) as { readonly revision?: unknown };
      if (response.ok && health.revision === resources.graph.revision)
        return { origin, stop: () => stopped(child) };
    } catch {
      // Candidate startup is polled until the bounded deadline.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  await stopped(child);
  throw new Error(`Generated runtime health check timed out. ${output.trim()}`.trim());
};

const parsePersistedState = (value: unknown): PersistedHotPublicationV1 => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== PUBLICATION_STATE_SCHEMA ||
    !('candidateId' in value) ||
    typeof value.candidateId !== 'string' ||
    !('databaseName' in value) ||
    typeof value.databaseName !== 'string' ||
    !('directory' in value) ||
    typeof value.directory !== 'string' ||
    !('revision' in value) ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !/^r\d+-[a-f0-9]{12}$/u.test(value.candidateId) ||
    !/^oxe_hot_[a-z0-9_]+$/u.test(value.databaseName) ||
    value.directory.length === 0
  )
    throw new TypeError('Stored hot publication state is invalid.');
  return Object.freeze({
    candidateId: value.candidateId,
    databaseName: value.databaseName,
    directory: value.directory,
    revision: value.revision,
    schemaVersion: PUBLICATION_STATE_SCHEMA,
  });
};

const readState = async (path: string): Promise<PersistedHotPublicationV1 | undefined> => {
  try {
    return parsePersistedState(JSON.parse(await readFile(path, 'utf8')) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
};

const writeState = async (path: string, state: PersistedHotPublicationV1): Promise<void> => {
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, path);
};

const packageRoot = async (name: string): Promise<string> => {
  const manifestPath = findPackageJSON(name, import.meta.url);
  if (!manifestPath) throw new Error(`Could not resolve package root for ${name}.`);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { readonly name?: unknown };
  if (manifest.name !== name) throw new Error(`Resolved package root for ${name} is invalid.`);
  return dirname(manifestPath);
};

const linkRuntimePackages = async (directory: string): Promise<void> => {
  for (const name of runtimePackages) {
    const target = join(directory, 'node_modules', ...name.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await symlink(await packageRoot(name), target, 'dir');
  }
};

const candidateResources = async (
  preparation: ApplicationPublicationPreparationV1,
  options: HotApplicationPublicationOptionsV1,
  stateDirectory: string,
): Promise<CandidateResources> => {
  const candidateId = `r${preparation.graph.revision}-${randomBytes(6).toString('hex')}`;
  const directory = join(stateDirectory, 'candidates', candidateId);
  const projectDirectory = resolve(options.projectDirectory);
  const graphPath = join(directory, 'graph.json');
  const outputDirectory = join(directory, 'dist');
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(graphPath, serializeApplicationGraph(preparation.graph), 'utf8');
    const graphRelative = relative(projectDirectory, graphPath).split(sep).join('/');
    const outputRelative = relative(projectDirectory, outputDirectory).split(sep).join('/');
    await buildProject({
      applicationGraph: graphRelative,
      outputDirectory: outputRelative,
      projectDirectory,
    });
    await linkRuntimePackages(directory);
    const serverEntry = join(outputDirectory, 'server', 'start.js');
    await stat(serverEntry);
    const databaseName =
      `oxe_hot_${preparation.graph.app.id.replace(/[^a-z0-9]+/giu, '_').toLowerCase()}_r${preparation.graph.revision}_${randomBytes(4).toString('hex')}`.slice(
        0,
        63,
      );
    const persisted: PersistedHotPublicationV1 = {
      candidateId,
      databaseName,
      directory: relative(projectDirectory, directory).split(sep).join('/'),
      revision: preparation.graph.revision,
      schemaVersion: PUBLICATION_STATE_SCHEMA,
    };
    return {
      buildDirectory: outputDirectory,
      candidateId,
      databaseName,
      databaseURL: '',
      graph: preparation.graph,
      persisted,
      serverEntry,
    };
  } catch (error) {
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
};

const recoveredResources = (
  state: PersistedHotPublicationV1,
  graph: ApplicationGraphV1,
  options: HotApplicationPublicationOptionsV1,
): CandidateResources => {
  const directory = resolve(options.projectDirectory, state.directory);
  const resolvedProject = resolve(options.projectDirectory);
  const relativeDirectory = relative(resolvedProject, directory);
  if (
    relativeDirectory === '..' ||
    relativeDirectory.startsWith(`..${sep}`) ||
    isAbsolute(relativeDirectory)
  )
    throw new TypeError('Stored hot publication directory escapes the project.');
  const buildDirectory = join(directory, 'dist');
  return {
    buildDirectory,
    candidateId: state.candidateId,
    databaseName: state.databaseName,
    databaseURL: databaseURLFor(options.databaseURL, state.databaseName),
    graph,
    persisted: state,
    serverEntry: join(buildDirectory, 'server', 'start.js'),
  };
};

const preparedRuntime = (
  resources: CandidateResources,
  running: RunningNodeCandidate,
  options: HotApplicationPublicationOptionsV1,
  statePath: string,
  previousState: PersistedHotPublicationV1 | undefined,
  initialPreviousTarget?: WorkspaceApplicationTargetV1,
): PreparedApplicationRuntimeV1 => {
  const candidateTarget: WorkspaceApplicationTargetV1 = {
    databaseName: resources.databaseName,
    databaseURL: resources.databaseURL,
    id: resources.candidateId,
    revision: resources.graph.revision,
    url: running.origin,
  };
  let previousTarget = initialPreviousTarget;
  let stoppedOnce = false;
  const stop = async (): Promise<void> => {
    if (stoppedOnce) return;
    stoppedOnce = true;
    await running.stop();
  };
  return {
    activate: async () => {
      previousTarget = options.applicationTarget.activate(candidateTarget);
      try {
        await writeState(statePath, resources.persisted);
      } catch (error) {
        options.applicationTarget.restore(candidateTarget.id, previousTarget);
        previousTarget = undefined;
        throw error;
      }
    },
    dispose: async () => {
      if (previousTarget && options.applicationTarget.restore(candidateTarget.id, previousTarget)) {
        if (previousState) await writeState(statePath, previousState);
        else await rm(statePath, { force: true });
      }
      await stop();
      await dropCandidateDatabase(options.databaseURL, resources.databaseName);
      await rm(resolve(options.projectDirectory, resources.persisted.directory), {
        force: true,
        recursive: true,
      });
    },
    shutdown: stop,
  };
};

export const createHotApplicationPublication = async (
  options: HotApplicationPublicationOptionsV1,
  activeGraph: ApplicationGraphV1,
): Promise<HotApplicationPublicationControllerV1> => {
  const projectDirectory = resolve(options.projectDirectory);
  const stateDirectory = safeStateDirectory(projectDirectory, options.stateDirectory);
  const statePath = join(stateDirectory, 'active.json');
  await mkdir(stateDirectory, { recursive: true });
  const persisted = await readState(statePath);
  let recoveredRuntime: PreparedApplicationRuntimeV1 | undefined;
  if (!persisted && options.applicationTarget.current().revision !== options.expectedActiveRevision)
    throw new Error(
      `Active publication r${options.expectedActiveRevision} has no restartable hot-runtime state; the configured application is r${options.applicationTarget.current().revision}.`,
    );
  if (persisted) {
    if (persisted.revision !== options.expectedActiveRevision) {
      throw new Error(
        `Stored hot runtime r${persisted.revision} does not match active publication r${options.expectedActiveRevision}.`,
      );
    }
    const resources = recoveredResources(persisted, activeGraph, options);
    const running = await startNodeCandidate(resources, options);
    const previous = options.applicationTarget.current();
    options.applicationTarget.activate({
      databaseName: resources.databaseName,
      databaseURL: resources.databaseURL,
      id: resources.candidateId,
      revision: resources.graph.revision,
      url: running.origin,
    });
    recoveredRuntime = preparedRuntime(resources, running, options, statePath, undefined, previous);
  }
  const adapter: ApplicationPublicationAdapterV1 = {
    prepare: async (preparation) => {
      let resources: CandidateResources;
      try {
        resources = await candidateResources(preparation, options, stateDirectory);
      } catch (error) {
        throw new ApplicationPublicationError('build', message(error), { cause: error });
      }
      const sourceDatabaseURL =
        options.applicationTarget.current().databaseURL ?? options.databaseURL;
      let databaseCreated = false;
      let dataCopied = false;
      let running: RunningNodeCandidate | undefined;
      try {
        const databaseURL = await createCandidateDatabase(
          sourceDatabaseURL,
          resources.databaseName,
        );
        databaseCreated = true;
        resources = { ...resources, databaseURL };
        const bootstrap = await startNodeCandidate(resources, options);
        await bootstrap.stop();
        await copyDevelopmentData(sourceDatabaseURL, databaseURL, preparation.graph);
        dataCopied = true;
        running = await startNodeCandidate(resources, options);
        return preparedRuntime(resources, running, options, statePath, await readState(statePath));
      } catch (error) {
        await running?.stop().catch(() => undefined);
        if (databaseCreated)
          await dropCandidateDatabase(options.databaseURL, resources.databaseName).catch(
            () => undefined,
          );
        await rm(resolve(projectDirectory, resources.persisted.directory), {
          force: true,
          recursive: true,
        });
        throw error instanceof ApplicationPublicationError
          ? error
          : new ApplicationPublicationError(dataCopied ? 'runtime' : 'migration', message(error), {
              cause: error,
            });
      }
    },
  };
  return {
    adapter,
    ...(recoveredRuntime ? { recoveredRuntime } : {}),
  };
};
