import type { Diagnostic } from './diagnostics.js';
import { parseSource } from './parser.js';

export interface FormatResult {
  readonly changed: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly formatted: string;
}

const splitComment = (line: string): readonly [string, string] => {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length - 1; index += 1) {
    const character = line[index];
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        quoted = false;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === '/' && line[index + 1] === '/') {
      return [line.slice(0, index), line.slice(index)];
    }
  }
  return [line, ''];
};

const mapOutsideStrings = (source: string, transform: (value: string) => string): string => {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (!quoted && character === '"') {
      parts.push(transform(source.slice(start, index)));
      start = index;
      quoted = true;
    } else if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        parts.push(source.slice(start, index + 1));
        start = index + 1;
        quoted = false;
      }
    }
  }
  parts.push(quoted ? source.slice(start) : transform(source.slice(start)));
  return parts.join('');
};

const formatCode = (source: string): string =>
  mapOutsideStrings(source, (value) =>
    value
      .replaceAll(/\s*(==|!=|=>|=\?|=|\+|-|\*|\/|%|\?)\s*/gu, ' $1 ')
      .replaceAll(/\s+\b(and|or)\b\s+/gu, ' $1 ')
      .replaceAll(/\s*:\s*/gu, ': ')
      .replaceAll(/,\s*/gu, ', ')
      .replaceAll(/\.\s*/gu, '.')
      .replaceAll(/\(\s*/gu, '(')
      .replaceAll(/\s*\)/gu, ')')
      .replaceAll(/\[\s*/gu, '[')
      .replaceAll(/\s*\]/gu, ']')
      .replaceAll(/\{\s*/gu, '{ ')
      .replaceAll(/\s*\}/gu, ' }'),
  );

const indentationWidth = (indentation: string): number =>
  [...indentation].reduce((width, character) => width + (character === '\t' ? 2 : 1), 0);

/**
 * Formats valid OXE without reprinting authored comments or markup text. Syntax
 * spacing is canonicalized on code-only lines; markup lines retain their text
 * payload byte-for-byte after indentation normalization.
 */
export const formatSource = (source: string, fileName = '<source>'): FormatResult => {
  const parsed = parseSource(source, fileName);
  if (parsed.diagnostics.length > 0) {
    return Object.freeze({
      changed: false,
      diagnostics: parsed.diagnostics,
      formatted: source,
    });
  }

  const normalized = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const lines = normalized.split('\n');
  while (lines.length > 1 && lines.at(-1) === '') {
    lines.pop();
  }
  const formattedLines = lines.map((line) => {
    const indentation = line.match(/^[ \t]*/u)?.[0] ?? '';
    const body = line.slice(indentation.length);
    if (body.length === 0) {
      return '';
    }
    const canonicalIndent = ' '.repeat(indentationWidth(indentation));
    const [code, comment] = splitComment(body);
    if (code.trim().length === 0) {
      return `${canonicalIndent}${comment}`;
    }
    const formattedCode = code.includes('<') ? code.trimEnd() : formatCode(code).trim();
    return `${canonicalIndent}${formattedCode}${comment ? ` ${comment}` : ''}`;
  });
  const formatted = `${formattedLines.join('\n')}\n`;
  return Object.freeze({
    changed: formatted !== source,
    diagnostics: Object.freeze([]),
    formatted,
  });
};
