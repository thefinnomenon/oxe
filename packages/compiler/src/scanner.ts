import type { Diagnostic, DiagnosticCode } from './diagnostics.js';
import type { SourcePosition, SourceSpan } from './source.js';
import type { Token, TokenKind, Trivia } from './tokens.js';

const INDENT_WIDTH = 2;

const keywordKinds: Readonly<Record<string, TokenKind>> = {
  and: 'and',
  export: 'export',
  from: 'from',
  import: 'import',
  or: 'or',
};

const punctuationKinds: Readonly<Record<string, TokenKind>> = {
  '!': 'bang',
  '%': 'percent',
  '(': 'leftParen',
  ')': 'rightParen',
  '*': 'star',
  '+': 'plus',
  '?': 'question',
  ',': 'comma',
  '-': 'minus',
  '.': 'dot',
  '/': 'slash',
  ':': 'colon',
  '<': 'lessThan',
  '=': 'equal',
  '>': 'greaterThan',
  '[': 'leftBracket',
  ']': 'rightBracket',
  '{': 'leftBrace',
  '}': 'rightBrace',
};

export interface ScanResult {
  readonly diagnostics: Diagnostic[];
  readonly tokens: Token[];
  readonly trivia: Trivia[];
}

interface ScannerState {
  readonly source: string;
  readonly fileName: string;
  readonly tokens: Token[];
  readonly diagnostics: Diagnostic[];
  readonly trivia: Trivia[];
  readonly indentStack: number[];
  offset: number;
  line: number;
  column: number;
  atLineStart: boolean;
}

const position = (state: ScannerState): SourcePosition => ({
  offset: state.offset,
  line: state.line,
  column: state.column,
});

const span = (
  state: ScannerState,
  start: SourcePosition,
  end: SourcePosition = position(state),
): SourceSpan => ({
  fileName: state.fileName,
  start,
  end,
});

const advance = (state: ScannerState): string => {
  const character = state.source[state.offset] ?? '';
  state.offset += 1;

  if (character === '\n') {
    state.line += 1;
    state.column = 1;
    state.atLineStart = true;
  } else {
    state.column += 1;
  }

  return character;
};

const peek = (state: ScannerState, distance = 0): string =>
  state.source[state.offset + distance] ?? '';

const addToken = (
  state: ScannerState,
  kind: TokenKind,
  start: SourcePosition,
  lexeme: string,
  value?: number | string,
): void => {
  const token: Token = {
    kind,
    lexeme,
    span: span(state, start),
    ...(value === undefined ? {} : { value }),
  };
  state.tokens.push(token);
};

const addDiagnostic = (
  state: ScannerState,
  code: DiagnosticCode,
  message: string,
  start: SourcePosition,
  end: SourcePosition = position(state),
): void => {
  state.diagnostics.push({
    code,
    message,
    severity: 'error',
    span: span(state, start, end),
  });
};

const addTrivia = (state: ScannerState, kind: Trivia['kind'], start: SourcePosition): void => {
  if (start.offset === state.offset) {
    return;
  }
  state.trivia.push({
    kind,
    span: span(state, start),
    text: state.source.slice(start.offset, state.offset),
  });
};

const isIdentifierStart = (character: string): boolean => /[A-Za-z_]/u.test(character);

const isIdentifierContinue = (character: string): boolean => /[A-Za-z0-9_]/u.test(character);

const isDigit = (character: string): boolean => character >= '0' && character <= '9';

const skipComment = (state: ScannerState): void => {
  const start = position(state);
  while (peek(state) !== '' && peek(state) !== '\n' && peek(state) !== '\r') {
    advance(state);
  }
  addTrivia(state, 'comment', start);
};

const scanIndentation = (state: ScannerState): void => {
  const start = position(state);
  let spaces = 0;
  let sawTab = false;
  let indentationHasError = false;

  while (peek(state) === ' ' || peek(state) === '\t') {
    if (advance(state) === '\t') {
      sawTab = true;
      spaces += INDENT_WIDTH;
    } else {
      spaces += 1;
    }
  }
  addTrivia(state, 'whitespace', start);

  if (
    peek(state) === '\n' ||
    peek(state) === '\r' ||
    peek(state) === '' ||
    (peek(state) === '/' && peek(state, 1) === '/')
  ) {
    state.atLineStart = false;
    return;
  }

  if (sawTab) {
    indentationHasError = true;
    addDiagnostic(
      state,
      'OXE1001',
      `Tabs are not allowed for indentation. Use ${INDENT_WIDTH} spaces per level.`,
      start,
    );
  }

  if (spaces % INDENT_WIDTH !== 0) {
    indentationHasError = true;
    addDiagnostic(
      state,
      'OXE1002',
      `Indentation must use exactly ${INDENT_WIDTH} spaces per level.`,
      start,
    );
  }

  const current = state.indentStack.at(-1) ?? 0;

  if (spaces > current) {
    if (!indentationHasError && spaces !== current + INDENT_WIDTH) {
      addDiagnostic(
        state,
        'OXE1002',
        `Indentation may increase by only ${INDENT_WIDTH} spaces at a time.`,
        start,
      );
    }
    state.indentStack.push(spaces);
    addToken(state, 'indent', start, state.source.slice(start.offset, state.offset));
  } else if (spaces < current) {
    while (state.indentStack.length > 1 && spaces < (state.indentStack.at(-1) ?? 0)) {
      state.indentStack.pop();
      addToken(state, 'dedent', start, '');
    }

    if (spaces !== (state.indentStack.at(-1) ?? 0)) {
      addDiagnostic(state, 'OXE1003', 'This indentation does not match any open block.', start);
    }
  }

  state.atLineStart = false;
};

const scanIdentifier = (state: ScannerState): void => {
  const start = position(state);
  advance(state);

  while (isIdentifierContinue(peek(state))) {
    advance(state);
  }

  const lexeme = state.source.slice(start.offset, state.offset);
  addToken(state, keywordKinds[lexeme] ?? 'identifier', start, lexeme);
};

const scanNumber = (state: ScannerState): void => {
  const start = position(state);

  while (isDigit(peek(state))) {
    advance(state);
  }

  if (peek(state) === '.' && isDigit(peek(state, 1))) {
    advance(state);
    while (isDigit(peek(state))) {
      advance(state);
    }
  }

  const lexeme = state.source.slice(start.offset, state.offset);
  addToken(state, 'number', start, lexeme, Number(lexeme));
};

const scanString = (state: ScannerState): void => {
  const start = position(state);
  advance(state);
  let value = '';

  while (
    peek(state) !== '' &&
    peek(state) !== '\n' &&
    peek(state) !== '\r' &&
    peek(state) !== '"'
  ) {
    const character = advance(state);

    if (character !== '\\') {
      value += character;
      continue;
    }

    const escaped = peek(state);
    if (escaped === '' || escaped === '\n' || escaped === '\r') {
      break;
    }

    advance(state);
    const escapeValue: Readonly<Record<string, string>> = {
      '"': '"',
      '\\': '\\',
      n: '\n',
      r: '\r',
      t: '\t',
    };
    value += escapeValue[escaped] ?? escaped;
  }

  if (peek(state) !== '"') {
    addDiagnostic(state, 'OXE1005', 'Unterminated string literal.', start);
    addToken(state, 'string', start, state.source.slice(start.offset, state.offset), value);
    return;
  }

  advance(state);
  addToken(state, 'string', start, state.source.slice(start.offset, state.offset), value);
};

const scanPunctuation = (state: ScannerState): boolean => {
  const start = position(state);
  const first = peek(state);
  const pair = `${first}${peek(state, 1)}`;
  const triple = `${pair}${peek(state, 2)}`;

  if (triple === '...') {
    advance(state);
    advance(state);
    advance(state);
    addToken(state, 'ellipsis', start, triple);
    return true;
  }

  const pairedKinds: Readonly<Record<string, TokenKind>> = {
    '!=': 'bangEqual',
    '=>': 'arrow',
    '=?': 'equalQuestion',
    '==': 'equalEqual',
  };
  const pairedKind = pairedKinds[pair];

  if (pairedKind) {
    advance(state);
    advance(state);
    addToken(state, pairedKind, start, pair);
    return true;
  }

  const kind = punctuationKinds[first];
  if (!kind) {
    return false;
  }

  if (pair === '</') {
    addDiagnostic(
      state,
      'OXE1006',
      'Closing tags are not valid in OXE. Dedent to close the element.',
      start,
      { ...start, offset: start.offset + 2, column: start.column + 2 },
    );
  } else if (pair === '/>') {
    addDiagnostic(
      state,
      'OXE1007',
      'Self-closing syntax is not valid in OXE. End every opening element with >.',
      start,
      { ...start, offset: start.offset + 2, column: start.column + 2 },
    );
  }

  advance(state);
  addToken(state, kind, start, first);
  return true;
};

export const scanSource = (source: string, fileName = '<source>'): ScanResult => {
  const state: ScannerState = {
    source,
    fileName,
    tokens: [],
    trivia: [],
    diagnostics: [],
    indentStack: [0],
    offset: 0,
    line: 1,
    column: 1,
    atLineStart: true,
  };

  while (state.offset < source.length) {
    if (state.atLineStart) {
      scanIndentation(state);
      if (state.offset >= source.length) {
        break;
      }
    }

    const character = peek(state);

    if (character === ' ' || character === '\t') {
      const start = position(state);
      while (peek(state) === ' ' || peek(state) === '\t') {
        advance(state);
      }
      addTrivia(state, 'whitespace', start);
      continue;
    }

    if (character === '\n' || character === '\r') {
      const start = position(state);
      const startOffset = state.offset;

      if (character === '\r') {
        advance(state);
        if (peek(state) === '\n') {
          advance(state);
        } else {
          state.line += 1;
          state.column = 1;
          state.atLineStart = true;
        }
      } else {
        advance(state);
      }

      addToken(state, 'newline', start, source.slice(startOffset, state.offset));
      continue;
    }

    if (character === '/' && peek(state, 1) === '/') {
      skipComment(state);
      continue;
    }

    if (isIdentifierStart(character)) {
      scanIdentifier(state);
      continue;
    }

    if (isDigit(character)) {
      scanNumber(state);
      continue;
    }

    if (character === '"') {
      scanString(state);
      continue;
    }

    if (scanPunctuation(state)) {
      continue;
    }

    const start = position(state);
    const unexpected = advance(state);
    addDiagnostic(state, 'OXE1004', `Unexpected character "${unexpected}".`, start);
  }

  const end = position(state);
  while (state.indentStack.length > 1) {
    state.indentStack.pop();
    addToken(state, 'dedent', end, '');
  }
  addToken(state, 'endOfFile', end, '');

  return {
    tokens: state.tokens,
    diagnostics: state.diagnostics,
    trivia: state.trivia,
  };
};
