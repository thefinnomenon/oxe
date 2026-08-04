import { createHash } from 'node:crypto';

export const contentHash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const messageHash = (value: string): string => {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
};

export const messageId = (source: string, placeholders: readonly string[]): string =>
  `m_${messageHash(`${source}\0${placeholders.join('\0')}`)}`;
