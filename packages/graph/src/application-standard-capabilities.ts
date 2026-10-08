import type { ApplicationCapabilityV1, ApplicationValueTypeV1 } from './application-types.js';

export type ApplicationStandardCapabilityKindV1 =
  'email' | 'objectStorage' | 'payments' | 'realtime' | 'search' | 'webhookDelivery';

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const record = (
  fields: Readonly<Record<string, ApplicationValueTypeV1>>,
): Extract<ApplicationValueTypeV1, { readonly kind: 'record' }> => ({ fields, kind: 'record' });

const success = (fields: Readonly<Record<string, ApplicationValueTypeV1>>) =>
  ({
    kind: 'result',
    outcomes: { rejected: record({ code: { kind: 'string' }, message: { kind: 'string' } }) },
    value: record(fields),
  }) satisfies ApplicationValueTypeV1;

const definitions: Readonly<
  Record<ApplicationStandardCapabilityKindV1, Omit<ApplicationCapabilityV1, 'id'>>
> = deepFreeze({
  email: {
    contract: 'oxe.capability.email',
    kind: 'capability',
    methods: {
      send: {
        input: record({
          body: { kind: 'string' },
          subject: { kind: 'string' },
          to: { kind: 'email' },
        }),
        output: record({ messageId: { kind: 'string' } }),
      },
    },
    name: 'Email',
    version: '1',
  },
  objectStorage: {
    contract: 'oxe.capability.object-storage',
    kind: 'capability',
    methods: {
      delete: {
        input: record({ key: { kind: 'string' } }),
        output: record({ deleted: { kind: 'boolean' } }),
      },
      put: {
        input: record({
          bytes: { kind: 'bytes' },
          contentType: { kind: 'string' },
          key: { kind: 'string' },
        }),
        output: record({ key: { kind: 'string' } }),
      },
      signedReadUrl: {
        input: record({
          expiresInSeconds: { kind: 'integer', minimum: 1 },
          key: { kind: 'string' },
        }),
        output: record({ url: { kind: 'url' } }),
      },
    },
    name: 'Object storage',
    version: '1',
  },
  payments: {
    contract: 'oxe.capability.payments',
    kind: 'capability',
    methods: {
      createCheckout: {
        input: record({
          amount: record({
            currency: { kind: 'string' },
            minorUnits: { kind: 'integer', minimum: 0 },
          }),
          idempotencyKey: { kind: 'string' },
          returnUrl: { kind: 'url' },
        }),
        output: success({ checkoutId: { kind: 'string' }, url: { kind: 'url' } }),
      },
    },
    name: 'Payments',
    version: '1',
  },
  realtime: {
    contract: 'oxe.capability.realtime',
    kind: 'capability',
    methods: {
      publish: {
        input: record({
          channel: { kind: 'string' },
          event: { kind: 'string' },
          payload: { kind: 'bytes' },
        }),
        output: record({ eventId: { kind: 'string' } }),
      },
    },
    name: 'Realtime',
    version: '1',
  },
  search: {
    contract: 'oxe.capability.search',
    kind: 'capability',
    methods: {
      query: {
        input: record({
          limit: { kind: 'integer', maximum: 100, minimum: 1 },
          query: { kind: 'string' },
        }),
        output: record({
          hits: {
            items: record({ id: { kind: 'string' }, score: { kind: 'number' } }),
            kind: 'list',
          },
        }),
      },
    },
    name: 'Search',
    version: '1',
  },
  webhookDelivery: {
    contract: 'oxe.capability.webhook-delivery',
    kind: 'capability',
    methods: {
      deliver: {
        input: record({ body: { kind: 'bytes' }, event: { kind: 'string' }, url: { kind: 'url' } }),
        output: success({ status: { kind: 'integer', maximum: 599, minimum: 100 } }),
      },
    },
    name: 'Webhook delivery',
    version: '1',
  },
});

/** Optional provider-neutral recipes. Applications remain free to declare any custom contract. */
export const createStandardApplicationCapability = (
  kind: ApplicationStandardCapabilityKindV1,
  id = `capability.${kind}`,
): ApplicationCapabilityV1 => Object.freeze({ ...definitions[kind], id });
