import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  applicationValueMatchesType,
  createStandardApplicationCapability,
  loadApplicationGraph,
  projectCompactApplicationGraph,
  validateApplicationGraph,
  type ApplicationCapabilityV1,
  type ApplicationGraphV1,
} from '../src/index.js';

const fixtureUrl = new URL('../../../examples/application-graph-todo/graph.json', import.meta.url);
const todoGraph = (): ApplicationGraphV1 =>
  loadApplicationGraph(JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown);

const typedCapability = (): ApplicationCapabilityV1 => ({
  contract: 'oxe.capability.documents',
  id: 'capability.documents',
  kind: 'capability',
  methods: {
    import: {
      input: {
        fields: {
          attachment: { kind: 'bytes' },
          attempts: { kind: 'integer', maximum: 5, minimum: 1 },
          birthday: { kind: 'date' },
          contact: { kind: 'email' },
          homepage: { kind: 'url' },
          price: { kind: 'decimal', precision: 12, scale: 2 },
          tags: { items: { kind: 'string' }, kind: 'list', maximumItems: 8 },
          teamId: {
            kind: 'optional',
            value: { entity: 'entity.team', kind: 'entityId' },
          },
        },
        kind: 'record',
      },
      output: {
        kind: 'result',
        outcomes: {
          rejected: {
            fields: { reason: { kind: 'string' } },
            kind: 'record',
          },
        },
        value: {
          fields: { location: { kind: 'url' } },
          kind: 'record',
        },
      },
    },
  },
  name: 'Documents',
  version: '1',
});

describe('application value type system', () => {
  it('offers reusable provider-neutral capability recipes without restricting custom contracts', () => {
    const capabilities = (
      ['email', 'objectStorage', 'payments', 'realtime', 'search', 'webhookDelivery'] as const
    ).map((kind) => createStandardApplicationCapability(kind));
    const graph = { ...todoGraph(), capabilities };
    expect(validateApplicationGraph(graph)).toEqual([]);
    expect(capabilities.map(({ contract }) => contract)).toEqual([
      'oxe.capability.email',
      'oxe.capability.object-storage',
      'oxe.capability.payments',
      'oxe.capability.realtime',
      'oxe.capability.search',
      'oxe.capability.webhook-delivery',
    ]);
    expect(projectCompactApplicationGraph(graph)).toContain(
      'createCheckout{amount:{currency:str,minorUnits:int(0..)},idempotencyKey:str,returnUrl:url}->result<',
    );
  });

  it('validates refined, collection, optional, and result contracts deterministically', () => {
    const graph = { ...todoGraph(), capabilities: [typedCapability()] };
    expect(validateApplicationGraph(graph)).toEqual([]);
    const projection = projectCompactApplicationGraph(graph);
    expect(projection).toContain('attempts:int(1..5)');
    expect(projection).toContain('price:decimal(12,2)');
    expect(projection).toContain('tags:list[..8]<str>');
    expect(projection).toContain('teamId:id<E');
    expect(projectCompactApplicationGraph(graph)).toBe(projection);
  });

  it('reports malformed refinements and nested entity references at exact paths', () => {
    const capability = typedCapability();
    const graph = {
      ...todoGraph(),
      capabilities: [
        {
          ...capability,
          methods: {
            import: {
              ...capability.methods.import,
              input: {
                fields: {
                  count: { kind: 'integer', maximum: 1, minimum: 2 },
                  price: { kind: 'decimal', precision: 2, scale: 3 },
                  target: {
                    kind: 'optional',
                    value: { entity: 'entity.missing', kind: 'entityId' },
                  },
                },
                kind: 'record',
              },
            },
          },
        },
      ],
    } as unknown;
    expect(validateApplicationGraph(graph)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '$.capabilities[0].methods.import.input.fields.count.minimum',
          semanticId: 'capability.documents',
        }),
        expect.objectContaining({
          path: '$.capabilities[0].methods.import.input.fields.price.scale',
          semanticId: 'capability.documents',
        }),
      ]),
    );
    const structurallyValid = graph as ApplicationGraphV1;
    const method = structurallyValid.capabilities?.[0]?.methods.import;
    if (!method || method.input.kind !== 'record') throw new Error('Expected test capability.');
    expect(
      validateApplicationGraph({
        ...structurallyValid,
        capabilities: [
          {
            ...structurallyValid.capabilities![0]!,
            methods: {
              import: {
                ...method,
                input: {
                  ...method.input,
                  fields: {
                    ...method.input.fields,
                    count: { kind: 'integer', maximum: 2, minimum: 1 },
                    price: { kind: 'decimal', precision: 3, scale: 2 },
                  },
                },
              },
            },
          },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3103',
          path: '$.capabilities[0].methods.import.input.fields.target.value.entity',
        }),
      ]),
    );
  });

  it('checks exact JSON-domain values without coercion', () => {
    expect(applicationValueMatchesType(3, { kind: 'integer', maximum: 4, minimum: 1 })).toBe(true);
    expect(applicationValueMatchesType(3.5, { kind: 'integer' })).toBe(false);
    expect(applicationValueMatchesType('12.30', { kind: 'decimal', precision: 4, scale: 2 })).toBe(
      true,
    );
    expect(applicationValueMatchesType('12.345', { kind: 'decimal', precision: 5, scale: 2 })).toBe(
      false,
    );
    expect(applicationValueMatchesType(null, { kind: 'optional', value: { kind: 'url' } })).toBe(
      true,
    );
    expect(applicationValueMatchesType('not a url', { kind: 'url' })).toBe(false);
    expect(
      applicationValueMatchesType(
        { outcome: 'rejected', value: { reason: 'unsafe' } },
        {
          kind: 'result',
          outcomes: { rejected: { fields: { reason: { kind: 'string' } }, kind: 'record' } },
          value: { kind: 'string' },
        },
      ),
    ).toBe(true);
  });
});
