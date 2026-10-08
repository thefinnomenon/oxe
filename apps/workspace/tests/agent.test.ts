import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ApplicationDevelopmentSession } from '@oxe/compiler/application-session';
import {
  APPLICATION_DEVELOPMENT_INTERACTION_SCHEMA,
  loadApplicationGraph,
  type ApplicationGraphV1,
} from '@oxe/graph';
import { ApplicationRevisionStore } from '@oxe/graph/store';
import { afterEach, describe, expect, it } from 'vitest';

import {
  parseWorkspaceChatRequest,
  streamWorkspaceChat,
  WORKSPACE_MODEL_RESPONSE_SCHEMA,
  type WorkspaceAgentModelV1,
  type WorkspaceModelRequestV1,
  type WorkspaceModelResponseV1,
} from '../src/agent.js';

const fixtureUrl = new URL('../../../examples/application-graph-todo/graph.json', import.meta.url);
const todoGraph = (): ApplicationGraphV1 =>
  loadApplicationGraph(JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown);
const directories: string[] = [];
const sessions: ApplicationDevelopmentSession[] = [];

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  for (const directory of directories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

const setup = (): ApplicationDevelopmentSession => {
  const directory = mkdtempSync(join(tmpdir(), 'oxe-workspace-agent-'));
  directories.push(directory);
  const session = new ApplicationDevelopmentSession(
    new ApplicationRevisionStore(join(directory, 'workspace.sqlite')),
    todoGraph(),
  );
  sessions.push(session);
  return session;
};

class ScriptedModel implements WorkspaceAgentModelV1 {
  public readonly requests: WorkspaceModelRequestV1[] = [];
  public constructor(private readonly responses: WorkspaceModelResponseV1[]) {}
  public complete(request: WorkspaceModelRequestV1): Promise<WorkspaceModelResponseV1> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error('Scripted model has no response.');
    return Promise.resolve(response);
  }
}

describe('workspace model agent', () => {
  it('strictly bounds and validates interaction context at the chat boundary', () => {
    expect(
      parseWorkspaceChatRequest({
        interactions: [],
        messages: [{ role: 'user', text: 'Fix that button.' }],
      }),
    ).toEqual({ interactions: [], messages: [{ role: 'user', text: 'Fix that button.' }] });
    expect(() =>
      parseWorkspaceChatRequest({
        interactions: Array.from({ length: 21 }, () => ({})),
        messages: [{ role: 'user', text: 'Fix that button.' }],
      }),
    ).toThrow('at most 20');
    expect(() =>
      parseWorkspaceChatRequest({
        interactions: [
          {
            at: 1,
            kind: 'click',
            route: '/tasks?private=yes',
            schemaVersion: APPLICATION_DEVELOPMENT_INTERACTION_SCHEMA,
            sequence: 1,
            target: { control: 'button' },
          },
        ],
        messages: [{ role: 'user', text: 'Fix that button.' }],
      }),
    ).toThrow('pathname without query or hash');
  });

  it('inspects and previews through typed tools without publishing a revision', async () => {
    const session = setup();
    const batch = {
      base: 16,
      ops: [
        {
          as: 'priority',
          default: 'normal',
          entity: 'entity.task',
          name: 'priority',
          op: 'field.add' as const,
          type: { enum: ['low', 'normal', 'high'] },
        },
        { field: '$priority', form: 'element.createTaskForm', op: 'form.field.add' as const },
        { field: '$priority', list: 'element.taskList', op: 'list.display.add' as const },
      ],
    };
    const model = new ScriptedModel([
      {
        callId: 'inspect-task',
        input: { inspect: { kind: 'node', semanticId: 'entity.task' }, kind: 'inspect' },
        kind: 'tool',
        schemaVersion: WORKSPACE_MODEL_RESPONSE_SCHEMA,
        tool: 'inspect',
      },
      {
        callId: 'preview-priority',
        input: batch,
        kind: 'tool',
        schemaVersion: WORKSPACE_MODEL_RESPONSE_SCHEMA,
        tool: 'preview',
      },
      {
        kind: 'message',
        schemaVersion: WORKSPACE_MODEL_RESPONSE_SCHEMA,
        text: 'I prepared Task.priority for review.',
      },
    ]);
    const events = [];
    for await (const event of streamWorkspaceChat(
      session,
      model,
      'app.todo',
      [{ role: 'user', text: 'Add task priority.' }],
      new AbortController().signal,
      [
        {
          at: 1_788_451_200_000,
          kind: 'click',
          route: '/tasks',
          schemaVersion: APPLICATION_DEVELOPMENT_INTERACTION_SCHEMA,
          sequence: 1,
          target: {
            control: 'button',
            elementId: 'element.createTaskForm',
            label: 'Add task',
            operationId: 'operation.createTask',
          },
        },
      ],
    ))
      events.push(event);

    expect(events.filter((event) => event.kind !== 'progress').map((event) => event.kind)).toEqual([
      'tool',
      'tool',
      'preview',
      'message',
    ]);
    expect(events.filter((event) => event.kind === 'progress')).toHaveLength(5);
    expect(session.store.current('app.todo')?.revision).toBe(16);
    expect(model.requests[0]?.messages[0]?.text).toContain('TinyTodo r16');
    expect(model.requests[0]?.messages[0]?.text).toContain('operation.createTask');
    expect(model.requests[0]?.interactions[0]?.target?.elementId).toBe('element.createTaskForm');
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toEqual(['inspect', 'preview']);
    expect(model.requests[2]?.messages.some((message) => message.role === 'tool')).toBe(true);
  });
});
