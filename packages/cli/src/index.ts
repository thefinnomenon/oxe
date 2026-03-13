import {
  applyMigrations,
  buildDatabaseSnapshot,
  createMigrationPreview,
  detectDatabaseDriftFromPostgres,
  diffDatabaseSnapshots,
  getMigrationStatus,
  InteractivePromptAdapter,
  loadDatabaseSnapshot,
  loadMigrationStatus,
  planMigrationWithAmbiguityResolution,
  renderMigrationSql,
  writeMigrationFiles,
} from '@oxe/migrate-core';
import { buildSchemaGraph, loadSchemaProject, validateSchemaProject } from '@oxe/schema-core';
import {
  applyStorageMigrations,
  buildStorageSnapshot,
  createS3CompatibleProviderFromEnv,
  diffStorageSnapshots,
  generateStorageMigrationPlan,
  getStorageMigrationStatus,
  InteractiveStoragePromptAdapter,
  loadStorageMigrationFiles,
  loadStorageSnapshot,
  resolveStoragePaths,
  writeStorageMigrationFile,
} from '@oxe/storage-core';

export interface CliResult {
  command: string;
  exitCode: number;
}

interface ParsedGenerateArgs {
  migrationName?: string;
  allowDestructive: boolean;
  interactive: boolean;
  dryRun: boolean;
  bucketPrefix?: string;
}

interface ParsedDatabaseArgs {
  connectionString?: string;
  schema?: string;
  localOnly?: boolean;
  forceStorageDelete?: boolean;
}

const parseGenerateArgs = (args: string[]): ParsedGenerateArgs => {
  let migrationName: string | undefined;
  let allowDestructive = false;
  let interactive = false;
  let dryRun = false;
  let bucketPrefix: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--allow-destructive') {
      allowDestructive = true;
      continue;
    }
    if (arg === '--interactive') {
      interactive = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--name') {
      migrationName = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--bucket-prefix') {
      bucketPrefix = args[index + 1];
      index += 1;
      continue;
    }
  }

  return { migrationName, allowDestructive, interactive, dryRun, bucketPrefix };
};

const parseDatabaseArgs = (args: string[]): ParsedDatabaseArgs => {
  let connectionString: string | undefined;
  let schema: string | undefined;
  let localOnly = false;
  let forceStorageDelete = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--url') {
      connectionString = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--schema') {
      schema = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--local') {
      localOnly = true;
      continue;
    }

    if (arg === '--force-storage-delete') {
      forceStorageDelete = true;
      continue;
    }
  }

  return { connectionString, schema, localOnly, forceStorageDelete };
};

const printDiagnostics = (
  prefix: string,
  diagnostics: Array<{ code: string; severity: string; message: string }>,
): void => {
  if (diagnostics.length === 0) {
    return;
  }

  console.error(prefix);
  for (const diagnostic of diagnostics) {
    console.error(
      `- [${diagnostic.severity.toUpperCase()}][${diagnostic.code}] ${diagnostic.message}`,
    );
  }
};

const runGenerateMigration = async (args: string[]): Promise<CliResult> => {
  const parsedArgs = parseGenerateArgs(args);
  const rootDir = process.cwd();
  const bucketPrefix = parsedArgs.bucketPrefix ?? process.env.OXE_STORAGE_BUCKET_PREFIX;

  const project = await loadSchemaProject({ rootDir, schemaRoots: ['schemas'] });
  const validation = validateSchemaProject(project);

  if (!validation.ok) {
    printDiagnostics('Schema validation failed:', validation.diagnostics);
    return { command: 'migrate:generate', exitCode: 1 };
  }

  const graph = buildSchemaGraph(project);
  const nextDatabaseSnapshot = buildDatabaseSnapshot(graph);
  const previousDatabaseSnapshot = await loadDatabaseSnapshot({ rootDir });
  const databaseDiff = diffDatabaseSnapshots(previousDatabaseSnapshot, nextDatabaseSnapshot);
  const databasePromptAdapter =
    parsedArgs.interactive && process.stdin.isTTY && process.stdout.isTTY
      ? new InteractivePromptAdapter()
      : undefined;

  const databasePlanned = await planMigrationWithAmbiguityResolution(databaseDiff, {
    allowDestructive: parsedArgs.allowDestructive,
    nonInteractive: !parsedArgs.interactive,
    promptAdapter: databasePromptAdapter,
  });
  let databasePlan = databasePlanned.plan;

  const nextStorageSnapshot = buildStorageSnapshot(graph, { bucketPrefix });
  const previousStorageSnapshot = await loadStorageSnapshot({ rootDir });
  const storageDiff = diffStorageSnapshots(previousStorageSnapshot, nextStorageSnapshot);
  const storagePromptAdapter =
    parsedArgs.interactive && process.stdin.isTTY && process.stdout.isTTY
      ? new InteractiveStoragePromptAdapter()
      : undefined;
  let storagePlan = await generateStorageMigrationPlan(storageDiff, {
    allowDestructive: parsedArgs.allowDestructive,
    nonInteractive: !parsedArgs.interactive,
    promptAdapter: storagePromptAdapter,
  });

  printDiagnostics('DB migration diagnostics:', databasePlan.diagnostics);
  printDiagnostics('Storage migration diagnostics:', storagePlan.diagnostics);

  if (
    (databasePlan.blocked || storagePlan.blocked) &&
    parsedArgs.interactive &&
    !parsedArgs.allowDestructive &&
    (databasePromptAdapter?.confirmDestructive || storagePromptAdapter?.confirmDestructive)
  ) {
    const continueAnyway = databasePromptAdapter?.confirmDestructive
      ? await databasePromptAdapter.confirmDestructive()
      : await (storagePromptAdapter?.confirmDestructive?.() ?? Promise.resolve(false));
    if (continueAnyway) {
      const rePlannedDatabase = await planMigrationWithAmbiguityResolution(databaseDiff, {
        allowDestructive: true,
        nonInteractive: !parsedArgs.interactive,
        promptAdapter: databasePromptAdapter,
      });
      databasePlan = rePlannedDatabase.plan;
      storagePlan = await generateStorageMigrationPlan(storageDiff, {
        allowDestructive: true,
        nonInteractive: !parsedArgs.interactive,
        promptAdapter: storagePromptAdapter,
      });
      printDiagnostics('DB migration diagnostics (confirmed):', databasePlan.diagnostics);
      printDiagnostics('Storage migration diagnostics (confirmed):', storagePlan.diagnostics);
    }
  }

  if (databasePlan.blocked || storagePlan.blocked) {
    console.error(
      'Migration generation blocked due to destructive/risky DB or storage changes. Re-run with --allow-destructive or use --interactive and confirm.',
    );
    return { command: 'migrate:generate', exitCode: 1 };
  }

  if (parsedArgs.dryRun) {
    const dbPreview = createMigrationPreview(databasePlan);
    const storageOperationsByKind = storagePlan.operations.reduce<Record<string, number>>(
      (accumulator, operation) => {
        accumulator[operation.kind] = (accumulator[operation.kind] ?? 0) + 1;
        return accumulator;
      },
      {},
    );

    console.log(`DB dry run: ${dbPreview.operationCount} operation(s)`);
    if (Object.keys(dbPreview.operationsByKind).length > 0) {
      console.log(`DB operation counts: ${JSON.stringify(dbPreview.operationsByKind, null, 2)}`);
    }
    console.log(`Storage dry run: ${storagePlan.operations.length} operation(s)`);
    if (Object.keys(storageOperationsByKind).length > 0) {
      console.log(`Storage operation counts: ${JSON.stringify(storageOperationsByKind, null, 2)}`);
    }

    if (dbPreview.sql.trim().length > 0) {
      console.log('\n--- DB Migration SQL Preview ---');
      console.log(dbPreview.sql);
      console.log('--- End Preview ---');
    }
    if (storagePlan.operations.length > 0) {
      console.log('\n--- Storage Migration Preview ---');
      console.log(JSON.stringify(storagePlan.operations, null, 2));
      console.log('--- End Preview ---');
    }

    if (dbPreview.sql.trim().length === 0 && storagePlan.operations.length === 0) {
      console.log('No DB or storage changes detected.');
    }

    return { command: 'migrate:generate', exitCode: 0 };
  }

  const databaseSql =
    databasePlan.operations.length > 0
      ? renderMigrationSql(databasePlan, { abortOnBlockedPlan: false })
      : undefined;
  const dbWriteResult = await writeMigrationFiles({
    plan: databasePlan,
    nextSnapshot: nextDatabaseSnapshot,
    sql: databaseSql,
    options: {
      rootDir,
      migrationName: parsedArgs.migrationName,
    },
  });

  const storageWriteResult = await writeStorageMigrationFile({
    plan: storagePlan,
    nextSnapshot: nextStorageSnapshot,
    options: {
      rootDir,
      migrationName: parsedArgs.migrationName,
      migrationNumber: dbWriteResult.migrationNumber,
    },
  });

  if (databasePlan.operations.length === 0 && storagePlan.operations.length === 0) {
    console.log('No DB or storage changes detected. Snapshots are up to date.');
    return { command: 'migrate:generate', exitCode: 0 };
  }

  if (dbWriteResult.migrationPath) {
    console.log(`Generated DB migration: ${dbWriteResult.migrationPath}`);
  }
  if (storageWriteResult.migrationPath) {
    console.log(`Generated storage migration: ${storageWriteResult.migrationPath}`);
  }
  console.log(`Updated DB snapshot: ${dbWriteResult.snapshotPath}`);
  console.log(`Updated storage snapshot: ${storageWriteResult.storageSnapshotPath}`);

  return { command: 'migrate:generate', exitCode: 0 };
};

const runMigrationStatus = async (args: string[]): Promise<CliResult> => {
  const parsedArgs = parseDatabaseArgs(args);
  const rootDir = process.cwd();
  if (parsedArgs.localOnly) {
    const dbStatus = await loadMigrationStatus({ rootDir });
    const storageSnapshot = await loadStorageSnapshot({ rootDir });
    const storageFiles = await loadStorageMigrationFiles({ rootDir });
    const storagePaths = resolveStoragePaths({ rootDir });
    if (!dbStatus && !storageSnapshot) {
      console.log('No local DB/storage migration status found. Generate a migration first.');
      return { command: 'migrate:status', exitCode: 0 };
    }

    if (dbStatus) {
      console.log(`Local DB migration status:
- updatedAt: ${dbStatus.updatedAt}
- latestMigration: ${dbStatus.latestMigration ?? '<none>'}
- latestMigrationNumber: ${dbStatus.latestMigrationNumber ?? '<none>'}
- migrationFiles: ${dbStatus.migrationFiles.length}
- snapshotPath: ${dbStatus.snapshotPath}`);
    } else {
      console.log('Local DB migration status: <not found>');
    }
    console.log(`Local storage migration status:
- migrationFiles: ${storageFiles.length}
- snapshotPath: ${storagePaths.storageSnapshotPath}
- snapshotPresent: ${storageSnapshot ? 'yes' : 'no'}`);
    return { command: 'migrate:status', exitCode: 0 };
  }

  const dbStatus = await getMigrationStatus({
    rootDir,
    connectionString: parsedArgs.connectionString,
  });
  const storageStatus = await getStorageMigrationStatus({
    rootDir,
    connectionString: parsedArgs.connectionString,
  });
  console.log(`Database migration status:
- sql.localFiles: ${dbStatus.files.length}
- sql.appliedInDb: ${dbStatus.applied.length}
- sql.pending: ${dbStatus.pending.length}
- sql.extraAppliedInDb: ${dbStatus.extraAppliedInDatabase.length}
- storage.localFiles: ${storageStatus.files.length}
- storage.appliedInDb: ${storageStatus.applied.length}
- storage.pending: ${storageStatus.pending.length}
- storage.extraAppliedInDb: ${storageStatus.extraAppliedInDatabase.length}`);

  if (dbStatus.pending.length > 0) {
    console.log('Pending DB migrations:');
    for (const pending of dbStatus.pending) {
      console.log(`- ${pending.id}`);
    }
  }
  if (storageStatus.pending.length > 0) {
    console.log('Pending storage migrations:');
    for (const pending of storageStatus.pending) {
      console.log(`- ${pending.id}`);
    }
  }
  if (
    dbStatus.extraAppliedInDatabase.length > 0 ||
    storageStatus.extraAppliedInDatabase.length > 0
  ) {
    console.log('Applied in DB but missing locally:');
    for (const extra of dbStatus.extraAppliedInDatabase) {
      console.log(`- ${extra.id}`);
    }
    for (const extra of storageStatus.extraAppliedInDatabase) {
      console.log(`- ${extra.id}`);
    }
  }
  return { command: 'migrate:status', exitCode: 0 };
};

const runApplyMigrations = async (args: string[]): Promise<CliResult> => {
  const parsedArgs = parseDatabaseArgs(args);
  const rootDir = process.cwd();
  const dbResult = await applyMigrations({
    rootDir,
    connectionString: parsedArgs.connectionString,
  });

  const storageFiles = await loadStorageMigrationFiles({ rootDir });
  let storageAppliedCount = 0;
  let storagePendingCount = 0;
  let storageSkippedCount = 0;
  let storageAppliedIds: string[] = [];
  if (storageFiles.length > 0) {
    const provider = createS3CompatibleProviderFromEnv();
    const storageResult = await applyStorageMigrations({
      rootDir,
      connectionString: parsedArgs.connectionString,
      provider,
      forceDeleteNonEmptyBuckets: parsedArgs.forceStorageDelete ?? false,
    });
    storageAppliedCount = storageResult.appliedCount;
    storagePendingCount = storageResult.pendingCount;
    storageSkippedCount = storageResult.skipped.length;
    storageAppliedIds = storageResult.applied.map((entry) => entry.id);
  }

  console.log(`Applied migrations:
- db.applied: ${dbResult.appliedCount}
- db.pendingBeforeApply: ${dbResult.pendingCount}
- db.skippedAlreadyApplied: ${dbResult.skipped.length}
- storage.applied: ${storageAppliedCount}
- storage.pendingBeforeApply: ${storagePendingCount}
- storage.skippedAlreadyApplied: ${storageSkippedCount}`);
  if (dbResult.applied.length > 0) {
    console.log('Applied DB migration files:');
    for (const entry of dbResult.applied) {
      console.log(`- ${entry.id}`);
    }
  }
  if (storageAppliedIds.length > 0) {
    console.log('Applied storage migration files:');
    for (const id of storageAppliedIds) {
      console.log(`- ${id}`);
    }
  }
  return { command: 'migrate:apply', exitCode: 0 };
};

const runMigrationDrift = async (args: string[]): Promise<CliResult> => {
  const parsedArgs = parseDatabaseArgs(args);
  const rootDir = process.cwd();

  const project = await loadSchemaProject({ rootDir, schemaRoots: ['schemas'] });
  const validation = validateSchemaProject(project);
  if (!validation.ok) {
    printDiagnostics('Schema validation failed:', validation.diagnostics);
    return { command: 'migrate:drift', exitCode: 1 };
  }

  const expectedSnapshot = buildDatabaseSnapshot(buildSchemaGraph(project));
  const drift = await detectDatabaseDriftFromPostgres({
    expectedSnapshot,
    connection: {
      connectionString: parsedArgs.connectionString,
      schema: parsedArgs.schema,
    },
  });

  printDiagnostics('Drift diagnostics:', drift.diff.diagnostics);
  if (!drift.hasDrift) {
    console.log('No schema drift detected.');
    return { command: 'migrate:drift', exitCode: 0 };
  }

  console.log(`Schema drift detected:
- missingTables: ${drift.summary.missingTables.length}
- extraTables: ${drift.summary.extraTables.length}
- missingColumns: ${drift.summary.missingColumns.length}
- extraColumns: ${drift.summary.extraColumns.length}`);

  return { command: 'migrate:drift', exitCode: 1 };
};

const printHelp = (): void => {
  console.log(`OXE CLI

Commands:
  oxe migrate:generate [--name <slug>] [--allow-destructive] [--interactive] [--dry-run] [--bucket-prefix <prefix>]
  oxe migrate:apply [--url <postgres-url>] [--force-storage-delete]
  oxe migrate:status [--url <postgres-url>] [--local]
  oxe migrate:drift [--url <postgres-url>] [--schema <schema>]
`);
};

export const runCli = async (args: string[]): Promise<CliResult> => {
  const command = args[0] ?? 'help';

  if (command === 'migrate:generate') {
    return runGenerateMigration(args.slice(1));
  }
  if (command === 'migrate:status') {
    return runMigrationStatus(args.slice(1));
  }
  if (command === 'migrate:apply') {
    return runApplyMigrations(args.slice(1));
  }
  if (command === 'migrate:drift') {
    return runMigrationDrift(args.slice(1));
  }

  printHelp();
  return { command, exitCode: 0 };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2))
    .then((result) => {
      process.exitCode = result.exitCode;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`CLI failed: ${message}`);
      process.exitCode = 1;
    });
}
