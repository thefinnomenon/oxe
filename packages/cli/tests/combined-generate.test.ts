import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/index.js';

const schemaSource = `
import { bucket, field, table } from '@oxe/schema-core';

export const User = table('User', {
  fields: {
    email: field.string().unique(),
  },
});

export const Assets = bucket('Assets', {
  config: {
    fileType: ['image/*'],
    fileNamePolicy: {
      strategy: 'slugify-uuid',
    },
  },
});
`;

describe('migrate:generate combined DB + storage', () => {
  const originalCwd = process.cwd();
  let tempRoot = '';

  afterEach(async () => {
    process.chdir(originalCwd);
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = '';
    }
  });

  it('writes SQL and storage migration artifacts with aligned numbering', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oxe-cli-'));
    await mkdir(path.join(tempRoot, 'schemas'), { recursive: true });
    await writeFile(path.join(tempRoot, 'schemas', 'schema.ts'), schemaSource, 'utf8');

    process.chdir(tempRoot);

    const first = await runCli(['migrate:generate', '--name', 'init']);
    expect(first.exitCode).toBe(0);

    const migrationFilesAfterFirst = await readdir(path.join(tempRoot, 'migrations'));
    expect(migrationFilesAfterFirst).toContain('0001_init.sql');
    expect(migrationFilesAfterFirst).toContain('0001_init.storage.json');

    const second = await runCli(['migrate:generate', '--name', 'init']);
    expect(second.exitCode).toBe(0);

    const migrationFilesAfterSecond = await readdir(path.join(tempRoot, 'migrations'));
    expect(migrationFilesAfterSecond.filter((entry) => entry.endsWith('.sql'))).toHaveLength(1);
    expect(
      migrationFilesAfterSecond.filter((entry) => entry.endsWith('.storage.json')),
    ).toHaveLength(1);
  });
});
