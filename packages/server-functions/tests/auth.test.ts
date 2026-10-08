import { describe, expect, it, vi } from 'vitest';

import {
  APPLICATION_ACTIVE_CONTEXT_HEADER,
  createApplicationClientContext,
  createBetterAuthApplicationContext,
  readApplicationActiveContextRequest,
} from '../src/auth.js';

describe('Better Auth application context adapter', () => {
  it('uses only the verified user/session and server-resolved active context chain', async () => {
    const resolve = vi.fn(async () => [
      {
        contextId: 'context.organization',
        entityId: 'builtin.organization',
        recordId: 'org-authorized',
      },
      { contextId: 'context.project', entityId: 'entity.project', recordId: 'project-authorized' },
    ]);

    await expect(
      createBetterAuthApplicationContext(
        { session: { id: 'session-1' }, user: { id: 'user-1' } },
        [{ contextId: 'context.organization', recordId: 'org-forged' }],
        resolve,
      ),
    ).resolves.toEqual({
      activeContexts: [
        {
          contextId: 'context.organization',
          entityId: 'builtin.organization',
          recordId: 'org-authorized',
        },
        {
          contextId: 'context.project',
          entityId: 'entity.project',
          recordId: 'project-authorized',
        },
      ],
      sessionId: 'session-1',
      userId: 'user-1',
    });
    expect(resolve).toHaveBeenCalledWith('user-1', [
      { contextId: 'context.organization', recordId: 'org-forged' },
    ]);
  });

  it('returns an anonymous context and rejects active scopes without a resolver', async () => {
    await expect(createBetterAuthApplicationContext(undefined)).resolves.toEqual({});
    await expect(
      createBetterAuthApplicationContext({ session: { id: 'session-1' }, user: { id: 'user-1' } }, [
        { contextId: 'context.project', recordId: 'project-unverified' },
      ]),
    ).rejects.toThrow('requires a server-side resolver');
  });

  it('strictly parses declared active-context selections', () => {
    const headers = new Headers({
      [APPLICATION_ACTIVE_CONTEXT_HEADER]: JSON.stringify([
        { contextId: 'context.organization', recordId: 'org-1' },
        { contextId: 'context.project', recordId: 'project-1' },
      ]),
    });
    expect(
      readApplicationActiveContextRequest(headers, ['context.organization', 'context.project']),
    ).toEqual([
      { contextId: 'context.organization', recordId: 'org-1' },
      { contextId: 'context.project', recordId: 'project-1' },
    ]);
    expect(() =>
      readApplicationActiveContextRequest(
        new Headers({
          [APPLICATION_ACTIVE_CONTEXT_HEADER]: JSON.stringify([
            { contextId: 'context.project', recordId: 'project-1' },
            { contextId: 'context.project', recordId: 'project-2' },
          ]),
        }),
        ['context.project'],
      ),
    ).toThrow('selected more than once');
    expect(() =>
      readApplicationActiveContextRequest(
        new Headers({
          [APPLICATION_ACTIVE_CONTEXT_HEADER]: JSON.stringify([
            { contextId: 'context.team', recordId: 'team-1' },
          ]),
        }),
        ['context.project'],
      ),
    ).toThrow('is not declared');
  });

  it('projects only browser-safe authenticated context', () => {
    expect(
      createApplicationClientContext({
        activeContexts: [
          { contextId: 'context.project', entityId: 'entity.project', recordId: 'project-1' },
        ],
        sessionId: 'server-secret-session-id',
        userId: 'user-1',
      }),
    ).toEqual({
      activeContexts: [
        { contextId: 'context.project', entityId: 'entity.project', recordId: 'project-1' },
      ],
      schemaVersion: 'oxe.application-client-context.v1',
      userId: 'user-1',
    });
    expect(() => createApplicationClientContext({})).toThrow('Authentication is required');
  });
});
