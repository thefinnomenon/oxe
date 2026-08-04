import type { PlatformCapabilityContract } from '@oxe/compiler';

export type PlaygroundCapabilitySet = 'async-users';

const asyncUserCapabilities = [
  {
    kind: 'async',
    name: 'playground.loadUser',
    parameters: ['number'],
    returns: 'record',
  },
  {
    kind: 'async',
    name: 'playground.listUserIds',
    parameters: [],
    returns: 'array',
  },
] as const satisfies readonly PlatformCapabilityContract[];

export const capabilitiesForPlayground = (
  set: PlaygroundCapabilitySet | undefined,
): readonly PlatformCapabilityContract[] => (set === 'async-users' ? asyncUserCapabilities : []);

export const isPlaygroundCapabilitySet = (value: unknown): value is PlaygroundCapabilitySet =>
  value === 'async-users';
