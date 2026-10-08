import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTodoApplication, type TodoApplicationV1 } from '../src/server.js';

const availablePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a PostgreSQL test port.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

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
const baseURL = 'http://127.0.0.1:31337';
const developmentOperationsToken = 'test-development-operations-token-32-chars';

const responseCookies = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';', 1)[0])
    .filter((cookie): cookie is string => cookie !== undefined)
    .join('; ');

describe.skipIf(!binaryDirectory)('runnable Todo application', () => {
  let application!: TodoApplicationV1;
  let dataDirectory = '';
  let postgresStarted = false;

  beforeAll(async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), 'oxe-todo-app-test-'));
    const port = await availablePort();
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
        `-F -p ${port} -h 127.0.0.1`,
        '-w',
        'start',
      ],
      { stdio: 'ignore' },
    );
    postgresStarted = true;
    application = await createTodoApplication({
      authSecret: 'test-only-secret-with-at-least-32-characters',
      baseURL,
      clientSource: 'globalThis.__todoClientLoaded = true;',
      databaseURL: `postgres://postgres@127.0.0.1:${port}/postgres`,
      developmentParentOrigin: 'https://oxe-dev.finnternet.com',
      developmentOperationsToken,
      developmentSource: 'export const development = true;',
      generatedClientSource: 'export const generated = true;',
      generatedModuleSources: {
        '/generated/account-client.js': 'export const account = true;',
        '/generated/application-client-runtime.js': 'export const runtime = true;',
        '/generated/application-client-loader.js': 'export const loader = true;',
        '/generated/application-view.js':
          'export const applicationView = { schemaVersion: "oxe.application-browser-view.v1" };',
        '/generated/ownedTeam-client.js': 'export const owner = true;',
        '/generated/team-client.js': 'export const team = true;',
      },
    });
  }, 30_000);

  afterAll(async () => {
    await application?.close();
    if (postgresStarted) {
      execFileSync(
        join(binaryDirectory!, 'pg_ctl'),
        ['-D', dataDirectory, '-m', 'fast', '-w', 'stop'],
        { stdio: 'ignore' },
      );
    }
    if (dataDirectory) {
      await rm(dataDirectory, { force: true, recursive: true });
    }
  }, 30_000);

  const signUp = async (name: string, email: string): Promise<string> => {
    const response = await application.handle(
      new Request(`${baseURL}/api/auth/sign-up/email`, {
        body: JSON.stringify({ email, name, password: 'correct-horse-battery-staple' }),
        headers: { 'content-type': 'application/json', origin: baseURL },
        method: 'POST',
      }),
    );
    expect(response.status).toBe(200);
    return responseCookies(response);
  };

  const rpc = async (
    cookie: string,
    functionId: string,
    arguments_: readonly unknown[],
    contexts: readonly { readonly contextId: string; readonly recordId: string }[] = [],
  ) => {
    const response = await application.handle(
      new Request(`${baseURL}/api/functions`, {
        body: JSON.stringify({
          arguments: arguments_,
          functionId,
          schemaVersion: 'oxe.server-function-request.v1',
        }),
        headers: {
          'content-type': 'application/json',
          cookie,
          origin: baseURL,
          ...(contexts.length > 0 ? { 'x-oxe-active-contexts': JSON.stringify(contexts) } : {}),
          'x-oxe-server-function': '1',
        },
        method: 'POST',
      }),
    );
    return { response, value: (await response.json()) as unknown };
  };

  it('serves the graph-derived shell, assets, configuration, and health endpoint', async () => {
    const page = await application.handle(new Request(`${baseURL}/sign-in`));
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(page.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'self' https://oxe-dev.finnternet.com",
    );
    expect(await page.text()).toContain('<title>TinyTodo</title>');

    const configuration = await application.handle(new Request(`${baseURL}/config.js`));
    const configurationSource = await configuration.text();
    expect(configurationSource).toContain('"authBasePath":"/api/auth"');
    expect(configurationSource).toContain(
      '"developmentParentOrigin":"https://oxe-dev.finnternet.com"',
    );
    const client = await application.handle(new Request(`${baseURL}/app.js`));
    expect(await client.text()).toBe('globalThis.__todoClientLoaded = true;');
    const development = await application.handle(new Request(`${baseURL}/development.js`));
    expect(development.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await development.text()).toBe('export const development = true;');
    const generatedClient = await application.handle(
      new Request(`${baseURL}/generated/application-client.js`),
    );
    expect(await generatedClient.text()).toBe('export const generated = true;');
    const generatedRuntime = await application.handle(
      new Request(`${baseURL}/generated/application-client-runtime.js`),
    );
    expect(await generatedRuntime.text()).toBe('export const runtime = true;');
    const generatedView = await application.handle(
      new Request(`${baseURL}/generated/application-view.js`),
    );
    expect(await generatedView.text()).toContain('oxe.application-browser-view.v1');
    const health = await application.handle(new Request(`${baseURL}/health`));
    await expect(health.json()).resolves.toEqual({ appId: 'app.todo', revision: 16, status: 'ok' });
    const anonymousContext = await application.handle(new Request(`${baseURL}/api/context`));
    expect(anonymousContext.status).toBe(401);
    expect(anonymousContext.headers.get('cache-control')).toBe('no-store');
    const anonymousOptions = await application.handle(
      new Request(`${baseURL}/api/context-options?contextId=context.team`),
    );
    expect(anonymousOptions.status).toBe(401);
  });

  it('enforces Team context authorization and task isolation through HTTP', async () => {
    const anonymous = await rpc('', 'app.todo/query.myTasks', []);
    expect(anonymous.response.status).toBe(200);
    expect(anonymous.value).toMatchObject({
      error: { kind: 'unauthorized', status: 401 },
      ok: false,
    });

    const aliceCookie = await signUp('Alice', 'alice-app@example.test');
    const aliceContext = await application.handle(
      new Request(`${baseURL}/api/context`, { headers: { cookie: aliceCookie } }),
    );
    expect(aliceContext.status).toBe(200);
    await expect(aliceContext.json()).resolves.toMatchObject({
      activeContexts: [],
      schemaVersion: 'oxe.application-client-context.v1',
      userId: expect.any(String),
    });
    const undeclaredContext = await application.handle(
      new Request(`${baseURL}/api/context`, {
        headers: {
          cookie: aliceCookie,
          'x-oxe-active-contexts': JSON.stringify([
            { contextId: 'context.project', recordId: 'project-forged' },
          ]),
        },
      }),
    );
    expect(undeclaredContext.status).toBe(400);
    const createdTeam = await rpc(aliceCookie, 'app.todo/operation.createTeam', ['Alice team']);
    expect(createdTeam.value).toMatchObject({ ok: true, value: { name: 'Alice team' } });
    const aliceTeam = (createdTeam.value as { value: { id: string } }).value;
    const aliceOptions = await application.handle(
      new Request(`${baseURL}/api/context-options?contextId=context.team`, {
        headers: { cookie: aliceCookie },
      }),
    );
    await expect(aliceOptions.json()).resolves.toEqual([
      {
        contextId: 'context.team',
        entityId: 'entity.team',
        label: 'Alice team',
        recordId: aliceTeam.id,
      },
    ]);
    const aliceSelection = [{ contextId: 'context.team', recordId: aliceTeam.id }] as const;
    const aliceResolvedContext = await application.handle(
      new Request(`${baseURL}/api/context`, {
        headers: {
          cookie: aliceCookie,
          'x-oxe-active-contexts': JSON.stringify(aliceSelection),
        },
      }),
    );
    expect(aliceResolvedContext.status).toBe(200);
    await expect(aliceResolvedContext.json()).resolves.toMatchObject({
      activeContexts: [
        { contextId: 'context.team', entityId: 'entity.team', recordId: aliceTeam.id },
      ],
    });
    const created = await rpc(
      aliceCookie,
      'app.todo/operation.createTask',
      ['Alice private task'],
      aliceSelection,
    );
    expect(created.response.status).toBe(200);
    expect(created.value).toMatchObject({
      functionId: 'app.todo/operation.createTask',
      ok: true,
      value: { done: false, title: 'Alice private task' },
    });

    const bobCookie = await signUp('Bob', 'bob-app@example.test');
    const bobSession = await application.handle(
      new Request(`${baseURL}/api/context`, { headers: { cookie: bobCookie } }),
    );
    const bobSessionValue = (await bobSession.json()) as { readonly userId: string };
    const forbiddenContext = await application.handle(
      new Request(`${baseURL}/api/context`, {
        headers: {
          cookie: bobCookie,
          'x-oxe-active-contexts': JSON.stringify(aliceSelection),
        },
      }),
    );
    expect(forbiddenContext.status).toBe(403);
    const ownerSelection = [{ contextId: 'context.ownedTeam', recordId: aliceTeam.id }] as const;
    const invited = await rpc(
      aliceCookie,
      'app.todo/operation.inviteTeamMember',
      [bobSessionValue.userId],
      ownerSelection,
    );
    expect(invited.value).toMatchObject({
      ok: true,
      value: {
        accepted: false,
        role: 'member',
        status: 'active',
        userId: bobSessionValue.userId,
      },
    });
    const invitation = (invited.value as { value: unknown }).value;
    const duplicateInvite = await rpc(
      aliceCookie,
      'app.todo/operation.inviteTeamMember',
      [bobSessionValue.userId],
      ownerSelection,
    );
    expect(duplicateInvite.value).toMatchObject({
      error: { kind: 'validation', status: 400 },
      ok: false,
    });
    const missingUserInvite = await rpc(
      aliceCookie,
      'app.todo/operation.inviteTeamMember',
      ['user-does-not-exist'],
      ownerSelection,
    );
    expect(missingUserInvite.value).toMatchObject({
      error: { kind: 'not-found', status: 404 },
      ok: false,
    });
    const bobSharedContext = await application.handle(
      new Request(`${baseURL}/api/context`, {
        headers: {
          cookie: bobCookie,
          'x-oxe-active-contexts': JSON.stringify(aliceSelection),
        },
      }),
    );
    expect(bobSharedContext.status).toBe(403);
    const bobOptions = await application.handle(
      new Request(`${baseURL}/api/context-options?contextId=context.team`, {
        headers: { cookie: bobCookie },
      }),
    );
    await expect(bobOptions.json()).resolves.toEqual([]);
    const bobInvitations = await rpc(bobCookie, 'app.todo/query.myTeamInvitations', []);
    expect(bobInvitations.value).toMatchObject({
      ok: true,
      value: [expect.objectContaining({ accepted: false, userId: bobSessionValue.userId })],
    });
    const accepted = await rpc(bobCookie, 'app.todo/operation.acceptTeamInvitation', [invitation]);
    expect(accepted.value).toMatchObject({
      ok: true,
      value: { accepted: true, userId: bobSessionValue.userId },
    });
    const remainingInvitations = await rpc(bobCookie, 'app.todo/query.myTeamInvitations', []);
    expect(remainingInvitations.value).toMatchObject({ ok: true, value: [] });
    const acceptedInvitation = (accepted.value as { value: unknown }).value;
    const acceptedContext = await application.handle(
      new Request(`${baseURL}/api/context`, {
        headers: {
          cookie: bobCookie,
          'x-oxe-active-contexts': JSON.stringify(aliceSelection),
        },
      }),
    );
    expect(acceptedContext.status).toBe(200);
    const acceptedOptions = await application.handle(
      new Request(`${baseURL}/api/context-options?contextId=context.team`, {
        headers: { cookie: bobCookie },
      }),
    );
    await expect(acceptedOptions.json()).resolves.toEqual([
      expect.objectContaining({ label: 'Alice team', recordId: aliceTeam.id }),
    ]);
    const ownerInvitations = await rpc(
      aliceCookie,
      'app.todo/query.teamInvitations',
      [],
      ownerSelection,
    );
    expect(ownerInvitations.value).toMatchObject({
      ok: true,
      value: [expect.objectContaining({ accepted: true, userId: bobSessionValue.userId })],
    });
    const bobCannotOwn = await application.handle(
      new Request(`${baseURL}/api/context`, {
        headers: {
          cookie: bobCookie,
          'x-oxe-active-contexts': JSON.stringify(ownerSelection),
        },
      }),
    );
    expect(bobCannotOwn.status).toBe(403);
    const sharedTasks = await rpc(bobCookie, 'app.todo/query.myTasks', [], aliceSelection);
    expect(sharedTasks.value).toMatchObject({
      ok: true,
      value: [expect.objectContaining({ title: 'Alice private task' })],
    });
    const revoked = await rpc(
      aliceCookie,
      'app.todo/operation.revokeTeamInvitation',
      [acceptedInvitation],
      ownerSelection,
    );
    expect(revoked.value).toMatchObject({
      ok: true,
      value: { userId: bobSessionValue.userId },
    });
    const revokedContext = await application.handle(
      new Request(`${baseURL}/api/context`, {
        headers: {
          cookie: bobCookie,
          'x-oxe-active-contexts': JSON.stringify(aliceSelection),
        },
      }),
    );
    expect(revokedContext.status).toBe(403);
    const createdBobTeam = await rpc(bobCookie, 'app.todo/operation.createTeam', ['Bob team']);
    const bobTeam = (createdBobTeam.value as { value: { id: string } }).value;
    const bobSelection = [{ contextId: 'context.team', recordId: bobTeam.id }] as const;
    const bobTasks = await rpc(bobCookie, 'app.todo/query.myTasks', [], bobSelection);
    expect(bobTasks.response.status).toBe(200);
    expect(bobTasks.value).toMatchObject({ ok: true, value: [] });

    const createdEnvelope = created.value as { value: unknown };
    const forbidden = await rpc(
      bobCookie,
      'app.todo/operation.toggleTask',
      [createdEnvelope.value],
      bobSelection,
    );
    expect(forbidden.response.status).toBe(200);
    expect(forbidden.value).toMatchObject({
      error: { kind: 'forbidden', status: 403 },
      ok: false,
    });

    const renamed = await rpc(
      aliceCookie,
      'app.todo/operation.renameTask',
      [createdEnvelope.value, 'Alice renamed task'],
      aliceSelection,
    );
    expect(renamed.value).toMatchObject({
      ok: true,
      value: { title: 'Alice renamed task' },
    });
    const renamedEnvelope = renamed.value as { value: unknown };
    const forbiddenDelete = await rpc(
      bobCookie,
      'app.todo/operation.deleteTask',
      [renamedEnvelope.value],
      bobSelection,
    );
    expect(forbiddenDelete.value).toMatchObject({
      error: { kind: 'forbidden', status: 403 },
      ok: false,
    });
    const deleted = await rpc(
      aliceCookie,
      'app.todo/operation.deleteTask',
      [renamedEnvelope.value],
      aliceSelection,
    );
    expect(deleted.value).toMatchObject({ ok: true, value: { title: 'Alice renamed task' } });
    const aliceTasks = await rpc(aliceCookie, 'app.todo/query.myTasks', [], aliceSelection);
    expect(aliceTasks.value).toMatchObject({ ok: true, value: [] });
  });

  it('protects metadata-only runtime operations while the outbox worker is running', async () => {
    const missingCredentials = await application.handle(
      new Request(`${baseURL}/api/development/operations`),
    );
    expect(missingCredentials.status).toBe(401);

    const response = await application.handle(
      new Request(`${baseURL}/api/development/operations`, {
        headers: { authorization: `Bearer ${developmentOperationsToken}` },
      }),
    );
    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as Record<string, unknown>;
    expect(snapshot).toMatchObject({
      appId: 'app.todo',
      deadLetterJobs: [],
      graphRevision: 16,
      schemaVersion: 'oxe.application-development-operations.v1',
      worker: { state: 'running' },
    });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('alice-app@example.test');
    expect(serialized).not.toContain('server-secret-session-id');
    expect(serialized).not.toContain('payload');

    const invalidReplay = await application.handle(
      new Request(`${baseURL}/api/development/operations`, {
        body: JSON.stringify({}),
        headers: {
          authorization: `Bearer ${developmentOperationsToken}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      }),
    );
    expect(invalidReplay.status).toBe(400);
  });
});
