import type { SourceSpan } from './source.js';

export type TokenKind =
  | 'and'
  | 'arrow'
  | 'bang'
  | 'bangEqual'
  | 'colon'
  | 'comma'
  | 'dedent'
  | 'dot'
  | 'ellipsis'
  | 'endOfFile'
  | 'equal'
  | 'equalEqual'
  | 'equalQuestion'
  | 'export'
  | 'from'
  | 'greaterThan'
  | 'identifier'
  | 'import'
  | 'indent'
  | 'leftBrace'
  | 'leftBracket'
  | 'leftParen'
  | 'lessThan'
  | 'minus'
  | 'newline'
  | 'number'
  | 'or'
  | 'percent'
  | 'plus'
  | 'question'
  | 'rightBrace'
  | 'rightBracket'
  | 'rightParen'
  | 'server'
  | 'slash'
  | 'star'
  | 'string';

export interface Token {
  readonly kind: TokenKind;
  readonly lexeme: string;
  readonly span: SourceSpan;
  readonly value?: number | string;
}

export interface Trivia {
  readonly kind: 'comment' | 'whitespace';
  readonly span: SourceSpan;
  readonly text: string;
}
