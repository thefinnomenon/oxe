import type { StorageMigrationPlan } from './types.js';

export interface SerializedStorageMigrationArtifact {
  formatVersion: 1;
  generatedAt: string;
  operations: StorageMigrationPlan['operations'];
}

export const serializeStorageMigrationPlan = (plan: StorageMigrationPlan): string => {
  const artifact: SerializedStorageMigrationArtifact = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    operations: plan.operations,
  };

  return `${JSON.stringify(artifact, null, 2)}\n`;
};

export const parseStorageMigrationArtifact = (raw: string): SerializedStorageMigrationArtifact => {
  return JSON.parse(raw) as SerializedStorageMigrationArtifact;
};
