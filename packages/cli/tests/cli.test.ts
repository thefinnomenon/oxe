import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from '../src/index.js';

describe('OXE CLI', () => {
  it('prints localization commands in help', async () => {
    const logs: string[] = [];
    const exitCode = await runCli(['--help'], {
      cwd: process.cwd(),
      io: { error: (message) => logs.push(message), log: (message) => logs.push(message) },
    });
    expect(exitCode).toBe(0);
    expect(logs.join('\n')).toContain('oxe i18n sync');
    expect(logs.join('\n')).toContain('explicit sync');
  });

  it('loads a working-directory .env without overriding the shell environment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oxe-cli-'));
    const projectDirectory = join(directory, 'project');
    await mkdir(projectDirectory);
    await writeFile(
      join(projectDirectory, 'oxe.config.json'),
      `${JSON.stringify({
        i18n: {
          locales: ['es'],
          source: 'en-US',
          translation: {
            apiKeyEnv: 'OXE_TEST_ENV_LOADED',
            model: 'gpt-test',
            provider: 'openai',
          },
        },
      })}\n`,
      'utf8',
    );
    await writeFile(join(projectDirectory, 'App.oxe'), 'App():\n  <code i18n={false}>Code\n');
    await writeFile(
      join(directory, '.env'),
      'OXE_TEST_ENV_LOADED=from-file\nOXE_TEST_ENV_PRESERVED=from-file\n',
    );
    delete process.env.OXE_TEST_ENV_LOADED;
    process.env.OXE_TEST_ENV_PRESERVED = 'from-shell';

    try {
      await expect(
        runCli(['i18n', 'sync', '--project', projectDirectory], {
          cwd: directory,
          io: { error: () => undefined, log: () => undefined },
        }),
      ).resolves.toBe(0);
      expect(process.env.OXE_TEST_ENV_LOADED).toBe('from-file');
      expect(process.env.OXE_TEST_ENV_PRESERVED).toBe('from-shell');
    } finally {
      delete process.env.OXE_TEST_ENV_LOADED;
      delete process.env.OXE_TEST_ENV_PRESERVED;
    }
  });
});
