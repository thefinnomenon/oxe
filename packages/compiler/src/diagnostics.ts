import type { SourceSpan } from './source.js';

export type DiagnosticCode =
  | 'OXE1001'
  | 'OXE1002'
  | 'OXE1003'
  | 'OXE1004'
  | 'OXE1005'
  | 'OXE1006'
  | 'OXE1007'
  | 'OXE1101'
  | 'OXE1102'
  | 'OXE1103'
  | 'OXE1104'
  | 'OXE1105'
  | 'OXE1106'
  | 'OXE1107'
  | 'OXE1108'
  | 'OXE1109'
  | 'OXE2001'
  | 'OXE2002'
  | 'OXE2003'
  | 'OXE2004'
  | 'OXE2005'
  | 'OXE2006'
  | 'OXE2007'
  | 'OXE2008'
  | 'OXE2009'
  | 'OXE2010'
  | 'OXE2011'
  | 'OXE2012'
  | 'OXE2013'
  | 'OXE2014'
  | 'OXE2015'
  | 'OXE2016'
  | 'OXE2017';

export interface RelatedDiagnostic {
  readonly message: string;
  readonly span: SourceSpan;
}

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly related?: readonly RelatedDiagnostic[];
  readonly severity: 'error';
  readonly span: SourceSpan;
}
