import {
  buildDatabaseSnapshot,
  diffDatabaseSnapshots,
  generateMigrationPlan,
  loadDatabaseSnapshot,
  renderMigrationSql,
  writeMigrationFiles,
} from '@oxe/migrate-core';
import { buildSchemaGraph, loadSchemaProject, validateSchemaProject } from '@oxe/schema-core';

export interface CliResult {
  command: string;
  exitCode: number;
}

interface ParsedGenerateArgs {
  migrationName?: string;
  allowDestructive: boolean;
}

const parseGenerateArgs = (args: string[]): ParsedGenerateArgs => {
  let migrationName: string | undefined;
  let allowDestructive = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--allow-destructive') {
      allowDestructive = true;
      continue;
    }

    if (arg === '--name') {
      migrationName = args[index + 1];
      index += 1;
      continue;
    }
  }

  return { migrationName, allowDestructive };
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

  const project = await loadSchemaProject({ rootDir, schemaRoots: ['schemas'] });
  const validation = validateSchemaProject(project);

  if (!validation.ok) {
    printDiagnostics('Schema validation failed:', validation.diagnostics);
    return { command: 'migrate:generate', exitCode: 1 };
  }

  const graph = buildSchemaGraph(project);
  const nextSnapshot = buildDatabaseSnapshot(graph);
  const previousSnapshot = await loadDatabaseSnapshot({ rootDir });
  const diff = diffDatabaseSnapshots(previousSnapshot, nextSnapshot);
  const plan = generateMigrationPlan(diff, { allowDestructive: parsedArgs.allowDestructive });

  printDiagnostics('Migration diagnostics:', plan.diagnostics);

  if (plan.blocked) {
    console.error('Migration generation blocked due to destructive/risky changes.');
    return { command: 'migrate:generate', exitCode: 1 };
  }

  if (plan.operations.length === 0) {
    await writeMigrationFiles({
      plan,
      nextSnapshot,
      options: {
        rootDir,
        migrationName: parsedArgs.migrationName,
      },
    });
    console.log('No schema changes detected. Snapshot is up to date.');
    return { command: 'migrate:generate', exitCode: 0 };
  }

  const sql = renderMigrationSql(plan, { abortOnBlockedPlan: false });
  const writeResult = await writeMigrationFiles({
    plan,
    nextSnapshot,
    sql,
    options: {
      rootDir,
      migrationName: parsedArgs.migrationName,
    },
  });

  console.log(`Generated migration: ${writeResult.migrationPath}`);
  console.log(`Updated snapshot: ${writeResult.snapshotPath}`);

  return { command: 'migrate:generate', exitCode: 0 };
};

const printHelp = (): void => {
  console.log(`OXE CLI

Commands:
  oxe migrate:generate [--name <slug>] [--allow-destructive]
`);
};

export const runCli = async (args: string[]): Promise<CliResult> => {
  const command = args[0] ?? 'help';

  if (command === 'migrate:generate') {
    return runGenerateMigration(args.slice(1));
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
