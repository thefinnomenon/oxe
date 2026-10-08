import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runCli } from '../src/index.js';

const chromePath =
  process.env.OXE_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const repositoryDirectory = fileURLToPath(new URL('../../../', import.meta.url));

const postgresBin = (): string | undefined => {
  try {
    const directory = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
    return existsSync(join(directory, 'initdb')) && existsSync(join(directory, 'pg_ctl'))
      ? directory
      : undefined;
  } catch {
    return undefined;
  }
};

const binaryDirectory = postgresBin();

const availablePort = (): Promise<number> =>
  new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a test port.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });

const waitForProcessOutput = (
  process_: ChildProcess,
  expected: string,
  timeoutMilliseconds = 20_000,
): Promise<void> =>
  new Promise((resolveOutput, reject) => {
    let output = '';
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for generated server output. Received: ${output}`)),
      timeoutMilliseconds,
    );
    const receive = (chunk: unknown) => {
      output += String(chunk);
      if (!output.includes(expected)) return;
      clearTimeout(timeout);
      resolveOutput();
    };
    process_.stdout?.on('data', receive);
    process_.stderr?.on('data', receive);
    process_.once('error', reject);
    process_.once('exit', (code) => {
      if (!output.includes(expected)) {
        clearTimeout(timeout);
        reject(new Error(`Generated server exited with code ${String(code)}. Output: ${output}`));
      }
    });
  });

interface DevtoolsResponse {
  readonly error?: { readonly message?: string };
  readonly id?: number;
  readonly result?: {
    readonly result?: { readonly value?: unknown };
  };
}

class ChromeSession {
  readonly #pending = new Map<
    number,
    { readonly reject: (error: Error) => void; readonly resolve: (value: DevtoolsResponse) => void }
  >();
  readonly #process: ChildProcess;
  readonly #profile: string;
  readonly #socket: WebSocket;
  #nextId = 0;

  private constructor(process_: ChildProcess, profile: string, socket: WebSocket) {
    this.#process = process_;
    this.#profile = profile;
    this.#socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as DevtoolsResponse;
      if (typeof message.id !== 'number') return;
      const pending = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      if (message.error)
        pending?.reject(new Error(message.error.message ?? 'DevTools command failed.'));
      else pending?.resolve(message);
    });
  }

  static async launch(url: string): Promise<ChromeSession> {
    const profile = await mkdtemp(join(tmpdir(), 'oxe-generated-chrome-'));
    const process_ = spawn(
      chromePath,
      [
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--no-first-run',
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const browserWebSocket = await new Promise<string>((resolveSocket, reject) => {
      let output = '';
      const timeout = setTimeout(
        () => reject(new Error('Chrome did not expose DevTools.')),
        10_000,
      );
      process_.once('error', reject);
      process_.stderr?.on('data', (chunk) => {
        output += String(chunk);
        const match = /DevTools listening on (ws:\/\/[^\s]+)/u.exec(output);
        if (!match?.[1]) return;
        clearTimeout(timeout);
        resolveSocket(match[1]);
      });
    });
    const debuggerOrigin = new URL(browserWebSocket.replace('ws:', 'http:')).origin;
    const target = (await fetch(`${debuggerOrigin}/json/new?${encodeURIComponent(url)}`, {
      method: 'PUT',
    }).then((response) => response.json())) as { readonly webSocketDebuggerUrl?: unknown };
    if (typeof target.webSocketDebuggerUrl !== 'string')
      throw new Error('Chrome target has no debugger URL.');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolveSocket, reject) => {
      socket.addEventListener('open', () => resolveSocket(), { once: true });
      socket.addEventListener('error', () => reject(new Error('Could not connect to Chrome.')), {
        once: true,
      });
    });
    const session = new ChromeSession(process_, profile, socket);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    return session;
  }

  async close(): Promise<void> {
    this.#socket.close();
    this.#process.kill('SIGTERM');
    await rm(this.#profile, { force: true, recursive: true });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const response = await this.send('Runtime.evaluate', {
      awaitPromise: true,
      expression,
      returnByValue: true,
    });
    return response.result?.result?.value as T;
  }

  async send(
    method: string,
    params: Readonly<Record<string, unknown>> = {},
  ): Promise<DevtoolsResponse> {
    return new Promise((resolveCommand, reject) => {
      const id = ++this.#nextId;
      this.#pending.set(id, { reject, resolve: resolveCommand });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async waitFor<T>(expression: string, accept: (value: T) => boolean): Promise<T> {
    const expires = Date.now() + 15_000;
    let value!: T;
    while (Date.now() < expires) {
      try {
        value = await this.evaluate<T>(expression);
        if (accept(value)) return value;
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('navigat')) throw error;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
    throw new Error(`Browser condition timed out. Last value: ${JSON.stringify(value)}`);
  }
}

describe.skipIf(!binaryDirectory || !existsSync(chromePath))(
  'generated application browser runtime',
  () => {
    let browser: ChromeSession | undefined;
    let dataDirectory = '';
    let postgresStarted = false;
    let projectDirectory = '';
    let serverProcess: ChildProcess | undefined;
    let baseURL = '';

    beforeAll(async () => {
      projectDirectory = await mkdtemp(join(tmpdir(), 'oxe-generated-application-'));
      dataDirectory = await mkdtemp(join(tmpdir(), 'oxe-generated-postgres-'));
      const extensionDirectory = join(projectDirectory, 'extensions');
      const packageDirectory = join(projectDirectory, 'node_modules');
      const oxePackageDirectory = join(packageDirectory, '@oxe');
      await mkdir(extensionDirectory, { recursive: true });
      await mkdir(oxePackageDirectory, { recursive: true });
      for (const packageName of ['auth', 'graph', 'postgres', 'router', 'server-functions'])
        await symlink(
          resolve(repositoryDirectory, 'packages', packageName),
          join(oxePackageDirectory, packageName),
          'dir',
        );
      await symlink(
        resolve(repositoryDirectory, 'apps/todo/node_modules/pg'),
        join(packageDirectory, 'pg'),
        'dir',
      );
      await writeFile(
        join(projectDirectory, 'package.json'),
        JSON.stringify({ name: 'generated-application-e2e', private: true, type: 'module' }),
        'utf8',
      );
      const componentSource = `export const statusCard = {
  define(contract) {
    if (customElements.get(contract.ssr.tag)) return;
    customElements.define(contract.ssr.tag, class extends HTMLElement {
      connectedCallback() {
        this.dataset.oxeCustomReady = 'true';
        this.textContent = String(this.label ?? this.getAttribute('label') ?? '');
      }
    });
  }
};
`;
      const styleSource = `oxe-status-card { color: rgb(1, 2, 3); display: block; }\n`;
      await writeFile(join(extensionDirectory, 'status-card.js'), componentSource, 'utf8');
      await writeFile(join(extensionDirectory, 'status-card.css'), styleSource, 'utf8');
      const fixture = await readFile(
        resolve(repositoryDirectory, 'examples/application-graph-todo/graph.json'),
        'utf8',
      );
      const graph = JSON.parse(fixture) as Record<string, unknown>;
      const integrity = (source: string): string =>
        `sha256:${createHash('sha256').update(source).digest('hex')}`;
      graph.modules = [
        {
          format: 'javascript',
          id: 'module.statusCard',
          integrity: integrity(componentSource),
          kind: 'extensionModule',
          name: 'Status card',
          source: 'extensions/status-card.js',
          target: 'browser',
        },
        {
          format: 'css',
          id: 'module.statusCardStyle',
          integrity: integrity(styleSource),
          kind: 'extensionModule',
          name: 'Status card style',
          source: 'extensions/status-card.css',
          target: 'browser',
        },
      ];
      graph.components = [
        {
          children: 'none',
          id: 'component.statusCard',
          implementation: { export: 'statusCard', module: 'module.statusCard' },
          kind: 'componentExtension',
          name: 'Status card',
          props: { label: { kind: 'string' } },
          ssr: { tag: 'oxe-status-card' },
        },
      ];
      graph.styles = [
        {
          id: 'style.statusCard',
          kind: 'style',
          name: 'Status card',
          stylesheets: ['module.statusCardStyle'],
          tokens: {},
        },
      ];
      const views = graph.views as { tree: { children?: unknown[] } }[];
      const view = views[0];
      if (!view) throw new Error('Todo fixture has no view.');
      view.tree.children = [
        {
          component: 'component.statusCard',
          id: 'element.statusCard',
          kind: 'component',
          props: { label: { kind: 'literal', value: 'Generated extension ready' } },
        },
        ...(view.tree.children ?? []),
      ];
      await writeFile(join(projectDirectory, 'graph.json'), JSON.stringify(graph), 'utf8');
      const errors: string[] = [];
      const exitCode = await runCli(
        ['build', '--project', projectDirectory, '--application-graph', 'graph.json'],
        {
          cwd: repositoryDirectory,
          io: { error: (message) => errors.push(message), log: () => undefined },
        },
      );
      if (exitCode !== 0)
        throw new Error(`Generated application build failed: ${errors.join('\n')}`);

      const postgresPort = await availablePort();
      execFileSync(
        join(binaryDirectory!, 'initdb'),
        ['-D', dataDirectory, '-A', 'trust', '-U', 'postgres', '--no-locale', '--encoding=UTF8'],
        { stdio: 'ignore' },
      );
      execFileSync(
        join(binaryDirectory!, 'pg_ctl'),
        [
          '-D',
          dataDirectory,
          '-l',
          join(dataDirectory, 'postgres.log'),
          '-o',
          `-F -p ${postgresPort} -h 127.0.0.1`,
          '-w',
          'start',
        ],
        { stdio: 'ignore' },
      );
      postgresStarted = true;
      const applicationPort = await availablePort();
      baseURL = `http://127.0.0.1:${applicationPort}`;
      serverProcess = spawn(
        process.execPath,
        [join(projectDirectory, 'dist', 'server', 'start.js')],
        {
          cwd: projectDirectory,
          env: {
            ...process.env,
            BETTER_AUTH_SECRET: 'generated-e2e-secret-with-at-least-32-characters',
            BETTER_AUTH_URL: baseURL,
            DATABASE_URL: `postgres://postgres@127.0.0.1:${postgresPort}/postgres`,
            HOST: '127.0.0.1',
            NODE_ENV: 'test',
            PORT: String(applicationPort),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      await waitForProcessOutput(serverProcess, 'is running at');
    }, 45_000);

    afterAll(async () => {
      await browser?.close();
      if (serverProcess && serverProcess.exitCode === null) {
        serverProcess.kill('SIGTERM');
        await new Promise<void>((resolveExit) => {
          const timeout = setTimeout(resolveExit, 5_000);
          serverProcess?.once('exit', () => {
            clearTimeout(timeout);
            resolveExit();
          });
        });
      }
      if (postgresStarted) {
        execFileSync(
          join(binaryDirectory!, 'pg_ctl'),
          ['-D', dataDirectory, '-m', 'fast', '-w', 'stop'],
          { stdio: 'ignore' },
        );
      }
      if (dataDirectory) await rm(dataDirectory, { force: true, recursive: true });
      if (projectDirectory) await rm(projectDirectory, { force: true, recursive: true });
    }, 30_000);

    it('serves immutable assets and enforces team-scoped tasks through the generated UI', async () => {
      const assetManifest = JSON.parse(
        await readFile(join(projectDirectory, 'dist', 'browser', 'asset-manifest.json'), 'utf8'),
      ) as { entries: { script: string; style?: string } };
      const shell = await fetch(`${baseURL}/tasks`);
      expect(shell.headers.get('cache-control')).toBe('no-store');
      const shellSource = await shell.text();
      expect(shellSource).toContain(`./${assetManifest.entries.script}`);
      const script = await fetch(`${baseURL}/${assetManifest.entries.script}`);
      expect(script.status).toBe(200);
      expect(script.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(await fetch(`${baseURL}/start.js`).then((response) => response.status)).toBe(404);
      if (assetManifest.entries.style) {
        const style = await fetch(`${baseURL}/${assetManifest.entries.style}`);
        expect(style.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      }

      browser = await ChromeSession.launch(`${baseURL}/sign-up`);
      await browser.waitFor<boolean>("Boolean(document.querySelector('form'))", Boolean);
      await browser.evaluate(`(() => {
        const form = document.querySelector('form');
        const values = { name: 'Generated User', email: 'generated-user@example.test', password: 'CorrectHorseBatteryStaple123!' };
        for (const [name, value] of Object.entries(values)) form.querySelector('[name="' + name + '"]').value = value;
        form.requestSubmit();
      })()`);
      await browser.waitFor<string>('location.pathname', (value) => value === '/tasks');
      await browser.waitFor<boolean>(
        `document.querySelector('[data-oxe-view-content]')?.getAttribute('aria-busy') === 'false'`,
        Boolean,
      );
      const extension = await browser.evaluate<{ color: string; ready: boolean; text: string }>(
        `(() => { const node = document.querySelector('oxe-status-card'); return { color: getComputedStyle(node).color, ready: node?.dataset.oxeCustomReady === 'true', text: node?.textContent ?? '' }; })()`,
      );
      expect(extension).toEqual({
        color: 'rgb(1, 2, 3)',
        ready: true,
        text: 'Generated extension ready',
      });

      const submit = (button: string, values: Readonly<Record<string, string>>) =>
        browser!.evaluate(`(() => {
          const form = [...document.forms].find((candidate) => [...candidate.querySelectorAll('button')].some((node) => node.textContent === ${JSON.stringify(button)}));
          if (!form) throw new Error('Missing form for ${button}');
          const values = ${JSON.stringify(values)};
          for (const [name, value] of Object.entries(values)) form.querySelector('[name="' + name + '"]').value = value;
          form.requestSubmit();
        })()`);
      const viewText = `document.querySelector('[data-oxe-view-content]')?.textContent ?? ''`;
      await submit('Create team', { name: 'Alpha team' });
      await browser.waitFor<string>(
        `JSON.stringify([...document.querySelectorAll('[data-oxe-context-controls] option')].map((node) => node.textContent))`,
        (value) => value.includes('Alpha team'),
      );
      await submit('Add', { title: 'Alpha task' });
      await browser.waitFor<string>(viewText, (value) => value.includes('Alpha task'));
      await submit('Create team', { name: 'Beta team' });
      await browser.waitFor<string>(
        `JSON.stringify([...document.querySelectorAll('[data-oxe-context-controls] option')].map((node) => node.textContent))`,
        (value) => value.includes('Alpha team') && value.includes('Beta team'),
      );
      await submit('Add', { title: 'Beta task' });
      await browser.waitFor<string>(viewText, (value) => value.includes('Beta task'));
      await browser.evaluate(`(() => {
        const select = document.querySelector('[data-oxe-context-controls] select');
        const alpha = [...select.options].find((option) => option.textContent === 'Alpha team');
        select.value = alpha.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await browser.waitFor<string>(
        viewText,
        (value) => value.includes('Alpha task') && !value.includes('Beta task'),
      );
    }, 45_000);
  },
);
