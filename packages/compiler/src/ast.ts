import type { SourceSpan } from './source.js';

export interface ModuleNode {
  readonly kind: 'Module';
  readonly imports: readonly ImportDeclarationNode[];
  readonly declarations: readonly ComponentDeclarationNode[];
  readonly span: SourceSpan;
}

export interface ImportDeclarationNode {
  readonly kind: 'ImportDeclaration';
  readonly specifiers: readonly ImportSpecifierNode[];
  readonly source: StringLiteralNode;
  readonly span: SourceSpan;
}

export interface ImportSpecifierNode {
  readonly kind: 'ImportSpecifier';
  readonly name: IdentifierNode;
  readonly span: SourceSpan;
}

export interface ComponentDeclarationNode {
  readonly kind: 'ComponentDeclaration';
  readonly exported: boolean;
  readonly name: IdentifierNode;
  readonly parameters: readonly ComponentParameterNode[];
  readonly body: readonly ComponentStatementNode[];
  readonly span: SourceSpan;
}

export interface RequiredComponentParameterNode {
  readonly kind: 'RequiredComponentParameter';
  readonly name: IdentifierNode;
  readonly span: SourceSpan;
}

export interface DefaultComponentParameterNode {
  readonly kind: 'DefaultComponentParameter';
  readonly name: IdentifierNode;
  readonly defaultValue: ExpressionNode;
  readonly span: SourceSpan;
}

export interface RestComponentParameterNode {
  readonly kind: 'RestComponentParameter';
  readonly name: IdentifierNode;
  readonly span: SourceSpan;
}

export type ComponentParameterNode =
  RequiredComponentParameterNode | DefaultComponentParameterNode | RestComponentParameterNode;

export interface HandlerDeclarationNode {
  readonly kind: 'HandlerDeclaration';
  readonly name: IdentifierNode;
  readonly body: readonly AssignmentStatementNode[];
  readonly span: SourceSpan;
}

export interface AssignmentStatementNode {
  readonly kind: 'AssignmentStatement';
  readonly target: IdentifierNode;
  readonly value: ExpressionNode;
  readonly span: SourceSpan;
}

export interface ElementNode {
  readonly kind: 'Element';
  readonly name: IdentifierNode;
  readonly attributes: readonly ElementAttributeNode[];
  readonly children: readonly MarkupChildNode[];
  readonly span: SourceSpan;
}

export interface AttributeNode {
  readonly kind: 'Attribute';
  readonly name: IdentifierNode;
  readonly value: ExpressionNode;
  readonly span: SourceSpan;
}

export interface SpreadAttributeNode {
  readonly kind: 'SpreadAttribute';
  readonly value: ExpressionNode;
  readonly span: SourceSpan;
}

export type ElementAttributeNode = AttributeNode | SpreadAttributeNode;

export interface TextNode {
  readonly kind: 'Text';
  readonly value: string;
  readonly span: SourceSpan;
}

export interface InterpolationNode {
  readonly kind: 'Interpolation';
  readonly expression: ExpressionNode;
  readonly span: SourceSpan;
}

export interface IfBranchNode {
  readonly kind: 'IfBranch';
  readonly condition?: ExpressionNode;
  readonly result: ElementNode;
  readonly span: SourceSpan;
}

export interface IfRegionNode {
  readonly kind: 'IfRegion';
  readonly branches: readonly IfBranchNode[];
  readonly span: SourceSpan;
}

export interface IdentifierNode {
  readonly kind: 'Identifier';
  readonly name: string;
  readonly span: SourceSpan;
}

export interface NumberLiteralNode {
  readonly kind: 'NumberLiteral';
  readonly value: number;
  readonly span: SourceSpan;
}

export interface StringLiteralNode {
  readonly kind: 'StringLiteral';
  readonly value: string;
  readonly span: SourceSpan;
}

export interface BooleanLiteralNode {
  readonly kind: 'BooleanLiteral';
  readonly value: boolean;
  readonly span: SourceSpan;
}

export interface ArrayLiteralNode {
  readonly elements: readonly ExpressionNode[];
  readonly kind: 'ArrayLiteral';
  readonly span: SourceSpan;
}

export interface MapExpressionNode {
  readonly body: ElementNode;
  readonly collection: ExpressionNode;
  readonly kind: 'MapExpression';
  readonly parameter: IdentifierNode;
  readonly span: SourceSpan;
}

export interface UntrackExpressionNode {
  readonly expression: ExpressionNode;
  readonly kind: 'UntrackExpression';
  readonly span: SourceSpan;
}

export interface ParenthesizedExpressionNode {
  readonly kind: 'ParenthesizedExpression';
  readonly expression: ExpressionNode;
  readonly span: SourceSpan;
}

export type ArithmeticOperator = '!=' | '%' | '*' | '+' | '-' | '/' | '==' | 'and' | 'or';

export interface BinaryExpressionNode {
  readonly kind: 'BinaryExpression';
  readonly operator: ArithmeticOperator;
  readonly left: ExpressionNode;
  readonly right: ExpressionNode;
  readonly span: SourceSpan;
}

export type ComponentStatementNode =
  AssignmentStatementNode | HandlerDeclarationNode | ElementNode | IfRegionNode;

export type MarkupChildNode = ElementNode | TextNode | InterpolationNode | IfRegionNode;

export type ExpressionNode =
  | ArrayLiteralNode
  | IdentifierNode
  | NumberLiteralNode
  | StringLiteralNode
  | BooleanLiteralNode
  | ParenthesizedExpressionNode
  | MapExpressionNode
  | UntrackExpressionNode
  | BinaryExpressionNode;
