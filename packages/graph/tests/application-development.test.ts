import { describe, expect, it } from 'vitest';

import {
  APPLICATION_DEVELOPMENT_INTERACTION_SCHEMA,
  parseApplicationDevelopmentInteraction,
} from '../src/index.js';

const interaction = () => ({
  at: 1_788_451_200_000,
  kind: 'click',
  route: '/tasks',
  schemaVersion: APPLICATION_DEVELOPMENT_INTERACTION_SCHEMA,
  sequence: 4,
  target: {
    control: 'button',
    elementId: 'element.createTaskForm',
    label: 'Add task',
    operationId: 'operation.createTask',
  },
});

describe('application development interaction protocol', () => {
  it('accepts bounded semantic interaction context', () => {
    expect(parseApplicationDevelopmentInteraction(interaction())).toEqual(interaction());
  });

  it('rejects query data, unknown fields, and non-semantic identifiers', () => {
    expect(() =>
      parseApplicationDevelopmentInteraction({ ...interaction(), route: '/tasks?token=secret' }),
    ).toThrow('pathname without query or hash');
    expect(() =>
      parseApplicationDevelopmentInteraction({ ...interaction(), value: 'private task title' }),
    ).toThrow('invalid schema or fields');
    expect(() =>
      parseApplicationDevelopmentInteraction({
        ...interaction(),
        target: { ...interaction().target, fieldId: 'not stable' },
      }),
    ).toThrow('fieldId is not a semantic ID');
  });

  it('requires operation outcomes and stable operation IDs together', () => {
    expect(() =>
      parseApplicationDevelopmentInteraction({ ...interaction(), kind: 'operation' }),
    ).toThrow('require an outcome');
    expect(() =>
      parseApplicationDevelopmentInteraction({
        ...interaction(),
        kind: 'operation',
        outcome: 'started',
        target: { control: 'button' },
      }),
    ).toThrow('require an operationId');
  });
});
