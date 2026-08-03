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
  | 'export'
  | 'from'
  | 'greaterThan'
  | 'identifier'
  | 'if'
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
  | 'slash'
  | 'star'
  | 'string';

export interface Token {
  readonly kind: TokenKind;
  readonly lexeme: string;
  readonly span: SourceSpan;
  readonly value?: number | string;
}
