import type {
  ArithmeticOperator,
  ArrayLiteralNode,
  AssignmentStatementNode,
  AttributeNode,
  BinaryExpressionNode,
  BooleanLiteralNode,
  CallExpressionNode,
  CallbackBlockNode,
  CollectionExpressionNode,
  CollectionMutationPredicateNode,
  CollectionMutationStatementNode,
  CollectionMutationUpdaterNode,
  CollectionUpdateAssignmentNode,
  ComponentDeclarationNode,
  ComponentParameterNode,
  ComponentStatementNode,
  ContextDeclarationNode,
  ConditionalBranchNode,
  ConditionalResultBlockNode,
  ConditionalResultNode,
  ConditionalRegionNode,
  ConditionalValueBranchNode,
  ConditionalValueExpressionNode,
  DefaultComponentParameterNode,
  ElementNode,
  ElementAttributeNode,
  ExpressionNode,
  ExpressionStatementNode,
  HandlerDeclarationNode,
  IdentifierNode,
  ImportDeclarationNode,
  ImportSpecifierNode,
  InterpolationNode,
  MarkupChildNode,
  MapExpressionNode,
  MemberExpressionNode,
  MemberAssignmentStatementNode,
  ModuleNode,
  NumberLiteralNode,
  ParenthesizedExpressionNode,
  RequiredComponentParameterNode,
  RecordEntryNode,
  RecordLiteralNode,
  RestComponentParameterNode,
  SpreadAttributeNode,
  StringLiteralNode,
  TextNode,
  UntrackExpressionNode,
} from './ast.js';
import type { Diagnostic, DiagnosticCode } from './diagnostics.js';
import { scanSource } from './scanner.js';
import type { SourcePosition, SourceSpan } from './source.js';
import type { Token, TokenKind, Trivia } from './tokens.js';

export interface ParseResult {
  readonly ast: ModuleNode;
  readonly diagnostics: readonly Diagnostic[];
  readonly tokens: readonly Token[];
  readonly trivia: readonly Trivia[];
}

interface BinaryOperatorDefinition {
  readonly operator: ArithmeticOperator;
  readonly precedence: number;
}

const binaryOperators: Readonly<Partial<Record<TokenKind, BinaryOperatorDefinition>>> = {
  or: { operator: 'or', precedence: 1 },
  and: { operator: 'and', precedence: 2 },
  bangEqual: { operator: '!=', precedence: 3 },
  equalEqual: { operator: '==', precedence: 3 },
  minus: { operator: '-', precedence: 4 },
  plus: { operator: '+', precedence: 4 },
  percent: { operator: '%', precedence: 5 },
  slash: { operator: '/', precedence: 5 },
  star: { operator: '*', precedence: 5 },
};

const freezePosition = (value: SourcePosition): SourcePosition =>
  Object.freeze({
    offset: value.offset,
    line: value.line,
    column: value.column,
  });

const freezeSpan = (start: SourcePosition, end: SourcePosition, fileName: string): SourceSpan =>
  Object.freeze({
    fileName,
    start: freezePosition(start),
    end: freezePosition(end),
  });

const copySpan = (value: SourceSpan): SourceSpan =>
  freezeSpan(value.start, value.end, value.fileName);

const spanFrom = (start: SourceSpan, end: SourceSpan): SourceSpan =>
  freezeSpan(start.start, end.end, start.fileName);

const pointSpan = (position: SourcePosition, fileName: string): SourceSpan =>
  freezeSpan(position, position, fileName);

const freezeNode = <Node extends object>(node: Node): Readonly<Node> => Object.freeze(node);

const freezeNodes = <Node>(nodes: readonly Node[]): readonly Node[] => Object.freeze([...nodes]);

class Parser {
  readonly #source: string;
  readonly #fileName: string;
  readonly #tokens: readonly Token[];
  readonly #diagnostics: Diagnostic[] = [];
  #index = 0;

  constructor(source: string, fileName: string, tokens: readonly Token[]) {
    this.#source = source;
    this.#fileName = fileName;
    this.#tokens = tokens;
  }

  parseModule(): ModuleNode {
    const imports: ImportDeclarationNode[] = [];
    const contexts: ContextDeclarationNode[] = [];
    const declarations: ComponentDeclarationNode[] = [];
    let sawDeclaration = false;

    this.#skipNewlines();
    while (!this.#check('endOfFile')) {
      if (this.#check('import')) {
        if (sawDeclaration) {
          this.#addDiagnostic(
            'OXE1103',
            'Imports must be declared before component declarations.',
            this.#current().span,
          );
        }
        const declaration = this.#parseImportDeclaration();
        if (declaration) {
          imports.push(declaration);
        }
      } else if (this.#check('export')) {
        sawDeclaration = true;
        const exportToken = this.#advance();
        if (!this.#check('identifier') || !this.#checkNext('leftParen')) {
          this.#addDiagnostic(
            'OXE1103',
            'Exports must be written directly on a component declaration: export Component():',
            exportToken.span,
          );
          this.#synchronizeLine();
          this.#skipNewlines();
          continue;
        }
        const declaration = this.#parseComponentDeclaration(exportToken);
        if (declaration) {
          declarations.push(declaration);
        }
      } else if (this.#check('identifier') && this.#checkNext('equal')) {
        sawDeclaration = true;
        const declaration = this.#parseContextDeclaration();
        if (declaration) {
          contexts.push(declaration);
        }
      } else if (this.#check('identifier') && this.#checkNext('leftParen')) {
        sawDeclaration = true;
        const declaration = this.#parseComponentDeclaration();
        if (declaration) {
          declarations.push(declaration);
        }
      } else {
        this.#addDiagnostic(
          'OXE1103',
          'Expected a component declaration at the top level.',
          this.#current().span,
        );
        if (!this.#match('dedent')) {
          this.#synchronizeLine();
        }
      }
      this.#skipNewlines();
    }

    const firstTopLevelSpan = [...imports, ...contexts, ...declarations].sort(
      (left, right) => left.span.start.offset - right.span.start.offset,
    )[0]?.span;
    const start = firstTopLevelSpan?.start ?? this.#current().span.start;
    const moduleSpan = freezeSpan(start, this.#current().span.end, this.#fileName);
    return freezeNode({
      kind: 'Module',
      imports: freezeNodes(imports),
      contexts: freezeNodes(contexts),
      declarations: freezeNodes(declarations),
      schemaVersion: 'oxe.syntax.v1',
      span: moduleSpan,
    });
  }

  #parseContextDeclaration(): ContextDeclarationNode | undefined {
    const name = this.#identifierFromToken(this.#advance());
    this.#advance();
    if (!this.#check('identifier') || this.#current().lexeme !== 'createContext') {
      this.#addDiagnostic(
        'OXE1103',
        'A top-level assignment must declare a context with createContext().',
        this.#current().span,
      );
      this.#synchronizeLine();
      return undefined;
    }
    this.#advance();
    if (!this.#consume('leftParen', 'OXE1101', 'Expected ( after createContext.')) {
      this.#synchronizeLine();
      return undefined;
    }
    if (!this.#check('rightParen')) {
      this.#addDiagnostic(
        'OXE1101',
        'createContext does not accept arguments.',
        this.#current().span,
      );
      this.#synchronizeLine();
      return undefined;
    }
    const end = this.#advance().span;
    if (!this.#check('newline') && !this.#check('endOfFile')) {
      this.#addDiagnostic(
        'OXE1101',
        'Expected the context declaration to end after createContext().',
        this.#current().span,
      );
      this.#synchronizeLine();
      return undefined;
    }
    this.#match('newline');
    return freezeNode({
      kind: 'ContextDeclaration',
      name,
      span: spanFrom(name.span, end),
    });
  }

  diagnostics(): readonly Diagnostic[] {
    return freezeNodes(this.#diagnostics);
  }

  #parseImportDeclaration(): ImportDeclarationNode | undefined {
    const opening = this.#advance();

    if (!this.#match('leftBrace')) {
      this.#addDiagnostic(
        'OXE1103',
        'Imports must use explicit named imports: import { Component } from "./module.oxe"',
        this.#current().span,
      );
      this.#synchronizeLine();
      return undefined;
    }

    const specifiers: ImportSpecifierNode[] = [];
    const importedNames = new Set<string>();
    let closing: Token | undefined;
    if (this.#check('rightBrace')) {
      this.#addDiagnostic(
        'OXE1101',
        'A named import must include at least one component name.',
        this.#current().span,
      );
      closing = this.#advance();
    } else {
      while (!this.#check('endOfFile')) {
        if (!this.#check('identifier')) {
          this.#addDiagnostic(
            'OXE1101',
            'Expected a component name in the named import.',
            this.#current().span,
          );
          this.#synchronizeLine();
          return undefined;
        }

        const name = this.#identifierFromToken(this.#advance());
        if (importedNames.has(name.name)) {
          this.#addDiagnostic(
            'OXE1101',
            `Imported component "${name.name}" is written more than once.`,
            name.span,
          );
        } else {
          importedNames.add(name.name);
        }
        specifiers.push(
          freezeNode({
            kind: 'ImportSpecifier',
            name,
            span: copySpan(name.span),
          }),
        );

        if (this.#check('identifier') && this.#current().lexeme === 'as') {
          this.#addDiagnostic(
            'OXE1103',
            'Import aliases are not supported. Import and use the exported component name directly.',
            this.#current().span,
          );
          this.#synchronizeLine();
          return undefined;
        }

        if (this.#check('rightBrace')) {
          closing = this.#advance();
          break;
        }
        if (!this.#match('comma')) {
          this.#addDiagnostic(
            'OXE1101',
            'Expected , or } after the imported component name.',
            this.#current().span,
          );
          this.#synchronizeLine();
          return undefined;
        }
        if (this.#check('rightBrace')) {
          this.#addDiagnostic(
            'OXE1101',
            'Expected an imported component name after ,.',
            this.#current().span,
          );
          closing = this.#advance();
          break;
        }
      }
    }

    if (!closing) {
      this.#addDiagnostic('OXE1101', 'Expected } after the named imports.', this.#current().span);
      this.#synchronizeLine();
      return undefined;
    }

    if (!this.#consume('from', 'OXE1101', 'Expected from after the named imports.')) {
      this.#synchronizeLine();
      return undefined;
    }

    if (!this.#check('string')) {
      this.#addDiagnostic(
        'OXE1101',
        'Expected a quoted module path after from.',
        this.#current().span,
      );
      this.#synchronizeLine();
      return undefined;
    }
    const sourceToken = this.#advance();
    const source: StringLiteralNode = freezeNode({
      kind: 'StringLiteral',
      value:
        typeof sourceToken.value === 'string' ? sourceToken.value : sourceToken.lexeme.slice(1, -1),
      span: copySpan(sourceToken.span),
    });

    if (!this.#check('newline') && !this.#check('endOfFile')) {
      this.#addDiagnostic(
        'OXE1101',
        'Expected the import declaration to end after the module path.',
        this.#current().span,
      );
      this.#synchronizeLine();
    } else {
      this.#match('newline');
    }

    return freezeNode({
      kind: 'ImportDeclaration',
      specifiers: freezeNodes(specifiers),
      source,
      span: spanFrom(opening.span, source.span),
    });
  }

  #parseComponentDeclaration(exportToken?: Token): ComponentDeclarationNode | undefined {
    const name = this.#parseIdentifier();
    if (!name) {
      this.#synchronizeLine();
      return undefined;
    }

    const parameters = this.#parseComponentParameters();
    if (!parameters) {
      this.#synchronizeLine();
      return undefined;
    }

    const colon = this.#consume('colon', 'OXE1101', 'Expected : after the component declaration.');
    if (!colon || !this.#consumeDeclarationLineEnd('component declaration')) {
      this.#synchronizeLine();
      return undefined;
    }

    this.#skipNewlines();
    if (!this.#match('indent')) {
      this.#addDiagnostic(
        'OXE1102',
        'Expected an indented component body.',
        pointSpan(this.#current().span.start, this.#fileName),
      );
      return freezeNode({
        kind: 'ComponentDeclaration',
        exported: exportToken !== undefined,
        name,
        parameters,
        body: freezeNodes([]),
        span: spanFrom(exportToken?.span ?? name.span, colon.span),
      });
    }

    const body: ComponentStatementNode[] = [];
    this.#skipNewlines();
    while (!this.#check('dedent') && !this.#check('endOfFile')) {
      const statement = this.#parseComponentStatement();
      if (statement) {
        body.push(statement);
      }
      this.#skipNewlines();
    }
    this.#match('dedent');

    const endSpan = body.at(-1)?.span ?? colon.span;
    return freezeNode({
      kind: 'ComponentDeclaration',
      exported: exportToken !== undefined,
      name,
      parameters,
      body: freezeNodes(body),
      span: spanFrom(exportToken?.span ?? name.span, endSpan),
    });
  }

  #parseComponentParameters(): readonly ComponentParameterNode[] | undefined {
    if (!this.#consume('leftParen', 'OXE1101', 'Expected ( after the component name.')) {
      return undefined;
    }

    const parameters: ComponentParameterNode[] = [];
    const parameterNames = new Set<string>();
    let sawDefault = false;
    let sawRest = false;

    if (this.#match('rightParen')) {
      return freezeNodes(parameters);
    }

    while (!this.#check('endOfFile')) {
      const restOpening = this.#matchToken('ellipsis');
      if (restOpening && !this.#check('identifier')) {
        this.#addDiagnostic(
          'OXE1101',
          'Expected a component rest parameter name after "...".',
          this.#current().span,
        );
        this.#synchronizeComponentParameters();
        this.#match('rightParen');
        return freezeNodes(parameters);
      }
      if (!restOpening && !this.#check('identifier')) {
        this.#addDiagnostic(
          'OXE1101',
          'Expected a component parameter name.',
          this.#current().span,
        );
        this.#synchronizeComponentParameters();
        this.#match('rightParen');
        return freezeNodes(parameters);
      }

      const name = this.#parseIdentifier();
      if (!name) {
        return undefined;
      }

      if (parameterNames.has(name.name)) {
        this.#addDiagnostic(
          'OXE1101',
          `Component parameter "${name.name}" is declared more than once.`,
          name.span,
        );
      } else {
        parameterNames.add(name.name);
      }

      if (restOpening) {
        if (sawRest) {
          this.#addDiagnostic(
            'OXE1101',
            'A component can declare only one rest parameter.',
            restOpening.span,
          );
        }
        sawRest = true;

        if (this.#match('equal')) {
          this.#addDiagnostic(
            'OXE1101',
            'A rest parameter cannot have a default value.',
            name.span,
          );
          this.#parseExpression();
        }

        const restParameter: RestComponentParameterNode = freezeNode({
          kind: 'RestComponentParameter',
          name,
          span: spanFrom(restOpening.span, name.span),
        });
        parameters.push(restParameter);
      } else if (this.#match('equal')) {
        if (
          this.#check('comma') ||
          this.#check('rightParen') ||
          this.#check('colon') ||
          this.#check('newline') ||
          this.#check('endOfFile')
        ) {
          this.#addDiagnostic(
            'OXE1101',
            `Expected a default value expression for parameter "${name.name}".`,
            this.#current().span,
          );
          this.#synchronizeComponentParameters();
          this.#match('rightParen');
          return freezeNodes(parameters);
        }

        const defaultValue = this.#parseExpression();
        if (!defaultValue) {
          this.#synchronizeComponentParameters();
          this.#match('rightParen');
          return freezeNodes(parameters);
        }
        const defaultParameter: DefaultComponentParameterNode = freezeNode({
          kind: 'DefaultComponentParameter',
          name,
          defaultValue,
          span: spanFrom(name.span, defaultValue.span),
        });
        parameters.push(defaultParameter);
        sawDefault = true;
      } else {
        if (sawDefault) {
          this.#addDiagnostic(
            'OXE1101',
            'Required component parameters must be declared before parameters with defaults.',
            name.span,
          );
        }
        const requiredParameter: RequiredComponentParameterNode = freezeNode({
          kind: 'RequiredComponentParameter',
          name,
          span: copySpan(name.span),
        });
        parameters.push(requiredParameter);
      }

      if (this.#match('rightParen')) {
        return freezeNodes(parameters);
      }

      if (!this.#match('comma')) {
        this.#addDiagnostic(
          'OXE1101',
          restOpening
            ? 'Expected ) after the rest parameter.'
            : 'Expected , or ) after the component parameter.',
          this.#current().span,
        );
        this.#synchronizeComponentParameters();
        this.#match('rightParen');
        return freezeNodes(parameters);
      }

      if (restOpening) {
        this.#addDiagnostic(
          'OXE1101',
          'The rest parameter must be the final component parameter.',
          restOpening.span,
        );
      }

      if (this.#check('rightParen')) {
        this.#addDiagnostic(
          'OXE1101',
          'Expected a component parameter after ,.',
          this.#current().span,
        );
        this.#advance();
        return freezeNodes(parameters);
      }
    }

    return freezeNodes(parameters);
  }

  #parseHandlerParameters(): readonly IdentifierNode[] | undefined {
    if (!this.#consume('leftParen', 'OXE1101', 'Expected ( after the handler name.')) {
      return undefined;
    }

    const parameters: IdentifierNode[] = [];
    const names = new Set<string>();
    if (this.#match('rightParen')) {
      return freezeNodes(parameters);
    }

    while (!this.#check('endOfFile')) {
      const parameter = this.#parseIdentifier();
      if (!parameter) {
        return undefined;
      }
      if (names.has(parameter.name)) {
        this.#addDiagnostic(
          'OXE1101',
          `Handler parameter "${parameter.name}" is declared more than once.`,
          parameter.span,
        );
      }
      names.add(parameter.name);
      parameters.push(parameter);
      if (this.#match('rightParen')) {
        return freezeNodes(parameters);
      }
      if (!this.#consume('comma', 'OXE1101', 'Expected , or ) after the handler parameter.')) {
        return undefined;
      }
    }
    return undefined;
  }

  #consumeDeclarationLineEnd(declarationKind: string): boolean {
    if (this.#match('newline')) {
      return true;
    }

    this.#addDiagnostic(
      'OXE1101',
      `Expected a newline after the ${declarationKind}.`,
      this.#current().span,
    );
    return false;
  }

  #parseComponentStatement(): ComponentStatementNode | undefined {
    if (this.#check('lessThan')) {
      return this.#parseElement();
    }

    if (this.#check('question')) {
      return this.#parseConditionalBlock();
    }

    if (this.#check('identifier')) {
      if (this.#checkNext('equal') || this.#checkNext('equalQuestion')) {
        return this.#parseAssignment();
      }
      if (this.#checkNext('leftParen') && this.#looksLikeDeclarationHeader()) {
        return this.#parseHandlerDeclaration();
      }
      if (this.#isRetiredIfSyntax()) {
        this.#diagnoseRetiredIfSyntax();
        return undefined;
      }
    }

    if (
      this.#canStartExpression() &&
      (this.#lineContains('question') || this.#lineContainsUiArrow())
    ) {
      return this.#parseInlineConditionalRegion();
    }

    if (this.#canStartExpression()) {
      return this.#parseExpressionStatement();
    }

    this.#addDiagnostic(
      'OXE1103',
      'Expected an assignment, handler, call, element, or conditional in the component body.',
      this.#current().span,
    );
    this.#synchronizeLine();
    return undefined;
  }

  #parseHandlerDeclaration(): HandlerDeclarationNode | undefined {
    const name = this.#parseIdentifier();
    if (!name) {
      this.#synchronizeLine();
      return undefined;
    }

    const parameters = this.#parseHandlerParameters();
    if (!parameters) {
      this.#synchronizeLine();
      return undefined;
    }

    const colon = this.#consume('colon', 'OXE1101', 'Expected : after the handler declaration.');
    if (!colon || !this.#consumeDeclarationLineEnd('handler declaration')) {
      this.#synchronizeLine();
      return undefined;
    }

    this.#skipNewlines();
    if (!this.#match('indent')) {
      this.#addDiagnostic(
        'OXE1102',
        'Expected an indented handler body.',
        pointSpan(this.#current().span.start, this.#fileName),
      );
      return freezeNode({
        kind: 'HandlerDeclaration',
        name,
        parameters,
        body: freezeNodes([]),
        span: spanFrom(name.span, colon.span),
      });
    }

    const body: (
      | AssignmentStatementNode
      | CollectionMutationStatementNode
      | ExpressionStatementNode
      | MemberAssignmentStatementNode
    )[] = [];
    this.#skipNewlines();
    while (!this.#check('dedent') && !this.#check('endOfFile')) {
      if (this.#looksLikeCollectionMutation()) {
        const statement = this.#parseCollectionMutation();
        if (statement) {
          body.push(statement);
        }
      } else if (
        this.#check('identifier') &&
        (this.#checkNext('equal') || this.#checkNext('equalQuestion'))
      ) {
        const statement = this.#parseAssignment();
        if (statement) {
          body.push(statement);
        }
      } else if (this.#looksLikeMemberAssignment()) {
        const statement = this.#parseMemberAssignment();
        if (statement) {
          body.push(statement);
        }
      } else if (this.#canStartExpression()) {
        const statement = this.#parseExpressionStatement();
        if (statement) {
          body.push(statement);
        }
      } else {
        this.#addDiagnostic(
          'OXE1104',
          'Expected an assignment or call in the handler body.',
          this.#current().span,
        );
        this.#synchronizeLine();
      }
      this.#skipNewlines();
    }
    this.#match('dedent');

    const endSpan = body.at(-1)?.span ?? colon.span;
    return freezeNode({
      kind: 'HandlerDeclaration',
      name,
      parameters,
      body: freezeNodes(body),
      span: spanFrom(name.span, endSpan),
    });
  }

  #parseAssignment(): AssignmentStatementNode | undefined {
    const target = this.#parseIdentifier();
    if (!target) {
      this.#synchronizeLine();
      return undefined;
    }

    if (!this.#check('equal') && !this.#check('equalQuestion')) {
      this.#addDiagnostic(
        'OXE1101',
        'Expected = or =? after the assignment target.',
        this.#current().span,
      );
      this.#synchronizeLine();
      return undefined;
    }
    const operator = this.#advance();

    const value =
      operator.kind === 'equalQuestion'
        ? this.#parseValueChoiceExpression(operator)
        : this.#parseExpression();
    if (!value) {
      this.#synchronizeLine();
      return undefined;
    }

    if (
      operator.kind === 'equal' &&
      !this.#check('newline') &&
      !this.#check('dedent') &&
      !this.#check('endOfFile')
    ) {
      this.#addDiagnostic(
        'OXE1101',
        'Expected the assignment to end after its value.',
        this.#current().span,
      );
      this.#synchronizeLine();
    } else if (operator.kind === 'equal') {
      this.#match('newline');
    }

    return freezeNode({
      kind: 'AssignmentStatement',
      target,
      value,
      span: spanFrom(target.span, value.span),
    });
  }

  #parseMemberAssignment(): MemberAssignmentStatementNode | undefined {
    const target = this.#parseMemberAssignmentTarget();
    if (!target) {
      this.#synchronizeLine();
      return undefined;
    }
    if (!this.#consume('equal', 'OXE1101', 'Expected = after the record field.')) {
      this.#synchronizeLine();
      return undefined;
    }
    const value = this.#parseExpression();
    if (!value) {
      this.#synchronizeLine();
      return undefined;
    }
    if (!this.#check('newline') && !this.#check('dedent') && !this.#check('endOfFile')) {
      this.#addDiagnostic(
        'OXE1101',
        'Expected the record field assignment to end after its value.',
        this.#current().span,
      );
      this.#synchronizeLine();
    } else {
      this.#match('newline');
    }
    return freezeNode({
      kind: 'MemberAssignmentStatement',
      target,
      value,
      span: spanFrom(target.span, value.span),
    });
  }

  #parseMemberAssignmentTarget(): MemberExpressionNode | undefined {
    let object: ExpressionNode | undefined = this.#parseIdentifier();
    if (!object) {
      return undefined;
    }
    let member: MemberExpressionNode | undefined;
    while (this.#match('dot')) {
      const property = this.#parseIdentifier();
      if (!property) {
        return undefined;
      }
      member = freezeNode({
        kind: 'MemberExpression',
        object,
        property,
        span: spanFrom(object.span, property.span),
      });
      object = member;
    }
    return member;
  }

  #parseCollectionMutation(): CollectionMutationStatementNode | undefined {
    const collection = this.#parseIdentifier();
    if (
      !collection ||
      !this.#consume('dot', 'OXE1101', 'Expected . before the collection operation.')
    ) {
      this.#synchronizeLine();
      return undefined;
    }
    const operationName = this.#parseIdentifier();
    if (!operationName) {
      this.#synchronizeLine();
      return undefined;
    }
    const operation = operationName.name as CollectionMutationStatementNode['operation'];
    if (operation !== 'add' && operation !== 'remove' && operation !== 'update') {
      this.#addDiagnostic('OXE1105', 'Expected add, update, or remove.', operationName.span);
      this.#synchronizeLine();
      return undefined;
    }
    if (!this.#consume('leftParen', 'OXE1101', `Expected ( after ${operation}.`)) {
      this.#synchronizeLine();
      return undefined;
    }
    const multilineCall = this.#beginCollectionMutationCall();
    if (multilineCall === undefined) {
      this.#synchronizeLine();
      return undefined;
    }

    if (operation === 'add') {
      const value = this.#parseExpression();
      if (!value) {
        this.#synchronizeLine();
        return undefined;
      }
      const closing = this.#closeCollectionMutationCall(
        multilineCall,
        'Expected ) after the added value.',
      );
      if (!closing || !this.#finishCollectionMutationLine()) {
        return undefined;
      }
      return freezeNode({
        collection,
        kind: 'CollectionMutationStatement',
        operation,
        span: spanFrom(collection.span, closing.span),
        value,
      });
    }

    const predicate = this.#parseCollectionMutationPredicate(operation);
    if (!predicate) {
      this.#synchronizeLine();
      return undefined;
    }

    let updater: CollectionMutationUpdaterNode | undefined;
    if (operation === 'update') {
      if (!this.#consume('comma', 'OXE1101', 'Expected , before the update callback.')) {
        this.#synchronizeLine();
        return undefined;
      }
      this.#skipNewlines();
      updater = this.#parseCollectionMutationUpdater();
      if (!updater) {
        this.#synchronizeLine();
        return undefined;
      }
    }

    let limit: ExpressionNode | undefined;
    if (this.#match('comma')) {
      this.#skipNewlines();
      limit = this.#parseExpression();
      if (!limit) {
        this.#synchronizeLine();
        return undefined;
      }
    }
    const closing = this.#closeCollectionMutationCall(
      multilineCall,
      `Expected ) after the ${operation} operation.`,
    );
    if (!closing || !this.#finishCollectionMutationLine()) {
      return undefined;
    }
    return freezeNode({
      collection,
      kind: 'CollectionMutationStatement',
      ...(limit ? { limit } : {}),
      operation,
      predicate,
      span: spanFrom(collection.span, closing.span),
      ...(updater ? { updater } : {}),
    });
  }

  #parseCollectionMutationPredicate(
    operation: 'remove' | 'update',
  ): CollectionMutationPredicateNode | undefined {
    const parameter = this.#parseSingleCallbackParameter(operation);
    if (!parameter) {
      return undefined;
    }
    if (!this.#consume('arrow', 'OXE1101', `Expected => after the ${operation} parameter.`)) {
      return undefined;
    }
    const callback = this.#parseCallbackBlock();
    if (!callback) {
      return undefined;
    }
    if (callback.result.kind === 'Element') {
      this.#addDiagnostic(
        'OXE1105',
        `${operation} predicates must produce a value, not markup.`,
        callback.result.span,
      );
      return undefined;
    }
    return freezeNode({
      callback,
      parameter,
      span: spanFrom(parameter.span, callback.span),
    });
  }

  #parseCollectionMutationUpdater(): CollectionMutationUpdaterNode | undefined {
    const parameter = this.#parseSingleCallbackParameter('update');
    if (!parameter) {
      return undefined;
    }
    if (!this.#consume('arrow', 'OXE1101', 'Expected => after the update parameter.')) {
      return undefined;
    }

    const assignments: CollectionUpdateAssignmentNode[] = [];
    if (!this.#match('newline')) {
      const assignment = this.#parseCollectionUpdateAssignment(false);
      if (assignment) {
        assignments.push(assignment);
      }
    } else {
      this.#skipNewlines();
      if (!this.#match('indent')) {
        this.#addDiagnostic(
          'OXE1102',
          'Expected an indented update callback body after =>.',
          pointSpan(this.#current().span.start, this.#fileName),
        );
        return undefined;
      }
      this.#skipNewlines();
      while (!this.#check('dedent') && !this.#check('endOfFile')) {
        const assignment = this.#parseCollectionUpdateAssignment(true);
        if (assignment) {
          assignments.push(assignment);
        }
        this.#skipNewlines();
      }
      this.#match('dedent');
    }

    if (assignments.length === 0) {
      this.#addDiagnostic(
        'OXE1105',
        'An update callback must assign at least one field or replace its value.',
        parameter.span,
      );
      return undefined;
    }
    return freezeNode({
      assignments: freezeNodes(assignments),
      kind: 'CollectionMutationUpdater',
      parameter,
      span: spanFrom(parameter.span, assignments.at(-1)?.span ?? parameter.span),
    });
  }

  #parseCollectionUpdateAssignment(
    consumeLineEnd: boolean,
  ): CollectionUpdateAssignmentNode | undefined {
    const identifier = this.#parseIdentifier();
    if (!identifier) {
      return undefined;
    }
    let target: IdentifierNode | MemberExpressionNode = identifier;
    while (this.#match('dot')) {
      const property = this.#parseIdentifier();
      if (!property) {
        return undefined;
      }
      target = freezeNode({
        kind: 'MemberExpression',
        object: target,
        property,
        span: spanFrom(target.span, property.span),
      });
    }
    if (!this.#consume('equal', 'OXE1101', 'Expected = in the update callback.')) {
      return undefined;
    }
    const value = this.#parseExpression();
    if (!value) {
      return undefined;
    }
    if (consumeLineEnd) {
      if (!this.#check('newline') && !this.#check('dedent') && !this.#check('endOfFile')) {
        this.#addDiagnostic(
          'OXE1101',
          'Expected the update assignment to end after its value.',
          this.#current().span,
        );
        this.#synchronizeLine();
      } else {
        this.#match('newline');
      }
    }
    return freezeNode({
      kind: 'CollectionUpdateAssignment',
      target,
      value,
      span: spanFrom(target.span, value.span),
    });
  }

  #parseSingleCallbackParameter(operation: string): IdentifierNode | undefined {
    if (!this.#match('leftParen')) {
      return this.#parseIdentifier();
    }
    const parameter = this.#parseIdentifier();
    if (!parameter) {
      return undefined;
    }
    if (!this.#consume('rightParen', 'OXE1101', `Expected ) after the ${operation} parameter.`)) {
      return undefined;
    }
    return parameter;
  }

  #finishCollectionMutationLine(): boolean {
    if (!this.#check('newline') && !this.#check('dedent') && !this.#check('endOfFile')) {
      this.#addDiagnostic(
        'OXE1101',
        'Expected the collection operation to end after the call.',
        this.#current().span,
      );
      this.#synchronizeLine();
      return false;
    }
    this.#match('newline');
    return true;
  }

  #beginCollectionMutationCall(): boolean | undefined {
    if (!this.#match('newline')) {
      return false;
    }
    this.#skipNewlines();
    if (!this.#match('indent')) {
      this.#addDiagnostic(
        'OXE1102',
        'Expected indented collection operation arguments.',
        pointSpan(this.#current().span.start, this.#fileName),
      );
      return undefined;
    }
    this.#skipNewlines();
    return true;
  }

  #closeCollectionMutationCall(multiline: boolean, message: string): Token | undefined {
    if (multiline) {
      this.#match('newline');
      this.#skipNewlines();
      if (!this.#match('dedent')) {
        this.#addDiagnostic(
          'OXE1102',
          'Expected collection operation arguments to return to the call indentation.',
          pointSpan(this.#current().span.start, this.#fileName),
        );
        return undefined;
      }
    }
    return this.#consume('rightParen', 'OXE1101', message);
  }

  #parseExpressionStatement(): ExpressionStatementNode | undefined {
    const expression = this.#parseExpression();
    if (!expression) {
      this.#synchronizeLine();
      return undefined;
    }
    if (!this.#check('newline') && !this.#check('dedent') && !this.#check('endOfFile')) {
      this.#addDiagnostic(
        'OXE1101',
        'Expected the expression statement to end after the call.',
        this.#current().span,
      );
      this.#synchronizeLine();
    } else {
      this.#match('newline');
    }
    return freezeNode({
      expression,
      kind: 'ExpressionStatement',
      span: copySpan(expression.span),
    });
  }

  #parseValueChoiceExpression(opening: Token): ConditionalValueExpressionNode | undefined {
    if (!this.#match('newline')) {
      this.#addDiagnostic('OXE1101', 'Expected a newline after =?.', this.#current().span);
      return undefined;
    }

    this.#skipNewlines();
    if (!this.#match('indent')) {
      this.#addDiagnostic(
        'OXE1102',
        'Expected indented branches after =?.',
        pointSpan(this.#current().span.start, this.#fileName),
      );
      return undefined;
    }

    const branches: ConditionalValueBranchNode[] = [];
    let sawCatchall = false;
    this.#skipNewlines();
    while (!this.#check('dedent') && !this.#check('endOfFile')) {
      const start = this.#current().span;
      if (sawCatchall) {
        this.#addDiagnostic(
          'OXE1105',
          'The conditionless value choice branch must be last.',
          start,
        );
      }

      let condition: ExpressionNode | undefined;
      if (this.#match('colon')) {
        sawCatchall = true;
      } else {
        condition = this.#parseExpression(0, false);
        if (!condition) {
          this.#synchronizeLine();
          this.#skipNewlines();
          continue;
        }
        if (!this.#consume('question', 'OXE1101', 'Expected ? after the value choice condition.')) {
          this.#synchronizeLine();
          this.#skipNewlines();
          continue;
        }
      }

      const result = this.#parseConditionalResult();
      if (!result) {
        this.#synchronizeLine();
        this.#skipNewlines();
        continue;
      }

      if (
        result.kind !== 'ConditionalResultBlock' &&
        !this.#check('newline') &&
        !this.#check('dedent') &&
        !this.#check('endOfFile')
      ) {
        this.#addDiagnostic(
          'OXE1101',
          'Expected the value choice branch to end after its result.',
          this.#current().span,
        );
        this.#synchronizeLine();
      } else if (result.kind !== 'ConditionalResultBlock') {
        this.#match('newline');
      }

      branches.push(
        freezeNode({
          kind: 'ConditionalValueBranch',
          ...(condition ? { condition } : {}),
          result,
          span: spanFrom(condition?.span ?? start, result.span),
        }),
      );
      this.#skipNewlines();
    }
    this.#match('dedent');

    if (branches.length === 0) {
      this.#addDiagnostic('OXE1105', 'A value choice requires at least one branch.', opening.span);
      return undefined;
    }
    if (!sawCatchall) {
      this.#addDiagnostic(
        'OXE1105',
        'A value-producing choice must end with a : fallback.',
        branches.at(-1)?.span ?? opening.span,
      );
    }

    return freezeNode({
      kind: 'ConditionalValueExpression',
      branches: freezeNodes(branches),
      span: spanFrom(opening.span, branches.at(-1)?.span ?? opening.span),
    });
  }

  #parseExpression(minimumPrecedence = 0, allowConditional = true): ExpressionNode | undefined {
    let left = this.#parsePrimaryExpression();
    if (!left) {
      return undefined;
    }

    left = this.#parsePostfixExpression(left);
    if (!left) {
      return undefined;
    }

    while (true) {
      const definition = binaryOperators[this.#current().kind];
      if (!definition || definition.precedence < minimumPrecedence) {
        break;
      }

      this.#advance();
      const right = this.#parseExpression(definition.precedence + 1, allowConditional);
      if (!right) {
        return undefined;
      }

      const binary: BinaryExpressionNode = freezeNode({
        kind: 'BinaryExpression',
        operator: definition.operator,
        left,
        right,
        span: spanFrom(left.span, right.span),
      });
      left = binary;
    }

    if (allowConditional && minimumPrecedence === 0 && this.#match('question')) {
      const result = this.#parseExpression();
      if (!result) {
        return undefined;
      }
      const fallbackOpening = this.#consume(
        'colon',
        'OXE1105',
        'A value-producing inline conditional requires a : fallback.',
      );
      if (!fallbackOpening) {
        return undefined;
      }
      const fallback = this.#parseExpression();
      if (!fallback) {
        return undefined;
      }
      const conditional: ConditionalValueExpressionNode = freezeNode({
        kind: 'ConditionalValueExpression',
        branches: freezeNodes([
          freezeNode({
            kind: 'ConditionalValueBranch',
            condition: left,
            result,
            span: spanFrom(left.span, result.span),
          }),
          freezeNode({
            kind: 'ConditionalValueBranch',
            result: fallback,
            span: spanFrom(fallbackOpening.span, fallback.span),
          }),
        ]),
        span: spanFrom(left.span, fallback.span),
      });
      return conditional;
    }

    return left;
  }

  #parsePostfixExpression(initial: ExpressionNode): ExpressionNode | undefined {
    let expression = initial;
    if (
      expression.kind === 'Identifier' &&
      expression.name === 'untrack' &&
      this.#match('leftParen')
    ) {
      const value = this.#parseExpression();
      if (!value) {
        return undefined;
      }
      const closing = this.#consume('rightParen', 'OXE1101', 'Expected ) after untrack.');
      if (!closing) {
        return undefined;
      }
      const snapshot: UntrackExpressionNode = freezeNode({
        kind: 'UntrackExpression',
        expression: value,
        span: spanFrom(expression.span, closing.span),
      });
      expression = snapshot;
    }
    while (true) {
      if (this.#match('dot')) {
        const property = this.#parseIdentifier();
        if (!property) {
          return undefined;
        }
        if (
          this.#check('leftParen') &&
          (property.name === 'map' ||
            property.name === 'filter' ||
            property.name === 'flatMap' ||
            property.name === 'reduce' ||
            property.name === 'sort') &&
          this.#callContainsArrow()
        ) {
          const collection = this.#parseCollectionExpression(expression, property);
          if (!collection) {
            return undefined;
          }
          expression = collection;
          continue;
        }
        const member: MemberExpressionNode = freezeNode({
          kind: 'MemberExpression',
          object: expression,
          property,
          span: spanFrom(expression.span, property.span),
        });
        expression = member;
        continue;
      }
      if (this.#match('leftParen')) {
        const arguments_: ExpressionNode[] = [];
        if (!this.#check('rightParen')) {
          while (!this.#check('endOfFile')) {
            const argument = this.#parseExpression();
            if (!argument) {
              return undefined;
            }
            arguments_.push(argument);
            if (this.#check('rightParen')) {
              break;
            }
            if (!this.#consume('comma', 'OXE1101', 'Expected , or ) after the call argument.')) {
              return undefined;
            }
          }
        }
        const closing = this.#consume('rightParen', 'OXE1101', 'Expected ) after the call.');
        if (!closing) {
          return undefined;
        }
        const call: CallExpressionNode = freezeNode({
          arguments: freezeNodes(arguments_),
          callee: expression,
          kind: 'CallExpression',
          span: spanFrom(expression.span, closing.span),
        });
        expression = call;
        continue;
      }
      break;
    }
    return expression;
  }

  #parseCollectionExpression(
    collection: ExpressionNode,
    operationName: IdentifierNode,
  ): CollectionExpressionNode | MapExpressionNode | undefined {
    const operation = operationName.name as CollectionExpressionNode['operation'];
    this.#advance();
    const parameters: IdentifierNode[] = [];
    if (this.#match('leftParen')) {
      while (!this.#check('rightParen') && !this.#check('endOfFile')) {
        const parameter = this.#parseIdentifier();
        if (!parameter) {
          return undefined;
        }
        parameters.push(parameter);
        if (!this.#match('comma')) {
          break;
        }
      }
      if (!this.#consume('rightParen', 'OXE1101', 'Expected ) after callback parameters.')) {
        return undefined;
      }
    } else {
      const parameter = this.#parseIdentifier();
      if (!parameter) {
        return undefined;
      }
      parameters.push(parameter);
    }

    const expectedParameters = operation === 'reduce' ? 2 : 1;
    if (parameters.length !== expectedParameters) {
      this.#addDiagnostic(
        'OXE1105',
        `${operation} callbacks require exactly ${expectedParameters} parameter${expectedParameters === 1 ? '' : 's'}.`,
        operationName.span,
      );
    }
    if (!this.#consume('arrow', 'OXE1101', `Expected => after the ${operation} parameters.`)) {
      return undefined;
    }

    const callback = this.#parseCallbackBlock();
    if (!callback) {
      return undefined;
    }

    let initial: ExpressionNode | undefined;
    let options: ExpressionNode | undefined;
    if (operation === 'reduce') {
      if (!this.#match('comma')) {
        this.#addDiagnostic('OXE1105', 'reduce requires an initial value.', this.#current().span);
      } else {
        initial = this.#parseExpression();
        if (!initial) {
          return undefined;
        }
      }
    } else if (operation === 'sort' && this.#match('comma')) {
      options = this.#parseExpression();
      if (!options) {
        return undefined;
      }
    }
    const closing = this.#consume(
      'rightParen',
      'OXE1101',
      `Expected ) after the ${operation} callback.`,
    );
    if (!closing) {
      return undefined;
    }

    if (callback.result.kind === 'Element') {
      if (operation !== 'map' || parameters.length !== 1) {
        this.#addDiagnostic(
          'OXE1105',
          'Only map may use a markup-producing callback.',
          callback.result.span,
        );
        return undefined;
      }
      const parameter = parameters[0];
      if (!parameter) {
        return undefined;
      }
      return freezeNode({
        assignments: callback.assignments,
        body: callback.result,
        collection,
        kind: 'MapExpression',
        parameter,
        span: spanFrom(collection.span, closing.span),
      });
    }

    return freezeNode({
      callback,
      collection,
      ...(initial ? { initial } : {}),
      kind: 'CollectionExpression',
      operation,
      ...(options ? { options } : {}),
      parameters: freezeNodes(parameters),
      span: spanFrom(collection.span, closing.span),
    });
  }

  #parseCallbackBlock(): CallbackBlockNode | undefined {
    if (!this.#match('newline')) {
      const result = this.#check('lessThan') ? this.#parseElement(true) : this.#parseExpression();
      return result
        ? freezeNode({
            assignments: freezeNodes([]),
            kind: 'CallbackBlock',
            result,
            span: copySpan(result.span),
          })
        : undefined;
    }

    this.#skipNewlines();
    if (!this.#match('indent')) {
      this.#addDiagnostic(
        'OXE1102',
        'Expected an indented callback body after =>.',
        pointSpan(this.#current().span.start, this.#fileName),
      );
      return undefined;
    }

    const assignments: AssignmentStatementNode[] = [];
    this.#skipNewlines();
    while (
      this.#check('identifier') &&
      (this.#checkNext('equal') || this.#checkNext('equalQuestion'))
    ) {
      const assignment = this.#parseAssignment();
      if (assignment) {
        assignments.push(assignment);
      }
      this.#skipNewlines();
    }

    const result = this.#check('lessThan') ? this.#parseElement() : this.#parseExpression();
    if (!result) {
      this.#synchronizeLine();
      this.#match('dedent');
      return undefined;
    }
    if (result.kind !== 'Element') {
      if (!this.#check('newline') && !this.#check('dedent') && !this.#check('endOfFile')) {
        this.#addDiagnostic(
          'OXE1101',
          'Expected the callback result to end at the end of the line.',
          this.#current().span,
        );
        this.#synchronizeLine();
      } else {
        this.#match('newline');
      }
    }
    this.#skipNewlines();
    this.#match('dedent');
    return freezeNode({
      assignments: freezeNodes(assignments),
      kind: 'CallbackBlock',
      result,
      span: spanFrom(assignments[0]?.span ?? result.span, result.span),
    });
  }

  #callContainsArrow(): boolean {
    let depth = 0;
    for (let index = this.#index; index < this.#tokens.length; index += 1) {
      const token = this.#tokens[index];
      if (!token || token.kind === 'endOfFile') {
        return false;
      }
      if (token.kind === 'leftParen') {
        depth += 1;
      } else if (token.kind === 'rightParen') {
        depth -= 1;
        if (depth === 0) {
          return false;
        }
      } else if (token.kind === 'arrow' && depth > 0) {
        return true;
      }
    }
    return false;
  }

  #parsePrimaryExpression(): ExpressionNode | undefined {
    const token = this.#current();

    if (token.kind === 'identifier') {
      this.#advance();
      if (token.lexeme === 'true' || token.lexeme === 'false') {
        const literal: BooleanLiteralNode = freezeNode({
          kind: 'BooleanLiteral',
          value: token.lexeme === 'true',
          span: copySpan(token.span),
        });
        return literal;
      }
      return this.#identifierFromToken(token);
    }

    if (token.kind === 'number') {
      this.#advance();
      const literal: NumberLiteralNode = freezeNode({
        kind: 'NumberLiteral',
        value: typeof token.value === 'number' ? token.value : Number(token.lexeme),
        span: copySpan(token.span),
      });
      return literal;
    }

    if (token.kind === 'string') {
      this.#advance();
      const literal: StringLiteralNode = freezeNode({
        kind: 'StringLiteral',
        value: typeof token.value === 'string' ? token.value : token.lexeme.slice(1, -1),
        span: copySpan(token.span),
      });
      return literal;
    }

    if (token.kind === 'leftParen') {
      const opening = this.#advance();
      const expression = this.#parseExpression();
      if (!expression) {
        return undefined;
      }
      const closing = this.#consume(
        'rightParen',
        'OXE1101',
        'Expected ) after the parenthesized expression.',
      );
      if (!closing) {
        return undefined;
      }
      const grouped: ParenthesizedExpressionNode = freezeNode({
        kind: 'ParenthesizedExpression',
        expression,
        span: spanFrom(opening.span, closing.span),
      });
      return grouped;
    }

    if (token.kind === 'leftBracket') {
      const opening = this.#advance();
      const elements: ExpressionNode[] = [];
      if (!this.#check('rightBracket')) {
        while (!this.#check('endOfFile')) {
          const element = this.#parseExpression();
          if (!element) {
            return undefined;
          }
          elements.push(element);
          if (this.#check('rightBracket')) {
            break;
          }
          if (!this.#consume('comma', 'OXE1101', 'Expected , or ] in the array literal.')) {
            return undefined;
          }
        }
      }
      const closing = this.#consume(
        'rightBracket',
        'OXE1101',
        'Expected ] after the array literal.',
      );
      if (!closing) {
        return undefined;
      }
      const array: ArrayLiteralNode = freezeNode({
        kind: 'ArrayLiteral',
        elements: freezeNodes(elements),
        span: spanFrom(opening.span, closing.span),
      });
      return array;
    }

    if (token.kind === 'leftBrace') {
      const opening = this.#advance();
      const entries: RecordEntryNode[] = [];
      const names = new Set<string>();
      if (!this.#check('rightBrace')) {
        while (!this.#check('endOfFile')) {
          const name = this.#parseIdentifier();
          if (!name) {
            return undefined;
          }
          if (names.has(name.name)) {
            this.#addDiagnostic(
              'OXE1105',
              `Record field "${name.name}" is written more than once.`,
              name.span,
            );
          }
          names.add(name.name);
          if (!this.#consume('colon', 'OXE1101', 'Expected : after the record field name.')) {
            return undefined;
          }
          const value = this.#parseExpression();
          if (!value) {
            return undefined;
          }
          entries.push(
            freezeNode({
              kind: 'RecordEntry',
              name,
              value,
              span: spanFrom(name.span, value.span),
            }),
          );
          if (this.#check('rightBrace')) {
            break;
          }
          if (!this.#consume('comma', 'OXE1101', 'Expected , or } in the record literal.')) {
            return undefined;
          }
        }
      }
      const closing = this.#consume(
        'rightBrace',
        'OXE1101',
        'Expected } after the record literal.',
      );
      if (!closing) {
        return undefined;
      }
      const record: RecordLiteralNode = freezeNode({
        entries: freezeNodes(entries),
        kind: 'RecordLiteral',
        span: spanFrom(opening.span, closing.span),
      });
      return record;
    }

    this.#addDiagnostic(
      'OXE1105',
      'Expected an identifier, number, string, Boolean, array, record, or parenthesized expression.',
      pointSpan(token.span.start, this.#fileName),
    );
    if (
      token.kind !== 'newline' &&
      token.kind !== 'rightBrace' &&
      token.kind !== 'dedent' &&
      token.kind !== 'endOfFile'
    ) {
      this.#advance();
    }
    return undefined;
  }

  #parseElement(stopAtRightParen = false, stopAtInlineFallback = false): ElementNode | undefined {
    const opening = this.#advance();
    const nameToken = this.#current();
    if (nameToken.kind !== 'identifier') {
      this.#addDiagnostic('OXE1101', 'Expected an element name after <.', nameToken.span);
      this.#synchronizeLine();
      return undefined;
    }
    this.#advance();
    const name = this.#identifierFromToken(nameToken);

    const attributes: ElementAttributeNode[] = [];
    const attributeNames = new Set<string>();
    while (this.#check('identifier') || this.#check('leftBrace')) {
      const attribute = this.#check('leftBrace')
        ? this.#parseSpreadAttribute()
        : this.#parseAttribute();
      if (attribute) {
        if (attribute.kind === 'Attribute') {
          if (attributeNames.has(attribute.name.name)) {
            this.#addDiagnostic(
              'OXE1107',
              `Attribute "${attribute.name.name}" is written more than once.`,
              attribute.name.span,
            );
          } else {
            attributeNames.add(attribute.name.name);
          }
        }
        attributes.push(attribute);
      }
    }

    const closing = this.#consume(
      'greaterThan',
      'OXE1101',
      'Expected > after the opening element.',
    );
    if (!closing) {
      this.#synchronizeLine();
      return freezeNode({
        kind: 'Element',
        name,
        attributes: freezeNodes(attributes),
        children: freezeNodes([]),
        span: spanFrom(opening.span, attributes.at(-1)?.span ?? name.span),
      });
    }

    const children = this.#parseInlineMarkupChildren(
      closing.span.end,
      stopAtRightParen,
      stopAtInlineFallback,
    );
    this.#match('newline');

    if (this.#match('indent')) {
      this.#skipNewlines();
      while (!this.#check('dedent') && !this.#check('endOfFile')) {
        const child = this.#parseMarkupChild();
        if (child) {
          children.push(child);
        }
        this.#skipNewlines();
      }
      this.#match('dedent');
    }

    const endSpan = children.at(-1)?.span ?? closing.span;
    return freezeNode({
      kind: 'Element',
      name,
      attributes: freezeNodes(attributes),
      children: freezeNodes(children),
      span: spanFrom(opening.span, endSpan),
    });
  }

  #parseConditionalBranch(stopAtInlineFallback = false): ConditionalBranchNode | undefined {
    const start = this.#current().span;
    let condition: ExpressionNode | undefined;
    if (this.#match('colon')) {
      condition = undefined;
    } else {
      condition = this.#parseExpression(0, false);
      if (!condition) {
        this.#synchronizeLine();
        return undefined;
      }
      if (
        !this.#consume(
          'question',
          'OXE1101',
          'Expected ? after the conditional condition. => is reserved for functions and callbacks.',
        )
      ) {
        this.#synchronizeLine();
        return undefined;
      }
    }
    const result = this.#parseConditionalResult(true, stopAtInlineFallback);
    if (!result) {
      return undefined;
    }
    return freezeNode({
      kind: 'ConditionalBranch',
      ...(condition ? { condition } : {}),
      result,
      span: spanFrom(condition?.span ?? start, result.span),
    });
  }

  #parseConditionalResult(
    requireElement = false,
    stopAtInlineFallback = false,
  ): ConditionalResultNode | undefined {
    if (!this.#match('newline')) {
      if (this.#check('lessThan')) {
        return this.#parseElement(false, stopAtInlineFallback);
      }
      if (requireElement) {
        this.#addDiagnostic(
          'OXE1105',
          'A UI conditional branch must produce an element.',
          this.#current().span,
        );
        this.#synchronizeLine();
        return undefined;
      }
      return this.#parseExpression();
    }

    this.#skipNewlines();
    if (!this.#match('indent')) {
      this.#addDiagnostic(
        'OXE1102',
        'Expected an indented conditional result block.',
        pointSpan(this.#current().span.start, this.#fileName),
      );
      return undefined;
    }

    const statements: (AssignmentStatementNode | ExpressionStatementNode)[] = [];
    this.#skipNewlines();
    while (!this.#check('dedent') && !this.#check('endOfFile')) {
      if (
        this.#check('identifier') &&
        (this.#checkNext('equal') || this.#checkNext('equalQuestion'))
      ) {
        const assignment = this.#parseAssignment();
        if (assignment) {
          statements.push(assignment);
        }
        this.#skipNewlines();
        continue;
      }
      if (this.#check('lessThan')) {
        const result = this.#parseElement();
        this.#skipNewlines();
        this.#match('dedent');
        return result
          ? freezeNode({
              kind: 'ConditionalResultBlock',
              result,
              span: spanFrom(statements[0]?.span ?? result.span, result.span),
              statements: freezeNodes(statements),
            })
          : undefined;
      }

      const expression = this.#parseExpression();
      if (!expression) {
        this.#synchronizeLine();
        this.#skipNewlines();
        continue;
      }
      if (!this.#check('newline') && !this.#check('dedent') && !this.#check('endOfFile')) {
        this.#addDiagnostic(
          'OXE1101',
          'Expected the conditional result line to end after its expression.',
          this.#current().span,
        );
        this.#synchronizeLine();
      } else {
        this.#match('newline');
      }
      this.#skipNewlines();
      if (this.#check('dedent')) {
        this.#advance();
        if (requireElement) {
          this.#addDiagnostic(
            'OXE1105',
            'A UI conditional branch must end with an element.',
            expression.span,
          );
          return undefined;
        }
        const block: ConditionalResultBlockNode = freezeNode({
          kind: 'ConditionalResultBlock',
          result: expression,
          span: spanFrom(statements[0]?.span ?? expression.span, expression.span),
          statements: freezeNodes(statements),
        });
        return block;
      }
      statements.push(
        freezeNode({
          expression,
          kind: 'ExpressionStatement',
          span: copySpan(expression.span),
        }),
      );
    }

    this.#match('dedent');
    this.#addDiagnostic(
      'OXE1105',
      'A conditional result block must end with a value or element.',
      this.#current().span,
    );
    return undefined;
  }

  #parseConditionalBranches(
    opening: Token,
    constructName: 'conditional choice',
  ): ConditionalBranchNode[] {
    const branches: ConditionalBranchNode[] = [];
    this.#skipNewlines();
    if (!this.#match('indent')) {
      this.#addDiagnostic(
        'OXE1102',
        `Expected indented branches after the ${constructName} opener.`,
        pointSpan(this.#current().span.start, this.#fileName),
      );
      return branches;
    }

    this.#skipNewlines();
    let sawCatchall = false;
    while (!this.#check('dedent') && !this.#check('endOfFile')) {
      if (sawCatchall) {
        this.#addDiagnostic(
          'OXE1105',
          'The conditionless conditional branch must be last.',
          this.#current().span,
        );
      }
      const branch = this.#parseConditionalBranch();
      if (branch) {
        sawCatchall = branch.condition === undefined;
        branches.push(branch);
      }
      this.#skipNewlines();
    }
    this.#match('dedent');

    if (branches.length === 0) {
      this.#addDiagnostic(
        'OXE1105',
        'A conditional choice requires at least one branch.',
        opening.span,
      );
    }
    return branches;
  }

  #parseConditionalBlock(): ConditionalRegionNode | undefined {
    const opening = this.#advance();
    if (!this.#match('newline')) {
      this.#addDiagnostic(
        'OXE1101',
        'A standalone ? opens an indented first-match conditional choice.',
        this.#current().span,
      );
      this.#synchronizeLine();
      return undefined;
    }

    const branches = this.#parseConditionalBranches(opening, 'conditional choice');
    return freezeNode({
      kind: 'ConditionalRegion',
      branches: freezeNodes(branches),
      span: spanFrom(opening.span, branches.at(-1)?.span ?? opening.span),
    });
  }

  #parseInlineConditionalRegion(): ConditionalRegionNode | undefined {
    const opening = this.#current();
    const branches: ConditionalBranchNode[] = [];
    const branch = this.#parseConditionalBranch(true);
    if (branch) {
      branches.push(branch);
    }
    if (this.#check('colon')) {
      const fallback = this.#parseConditionalBranch();
      if (fallback) {
        branches.push(fallback);
      }
    }
    return freezeNode({
      kind: 'ConditionalRegion',
      branches: freezeNodes(branches),
      span: spanFrom(opening.span, branches.at(-1)?.span ?? opening.span),
    });
  }

  #parseAttribute(): AttributeNode | undefined {
    const nameToken = this.#advance();
    const name = this.#identifierFromToken(nameToken);

    if (!this.#match('equal') || !this.#match('leftBrace')) {
      this.#addDiagnostic(
        'OXE1107',
        'Attribute values must use ={expression}.',
        this.#current().span,
      );
      this.#synchronizeElementOpening();
      return undefined;
    }

    const value = this.#parseExpression();
    if (!value) {
      this.#synchronizeAttribute();
      return undefined;
    }

    if (!this.#check('rightBrace')) {
      this.#addDiagnostic(
        'OXE1107',
        'Expected } after the attribute expression.',
        this.#current().span,
      );
      this.#synchronizeAttribute();
      return undefined;
    }
    const closing = this.#advance();

    return freezeNode({
      kind: 'Attribute',
      name,
      value,
      span: spanFrom(name.span, closing.span),
    });
  }

  #parseSpreadAttribute(): SpreadAttributeNode | undefined {
    const opening = this.#advance();
    const spread = this.#consume(
      'ellipsis',
      'OXE1107',
      'Spread attributes must use {...expression}.',
    );
    if (!spread) {
      this.#synchronizeAttribute();
      return undefined;
    }

    if (
      this.#check('rightBrace') ||
      this.#check('greaterThan') ||
      this.#check('newline') ||
      this.#check('dedent') ||
      this.#check('endOfFile')
    ) {
      this.#addDiagnostic(
        'OXE1107',
        'Expected an expression after ... in the spread attribute.',
        this.#current().span,
      );
      this.#synchronizeAttribute();
      return undefined;
    }

    const value = this.#parseExpression();
    if (!value) {
      this.#synchronizeAttribute();
      return undefined;
    }

    if (!this.#check('rightBrace')) {
      this.#addDiagnostic(
        'OXE1107',
        'Expected } after the spread attribute expression.',
        this.#current().span,
      );
      this.#synchronizeAttribute();
      return undefined;
    }
    const closing = this.#advance();

    return freezeNode({
      kind: 'SpreadAttribute',
      value,
      span: spanFrom(opening.span, closing.span),
    });
  }

  #parseInlineMarkupChildren(
    start: SourcePosition,
    stopAtRightParen = false,
    stopAtInlineFallback = false,
  ): MarkupChildNode[] {
    const children: MarkupChildNode[] = [];
    let textStart = start;

    while (
      !this.#check('newline') &&
      !this.#check('dedent') &&
      !this.#check('endOfFile') &&
      !(stopAtRightParen && this.#check('rightParen')) &&
      !(stopAtInlineFallback && this.#check('colon') && this.#checkNext('lessThan'))
    ) {
      if (!this.#check('leftBrace')) {
        this.#advance();
        continue;
      }

      const opening = this.#advance();
      this.#appendText(children, textStart, opening.span.start);
      const expression = this.#parseExpression();

      let interpolationEnd = expression?.span.end ?? opening.span.end;
      if (this.#check('rightBrace')) {
        const closing = this.#advance();
        interpolationEnd = closing.span.end;
      } else {
        this.#addDiagnostic(
          'OXE1108',
          'Expected } to close the interpolation.',
          pointSpan(this.#current().span.start, this.#fileName),
        );
        while (
          !this.#check('rightBrace') &&
          !this.#check('newline') &&
          !this.#check('dedent') &&
          !this.#check('endOfFile')
        ) {
          interpolationEnd = this.#advance().span.end;
        }
        if (this.#check('rightBrace')) {
          interpolationEnd = this.#advance().span.end;
        }
      }

      if (expression) {
        const interpolation: InterpolationNode = freezeNode({
          kind: 'Interpolation',
          expression,
          span: freezeSpan(opening.span.start, interpolationEnd, this.#fileName),
        });
        children.push(interpolation);
      }
      textStart = interpolationEnd;
    }

    this.#appendText(children, textStart, this.#current().span.start);
    return children;
  }

  #parseMarkupChild(): MarkupChildNode | undefined {
    if (this.#check('lessThan')) {
      return this.#parseElement();
    }
    if (this.#check('question')) {
      return this.#parseConditionalBlock();
    }
    if (this.#check('leftBrace')) {
      return this.#parseMarkupInterpolationLine();
    }
    if (this.#isRetiredIfSyntax()) {
      this.#diagnoseRetiredIfSyntax();
      return undefined;
    }
    if (
      this.#canStartExpression() &&
      (this.#lineContains('question') || this.#lineContainsUiArrow())
    ) {
      return this.#parseInlineConditionalRegion();
    }

    this.#addDiagnostic(
      'OXE1109',
      'Expected an element, interpolation, or conditional in the indented markup block.',
      this.#current().span,
    );
    this.#synchronizeLine();
    return undefined;
  }

  #parseMarkupInterpolationLine(): InterpolationNode | undefined {
    const opening = this.#advance();
    const expression = this.#parseExpression();
    if (!expression) {
      this.#synchronizeLine();
      return undefined;
    }

    if (!this.#check('rightBrace')) {
      this.#addDiagnostic(
        'OXE1108',
        'Expected } to close the interpolation.',
        pointSpan(this.#current().span.start, this.#fileName),
      );
      this.#synchronizeLine();
      return undefined;
    }
    const closing = this.#advance();

    if (!this.#check('newline') && !this.#check('dedent') && !this.#check('endOfFile')) {
      this.#addDiagnostic(
        'OXE1101',
        'Expected the interpolation to end at the end of the line.',
        this.#current().span,
      );
      this.#synchronizeLine();
    } else {
      this.#match('newline');
    }

    return freezeNode({
      kind: 'Interpolation',
      expression,
      span: spanFrom(opening.span, closing.span),
    });
  }

  #appendText(children: MarkupChildNode[], start: SourcePosition, end: SourcePosition): void {
    if (start.offset >= end.offset) {
      return;
    }

    const value = this.#source.slice(start.offset, end.offset);
    if (value.length === 0) {
      return;
    }

    const text: TextNode = freezeNode({
      kind: 'Text',
      value,
      span: freezeSpan(start, end, this.#fileName),
    });
    children.push(text);
  }

  #parseIdentifier(): IdentifierNode | undefined {
    if (!this.#check('identifier')) {
      this.#addDiagnostic('OXE1101', 'Expected an identifier.', this.#current().span);
      return undefined;
    }
    return this.#identifierFromToken(this.#advance());
  }

  #canStartExpression(): boolean {
    return (
      this.#check('identifier') ||
      this.#check('number') ||
      this.#check('string') ||
      this.#check('leftParen') ||
      this.#check('leftBracket') ||
      this.#check('leftBrace')
    );
  }

  #looksLikeDeclarationHeader(): boolean {
    let depth = 0;
    for (let index = this.#index + 1; index < this.#tokens.length; index += 1) {
      const token = this.#tokens[index];
      if (!token || token.kind === 'newline' || token.kind === 'endOfFile') {
        return false;
      }
      if (token.kind === 'leftParen') {
        depth += 1;
      } else if (token.kind === 'rightParen') {
        depth -= 1;
        if (depth === 0) {
          return this.#tokens[index + 1]?.kind === 'colon';
        }
      }
    }
    return false;
  }

  #looksLikeCollectionMutation(): boolean {
    return (
      this.#check('identifier') &&
      this.#tokens[this.#index + 1]?.kind === 'dot' &&
      this.#tokens[this.#index + 2]?.kind === 'identifier' &&
      (this.#tokens[this.#index + 2]?.lexeme === 'add' ||
        this.#tokens[this.#index + 2]?.lexeme === 'remove' ||
        this.#tokens[this.#index + 2]?.lexeme === 'update') &&
      this.#tokens[this.#index + 3]?.kind === 'leftParen'
    );
  }

  #looksLikeMemberAssignment(): boolean {
    if (!this.#check('identifier')) {
      return false;
    }
    let index = this.#index + 1;
    let fields = 0;
    while (this.#tokens[index]?.kind === 'dot' && this.#tokens[index + 1]?.kind === 'identifier') {
      fields += 1;
      index += 2;
    }
    return fields > 0 && this.#tokens[index]?.kind === 'equal';
  }

  #lineContains(kind: TokenKind): boolean {
    for (let index = this.#index; index < this.#tokens.length; index += 1) {
      const token = this.#tokens[index];
      if (
        !token ||
        token.kind === 'newline' ||
        token.kind === 'dedent' ||
        token.kind === 'endOfFile'
      ) {
        return false;
      }
      if (token.kind === kind) {
        return true;
      }
    }
    return false;
  }

  #lineContainsUiArrow(): boolean {
    for (let index = this.#index; index < this.#tokens.length; index += 1) {
      const token = this.#tokens[index];
      if (
        !token ||
        token.kind === 'newline' ||
        token.kind === 'dedent' ||
        token.kind === 'endOfFile'
      ) {
        return false;
      }
      if (token.kind === 'arrow') {
        return this.#tokens[index + 1]?.kind === 'lessThan';
      }
    }
    return false;
  }

  #isRetiredIfSyntax(): boolean {
    return (
      this.#check('identifier') &&
      this.#current().lexeme === 'if' &&
      !this.#checkNext('equal') &&
      !this.#checkNext('equalQuestion') &&
      !this.#checkNext('leftParen') &&
      !this.#checkNext('question')
    );
  }

  #diagnoseRetiredIfSyntax(): void {
    const blockForm = this.#checkNext('newline');
    const retired = this.#advance();
    this.#addDiagnostic(
      'OXE1105',
      'The if keyword was removed. Write a single condition directly, or replace a multi-branch if opener with ?.',
      retired.span,
    );
    this.#synchronizeLine();
    if (blockForm) {
      this.#skipIndentedBlock();
    }
  }

  #skipIndentedBlock(): void {
    if (!this.#match('indent')) {
      return;
    }
    let depth = 1;
    while (depth > 0 && !this.#check('endOfFile')) {
      if (this.#match('indent')) {
        depth += 1;
      } else if (this.#match('dedent')) {
        depth -= 1;
      } else {
        this.#advance();
      }
    }
  }

  #identifierFromToken(token: Token): IdentifierNode {
    return freezeNode({
      kind: 'Identifier',
      name: token.lexeme,
      span: copySpan(token.span),
    });
  }

  #synchronizeLine(): void {
    while (!this.#check('newline') && !this.#check('dedent') && !this.#check('endOfFile')) {
      this.#advance();
    }
    this.#match('newline');
  }

  #synchronizeElementOpening(): void {
    while (
      !this.#check('greaterThan') &&
      !this.#check('newline') &&
      !this.#check('dedent') &&
      !this.#check('endOfFile')
    ) {
      this.#advance();
    }
  }

  #synchronizeAttribute(): void {
    while (
      !this.#check('rightBrace') &&
      !this.#check('greaterThan') &&
      !this.#check('newline') &&
      !this.#check('dedent') &&
      !this.#check('endOfFile')
    ) {
      this.#advance();
    }
    this.#match('rightBrace');
  }

  #synchronizeComponentParameters(): void {
    while (
      !this.#check('rightParen') &&
      !this.#check('colon') &&
      !this.#check('newline') &&
      !this.#check('endOfFile')
    ) {
      this.#advance();
    }
  }

  #skipNewlines(): void {
    while (this.#match('newline')) {
      // Blank and comment-only lines do not affect the surrounding block.
    }
  }

  #consume(kind: TokenKind, code: DiagnosticCode, message: string): Token | undefined {
    if (this.#check(kind)) {
      return this.#advance();
    }
    this.#addDiagnostic(code, message, this.#current().span);
    return undefined;
  }

  #match(kind: TokenKind): boolean {
    if (!this.#check(kind)) {
      return false;
    }
    this.#advance();
    return true;
  }

  #matchToken(kind: TokenKind): Token | undefined {
    if (!this.#check(kind)) {
      return undefined;
    }
    return this.#advance();
  }

  #check(kind: TokenKind): boolean {
    return this.#current().kind === kind;
  }

  #checkNext(kind: TokenKind): boolean {
    return (this.#tokens[this.#index + 1] ?? this.#current()).kind === kind;
  }

  #current(): Token {
    return this.#tokens[this.#index] ?? this.#tokens[this.#tokens.length - 1]!;
  }

  #advance(): Token {
    const token = this.#current();
    if (token.kind !== 'endOfFile') {
      this.#index += 1;
    }
    return token;
  }

  #addDiagnostic(code: DiagnosticCode, message: string, diagnosticSpan: SourceSpan): void {
    this.#diagnostics.push(
      Object.freeze({
        code,
        message,
        severity: 'error',
        span: copySpan(diagnosticSpan),
      }),
    );
  }
}

export const parseSource = (source: string, fileName = '<source>'): ParseResult => {
  const scanResult = scanSource(source, fileName);
  const parser = new Parser(source, fileName, scanResult.tokens);
  const ast = parser.parseModule();
  const diagnostics = [...scanResult.diagnostics, ...parser.diagnostics()].sort(
    (left, right) => left.span.start.offset - right.span.start.offset,
  );

  return Object.freeze({
    ast,
    diagnostics: freezeNodes(diagnostics),
    tokens: freezeNodes(scanResult.tokens),
    trivia: freezeNodes(scanResult.trivia),
  });
};
