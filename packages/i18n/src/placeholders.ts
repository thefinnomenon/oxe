import type { ExtractedMessage } from './types.js';

interface ProtectedMessage {
  readonly masked: string;
  restore(translated: string): string;
}

const marker = (index: number): string => `<x${index}/>`;

const occurrences = (value: string, search: string): number =>
  search.length === 0 ? 0 : value.split(search).length - 1;

export const protectMessage = (message: ExtractedMessage): ProtectedMessage => {
  let masked = message.source;
  const replacements = message.placeholders.map((placeholder, index) => ({
    marker: marker(index),
    token: placeholder.token,
  }));
  for (const replacement of [...replacements].sort(
    (left, right) => right.token.length - left.token.length,
  )) {
    masked = masked.replaceAll(replacement.token, replacement.marker);
  }
  return {
    masked,
    restore(translated: string): string {
      let restored = translated;
      for (const replacement of replacements) {
        if (occurrences(restored, replacement.marker) !== 1) {
          throw new Error(
            `Translation of ${message.id} did not preserve placeholder ${replacement.token}.`,
          );
        }
        restored = restored.replace(replacement.marker, replacement.token);
      }
      return restored;
    },
  };
};

export const hasValidPlaceholders = (message: ExtractedMessage, translated: string): boolean =>
  message.placeholders.every((placeholder) => occurrences(translated, placeholder.token) === 1);
