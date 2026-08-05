import type { UiServerFunctionDefinitionV1 } from '@oxe/graph';

import type {
  ConditionalResultBlockNode,
  ExpressionNode,
  ServerFunctionDeclarationNode,
} from './ast.js';
import { OxeCodegenError } from './codegen.js';
import type { AnalyzeProjectResult, AnalyzedProjectModule } from './semantic.js';

export interface ServerFunctionCodeArtifact {
  readonly functionIds: readonly string[];
  readonly moduleSource: string;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const unsupported = (message: string): never => {
  throw new OxeCodegenError('OXE4002', message);
};

const expressionPath = (expression: ExpressionNode): readonly string[] | undefined => {
  const path: string[] = [];
  let current = expression;
  while (current.kind === 'MemberExpression') {
    path.unshift(current.property.name);
    current = current.object;
  }
  if (current.kind !== 'Identifier') return undefined;
  path.unshift(current.name);
  return path;
};

const binaryOperator = (operator: string): string => {
  switch (operator) {
    case '+':
    case '-':
    case '*':
    case '/':
      return operator;
    case '==':
      return '===';
    case '!=':
      return '!==';
    case 'and':
      return '&&';
    case 'or':
      return '||';
    default:
      return unsupported(`Cannot emit unknown server operator "${operator}".`);
  }
};

const safeIdentifier = (value: string): string => {
  const normalized = value.replaceAll(/[^A-Za-z0-9_$]/gu, '_');
  return /^[A-Za-z_$]/u.test(normalized) ? normalized : `_${normalized}`;
};

class NameAllocator {
  readonly #used = new Set([
    'arguments',
    'callServerCapability',
    'context',
    'definition',
    'implementServerFunction',
    'serverFunctionDefinitions',
    'serverFunctionRegistry',
    'signal',
  ]);

  public allocate(requested: string): string {
    const base = safeIdentifier(requested);
    let name = base;
    let suffix = 2;
    while (this.#used.has(name)) {
      name = `${base}${suffix}`;
      suffix += 1;
    }
    this.#used.add(name);
    return name;
  }
}

class Writer {
  readonly #lines: string[] = [];
  #indent = 0;

  public line(value = ''): void {
    this.#lines.push(`${'  '.repeat(this.#indent)}${value}`);
  }

  public indented(write: () => void): void {
    this.#indent += 1;
    write();
    this.#indent -= 1;
  }

  public toString(): string {
    return this.#lines.join('\n');
  }
}

interface ExpressionContext {
  readonly contextName: string;
  readonly names: ReadonlyMap<string, string>;
  readonly signalName: string;
}

const emitConditionalBlock = (
  block: ConditionalResultBlockNode,
  context: ExpressionContext,
  names: NameAllocator,
): string => {
  const blockNames = new Map(context.names);
  const statements: string[] = [];
  for (const statement of block.statements) {
    if (statement.kind === 'AssignmentStatement') {
      const name = names.allocate(statement.target.name);
      statements.push(
        `const ${name} = ${emitExpression(statement.value, { ...context, names: blockNames }, names)};`,
      );
      blockNames.set(statement.target.name, name);
    } else {
      statements.push(
        `${emitExpression(statement.expression, { ...context, names: blockNames }, names)};`,
      );
    }
  }
  if (block.result.kind === 'Element') {
    return unsupported('Server function conditional values cannot produce markup.');
  }
  const result = emitExpression(block.result, { ...context, names: blockNames }, names);
  return `await (async () => { ${statements.join(' ')} return ${result}; })()`;
};

const emitExpression = (
  expression: ExpressionNode,
  context: ExpressionContext,
  names: NameAllocator,
): string => {
  switch (expression.kind) {
    case 'ArrayLiteral':
      return `[${expression.elements.map((item) => emitExpression(item, context, names)).join(', ')}]`;
    case 'BinaryExpression':
      return `(${emitExpression(expression.left, context, names)} ${binaryOperator(expression.operator)} ${emitExpression(expression.right, context, names)})`;
    case 'BooleanLiteral':
    case 'NumberLiteral':
    case 'StringLiteral':
      return JSON.stringify(expression.value);
    case 'CallExpression': {
      const path = expressionPath(expression.callee);
      if (!path) {
        return unsupported('Server function calls must name a configured server capability.');
      }
      return `await callServerCapability(${context.contextName}, ${JSON.stringify(path)}, [${expression.arguments
        .map((argument) => emitExpression(argument, context, names))
        .join(', ')}], ${context.signalName})`;
    }
    case 'CollectionExpression':
    case 'MapExpression':
      return unsupported('Collection callbacks are not supported in server function bodies yet.');
    case 'ConditionalValueExpression': {
      const branches = expression.branches;
      const emitBranch = (index: number): string => {
        const branch = branches[index];
        if (!branch) return 'undefined';
        const result =
          branch.result.kind === 'ConditionalResultBlock'
            ? emitConditionalBlock(branch.result, context, names)
            : branch.result.kind === 'Element'
              ? unsupported('Server function conditional values cannot produce markup.')
              : emitExpression(branch.result, context, names);
        return branch.condition
          ? `(${emitExpression(branch.condition, context, names)} ? ${result} : ${emitBranch(index + 1)})`
          : result;
      };
      return emitBranch(0);
    }
    case 'Identifier': {
      const name = context.names.get(expression.name);
      return name ?? unsupported(`Cannot emit unresolved server value "${expression.name}".`);
    }
    case 'MemberExpression':
      return `${emitExpression(expression.object, context, names)}[${JSON.stringify(expression.property.name)}]`;
    case 'ParenthesizedExpression':
    case 'UntrackExpression':
      return `(${emitExpression(expression.expression, context, names)})`;
    case 'RecordLiteral':
      return `({ ${expression.entries
        .map(
          (entry) =>
            `${JSON.stringify(entry.name.name)}: ${emitExpression(entry.value, context, names)}`,
        )
        .join(', ')} })`;
  }
};

const emitImplementation = (
  writer: Writer,
  declaration: ServerFunctionDeclarationNode,
  definition: UiServerFunctionDefinitionV1,
): void => {
  const allocator = new NameAllocator();
  const argumentsName = allocator.allocate('serverArguments');
  const contextName = allocator.allocate('serverContext');
  const signalName = allocator.allocate('serverSignal');
  const names = new Map<string, string>();
  const functionName = allocator.allocate(`${declaration.name.name}Implementation`);

  writer.line(`const ${functionName} = implementServerFunction(`);
  writer.indented(() => {
    writer.line(`definition(${JSON.stringify(definition.id)}),`);
    writer.line(`async (${argumentsName}, ${contextName}, ${signalName}) => {`);
    writer.indented(() => {
      declaration.parameters.forEach((parameter, index) => {
        const name = allocator.allocate(parameter.name.name);
        names.set(parameter.name.name, name);
        writer.line(`const ${name} = ${argumentsName}[${index}];`);
      });
      const expressionContext: ExpressionContext = { contextName, names, signalName };
      for (const [index, statement] of declaration.body.entries()) {
        const final = index === declaration.body.length - 1;
        if (statement.kind === 'AssignmentStatement') {
          const value = emitExpression(statement.value, expressionContext, allocator);
          const name = allocator.allocate(statement.target.name);
          writer.line(`const ${name} = ${value};`);
          names.set(statement.target.name, name);
          continue;
        }
        const value = emitExpression(statement.expression, expressionContext, allocator);
        writer.line(final ? `return ${value};` : `${value};`);
      }
    });
    writer.line('},');
  });
  writer.line(');');
  writer.line(`implementations.push(${functionName});`);
};

const declarationsByDefinition = (
  modules: readonly AnalyzedProjectModule[],
): ReadonlyMap<string, ServerFunctionDeclarationNode> => {
  const result = new Map<string, ServerFunctionDeclarationNode>();
  for (const module of modules) {
    for (const declaration of module.ast.serverFunctions) {
      result.set(`${module.moduleId}\0${declaration.name.name}`, declaration);
    }
  }
  return result;
};

export const generateServerFunctionArtifact = (
  project: AnalyzeProjectResult,
): ServerFunctionCodeArtifact => {
  if (project.diagnostics.length > 0) {
    return unsupported('Cannot generate server functions from a project with diagnostics.');
  }
  if (!project.graph) {
    return unsupported('Cannot generate server functions because the project has no UI graph.');
  }
  const definitions = [...(project.graph.serverFunctions ?? [])].sort((left, right) =>
    compareText(left.id, right.id),
  );
  const declarations = declarationsByDefinition(project.modules);
  const writer = new Writer();
  writer.line(
    `import { createServerFunctionRegistry, implementServerFunction } from '@oxe/server-functions';`,
  );
  writer.line();
  writer.line(`const serverFunctionDefinitions = Object.freeze(${JSON.stringify(definitions)});`);
  writer.line(
    'const definitionsById = new Map(serverFunctionDefinitions.map((value) => [value.id, value]));',
  );
  writer.line('const definition = (id) => {');
  writer.indented(() => {
    writer.line('const value = definitionsById.get(id);');
    writer.line(
      'if (!value) throw new Error(`Missing generated server function definition "${id}".`);',
    );
    writer.line('return value;');
  });
  writer.line('};');
  writer.line('const callServerCapability = (context, path, arguments_, signal) => {');
  writer.indented(() => {
    writer.line("if (!context || typeof context.callCapability !== 'function') {");
    writer.indented(() => {
      writer.line(
        "throw new Error('Generated server functions require context.callCapability(path, arguments, signal).');",
      );
    });
    writer.line('}');
    writer.line('return context.callCapability(path, arguments_, signal);');
  });
  writer.line('};');
  writer.line('const implementations = [];');
  writer.line();

  for (const definition of definitions) {
    const declaration = declarations.get(`${definition.moduleId}\0${definition.name}`);
    if (!declaration) {
      return unsupported(
        `Cannot find the declaration for generated server function "${definition.name}" in "${definition.moduleId}".`,
      );
    }
    emitImplementation(writer, declaration, definition);
    writer.line();
  }

  writer.line('const serverFunctionRegistry = createServerFunctionRegistry(implementations);');
  writer.line();
  writer.line('export { serverFunctionDefinitions, serverFunctionRegistry };');
  return Object.freeze({
    functionIds: Object.freeze(definitions.map((definition) => definition.id)),
    moduleSource: `${writer.toString()}\n`,
  });
};

export const generateServerFunctionModuleSource = (project: AnalyzeProjectResult): string =>
  generateServerFunctionArtifact(project).moduleSource;
