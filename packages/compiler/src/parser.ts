import type {
  ArithmeticOperator,
  ArrayLiteralNode,
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
  IfBranchNode,
  IfRegionNode,
  ImportDeclarationNode,
  ImportSpecifierNode,
  InterpolationNode,
  MarkupChildNode,
  MapExpressionNode,
  ModuleNode,
  NumberLiteralNode,
  ParenthesizedExpressionNode,
  RequiredComponentParameterNode,
  RestComponentParameterNode,
  SpreadAttributeNode,
  StringLiteralNode,
  TextNode,
  UntrackExpressionNode,
} from './ast.js';
import type { Diagnostic, DiagnosticCode } from './diagnostics.js';
import { scanSource } from './scanner.js';
import type { SourcePosition, SourceSpan } from './source.js';
import type { Token, TokenKind } from './tokens.js';

export interface ParseResult {
  readonly ast: ModuleNode;
  readonly diagnostics: readonly Diagnostic[];
  readonly tokens: readonly Token[];
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
        this.#synchronizeLine();
      }
      this.#skipNewlines();
    }

    const firstTopLevelSpan = [...imports, ...declarations].sort(
      (left, right) => left.span.start.offset - right.span.start.offset,
    )[0]?.span;
    const start = firstTopLevelSpan?.start ?? this.#current().span.start;
    const moduleSpan = freezeSpan(start, this.#current().span.end, this.#fileName);
    return freezeNode({
      kind: 'Module',
      imports: freezeNodes(imports),
      declarations: freezeNodes(declarations),
      span: moduleSpan,
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

  #parseZeroArgumentHeader(declarationKind: 'handler'): boolean {
    if (!this.#consume('leftParen', 'OXE1101', `Expected ( after the ${declarationKind} name.`)) {
      return false;
    }

    if (!this.#check('rightParen')) {
      this.#addDiagnostic(
        'OXE1101',
        'Handlers in this language slice must have zero arguments.',
        this.#current().span,
      );
      while (
        !this.#check('rightParen') &&
        !this.#check('colon') &&
        !this.#check('newline') &&
        !this.#check('endOfFile')
      ) {
        this.#advance();
      }
    }

    return Boolean(
      this.#consume('rightParen', 'OXE1101', `Expected ) after the ${declarationKind} parameters.`),
    );
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

    if (this.#check('if')) {
      return this.#parseIfRegion();
    }

    if (this.#check('identifier')) {
      if (this.#checkNext('equal')) {
        return this.#parseAssignment();
      }
      if (this.#checkNext('leftParen')) {
        return this.#parseHandlerDeclaration();
      }
    }

    this.#addDiagnostic(
      'OXE1103',
      'Expected an assignment, zero-argument handler, or element in the component body.',
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

    if (!this.#parseZeroArgumentHeader('handler')) {
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
        body: freezeNodes([]),
        span: spanFrom(name.span, colon.span),
      });
    }

    const body: AssignmentStatementNode[] = [];
    this.#skipNewlines();
    while (!this.#check('dedent') && !this.#check('endOfFile')) {
      if (this.#check('identifier') && this.#checkNext('equal')) {
        const statement = this.#parseAssignment();
        if (statement) {
          body.push(statement);
        }
      } else {
        this.#addDiagnostic(
          'OXE1104',
          'Expected an assignment in the handler body.',
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

    if (!this.#consume('equal', 'OXE1101', 'Expected = after the assignment target.')) {
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
        'Expected the assignment to end after its value.',
        this.#current().span,
      );
      this.#synchronizeLine();
    } else {
      this.#match('newline');
    }

    return freezeNode({
      kind: 'AssignmentStatement',
      target,
      value,
      span: spanFrom(target.span, value.span),
    });
  }

  #parseExpression(minimumPrecedence = 0): ExpressionNode | undefined {
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
      const right = this.#parseExpression(definition.precedence + 1);
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
    while (this.#match('dot')) {
      if (!this.#check('identifier')) {
        this.#addDiagnostic(
          'OXE1105',
          'Expected a collection operation after .',
          this.#current().span,
        );
        return undefined;
      }
      const operation = this.#advance();
      if (operation.lexeme !== 'map') {
        this.#addDiagnostic(
          'OXE1105',
          `Collection operation "${operation.lexeme}" is not implemented yet.`,
          operation.span,
        );
        return undefined;
      }
      if (!this.#consume('leftParen', 'OXE1101', 'Expected ( after map.')) {
        return undefined;
      }
      const parameter = this.#parseIdentifier();
      if (!parameter) {
        return undefined;
      }
      if (!this.#consume('arrow', 'OXE1101', 'Expected => after the map item parameter.')) {
        return undefined;
      }
      if (!this.#check('lessThan')) {
        this.#addDiagnostic(
          'OXE1105',
          'A markup-producing map callback must return an element.',
          this.#current().span,
        );
        return undefined;
      }
      const body = this.#parseElement(true);
      if (!body) {
        return undefined;
      }
      const closing = this.#consume('rightParen', 'OXE1101', 'Expected ) after the map callback.');
      if (!closing) {
        return undefined;
      }
      const mapped: MapExpressionNode = freezeNode({
        kind: 'MapExpression',
        collection: expression,
        parameter,
        body,
        span: spanFrom(expression.span, closing.span),
      });
      expression = mapped;
    }
    return expression;
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

    this.#addDiagnostic(
      'OXE1105',
      'Expected an identifier, number, string, Boolean, or parenthesized expression.',
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

  #parseIfRegion(): IfRegionNode | undefined {
    const opening = this.#advance();
    const branches: IfBranchNode[] = [];

    const parseBranch = (stopAtInlineFallback = false): IfBranchNode | undefined => {
      const start = this.#current().span;
      let condition: ExpressionNode | undefined;
      if (this.#match('colon')) {
        condition = undefined;
      } else if (this.#check('arrow')) {
        this.#addDiagnostic(
          'OXE1101',
          'Use : for an if fallback. => is reserved for functions and callbacks.',
          this.#advance().span,
        );
      } else {
        condition = this.#parseExpression();
        if (!condition) {
          this.#synchronizeLine();
          return undefined;
        }
        if (
          !this.#consume(
            'question',
            'OXE1101',
            'Expected ? after the if condition. => is reserved for functions and callbacks.',
          )
        ) {
          this.#synchronizeLine();
          return undefined;
        }
      }
      if (!this.#check('lessThan')) {
        this.#addDiagnostic(
          'OXE1105',
          'A UI if branch must produce an element.',
          this.#current().span,
        );
        this.#synchronizeLine();
        return undefined;
      }
      const result = this.#parseElement(false, stopAtInlineFallback);
      if (!result) {
        return undefined;
      }
      return freezeNode({
        kind: 'IfBranch',
        ...(condition ? { condition } : {}),
        result,
        span: spanFrom(condition?.span ?? start, result.span),
      });
    };

    if (!this.#match('newline')) {
      const branch = parseBranch(true);
      if (branch) {
        branches.push(branch);
      }
      if (this.#check('colon')) {
        const fallback = parseBranch();
        if (fallback) {
          branches.push(fallback);
        }
      }
    } else {
      if (!this.#match('indent')) {
        this.#addDiagnostic(
          'OXE1102',
          'Expected indented branches after if.',
          pointSpan(this.#current().span.start, this.#fileName),
        );
      } else {
        this.#skipNewlines();
        let sawCatchall = false;
        while (!this.#check('dedent') && !this.#check('endOfFile')) {
          if (sawCatchall) {
            this.#addDiagnostic(
              'OXE1105',
              'The conditionless if branch must be last.',
              this.#current().span,
            );
          }
          const branch = parseBranch();
          if (branch) {
            sawCatchall = branch.condition === undefined;
            branches.push(branch);
          }
          this.#skipNewlines();
        }
        this.#match('dedent');
      }
    }

    if (branches.length === 0) {
      this.#addDiagnostic('OXE1105', 'An if region requires at least one branch.', opening.span);
    }

    return freezeNode({
      kind: 'IfRegion',
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
    if (this.#check('if')) {
      return this.#parseIfRegion();
    }
    if (this.#check('leftBrace')) {
      return this.#parseMarkupInterpolationLine();
    }

    this.#addDiagnostic(
      'OXE1109',
      'Expected an element or interpolation in the indented markup block.',
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
  });
};
