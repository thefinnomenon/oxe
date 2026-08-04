import { glob, readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import {
  parseSource,
  type AttributeNode,
  type ConditionalResultNode,
  type ElementNode,
  type ExpressionNode,
  type MarkupChildNode,
  type ModuleNode,
  type SourceSpan,
} from '@oxe/compiler';

import { contentHash, messageId } from './hash.js';
import type {
  ExtractedMessage,
  ExtractMessagesResult,
  I18nDiagnostic,
  MessageLocation,
  MessagePlaceholder,
  MessageSelection,
  MessageTranslationContext,
  OxeProjectConfig,
} from './types.js';

const skippedElements = new Set([
  'code',
  'kbd',
  'math',
  'pre',
  'samp',
  'script',
  'style',
  'svg',
  'template',
  'textarea',
  'var',
]);

const inlineElements = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'br',
  'cite',
  'code',
  'data',
  'del',
  'em',
  'i',
  'ins',
  'kbd',
  'mark',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
  'wbr',
]);

const translatedAttributes = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-valuetext',
  'placeholder',
  'title',
]);

interface ElementI18nConfig {
  readonly contextSelectors: readonly string[];
  readonly explicit: boolean;
  readonly format: boolean;
  readonly key?: string;
  readonly mode: 'inherit' | 'off' | 'on';
  readonly purpose?: string;
  readonly selection?: MessageSelection;
}

interface ExtractionState {
  readonly diagnostics: I18nDiagnostic[];
  readonly messages: Map<string, ExtractedMessage>;
  readonly projectDirectory: string;
}

interface SerializedMessage {
  readonly placeholders: MessagePlaceholder[];
  readonly source: string;
  readonly span: SourceSpan;
}

const attributeNamed = (element: ElementNode, name: string): AttributeNode | undefined =>
  element.attributes.find(
    (attribute): attribute is AttributeNode =>
      attribute.kind === 'Attribute' && attribute.name.name === name,
  );

const isAutomaticallySkipped = (element: ElementNode): boolean => {
  if (skippedElements.has(element.name.name)) {
    return true;
  }
  const editable = attributeNamed(element, 'contenteditable')?.value;
  if (editable && (editable.kind !== 'BooleanLiteral' || editable.value)) {
    return true;
  }
  const translate = attributeNamed(element, 'translate')?.value;
  return translate?.kind === 'StringLiteral' && translate.value.toLowerCase() === 'no';
};

const recordField = (expression: ExpressionNode, name: string): ExpressionNode | undefined =>
  expression.kind === 'RecordLiteral'
    ? expression.entries.find((entry) => entry.name.name === name)?.value
    : undefined;

const elementI18nConfig = (
  element: ElementNode,
  diagnostics: I18nDiagnostic[],
): ElementI18nConfig => {
  const attribute = attributeNamed(element, 'i18n');
  if (!attribute) {
    return { contextSelectors: [], explicit: false, format: false, mode: 'inherit' };
  }
  if (attribute.value.kind === 'BooleanLiteral' && attribute.value.value === false) {
    return { contextSelectors: [], explicit: true, format: false, mode: 'off' };
  }
  if (attribute.value.kind !== 'RecordLiteral') {
    diagnostics.push({
      code: 'OXEI18N001',
      column: attribute.span.start.column,
      file: attribute.span.fileName,
      line: attribute.span.start.line,
      message: 'i18n must be false or a compiler-readable record.',
    });
    return { contextSelectors: [], explicit: true, format: false, mode: 'off' };
  }
  const fields = new Map<string, SourceSpan>();
  const allowedFields = new Set(['context', 'count', 'format', 'key', 'ordinal', 'purpose']);
  for (const entry of attribute.value.entries) {
    const previous = fields.get(entry.name.name);
    if (previous) {
      diagnostics.push({
        code: 'OXEI18N004',
        column: entry.name.span.start.column,
        file: entry.name.span.fileName,
        line: entry.name.span.start.line,
        message: `Duplicate i18n field ${JSON.stringify(entry.name.name)}.`,
      });
      continue;
    }
    fields.set(entry.name.name, entry.name.span);
    if (!allowedFields.has(entry.name.name)) {
      diagnostics.push({
        code: 'OXEI18N005',
        column: entry.name.span.start.column,
        file: entry.name.span.fileName,
        line: entry.name.span.start.line,
        message: `Unknown i18n field ${JSON.stringify(entry.name.name)}.`,
      });
    } else if (entry.name.name === 'context' && entry.value.kind !== 'RecordLiteral') {
      diagnostics.push({
        code: 'OXEI18N006',
        column: entry.value.span.start.column,
        file: entry.value.span.fileName,
        line: entry.value.span.start.line,
        message: 'i18n.context must be an inline record.',
      });
    } else if (entry.name.name === 'purpose' && entry.value.kind !== 'StringLiteral') {
      diagnostics.push({
        code: 'OXEI18N011',
        column: entry.value.span.start.column,
        file: entry.value.span.fileName,
        line: entry.value.span.start.line,
        message: 'i18n.purpose must be a static string.',
      });
    } else if (entry.name.name === 'format') {
      if (entry.value.kind !== 'RecordLiteral') {
        diagnostics.push({
          code: 'OXEI18N007',
          column: entry.value.span.start.column,
          file: entry.value.span.fileName,
          line: entry.value.span.start.line,
          message: 'i18n.format must be an inline record.',
        });
        continue;
      }
      const type = recordField(entry.value, 'type');
      if (!type || type.kind !== 'StringLiteral') {
        diagnostics.push({
          code: 'OXEI18N008',
          column: (type ?? entry.value).span.start.column,
          file: (type ?? entry.value).span.fileName,
          line: (type ?? entry.value).span.start.line,
          message: 'i18n.format.type must be a static string.',
        });
      } else if (!['currency', 'date', 'datetime', 'time'].includes(type.value)) {
        diagnostics.push({
          code: 'OXEI18N009',
          column: type.span.start.column,
          file: type.span.fileName,
          line: type.span.start.line,
          message: 'i18n.format.type must be currency, date, datetime, or time.',
        });
      } else if (type.value === 'currency' && recordField(entry.value, 'currency') === undefined) {
        diagnostics.push({
          code: 'OXEI18N010',
          column: entry.value.span.start.column,
          file: entry.value.span.fileName,
          line: entry.value.span.start.line,
          message: 'Currency formatting requires i18n.format.currency.',
        });
      }
    }
  }
  const keyExpression = recordField(attribute.value, 'key');
  if (keyExpression && keyExpression.kind !== 'StringLiteral') {
    diagnostics.push({
      code: 'OXEI18N002',
      column: keyExpression.span.start.column,
      file: keyExpression.span.fileName,
      line: keyExpression.span.start.line,
      message: 'i18n.key must be a static string.',
    });
  }
  const key = keyExpression?.kind === 'StringLiteral' ? keyExpression.value : undefined;
  const count = recordField(attribute.value, 'count');
  const ordinal = recordField(attribute.value, 'ordinal');
  if (count && ordinal) {
    diagnostics.push({
      code: 'OXEI18N012',
      column: ordinal.span.start.column,
      file: ordinal.span.fileName,
      line: ordinal.span.start.line,
      message: 'i18n.count and i18n.ordinal cannot be used together.',
    });
  }
  const context = recordField(attribute.value, 'context');
  const purpose = recordField(attribute.value, 'purpose');
  return {
    contextSelectors:
      context?.kind === 'RecordLiteral'
        ? context.entries.map((entry) => entry.name.name).sort()
        : [],
    explicit: true,
    format: recordField(attribute.value, 'format')?.kind === 'RecordLiteral',
    ...(key === undefined ? {} : { key }),
    mode: 'on',
    ...(purpose?.kind === 'StringLiteral' ? { purpose: purpose.value } : {}),
    ...(count ? { selection: { kind: 'cardinal' as const } } : {}),
    ...(!count && ordinal ? { selection: { kind: 'ordinal' as const } } : {}),
  };
};

const normalizeMessage = (value: string): string =>
  value
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,.;:!?])/gu, '$1')
    .trim();

const expressionBaseName = (expression: ExpressionNode): string => {
  switch (expression.kind) {
    case 'Identifier':
      return expression.name;
    case 'MemberExpression':
      return expression.property.name;
    case 'ParenthesizedExpression':
    case 'UntrackExpression':
      return expressionBaseName(expression.expression);
    case 'CallExpression':
      return expressionBaseName(expression.callee);
    default:
      return 'value';
  }
};

const uniqueName = (base: string, counts: Map<string, number>): string => {
  const normalized = base.replace(/[^A-Za-z0-9_]/gu, '') || 'value';
  const next = (counts.get(normalized) ?? 0) + 1;
  counts.set(normalized, next);
  return next === 1 ? normalized : `${normalized}${next}`;
};

const location = (span: SourceSpan, projectDirectory: string): MessageLocation => ({
  column: span.start.column,
  file: relative(projectDirectory, resolve(projectDirectory, span.fileName)).split(sep).join('/'),
  line: span.start.line,
});

const addMessage = (
  state: ExtractionState,
  serialized: SerializedMessage,
  options: {
    readonly discriminator?: string;
    readonly explicitKey?: string;
    readonly selection?: MessageSelection;
    readonly translationContext: MessageTranslationContext;
  },
): void => {
  const source = normalizeMessage(serialized.source);
  if (source.length === 0 || !/[\p{L}\p{N}]/u.test(source.replace(/\{[^}]+\}/gu, ''))) {
    return;
  }
  const placeholders = serialized.placeholders;
  const id =
    options.explicitKey ??
    messageId(
      `${options.discriminator ?? 'content'}\0${source}`,
      placeholders.map((item) => item.token),
    );
  const sourceHash = contentHash(
    JSON.stringify({
      placeholders,
      selection: options.selection,
      source,
      translationContext: options.translationContext,
    }),
  );
  const nextLocation = location(serialized.span, state.projectDirectory);
  const existing = state.messages.get(id);
  if (existing) {
    if (
      existing.source !== source ||
      JSON.stringify(existing.selection) !== JSON.stringify(options.selection) ||
      JSON.stringify(existing.translationContext) !== JSON.stringify(options.translationContext)
    ) {
      state.diagnostics.push({
        code: 'OXEI18N003',
        column: serialized.span.start.column,
        file: serialized.span.fileName,
        line: serialized.span.start.line,
        message: `The message key ${JSON.stringify(id)} is already used for different source text.`,
      });
      return;
    }
    const locations = [...existing.locations, nextLocation].sort(
      (left, right) =>
        left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column,
    );
    state.messages.set(id, { ...existing, locations });
    return;
  }
  state.messages.set(id, {
    explicitKey: options.explicitKey !== undefined,
    id,
    locations: [nextLocation],
    placeholders,
    ...(options.selection ? { selection: options.selection } : {}),
    source,
    sourceHash,
    translationContext: options.translationContext,
  });
};

const inferredPurpose = (element: string, attribute?: string): string => {
  if (attribute) {
    const purposes: Readonly<Record<string, string>> = {
      alt: 'alternative text describing an image',
      'aria-description': 'accessible description',
      'aria-label': 'accessible control label',
      'aria-valuetext': 'accessible human-readable value',
      placeholder: 'short form-input placeholder',
      title: 'supplementary tooltip text',
    };
    return purposes[attribute] ?? `${attribute} attribute on <${element}>`;
  }
  if (/^h[1-6]$/u.test(element)) return 'interface heading';
  if (element === 'button') return 'concise action button label';
  if (element === 'label') return 'form field label';
  if (element === 'option') return 'selection option label';
  if (element === 'nav') return 'navigation text';
  return `visible interface text in <${element}>`;
};

const finalElement = (result: ConditionalResultNode): ElementNode | undefined => {
  if (result.kind === 'Element') {
    return result;
  }
  if (result.kind === 'ConditionalResultBlock' && result.result.kind === 'Element') {
    return result.result;
  }
  return undefined;
};

const nestedExpressionElements = (expression: ExpressionNode): readonly ElementNode[] => {
  switch (expression.kind) {
    case 'MapExpression':
      return [expression.body];
    case 'CollectionExpression':
      return expression.callback.result.kind === 'Element' ? [expression.callback.result] : [];
    case 'ConditionalValueExpression':
      return expression.branches.flatMap((branch) => {
        const element = finalElement(branch.result);
        return element ? [element] : [];
      });
    case 'ParenthesizedExpression':
    case 'UntrackExpression':
      return nestedExpressionElements(expression.expression);
    default:
      return [];
  }
};

const serializeChildren = (
  children: readonly MarkupChildNode[],
  placeholders: MessagePlaceholder[],
  counts: Map<string, number>,
): string => {
  let source = '';
  for (const child of children) {
    if (child.kind === 'Text') {
      source += child.value;
      continue;
    }
    if (child.kind === 'Interpolation') {
      if (nestedExpressionElements(child.expression).length > 0) {
        continue;
      }
      const name = uniqueName(expressionBaseName(child.expression), counts);
      const token = `{${name}}`;
      placeholders.push({ kind: 'expression', name, token });
      source += token;
      continue;
    }
    if (child.kind !== 'Element') {
      continue;
    }
    const childName = child.name.name;
    if (skippedElements.has(childName)) {
      const name = uniqueName(childName, counts);
      const token = `{${name}}`;
      placeholders.push({ kind: 'expression', name, token });
      source += token;
      continue;
    }
    const name = uniqueName(childName, counts);
    const open = `<${name}>`;
    const close = `</${name}>`;
    placeholders.push({ kind: 'markup-open', name, token: open });
    source += open;
    source += serializeChildren(child.children, placeholders, counts);
    placeholders.push({ kind: 'markup-close', name, token: close });
    source += close;
  }
  return source;
};

const visitElement = (
  element: ElementNode,
  inheritedEnabled: boolean,
  state: ExtractionState,
  component: string,
): void => {
  const config = elementI18nConfig(element, state.diagnostics);
  const automaticallySkipped = isAutomaticallySkipped(element);
  const enabled =
    config.mode === 'on'
      ? true
      : config.mode === 'off'
        ? false
        : inheritedEnabled && !automaticallySkipped;

  if (enabled) {
    for (const attribute of element.attributes) {
      if (
        attribute.kind === 'Attribute' &&
        translatedAttributes.has(attribute.name.name) &&
        attribute.value.kind === 'StringLiteral'
      ) {
        addMessage(
          state,
          { placeholders: [], source: attribute.value.value, span: attribute.span },
          {
            discriminator: `attribute:${attribute.name.name}`,
            translationContext: {
              attribute: attribute.name.name,
              component,
              contextSelectors: [],
              element: element.name.name,
              purpose: inferredPurpose(element.name.name, attribute.name.name),
            },
          },
        );
      }
    }
  }

  let group: MarkupChildNode[] = [];
  const flush = (): void => {
    if (enabled && group.length > 0 && !config.format) {
      const placeholders: MessagePlaceholder[] = [];
      addMessage(
        state,
        {
          placeholders,
          source: serializeChildren(group, placeholders, new Map()),
          span: group[0]?.span ?? element.span,
        },
        {
          ...(config.key ? { explicitKey: config.key } : {}),
          ...(config.selection ? { selection: config.selection } : {}),
          translationContext: {
            component,
            contextSelectors: config.contextSelectors,
            element: element.name.name,
            purpose: config.purpose ?? inferredPurpose(element.name.name),
          },
        },
      );
    }
    group = [];
  };

  for (const child of element.children) {
    if (child.kind === 'Text') {
      group.push(child);
      continue;
    }
    if (child.kind === 'Interpolation') {
      const nested = nestedExpressionElements(child.expression);
      if (nested.length === 0) {
        group.push(child);
      } else {
        flush();
        for (const nestedElement of nested) {
          visitElement(nestedElement, enabled, state, component);
        }
      }
      continue;
    }
    if (child.kind === 'ConditionalRegion') {
      flush();
      for (const branch of child.branches) {
        const branchElement = finalElement(branch.result);
        if (branchElement) {
          visitElement(branchElement, enabled, state, component);
        }
      }
      continue;
    }
    const childConfig = elementI18nConfig(child, state.diagnostics);
    if (
      inlineElements.has(child.name.name) &&
      childConfig.mode === 'inherit' &&
      !skippedElements.has(child.name.name)
    ) {
      group.push(child);
      continue;
    }
    if (inlineElements.has(child.name.name) && skippedElements.has(child.name.name)) {
      group.push(child);
      continue;
    }
    flush();
    visitElement(child, enabled, state, component);
  }
  flush();
};

const visitModule = (module: ModuleNode, state: ExtractionState): void => {
  for (const declaration of module.declarations) {
    for (const statement of declaration.body) {
      if (statement.kind === 'Element') {
        visitElement(statement, true, state, declaration.name.name);
      } else if (statement.kind === 'ConditionalRegion') {
        for (const branch of statement.branches) {
          const element = finalElement(branch.result);
          if (element) {
            visitElement(element, true, state, declaration.name.name);
          }
        }
      } else if (statement.kind === 'ExpressionStatement') {
        for (const element of nestedExpressionElements(statement.expression)) {
          visitElement(element, true, state, declaration.name.name);
        }
      }
    }
  }
};

const collectSourceFiles = async (config: OxeProjectConfig): Promise<readonly string[]> => {
  const files = new Set<string>();
  for (const pattern of config.i18n.include) {
    for await (const file of glob(pattern, {
      cwd: config.projectDirectory,
      exclude: ['**/.git/**', '**/dist/**', '**/node_modules/**'],
    })) {
      files.add(file);
    }
  }
  return [...files].sort();
};

export const extractProjectMessages = async (
  config: OxeProjectConfig,
): Promise<ExtractMessagesResult> => {
  const state: ExtractionState = {
    diagnostics: [],
    messages: new Map(),
    projectDirectory: config.projectDirectory,
  };
  for (const file of await collectSourceFiles(config)) {
    const absoluteFile = resolve(config.projectDirectory, file);
    const source = await readFile(absoluteFile, 'utf8');
    const result = parseSource(source, file);
    state.diagnostics.push(
      ...result.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        column: diagnostic.span.start.column,
        file: diagnostic.span.fileName,
        line: diagnostic.span.start.line,
        message: diagnostic.message,
      })),
    );
    if (result.diagnostics.length === 0) {
      visitModule(result.ast, state);
    }
  }
  return {
    diagnostics: state.diagnostics,
    messages: [...state.messages.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
};
