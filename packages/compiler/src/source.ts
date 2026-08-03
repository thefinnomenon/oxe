export interface SourcePosition {
  /** UTF-16 offset from the start of the source. */
  readonly offset: number;
  /** One-based line number. */
  readonly line: number;
  /** One-based UTF-16 column. */
  readonly column: number;
}

export interface SourceSpan {
  readonly fileName: string;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}
