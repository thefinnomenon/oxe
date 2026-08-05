import type { SourceSpan } from './source.js';

export interface ModuleNode {
  readonly kind: 'Module';
  readonly imports: readonly ImportDeclarationNode[];
  readonly contexts: readonly ContextDeclarationNode[];
  readonly declarations: readonly ComponentDeclarationNode[];
  readonly serverFunctions: readonly ServerFunctionDeclarationNode[];
  readonly schemaVersion: 'oxe.syntax.v1';
  readonly span: SourceSpan;
}

export interface ContextDeclarationNode {
  readonly kind: 'ContextDeclaration';
  readonly name: IdentifierNode;
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
  readonly parameters: readonly IdentifierNode[];
  readonly body: readonly ProceduralStatementNode[];
  readonly span: SourceSpan;
}

export interface ServerFunctionParameterNode {
  readonly kind: 'ServerFunctionParameter';
  readonly name: IdentifierNode;
  /** Optional scalar annotation used when the exact type cannot be inferred from the body. */
  readonly type?: 'boolean' | 'number' | 'string';
  readonly span: SourceSpan;
}

export interface ServerFunctionDeclarationNode {
  readonly body: readonly ServerFunctionStatementNode[];
  readonly exported: boolean;
  readonly kind: 'ServerFunctionDeclaration';
  readonly name: IdentifierNode;
  readonly parameters: readonly ServerFunctionParameterNode[];
  readonly span: SourceSpan;
}

export interface AssignmentStatementNode {
  readonly kind: 'AssignmentStatement';
  readonly target: IdentifierNode;
  readonly value: ExpressionNode;
  readonly span: SourceSpan;
}

export interface MemberAssignmentStatementNode {
  readonly kind: 'MemberAssignmentStatement';
  readonly target: MemberExpressionNode;
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

export interface ConditionalBranchNode {
  readonly kind: 'ConditionalBranch';
  readonly condition?: ExpressionNode;
  readonly result: ConditionalResultNode;
  readonly span: SourceSpan;
}

export interface ConditionalRegionNode {
  readonly kind: 'ConditionalRegion';
  readonly branches: readonly ConditionalBranchNode[];
  readonly span: SourceSpan;
}

export interface ConditionalValueBranchNode {
  readonly condition?: ExpressionNode;
  readonly kind: 'ConditionalValueBranch';
  readonly result: ConditionalResultNode;
  readonly span: SourceSpan;
}

export interface ConditionalValueExpressionNode {
  readonly branches: readonly ConditionalValueBranchNode[];
  readonly kind: 'ConditionalValueExpression';
  readonly span: SourceSpan;
}

export interface ConditionalResultBlockNode {
  readonly kind: 'ConditionalResultBlock';
  readonly statements: readonly (AssignmentStatementNode | ExpressionStatementNode)[];
  readonly result: ElementNode | ExpressionNode;
  readonly span: SourceSpan;
}

export type ConditionalResultNode = ConditionalResultBlockNode | ElementNode | ExpressionNode;

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

export interface RecordEntryNode {
  readonly kind: 'RecordEntry';
  readonly name: IdentifierNode;
  readonly value: ExpressionNode;
  readonly span: SourceSpan;
}

export interface RecordLiteralNode {
  readonly entries: readonly RecordEntryNode[];
  readonly kind: 'RecordLiteral';
  readonly span: SourceSpan;
}

export interface MemberExpressionNode {
  readonly kind: 'MemberExpression';
  readonly object: ExpressionNode;
  readonly property: IdentifierNode;
  readonly span: SourceSpan;
}

export interface CallExpressionNode {
  readonly arguments: readonly ExpressionNode[];
  readonly callee: ExpressionNode;
  readonly kind: 'CallExpression';
  readonly span: SourceSpan;
}

export interface ExpressionStatementNode {
  readonly expression: ExpressionNode;
  readonly kind: 'ExpressionStatement';
  readonly span: SourceSpan;
}

export interface CallbackBlockNode {
  readonly assignments: readonly AssignmentStatementNode[];
  readonly kind: 'CallbackBlock';
  readonly result: ExpressionNode | ElementNode;
  readonly span: SourceSpan;
}

export interface CollectionExpressionNode {
  readonly callback: CallbackBlockNode;
  readonly collection: ExpressionNode;
  readonly initial?: ExpressionNode;
  readonly kind: 'CollectionExpression';
  readonly operation: 'filter' | 'flatMap' | 'map' | 'reduce' | 'sort';
  readonly options?: ExpressionNode;
  readonly parameters: readonly IdentifierNode[];
  readonly span: SourceSpan;
}

export interface CollectionMutationPredicateNode {
  readonly callback: CallbackBlockNode;
  readonly parameter: IdentifierNode;
  readonly span: SourceSpan;
}

export interface CollectionUpdateAssignmentNode {
  readonly kind: 'CollectionUpdateAssignment';
  readonly target: IdentifierNode | MemberExpressionNode;
  readonly value: ExpressionNode;
  readonly span: SourceSpan;
}

export interface CollectionMutationUpdaterNode {
  readonly assignments: readonly CollectionUpdateAssignmentNode[];
  readonly kind: 'CollectionMutationUpdater';
  readonly parameter: IdentifierNode;
  readonly span: SourceSpan;
}

export interface CollectionMutationStatementNode {
  readonly collection: IdentifierNode;
  readonly kind: 'CollectionMutationStatement';
  readonly limit?: ExpressionNode;
  readonly operation: 'add' | 'remove' | 'update';
  readonly predicate?: CollectionMutationPredicateNode;
  readonly span: SourceSpan;
  readonly updater?: CollectionMutationUpdaterNode;
  readonly value?: ExpressionNode;
}

export interface MapExpressionNode {
  readonly assignments: readonly AssignmentStatementNode[];
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
  | AssignmentStatementNode
  | ExpressionStatementNode
  | HandlerDeclarationNode
  | ElementNode
  | ConditionalRegionNode;

export type ProceduralStatementNode =
  | AssignmentStatementNode
  | CollectionMutationStatementNode
  | ExpressionStatementNode
  | MemberAssignmentStatementNode;

export type ServerFunctionStatementNode = AssignmentStatementNode | ExpressionStatementNode;

export type MarkupChildNode = ElementNode | TextNode | InterpolationNode | ConditionalRegionNode;

export type ExpressionNode =
  | ArrayLiteralNode
  | CallExpressionNode
  | CollectionExpressionNode
  | IdentifierNode
  | NumberLiteralNode
  | StringLiteralNode
  | BooleanLiteralNode
  | ConditionalValueExpressionNode
  | ParenthesizedExpressionNode
  | MapExpressionNode
  | MemberExpressionNode
  | UntrackExpressionNode
  | BinaryExpressionNode
  | RecordLiteralNode;
