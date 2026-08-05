import { describe, expect, it } from 'vitest';

import { scanSource, type TokenKind } from '../src/index.js';

const significantKinds = (source: string): TokenKind[] =>
  scanSource(source).tokens.map((token) => token.kind);

describe('OXE scanner', () => {
  it('scans component relationships, handlers, markup, and interpolation', () => {
    const source = `App():
  count = 0
  doubled = count * 2

  increment():
    count = count + 1

  <main>
    <button onClick={increment}>Count: {count}
`;

    const result = scanSource(source, 'counter.oxe');

    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.map((token) => token.kind)).toEqual([
      'identifier',
      'leftParen',
      'rightParen',
      'colon',
      'newline',
      'indent',
      'identifier',
      'equal',
      'number',
      'newline',
      'identifier',
      'equal',
      'identifier',
      'star',
      'number',
      'newline',
      'newline',
      'identifier',
      'leftParen',
      'rightParen',
      'colon',
      'newline',
      'indent',
      'identifier',
      'equal',
      'identifier',
      'plus',
      'number',
      'newline',
      'newline',
      'dedent',
      'lessThan',
      'identifier',
      'greaterThan',
      'newline',
      'indent',
      'lessThan',
      'identifier',
      'identifier',
      'equal',
      'leftBrace',
      'identifier',
      'rightBrace',
      'greaterThan',
      'identifier',
      'colon',
      'leftBrace',
      'identifier',
      'rightBrace',
      'newline',
      'dedent',
      'dedent',
      'endOfFile',
    ]);

    const app = result.tokens[0];
    expect(app).toMatchObject({
      kind: 'identifier',
      lexeme: 'App',
      span: {
        fileName: 'counter.oxe',
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 3, line: 1, column: 4 },
      },
    });

    expect(result.tokens.find((token) => token.kind === 'number')).toMatchObject({
      value: 0,
    });
  });

  it('does not change indentation for blank or comment-only lines', () => {
    const source = `App():
  value = 1

    // explanation aligned inside a deeper visual column
  next = 2
`;

    const result = scanSource(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.filter((token) => token.kind === 'indent')).toHaveLength(1);
    expect(result.tokens.filter((token) => token.kind === 'dedent')).toHaveLength(1);
  });

  it('emits one targeted diagnostic for tab indentation', () => {
    const result = scanSource('App():\n\tvalue = 1\n', 'tab.oxe');

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'OXE1001',
      message: 'Tabs are not allowed for indentation. Use 2 spaces per level.',
      span: {
        fileName: 'tab.oxe',
        start: { line: 2, column: 1 },
      },
    });
  });

  it('diagnoses indentation widths and dedents that do not match an open block', () => {
    const result = scanSource('App():\n    first = 1\n  second = 2\n');

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['OXE1002', 'OXE1003']);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'Indentation may increase by only 2 spaces at a time.',
      'This indentation does not match any open block.',
    ]);
  });

  it('rejects closing tags and slash self-closing syntax with migration guidance', () => {
    const result = scanSource('<main>\n  <input/>\n</main>\n');

    expect(result.diagnostics).toMatchObject([
      {
        code: 'OXE1007',
        message: 'Self-closing syntax is not valid in OXE. End every opening element with >.',
      },
      {
        code: 'OXE1006',
        message: 'Closing tags are not valid in OXE. Dedent to close the element.',
      },
    ]);
  });

  it('scans type-safe operators and punctuation-led conditionals', () => {
    expect(significantKinds('if user and !user.disabled ? user : fallback\n')).toEqual([
      'identifier',
      'identifier',
      'and',
      'bang',
      'identifier',
      'dot',
      'identifier',
      'question',
      'identifier',
      'colon',
      'identifier',
      'newline',
      'endOfFile',
    ]);

    expect(significantKinds('view =?\n  user ? result\n  : fallback\n')).toEqual([
      'identifier',
      'equalQuestion',
      'newline',
      'indent',
      'identifier',
      'question',
      'identifier',
      'newline',
      'colon',
      'identifier',
      'newline',
      'dedent',
      'endOfFile',
    ]);

    expect(significantKinds('items.map(item => item)\n')).toContain('arrow');

    expect(significantKinds('left == right or left != other\n')).toEqual([
      'identifier',
      'equalEqual',
      'identifier',
      'or',
      'identifier',
      'bangEqual',
      'identifier',
      'newline',
      'endOfFile',
    ]);
  });

  it('scans JavaScript-style rest and spread punctuation as one token', () => {
    expect(significantKinds('Card(title, ...props):\n  <Panel {...props}>\n')).toEqual([
      'identifier',
      'leftParen',
      'identifier',
      'comma',
      'ellipsis',
      'identifier',
      'rightParen',
      'colon',
      'newline',
      'indent',
      'lessThan',
      'identifier',
      'leftBrace',
      'ellipsis',
      'identifier',
      'rightBrace',
      'greaterThan',
      'newline',
      'dedent',
      'endOfFile',
    ]);
  });

  it('reserves the JavaScript-style component module keywords', () => {
    expect(
      significantKinds('import { Card, Button } from "./components.oxe"\nexport App():\n'),
    ).toEqual([
      'import',
      'leftBrace',
      'identifier',
      'comma',
      'identifier',
      'rightBrace',
      'from',
      'string',
      'newline',
      'export',
      'identifier',
      'leftParen',
      'rightParen',
      'colon',
      'newline',
      'endOfFile',
    ]);
  });

  it('reserves server declarations as an authored execution boundary', () => {
    expect(significantKinds('export server readProject(id):\n  id\n')).toEqual([
      'export',
      'server',
      'identifier',
      'leftParen',
      'identifier',
      'rightParen',
      'colon',
      'newline',
      'indent',
      'identifier',
      'newline',
      'dedent',
      'endOfFile',
    ]);
  });

  it('decodes supported string escapes and diagnoses unterminated strings', () => {
    const valid = scanSource('message = "line\\nnext"\n');
    expect(valid.diagnostics).toEqual([]);
    expect(valid.tokens.find((token) => token.kind === 'string')).toMatchObject({
      value: 'line\nnext',
    });

    const invalid = scanSource('message = "unfinished\nnext = 1\n');
    expect(invalid.diagnostics).toMatchObject([
      {
        code: 'OXE1005',
        message: 'Unterminated string literal.',
      },
    ]);
    expect(invalid.tokens.at(-1)?.kind).toBe('endOfFile');
  });

  it('ends an unterminated string before a standalone carriage return after a backslash', () => {
    const result = scanSource('message = "unfinished\\\rnext = 1\r', 'standalone-cr.oxe');

    expect(result.diagnostics).toMatchObject([
      {
        code: 'OXE1005',
        message: 'Unterminated string literal.',
      },
    ]);
    expect(result.tokens.find((token) => token.lexeme === 'next')).toMatchObject({
      span: {
        fileName: 'standalone-cr.oxe',
        start: { line: 2, column: 1 },
      },
    });
    expect(result.tokens.filter((token) => token.kind === 'newline')).toHaveLength(2);
  });

  it('continues scanning after an unexpected character', () => {
    const result = scanSource('first = 1\nsecond = `bad\nthird = 3\n');

    expect(result.diagnostics).toMatchObject([
      {
        code: 'OXE1004',
        message: 'Unexpected character "`".',
      },
    ]);
    expect(result.tokens.some((token) => token.lexeme === 'third')).toBe(true);
  });

  it('handles CRLF and trailing indentation without inventing tokens', () => {
    const result = scanSource('App():\r\n  value = 1\r\n  ');

    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.filter((token) => token.kind === 'newline')).toHaveLength(2);
    expect(result.tokens.at(-1)).toMatchObject({
      kind: 'endOfFile',
      span: {
        start: { line: 3, column: 3 },
      },
    });
  });
});
