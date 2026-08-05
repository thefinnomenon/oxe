import type { PlatformCapabilityContract } from '@oxe/compiler';

import { serverFunctionDemoCompilerCapabilities } from './server-function-demo.js';

export type PlaygroundCapabilitySet = 'async-users' | 'server-projects';

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
): readonly PlatformCapabilityContract[] =>
  set === 'async-users'
    ? asyncUserCapabilities
    : set === 'server-projects'
      ? serverFunctionDemoCompilerCapabilities
      : [];

export const isPlaygroundCapabilitySet = (value: unknown): value is PlaygroundCapabilitySet =>
  value === 'async-users' || value === 'server-projects';
