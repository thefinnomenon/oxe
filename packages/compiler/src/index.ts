export { scanSource, type ScanResult } from './scanner.js';
export { parseSource, type ParseResult } from './parser.js';
export {
  analyzeProject,
  analyzeSource,
  type AnalyzedProjectModule,
  type AnalyzeProjectOptions,
  type AnalyzeProjectResult,
  type AnalyzeResult,
  type LoadOxeModule,
} from './semantic.js';
export {
  normalizeProjectModuleId,
  OxeModulePathError,
  resolveImportModuleId,
  type ModulePathErrorCode,
} from './module-path.js';
export {
  generateDomArtifact,
  generateDomFactorySource,
  generateDomModuleSource,
  OxeCodegenError,
  type CodegenErrorCode,
  type DomCodeArtifact,
} from './codegen.js';
export type {
  ArithmeticOperator,
  AssignmentStatementNode,
  AttributeNode,
  BinaryExpressionNode,
  BooleanLiteralNode,
  ComponentDeclarationNode,
  ComponentParameterNode,
  ComponentStatementNode,
  DefaultComponentParameterNode,
  ElementNode,
  ElementAttributeNode,
  ExpressionNode,
  HandlerDeclarationNode,
  IdentifierNode,
  ImportDeclarationNode,
  ImportSpecifierNode,
  InterpolationNode,
  MarkupChildNode,
  ModuleNode,
  NumberLiteralNode,
  ParenthesizedExpressionNode,
  RequiredComponentParameterNode,
  RestComponentParameterNode,
  SpreadAttributeNode,
  StringLiteralNode,
  TextNode,
} from './ast.js';
export type { Diagnostic, DiagnosticCode, RelatedDiagnostic } from './diagnostics.js';
export type { SourcePosition, SourceSpan } from './source.js';
export type { Token, TokenKind } from './tokens.js';
