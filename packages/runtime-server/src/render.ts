import type {
  ServerBindingV1,
  ServerCapabilityPlanV1,
  ServerComponentPlanV1,
  ServerComponentPropV1,
  ServerExpressionV1,
  ServerFormattedValueV1,
  ServerFormatValueOptions,
  ServerParameterV1,
  ServerRenderMetrics,
  ServerRenderLocation,
  ServerLocalizedContentPart,
  ServerLocalizedMessageV1,
  ServerLocalizedMarkupV1,
  ServerRenderOptions,
  ServerRenderPlanV1,
  ServerRenderResult,
  ServerRenderSink,
  ServerViewV1,
} from './types.js';

export type ServerRenderErrorCode =
  'OXE_SERVER_RENDER_CAPABILITY' | 'OXE_SERVER_RENDER_INVALID_PLAN' | 'OXE_SERVER_RENDER_VALUE';

export class OxeServerRenderError extends Error {
  public readonly code: ServerRenderErrorCode;

  public constructor(code: ServerRenderErrorCode, message: string) {
    super(message);
    this.name = 'OxeServerRenderError';
    this.code = code;
  }
}

interface MutableMetrics {
  bytesWritten: number;
  collectionItems: number;
  components: number;
  elements: number;
  expressions: number;
  maxComponentDepth: number;
  textNodes: number;
  views: number;
}

interface ContentCapture {
  readonly contexts: ReadonlyMap<string, unknown>;
  readonly environment: RenderEnvironment;
  readonly instancePath: string;
  readonly locals: ReadonlyMap<string, unknown>;
  readonly views: readonly ServerViewV1[];
}

interface ProcedureToken {
  readonly kind: 'procedure';
  readonly targetId: string;
}

interface CapabilityToken {
  readonly capability: ServerCapabilityPlanV1;
  readonly kind: 'capability';
}

interface RenderEnvironment {
  readonly bindings: ReadonlyMap<string, ServerBindingV1>;
  readonly component: ServerComponentPlanV1;
  readonly contents: Map<string, ContentCapture>;
  readonly evaluating: Set<string>;
  readonly instancePath: string;
  readonly invocationId?: string;
  readonly parameters: ReadonlyMap<string, ServerParameterV1>;
  readonly parentInstancePath?: string;
  readonly procedures: Map<string, ProcedureToken>;
  readonly values: Map<string, unknown>;
}

interface RenderState {
  readonly capabilities: ReadonlyMap<string, ServerCapabilityPlanV1>;
  readonly components: ReadonlyMap<string, ServerComponentPlanV1>;
  readonly metrics: MutableMetrics;
  readonly options: ServerRenderOptions;
  readonly plan: ServerRenderPlanV1;
  readonly sink: ServerRenderSink;
}

const voidElements = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const invalidPlan = (message: string): never => {
  throw new OxeServerRenderError('OXE_SERVER_RENDER_INVALID_PLAN', message);
};

const invalidValue = (message: string): never => {
  throw new OxeServerRenderError('OXE_SERVER_RENDER_VALUE', message);
};

const capabilityError = (message: string): never => {
  throw new OxeServerRenderError('OXE_SERVER_RENDER_CAPABILITY', message);
};

const utf8ByteLength = (value: string): number => {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
};

const write = (state: RenderState, chunk: string): void => {
  state.metrics.bytesWritten += utf8ByteLength(chunk);
  state.sink.write(chunk);
};

const escapeText = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const escapeAttribute = (value: string): string =>
  escapeText(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const renderTextValue = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value);

const hydrationMarkerId = (id: string): string => encodeURIComponent(id).replaceAll('-', '%2D');

const childInstancePath = (parent: string, kind: 'component' | 'row', identity: string): string =>
  `${parent}/${kind}:${encodeURIComponent(identity)}`;

const keyedInstanceIdentity = (key: unknown): string => {
  if (typeof key === 'number') {
    if (Number.isNaN(key)) return 'number:NaN';
    if (Object.is(key, -0)) return 'number:-0';
  }
  return `${typeof key}:${String(key)}`;
};

const renderLocation = (
  environment: RenderEnvironment,
  instancePath: string,
): ServerRenderLocation => ({
  componentId: environment.component.id,
  componentInstancePath: environment.instancePath,
  instancePath,
  ...(environment.invocationId ? { invocationId: environment.invocationId } : {}),
  ...(environment.parentInstancePath
    ? { parentComponentInstancePath: environment.parentInstancePath }
    : {}),
});

const recordValue = (value: unknown, operation: string): Readonly<Record<string, unknown>> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidValue(`${operation} expected a record value.`);
  }
  return value as Readonly<Record<string, unknown>>;
};

const arrayValue = (value: unknown, operation: string): readonly unknown[] => {
  if (!Array.isArray(value)) {
    return invalidValue(`${operation} expected an array value.`);
  }
  return value;
};

const evaluate = (
  expression: ServerExpressionV1,
  environment: RenderEnvironment,
  contexts: ReadonlyMap<string, unknown>,
  locals: ReadonlyMap<string, unknown>,
  state: RenderState,
): unknown => {
  state.metrics.expressions += 1;
  switch (expression.kind) {
    case 'array':
      return expression.elements.map((item) =>
        evaluate(item, environment, contexts, locals, state),
      );
    case 'binary': {
      const left = evaluate(expression.left, environment, contexts, locals, state);
      if (expression.operator === 'and') {
        return left && evaluate(expression.right, environment, contexts, locals, state);
      }
      if (expression.operator === 'or') {
        return left || evaluate(expression.right, environment, contexts, locals, state);
      }
      const right = evaluate(expression.right, environment, contexts, locals, state);
      switch (expression.operator) {
        case '!=':
          return left !== right;
        case '%':
          return Number(left) % Number(right);
        case '*':
          return Number(left) * Number(right);
        case '+':
          return typeof left === 'string' || typeof right === 'string'
            ? String(left) + String(right)
            : Number(left) + Number(right);
        case '-':
          return Number(left) - Number(right);
        case '/':
          return Number(left) / Number(right);
        case '==':
          return left === right;
      }
      return invalidPlan('A binary expression contains an unsupported operator.');
    }
    case 'call': {
      const callee = evaluate(expression.callee, environment, contexts, locals, state);
      const arguments_ = expression.arguments.map((argument) =>
        evaluate(argument, environment, contexts, locals, state),
      );
      if (isCapabilityToken(callee)) {
        const capability = callee.capability;
        if (capability.target === 'client') {
          return capabilityError(
            `Client-only capability "${capability.path.join('.')}" cannot run during SSR.`,
          );
        }
        if (capability.capabilityKind !== 'pure') {
          return capabilityError(
            `Non-pure capability "${capability.path.join('.')}" cannot run while rendering.`,
          );
        }
        if (!state.options.callCapability) {
          return capabilityError(
            `SSR requires a host resolver for capability "${capability.path.join('.')}".`,
          );
        }
        return state.options.callCapability(capability, arguments_);
      }
      if (isProcedureToken(callee)) {
        return capabilityError(
          `Procedure "${callee.targetId}" cannot execute during side-effect-free SSR.`,
        );
      }
      return invalidValue('Server expressions may only call declared capabilities.');
    }
    case 'capability': {
      const procedure = environment.procedures.get(expression.targetId);
      if (procedure) {
        return procedure;
      }
      const capability = state.capabilities.get(expression.targetId);
      return capability
        ? ({ kind: 'capability', capability } satisfies CapabilityToken)
        : invalidPlan(`Expression references missing capability "${expression.targetId}".`);
    }
    case 'collection': {
      const source = arrayValue(
        evaluate(expression.source, environment, contexts, locals, state),
        `${expression.operation}()`,
      );
      const invoke = (arguments_: readonly unknown[]): unknown => {
        const callbackLocals = new Map(locals);
        expression.callback.parameters.forEach((parameter, index) => {
          callbackLocals.set(parameter.id, arguments_[index]);
        });
        return evaluate(expression.callback.result, environment, contexts, callbackLocals, state);
      };
      switch (expression.operation) {
        case 'filter':
          return source.filter((item, index) => Boolean(invoke([item, index, source])));
        case 'flatMap':
          return source.flatMap((item, index) => invoke([item, index, source]));
        case 'map':
          return source.map((item, index) => invoke([item, index, source]));
        case 'reduce': {
          if (!expression.initial) {
            return invalidPlan('A server reduce expression requires an explicit initial value.');
          }
          const initial = evaluate(expression.initial, environment, contexts, locals, state);
          return source.reduce(
            (accumulator, item, index) => invoke([accumulator, item, index, source]),
            initial,
          );
        }
        case 'sort': {
          const options = expression.options
            ? recordValue(
                evaluate(expression.options, environment, contexts, locals, state),
                'sort options',
              )
            : {};
          const direction = options.descending === true ? -1 : 1;
          return source
            .map((item, index) => ({
              item,
              index,
              key: sortableValue(invoke([item, index, source])),
            }))
            .sort((left, right) => {
              const comparison = left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
              return comparison * direction || left.index - right.index;
            })
            .map(({ item }) => item);
        }
      }
      return invalidPlan('A collection expression contains an unsupported operation.');
    }
    case 'conditional':
      for (const branch of expression.branches) {
        if (
          !branch.condition ||
          Boolean(evaluate(branch.condition, environment, contexts, locals, state))
        ) {
          return evaluate(branch.result, environment, contexts, locals, state);
        }
      }
      return invalidPlan('A conditional value has no matching or fallback branch.');
    case 'literal':
      return expression.value;
    case 'local':
      return locals.has(expression.targetId)
        ? locals.get(expression.targetId)
        : invalidPlan(`Expression references missing local "${expression.targetId}".`);
    case 'member': {
      const object = evaluate(expression.object, environment, contexts, locals, state);
      if (object === null || object === undefined) {
        return invalidValue(`Cannot read member "${expression.property}" from an empty value.`);
      }
      return (Object(object) as Record<string, unknown>)[expression.property];
    }
    case 'record':
      return Object.fromEntries(
        expression.entries.map((entry) => [
          entry.name,
          evaluate(entry.value, environment, contexts, locals, state),
        ]),
      );
    case 'read':
      return readTarget(expression.targetId, environment, contexts, locals, state);
  }
};

const sortableValue = (value: unknown): boolean | number | string => {
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  return invalidValue('sort() keys must be booleans, numbers, or strings.');
};

const isCapabilityToken = (value: unknown): value is CapabilityToken =>
  typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'capability';

const isProcedureToken = (value: unknown): value is ProcedureToken =>
  typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'procedure';

const readTarget = (
  targetId: string,
  environment: RenderEnvironment,
  contexts: ReadonlyMap<string, unknown>,
  locals: ReadonlyMap<string, unknown>,
  state: RenderState,
): unknown => {
  if (locals.has(targetId)) {
    return locals.get(targetId);
  }
  if (environment.values.has(targetId)) {
    return environment.values.get(targetId);
  }
  const parameter = environment.parameters.get(targetId);
  if (parameter) {
    if (parameter.kind === 'value' && parameter.default) {
      return evaluateOwned(
        targetId,
        () =>
          evaluate(parameter.default as ServerExpressionV1, environment, contexts, locals, state),
        environment,
      );
    }
    return invalidValue(
      `Component "${environment.component.name}" is missing parameter "${parameter.name}".`,
    );
  }
  const binding = environment.bindings.get(targetId);
  if (!binding) {
    return invalidPlan(
      `Component "${environment.component.name}" cannot read unknown value "${targetId}".`,
    );
  }
  switch (binding.kind) {
    case 'async-resource': {
      const resolved = state.options.resolveResourceValue?.(
        targetId,
        renderLocation(environment, environment.instancePath),
      );
      if (resolved?.found) {
        environment.values.set(targetId, resolved.value);
        return resolved.value;
      }
      if (state.options.resourceValues?.has(targetId)) {
        const value = state.options.resourceValues.get(targetId);
        environment.values.set(targetId, value);
        return value;
      }
      if (state.options.tolerateUnresolvedAsyncResources) {
        const value = Object.freeze({});
        environment.values.set(targetId, value);
        return value;
      }
      return evaluateOwned(
        targetId,
        () => evaluate(binding.expression, environment, contexts, locals, state),
        environment,
      );
    }
    case 'constant':
      environment.values.set(targetId, binding.value);
      return binding.value;
    case 'state':
      return evaluateOwned(
        targetId,
        () => evaluate(binding.initial, environment, contexts, locals, state),
        environment,
      );
    case 'computed':
      return evaluateOwned(
        targetId,
        () => evaluate(binding.expression, environment, contexts, locals, state),
        environment,
        false,
      );
    case 'context':
      return contexts.has(binding.contextId)
        ? contexts.get(binding.contextId)
        : invalidValue(`No server context provider exists for "${binding.name}".`);
    case 'ref':
      return invalidValue(`DOM ref "${binding.name}" is unavailable during SSR.`);
  }
};

const evaluateOwned = (
  id: string,
  run: () => unknown,
  environment: RenderEnvironment,
  cache = true,
): unknown => {
  if (environment.evaluating.has(id)) {
    return invalidValue(`Server value evaluation cycles through "${id}".`);
  }
  environment.evaluating.add(id);
  try {
    const value = run();
    if (cache) {
      environment.values.set(id, value);
    }
    return value;
  } finally {
    environment.evaluating.delete(id);
  }
};

const normalizedAttributeName = (name: string, mode: 'attribute' | 'property'): string => {
  if (mode === 'property' && name === 'className') {
    return 'class';
  }
  if (mode === 'property' && name === 'htmlFor') {
    return 'for';
  }
  return name;
};

const renderAttribute = (name: string, mode: 'attribute' | 'property', value: unknown): string => {
  const normalized = normalizedAttributeName(name, mode);
  if (!/^[^\s"'<>/=]+$/u.test(normalized)) {
    return invalidPlan(`Invalid HTML attribute name "${normalized}".`);
  }
  if (value === false || value === null || value === undefined) {
    return '';
  }
  return value === true
    ? ` ${normalized}=""`
    : ` ${normalized}="${escapeAttribute(String(value))}"`;
};

const localizedOptions = (
  localization: ServerLocalizedMessageV1,
  environment: RenderEnvironment,
  contexts: ReadonlyMap<string, unknown>,
  locals: ReadonlyMap<string, unknown>,
  state: RenderState,
): {
  readonly count?: number;
  readonly markup?: readonly string[];
  readonly ordinal?: number;
  readonly values?: Readonly<Record<string, boolean | number | string>>;
} => {
  const values: Record<string, boolean | number | string> = {};
  for (const entry of localization.values) {
    const value = evaluate(entry.value, environment, contexts, locals, state);
    if (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') {
      return invalidValue(
        `Localized value "${entry.name}" for "${localization.key}" must be a primitive.`,
      );
    }
    values[entry.name] = value;
  }
  let selection: number | undefined;
  if (localization.selection) {
    const value = evaluate(localization.selection.value, environment, contexts, locals, state);
    if (typeof value !== 'number') {
      return invalidValue(
        `Localized ${localization.selection.kind} selection for "${localization.key}" must be a number.`,
      );
    }
    selection = value;
  }
  return {
    ...(localization.selection?.kind === 'cardinal' && selection !== undefined
      ? { count: selection }
      : {}),
    ...(localization.selection?.kind === 'ordinal' && selection !== undefined
      ? { ordinal: selection }
      : {}),
    ...(localization.markup.length > 0
      ? { markup: localization.markup.map((markup) => markup.name) }
      : {}),
    ...(Object.keys(values).length > 0 ? { values } : {}),
  };
};

const formattedOptions = (
  format: ServerFormattedValueV1,
  environment: RenderEnvironment,
  contexts: ReadonlyMap<string, unknown>,
  locals: ReadonlyMap<string, unknown>,
  state: RenderState,
): ServerFormatValueOptions => {
  const options: { [name: string]: unknown } = { type: format.type };
  for (const option of format.options) {
    options[option.name] = evaluate(option.value, environment, contexts, locals, state);
  }
  if (format.type === 'currency' && typeof options.currency !== 'string') {
    return invalidValue('Currency formatting requires a string currency code.');
  }
  // Intl performs the authoritative validation for the remaining platform option names.
  return options as ServerFormatValueOptions;
};

const renderLocalizedParts = (
  parts: readonly ServerLocalizedContentPart[],
  markup: ReadonlyMap<string, ServerLocalizedMarkupV1>,
  environment: RenderEnvironment,
  contexts: ReadonlyMap<string, unknown>,
  locals: ReadonlyMap<string, unknown>,
  state: RenderState,
): void => {
  for (const part of parts) {
    if (typeof part === 'string') {
      state.metrics.textNodes += 1;
      write(state, escapeText(part));
      continue;
    }
    const descriptor = markup.get(part.name);
    if (!descriptor) {
      return invalidPlan(`Localized markup "${part.name}" has no compiler descriptor.`);
    }
    if (!/^[a-z][a-z0-9]*$/u.test(descriptor.tag)) {
      return invalidPlan(`Invalid localized HTML tag <${descriptor.tag}>.`);
    }
    state.metrics.elements += 1;
    write(state, `<${descriptor.tag}`);
    for (const attribute of descriptor.staticAttributes) {
      write(state, renderAttribute(attribute.name, 'attribute', attribute.value));
    }
    for (const attribute of descriptor.dynamicAttributes) {
      write(
        state,
        renderAttribute(
          attribute.name,
          attribute.mode,
          evaluate(attribute.value, environment, contexts, locals, state),
        ),
      );
    }
    write(state, '>');
    renderLocalizedParts(part.children, markup, environment, contexts, locals, state);
    write(state, `</${descriptor.tag}>`);
  }
};

const renderView = (
  view: ServerViewV1,
  environment: RenderEnvironment,
  contexts: ReadonlyMap<string, unknown>,
  locals: ReadonlyMap<string, unknown>,
  state: RenderState,
  depth: number,
  instancePath: string,
): void => {
  state.metrics.views += 1;
  switch (view.kind) {
    case 'value-capture': {
      if (!state.options.captureValue) {
        return invalidPlan(`Value capture "${view.id}" requires a server capture hook.`);
      }
      state.options.captureValue(
        view.id,
        evaluate(view.value, environment, contexts, locals, state),
        renderLocation(environment, instancePath),
      );
      return;
    }
    case 'element': {
      if (!/^[a-z][a-z0-9]*$/u.test(view.tag)) {
        return invalidPlan(`Invalid server HTML tag <${view.tag}>.`);
      }
      state.metrics.elements += 1;
      write(state, `<${view.tag}`);
      if (view.eventId) {
        write(state, ` data-oxe-event="${escapeAttribute(hydrationMarkerId(view.eventId))}"`);
      }
      for (const attribute of view.attributes) {
        const value =
          attribute.kind === 'static'
            ? (state.options.transformStaticAttribute?.(
                attribute.name,
                attribute.value,
                renderLocation(environment, instancePath),
              ) ?? attribute.value)
            : attribute.localization
              ? (state.options.i18n?.format(
                  attribute.localization.key,
                  localizedOptions(attribute.localization, environment, contexts, locals, state),
                ) ??
                invalidPlan(
                  `Localized attribute "${attribute.localization.key}" requires options.i18n.`,
                ))
              : evaluate(attribute.value, environment, contexts, locals, state);
        write(
          state,
          renderAttribute(
            attribute.name,
            attribute.kind === 'static' ? 'attribute' : attribute.mode,
            value,
          ),
        );
      }
      const machineName =
        view.tag === 'data' ? 'value' : view.tag === 'time' ? 'datetime' : undefined;
      const formattedChild =
        view.children.length === 1 && view.children[0]?.kind === 'text'
          ? view.children[0].format
          : undefined;
      if (
        machineName &&
        formattedChild &&
        !view.attributes.some((attribute) => attribute.name === machineName)
      ) {
        const i18n = state.options.i18n;
        if (!i18n) {
          return invalidPlan(`Formatted <${view.tag}> requires options.i18n.`);
        }
        write(
          state,
          renderAttribute(
            machineName,
            'attribute',
            i18n.machineValue(
              evaluate(formattedChild.value, environment, contexts, locals, state),
              formattedChild.type,
            ),
          ),
        );
      }
      write(state, '>');
      if (voidElements.has(view.tag)) {
        if (view.children.length > 0) {
          return invalidPlan(`Void element <${view.tag}> cannot have server-rendered children.`);
        }
        return;
      }
      for (const child of view.children) {
        renderView(child, environment, contexts, locals, state, depth, instancePath);
      }
      write(state, `</${view.tag}>`);
      return;
    }
    case 'text': {
      if (view.format) {
        const i18n = state.options.i18n;
        if (!i18n) {
          return invalidPlan(`Formatted value "${view.id}" requires options.i18n.`);
        }
        state.metrics.textNodes += 1;
        write(
          state,
          escapeText(
            i18n.formatValue(
              evaluate(view.format.value, environment, contexts, locals, state),
              formattedOptions(view.format, environment, contexts, locals, state),
            ),
          ),
        );
        return;
      }
      if (view.localization) {
        const i18n = state.options.i18n;
        if (!i18n) {
          return invalidPlan(`Localized message "${view.localization.key}" requires options.i18n.`);
        }
        const options = localizedOptions(view.localization, environment, contexts, locals, state);
        if (view.localization.markup.length === 0) {
          state.metrics.textNodes += 1;
          write(state, escapeText(i18n.format(view.localization.key, options)));
          return;
        }
        const marker = hydrationMarkerId(view.id);
        write(state, `<!--oxe:${marker}:start-->`);
        renderLocalizedParts(
          i18n.formatToParts(view.localization.key, options),
          new Map(view.localization.markup.map((markup) => [markup.name, markup])),
          environment,
          contexts,
          locals,
          state,
        );
        write(state, `<!--oxe:${marker}:end-->`);
        return;
      }
      state.metrics.textNodes += 1;
      const text = view.parts
        .map((part) =>
          part.kind === 'static'
            ? (state.options.transformStaticText?.(
                part.value,
                renderLocation(environment, instancePath),
              ) ?? part.value)
            : renderTextValue(evaluate(part.expression, environment, contexts, locals, state)),
        )
        .join('');
      write(state, escapeText(text));
      return;
    }
    case 'component':
      renderComponent(
        view.componentId,
        view.props,
        { views: view.children, environment, contexts, instancePath, locals },
        contexts,
        state,
        depth + 1,
        childInstancePath(instancePath, 'component', view.id),
        environment.instancePath,
        view.id,
      );
      return;
    case 'choice':
      for (const branch of view.branches) {
        if (
          !branch.condition ||
          Boolean(evaluate(branch.condition, environment, contexts, locals, state))
        ) {
          renderView(branch.view, environment, contexts, locals, state, depth, instancePath);
          return;
        }
      }
      return;
    case 'collection': {
      const items = arrayValue(
        evaluate(view.source, environment, contexts, locals, state),
        `Keyed collection "${view.id}"`,
      );
      const keys = new Set<unknown>();
      for (const item of items) {
        const rowLocals = new Map(locals);
        rowLocals.set(view.itemId, item);
        const key = evaluate(view.key, environment, contexts, rowLocals, state);
        if (keys.has(key)) {
          return invalidValue(
            `Keyed collection "${view.id}" received duplicate key ${String(key)}.`,
          );
        }
        keys.add(key);
        state.metrics.collectionItems += 1;
        renderView(
          view.row,
          environment,
          contexts,
          rowLocals,
          state,
          depth,
          childInstancePath(instancePath, 'row', `${view.id}:${keyedInstanceIdentity(key)}`),
        );
      }
      return;
    }
    case 'context-provider': {
      const nextContexts = new Map(contexts);
      nextContexts.set(view.contextId, evaluate(view.value, environment, contexts, locals, state));
      for (const child of view.children) {
        renderView(child, environment, nextContexts, locals, state, depth, instancePath);
      }
      return;
    }
    case 'content-slot': {
      const capture = environment.contents.get(view.parameterId);
      if (!capture) {
        return;
      }
      for (const child of capture.views) {
        renderView(
          child,
          capture.environment,
          capture.contexts,
          capture.locals,
          state,
          depth,
          capture.instancePath,
        );
      }
      return;
    }
  }
};

const propOrder = (left: ServerComponentPropV1, right: ServerComponentPropV1): number =>
  (left.index ?? Number.MAX_SAFE_INTEGER) - (right.index ?? Number.MAX_SAFE_INTEGER) ||
  left.parameterId.localeCompare(right.parameterId);

const renderComponent = (
  componentId: string,
  props: readonly ServerComponentPropV1[],
  content: ContentCapture | undefined,
  contexts: ReadonlyMap<string, unknown>,
  state: RenderState,
  depth: number,
  instancePath: string,
  parentInstancePath?: string,
  invocationId?: string,
): void => {
  const component = state.components.get(componentId);
  if (!component) {
    return invalidPlan(`Server plan references missing component "${componentId}".`);
  }
  state.metrics.components += 1;
  state.metrics.maxComponentDepth = Math.max(state.metrics.maxComponentDepth, depth);
  const environment: RenderEnvironment = {
    component,
    bindings: new Map(component.bindings.map((binding) => [binding.id, binding])),
    parameters: new Map(component.parameters.map((parameter) => [parameter.id, parameter])),
    contents: new Map(),
    procedures: new Map(),
    evaluating: new Set(),
    instancePath,
    ...(invocationId ? { invocationId } : {}),
    values: new Map(),
    ...(parentInstancePath ? { parentInstancePath } : {}),
  };
  state.options.onComponentInstance?.(renderLocation(environment, instancePath));

  const caller = content?.environment;
  const callerContexts = content?.contexts ?? contexts;
  const callerLocals = content?.locals ?? new Map<string, unknown>();
  const orderedProps = [...props].sort(propOrder);
  for (const parameter of component.parameters) {
    const assignments = orderedProps.filter((prop) => prop.parameterId === parameter.id);
    switch (parameter.kind) {
      case 'children':
        if (content) {
          environment.contents.set(parameter.id, content);
        }
        break;
      case 'procedure': {
        const assignment = assignments.find((prop) => prop.kind === 'procedure');
        if (assignment?.kind === 'procedure') {
          environment.procedures.set(parameter.id, {
            kind: 'procedure',
            targetId: assignment.targetId,
          });
        }
        break;
      }
      case 'rest': {
        const rest: Record<string, unknown> = {};
        for (const assignment of assignments) {
          if (!caller) {
            return invalidPlan(`Entry component cannot receive rest prop assignments.`);
          }
          if (assignment.kind === 'spread') {
            const spread =
              assignment.source.kind === 'rest'
                ? readTarget(
                    assignment.source.targetId,
                    caller,
                    callerContexts,
                    callerLocals,
                    state,
                  )
                : evaluate(assignment.source.value, caller, callerContexts, callerLocals, state);
            Object.assign(rest, recordValue(spread, 'A component prop spread'));
          } else if (assignment.kind === 'value' && assignment.authoredName) {
            rest[assignment.authoredName] = evaluate(
              assignment.value,
              caller,
              callerContexts,
              callerLocals,
              state,
            );
          }
        }
        environment.values.set(parameter.id, rest);
        break;
      }
      case 'value': {
        const assignment = assignments.find((prop) => prop.kind === 'value');
        if (assignment?.kind === 'value') {
          if (!caller) {
            return invalidPlan(`Entry component cannot receive value prop assignments.`);
          }
          environment.values.set(
            parameter.id,
            evaluate(assignment.value, caller, callerContexts, callerLocals, state),
          );
        } else if (!parameter.default) {
          return invalidValue(
            `Component "${component.name}" is missing value prop "${parameter.name}".`,
          );
        }
        break;
      }
    }
  }

  if (state.options.captureAsyncResource) {
    for (const binding of component.bindings) {
      if (binding.kind !== 'async-resource' || binding.expression.kind !== 'call') continue;
      state.options.captureAsyncResource(
        binding.id,
        binding.expression.arguments.map((argument) =>
          evaluate(argument, environment, contexts, new Map(), state),
        ),
        renderLocation(environment, instancePath),
      );
    }
  }

  renderView(component.boundary.root, environment, contexts, new Map(), state, depth, instancePath);
};

const initializeState = (
  plan: ServerRenderPlanV1,
  sink: ServerRenderSink,
  options: ServerRenderOptions,
): RenderState => {
  if (plan.schemaVersion !== 'oxe.server-render-plan.v1') {
    return invalidPlan('Unsupported server render plan schema.');
  }
  if (plan.execution.mode !== 'synchronous') {
    return invalidPlan('The synchronous renderer cannot execute a non-synchronous plan.');
  }
  const components = new Map(plan.components.map((component) => [component.id, component]));
  if (components.size !== plan.components.length) {
    return invalidPlan('The server render plan contains duplicate component ids.');
  }
  const entryComponent = components.get(plan.entry.componentId);
  if (!entryComponent) {
    return invalidPlan(`Entry component "${plan.entry.componentId}" is missing from the plan.`);
  }
  if (entryComponent.boundary.id !== plan.entry.boundaryId) {
    return invalidPlan(`Entry boundary "${plan.entry.boundaryId}" is missing from the plan.`);
  }
  return {
    plan,
    sink,
    options,
    components,
    capabilities: new Map(plan.capabilities.map((capability) => [capability.id, capability])),
    metrics: {
      bytesWritten: 0,
      collectionItems: 0,
      components: 0,
      elements: 0,
      expressions: 0,
      maxComponentDepth: 0,
      textNodes: 0,
      views: 0,
    },
  };
};

/** Executes a blocking v1 plan against an ordered sink, the seam used by future streaming hosts. */
export const renderToSink = (
  plan: ServerRenderPlanV1,
  sink: ServerRenderSink,
  options: ServerRenderOptions = {},
): ServerRenderMetrics => {
  const state = initializeState(plan, sink, options);
  renderComponent(plan.entry.componentId, [], undefined, new Map(), state, 1, 'root');
  return Object.freeze({ ...state.metrics });
};

export const renderToStringWithMetrics = (
  plan: ServerRenderPlanV1,
  options: ServerRenderOptions = {},
): ServerRenderResult => {
  const chunks: string[] = [];
  const metrics = renderToSink(plan, { write: (chunk) => chunks.push(chunk) }, options);
  return { html: chunks.join(''), metrics };
};

export const renderToString = (
  plan: ServerRenderPlanV1,
  options: ServerRenderOptions = {},
): string => renderToStringWithMetrics(plan, options).html;
