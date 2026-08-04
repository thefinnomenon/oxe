import { asyncResourceIdentity } from '@oxe/runtime';

import { renderToString } from './render.js';
import { serializeServerRegionMarker, type ServerStreamPatch } from './stream-protocol.js';
import type {
  ServerBindingV1,
  ServerCapabilityPlanV1,
  ServerComponentPlanV1,
  ServerDynamicAttributeV1,
  ServerDeferredRegionOutput,
  ServerDeferredResourceRequestV2,
  ServerDeferredResourceV2,
  ServerExpressionV1,
  ServerPreparedRegionV2,
  ServerReadinessAdapter,
  ServerReadinessPreparation,
  ServerRenderPlanV1,
  ServerRenderPlanV2,
  ServerRenderLocation,
  ServerViewV1,
} from './types.js';

export type ServerJavaScriptReadinessErrorCode =
  'OXE_SERVER_ASYNC_CAPABILITY' | 'OXE_SERVER_ASYNC_INVALID_PLAN' | 'OXE_SERVER_ASYNC_UNSUPPORTED';

export class OxeServerJavaScriptReadinessError extends Error {
  public readonly code: ServerJavaScriptReadinessErrorCode;

  public constructor(code: ServerJavaScriptReadinessErrorCode, message: string) {
    super(message);
    this.name = 'OxeServerJavaScriptReadinessError';
    this.code = code;
  }
}

export interface ServerJavaScriptReadinessOptions {
  readonly callCapability: (
    capability: ServerCapabilityPlanV1,
    arguments_: readonly unknown[],
    signal: AbortSignal,
  ) => unknown | PromiseLike<unknown>;
  readonly scope?: string;
  /** Host policy may promote additional resources into the pre-header status gate. */
  readonly statusGate?: (context: {
    readonly binding: Extract<ServerBindingV1, { readonly kind: 'async-resource' }>;
    readonly capability: ServerCapabilityPlanV1;
    readonly component: ServerComponentPlanV1;
    readonly inferred: boolean;
  }) => boolean;
}

interface ResourceTemplate {
  readonly arguments: readonly unknown[];
  readonly binding: Extract<ServerBindingV1, { readonly kind: 'async-resource' }>;
  readonly capability: ServerCapabilityPlanV1;
  readonly componentId: string;
  readonly instancePath: string;
  readonly runtimeId: string;
  statusGate: boolean;
}

interface AsyncBindingTemplate {
  readonly binding: Extract<ServerBindingV1, { readonly kind: 'async-resource' }>;
  readonly capability: ServerCapabilityPlanV1;
  readonly componentId: string;
}

interface ComponentInstance {
  readonly componentId: string;
  readonly instancePath: string;
  readonly invocationId?: string;
  readonly parentInstancePath?: string;
}

interface RegionInstance {
  readonly id: string;
  readonly location: ServerRenderLocation;
  readonly template: ServerRenderPlanV2['regions'][number];
}

interface CapturedResourceArguments {
  readonly arguments: readonly unknown[];
  readonly bindingId: string;
  readonly instancePath: string;
}

interface RuntimeInstances {
  readonly components: Map<string, ComponentInstance>;
  readonly markerExpansions: Map<string, string>;
  readonly regions: Map<string, RegionInstance>;
  readonly resourceArguments: Map<string, CapturedResourceArguments>;
}

interface MarkerTransform {
  readonly markers: Map<string, string>;
  readonly plan: ServerRenderPlanV1;
  readonly targetAttribute?: ServerDynamicAttributeV1;
  readonly valueCaptureId?: string;
}

interface TransformContext {
  readonly captureEnd: string;
  readonly captureStart: string;
  readonly markerIds: ReadonlyMap<string, string>;
  readonly markers: Map<string, string>;
  readonly plan: ServerRenderPlanV2;
  readonly regionByConsumer: ReadonlyMap<string, ServerRenderPlanV2['regions'][number]>;
  readonly resolvedResourceIds: ReadonlySet<string>;
  readonly suppressedHydrationId?: string;
  readonly suppressedRegionId?: string;
  readonly targetRegionId?: string;
  targetAttribute?: ServerDynamicAttributeV1;
  valueCaptureId?: string;
}

const invalidPlan = (message: string): never => {
  throw new OxeServerJavaScriptReadinessError('OXE_SERVER_ASYNC_INVALID_PLAN', message);
};

const unsupported = (message: string): never => {
  throw new OxeServerJavaScriptReadinessError('OXE_SERVER_ASYNC_UNSUPPORTED', message);
};

const capabilityError = (message: string): never => {
  throw new OxeServerJavaScriptReadinessError('OXE_SERVER_ASYNC_CAPABILITY', message);
};

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const consumerKey = (consumerId: string, suffix: string): string => `${consumerId}\0${suffix}`;

const runtimeMarkerId = (templateId: string, instancePath = 'root'): string =>
  encodeURIComponent(`${templateId}@${instancePath}`);

const runtimeResourceId = (bindingId: string, instancePath = 'root'): string =>
  `${bindingId}@${instancePath}`;

const markerToken = (markerId: string): string => `\u{e000}OXE:${markerId}\u{e001}`;

const captureStartToken = (regionId: string): string =>
  `\u{e002}OXE_CAPTURE_START:${regionId}\u{e003}`;

const captureEndToken = (regionId: string): string => `\u{e004}OXE_CAPTURE_END:${regionId}\u{e005}`;

const hydrationMarkerId = (id: string): string => encodeURIComponent(id).replaceAll('-', '%2D');

const hydrationToken = (viewId: string, edge: 'end' | 'start'): string =>
  `\u{e006}OXE_HYDRATION:${hydrationMarkerId(viewId)}:${edge}\u{e007}`;

const staticText = (id: string, value: string): ServerViewV1 => ({
  id,
  kind: 'text',
  parts: [{ kind: 'static', value }],
});

const escapeSkeletonText = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const escapeSkeletonAttribute = (value: string): string =>
  escapeSkeletonText(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const skeletonVoidElements = new Set([
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

const serverSkeletonHtml = (
  plan: ServerRenderPlanV2,
  template: ServerRenderPlanV2['regions'][number],
): string | undefined => {
  if (template.kind !== 'structural') return undefined;
  const components = new Map(plan.components.map((component) => [component.id, component]));
  const views = new Map<string, ServerViewV1>();
  const visit = (view: ServerViewV1): void => {
    views.set(view.id, view);
    if (view.kind === 'element' || view.kind === 'component' || view.kind === 'context-provider') {
      view.children.forEach(visit);
    } else if (view.kind === 'choice') {
      view.branches.forEach((branch) => visit(branch.view));
    } else if (view.kind === 'collection') visit(view.row);
  };
  plan.components.forEach((component) => visit(component.boundary.root));

  const render = (view: ServerViewV1, active: ReadonlySet<string>): string => {
    if (view.kind === 'text') {
      return '████████';
    }
    if (view.kind === 'element') {
      const attributes = view.attributes
        .filter(
          (attribute) =>
            attribute.kind === 'static' &&
            ['class', 'height', 'style', 'width'].includes(attribute.name),
        )
        .map((attribute) =>
          attribute.kind === 'static'
            ? ` ${attribute.name}="${escapeSkeletonAttribute(String(attribute.value))}"`
            : '',
        )
        .join('');
      const disabled = ['button', 'input', 'select', 'textarea'].includes(view.tag)
        ? ' disabled=""'
        : '';
      const children = view.children.map((child) => render(child, active)).join('');
      if (skeletonVoidElements.has(view.tag)) return `<${view.tag}${attributes}${disabled}>`;
      return `<${view.tag}${attributes}${disabled}>${children}</${view.tag}>`;
    }
    if (view.kind === 'component') {
      if (active.has(view.componentId)) return '';
      const target = components.get(view.componentId);
      return target ? render(target.boundary.root, new Set([...active, view.componentId])) : '';
    }
    if (view.kind === 'choice') {
      const first = view.branches[0];
      return first ? render(first.view, active) : '';
    }
    if (view.kind === 'collection') return render(view.row, active);
    if (view.kind === 'context-provider') {
      return view.children.map((child) => render(child, active)).join('');
    }
    if (view.kind === 'content-slot') return '';
    return '';
  };

  const consumer = views.get(template.consumerId);
  if (!consumer) return undefined;
  const html = render(consumer, new Set());
  return /^<[a-z][a-z0-9]*(?:\s|>)/u.test(html) ? html : undefined;
};

const serializePendingRegion = (
  plan: ServerRenderPlanV2,
  template: ServerRenderPlanV2['regions'][number],
  regionId: string,
): string => {
  if (template.kind === 'text') {
    return serializeServerRegionMarker(regionId, 0, { kind: 'text' });
  }
  if (template.kind === 'structural') {
    const skeletonHtml = serverSkeletonHtml(plan, template);
    return serializeServerRegionMarker(regionId, 0, {
      kind: 'structural',
      ...(skeletonHtml ? { skeletonHtml } : {}),
    });
  }
  return serializeServerRegionMarker(regionId);
};

const blockingPlan = (
  plan: ServerRenderPlanV2,
  components: readonly ServerComponentPlanV1[],
): ServerRenderPlanV1 => ({
  capabilities: plan.capabilities,
  components,
  contexts: plan.contexts,
  entry: plan.entry,
  execution: { delivery: 'ordered-chunks', mode: 'synchronous' },
  nonRenderingWork: plan.nonRenderingWork,
  schemaVersion: 'oxe.server-render-plan.v1',
  source: plan.source,
});

const regionLookup = (
  regions: readonly ServerRenderPlanV2['regions'][number][],
): ReadonlyMap<string, ServerRenderPlanV2['regions'][number]> => {
  const result = new Map<string, ServerRenderPlanV2['regions'][number]>();
  for (const region of regions) {
    const suffix = region.id.slice(`${region.consumerId}/deferred/`.length);
    const key = consumerKey(region.consumerId, suffix);
    if (result.has(key)) invalidPlan(`Deferred consumer key "${key}" is duplicated.`);
    result.set(key, region);
  }
  return result;
};

const addMarker = (regionId: string, context: TransformContext): string => {
  const runtimeId =
    context.markerIds.get(regionId) ?? invalidPlan(`Region "${regionId}" has no runtime marker.`);
  const token = markerToken(runtimeId);
  const template =
    context.plan.regions.find((region) => region.id === regionId) ??
    invalidPlan(`Region "${regionId}" has no template.`);
  context.markers.set(token, serializePendingRegion(context.plan, template, runtimeId));
  return token;
};

const regionIsResolved = (
  region: ServerRenderPlanV2['regions'][number],
  context: TransformContext,
): boolean => region.resourceIds.every((resourceId) => context.resolvedResourceIds.has(resourceId));

const addHydrationMarker = (
  viewId: string,
  edge: 'end' | 'start',
  context: TransformContext,
): string => {
  const id = hydrationMarkerId(viewId);
  const token = hydrationToken(viewId, edge);
  context.markers.set(token, `<!--oxe:${id}:${edge}-->`);
  return token;
};

const hydrationWrapper = (view: ServerViewV1, context: TransformContext): ServerViewV1 => ({
  children: [
    staticText(`${view.id}/hydration-start`, addHydrationMarker(view.id, 'start', context)),
    transformView(view, { ...context, suppressedHydrationId: view.id }),
    staticText(`${view.id}/hydration-end`, addHydrationMarker(view.id, 'end', context)),
  ],
  contextId: `${view.id}/hydration-context`,
  id: `${view.id}/hydration-wrapper`,
  kind: 'context-provider',
  value: { kind: 'literal', value: false },
});

const structuralWrapper = (
  view: ServerViewV1,
  regionId: string,
  context: TransformContext,
): ServerViewV1 => ({
  children: [
    staticText(`${view.id}/capture-start`, context.captureStart),
    staticText(`${view.id}/hydration-start`, addHydrationMarker(view.id, 'start', context)),
    transformView(view, {
      ...context,
      suppressedHydrationId: view.id,
      suppressedRegionId: regionId,
    }),
    staticText(`${view.id}/hydration-end`, addHydrationMarker(view.id, 'end', context)),
    staticText(`${view.id}/capture-end`, context.captureEnd),
  ],
  contextId: `${view.id}/capture-context`,
  id: `${view.id}/capture-wrapper`,
  kind: 'context-provider',
  value: { kind: 'literal', value: false },
});

const transformView = (view: ServerViewV1, context: TransformContext): ServerViewV1 => {
  if (view.kind === 'text') {
    const targetIndex = view.parts.findIndex((part, index) => {
      if (part.kind !== 'expression' || !context.targetRegionId) return false;
      return (
        context.regionByConsumer.get(consumerKey(view.id, `text[${index}]`))?.id ===
        context.targetRegionId
      );
    });
    if (targetIndex >= 0) {
      const target = view.parts[targetIndex];
      if (!target || target.kind !== 'expression') {
        return invalidPlan(`Text capture "${view.id}" has no target expression.`);
      }
      return {
        ...view,
        parts: [
          { kind: 'static', value: context.captureStart },
          target,
          { kind: 'static', value: context.captureEnd },
        ],
      };
    }
    return {
      ...view,
      parts: view.parts.map((part, index) => {
        if (part.kind !== 'expression') return part;
        const region = context.regionByConsumer.get(consumerKey(view.id, `text[${index}]`));
        return region && !regionIsResolved(region, context)
          ? { kind: 'static' as const, value: addMarker(region.id, context) }
          : part;
      }),
    };
  }

  if (view.kind === 'element') {
    let target: ServerDynamicAttributeV1 | undefined;
    let targetDynamicIndex = 0;
    for (const attribute of view.attributes) {
      if (attribute.kind !== 'dynamic') continue;
      const region = context.regionByConsumer.get(
        consumerKey(view.id, `attribute[${targetDynamicIndex}]/${attribute.name}`),
      );
      if (context.targetRegionId && region?.id === context.targetRegionId) target = attribute;
      targetDynamicIndex += 1;
    }
    if (target?.kind === 'dynamic') {
      const captureId = `${view.id}/attribute-capture`;
      context.targetAttribute = target;
      context.valueCaptureId = captureId;
      return { id: captureId, kind: 'value-capture', value: target.value };
    }

    const attributeMarkers: string[] = [];
    const attributes: (typeof view.attributes)[number][] = [];
    let dynamicIndex = 0;
    view.attributes.forEach((attribute) => {
      if (attribute.kind !== 'dynamic') {
        attributes.push(attribute);
        return;
      }
      const region = context.regionByConsumer.get(
        consumerKey(view.id, `attribute[${dynamicIndex}]/${attribute.name}`),
      );
      dynamicIndex += 1;
      if (!region) {
        attributes.push(attribute);
        return;
      }
      if (regionIsResolved(region, context)) {
        attributes.push(attribute);
        return;
      }
      attributeMarkers.push(
        context.markerIds.get(region.id) ??
          invalidPlan(`Attribute region "${region.id}" has no runtime marker.`),
      );
    });
    if (attributeMarkers.length > 0) {
      if (
        attributes.some(
          (attribute) =>
            attribute.name === 'data-oxe-attr-region' || attribute.name === 'data-oxe-token',
        )
      ) {
        return invalidPlan(
          `Element "${view.id}" conflicts with compiler-owned deferred marker attributes.`,
        );
      }
      attributes.push(
        {
          kind: 'static',
          name: 'data-oxe-attr-region',
          value: attributeMarkers.join(' '),
        },
        { kind: 'static', name: 'data-oxe-token', value: 0 },
        { kind: 'static', name: 'data-oxe-pending', value: true },
      );
      if (!attributes.some((attribute) => attribute.name === 'aria-busy')) {
        attributes.push({ kind: 'static', name: 'aria-busy', value: 'true' });
      }
    }
    return {
      ...view,
      attributes,
      children: view.children.map((child) => transformView(child, context)),
    };
  }

  if (view.kind === 'component') {
    return { ...view, children: view.children.map((child) => transformView(child, context)) };
  }

  if (view.kind === 'choice') {
    const region = context.regionByConsumer.get(consumerKey(view.id, 'structure'));
    if (region && region.id !== context.suppressedRegionId) {
      if (region.id === context.targetRegionId) {
        return structuralWrapper(view, region.id, context);
      }
      if (!regionIsResolved(region, context)) {
        return staticText(`${view.id}/marker`, addMarker(region.id, context));
      }
    }
    if (context.suppressedHydrationId !== view.id) return hydrationWrapper(view, context);
    return {
      ...view,
      branches: view.branches.map((branch) => ({
        ...branch,
        view: transformView(branch.view, context),
      })),
    };
  }

  if (view.kind === 'collection') {
    const region = context.regionByConsumer.get(consumerKey(view.id, 'structure'));
    if (region && region.id !== context.suppressedRegionId) {
      if (region.id === context.targetRegionId) {
        return structuralWrapper(view, region.id, context);
      }
      if (!regionIsResolved(region, context)) {
        return staticText(`${view.id}/marker`, addMarker(region.id, context));
      }
    }
    if (context.suppressedHydrationId !== view.id) return hydrationWrapper(view, context);
    return { ...view, row: transformView(view.row, context) };
  }

  if (view.kind === 'context-provider') {
    const region = context.regionByConsumer.get(consumerKey(view.id, 'structure'));
    if (region && region.id !== context.suppressedRegionId) {
      if (region.id === context.targetRegionId) {
        return structuralWrapper(view, region.id, context);
      }
      if (!regionIsResolved(region, context)) {
        return staticText(`${view.id}/marker`, addMarker(region.id, context));
      }
    }
    return { ...view, children: view.children.map((child) => transformView(child, context)) };
  }

  return view;
};

const transformPlan = (
  plan: ServerRenderPlanV2,
  markerIds: ReadonlyMap<string, string>,
  targetRegionId?: string,
  resolvedResourceIds: ReadonlySet<string> = new Set(),
): MarkerTransform => {
  const captureStart = captureStartToken(targetRegionId ?? 'shell');
  const captureEnd = captureEndToken(targetRegionId ?? 'shell');
  const context: TransformContext = {
    captureEnd,
    captureStart,
    markerIds,
    markers: new Map(),
    plan,
    regionByConsumer: regionLookup(plan.regions),
    resolvedResourceIds,
    ...(targetRegionId ? { targetRegionId } : {}),
  };
  const components = plan.components.map((component) => ({
    ...component,
    boundary: {
      ...component.boundary,
      root: transformView(component.boundary.root, context),
    },
  }));
  return {
    markers: context.markers,
    plan: blockingPlan(plan, components),
    ...(context.targetAttribute ? { targetAttribute: context.targetAttribute } : {}),
    ...(context.valueCaptureId ? { valueCaptureId: context.valueCaptureId } : {}),
  };
};

const expandMarkers = (html: string, markers: ReadonlyMap<string, string>): string => {
  let expanded = html;
  for (const [token, marker] of markers) expanded = expanded.replaceAll(token, marker);
  return expanded;
};

const extractCapture = (html: string, regionId: string): string => {
  const start = captureStartToken(regionId);
  const end = captureEndToken(regionId);
  const startIndex = html.indexOf(start);
  const endIndex = html.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    return unsupported(`Deferred region "${regionId}" was not instantiated by the entry tree.`);
  }
  if (html.indexOf(start, startIndex + start.length) >= 0) {
    return unsupported(
      `Deferred region "${regionId}" has multiple runtime instances; keyed instance expansion is the next reference-adapter slice.`,
    );
  }
  return html.slice(startIndex + start.length, endIndex);
};

const createRuntimeInstances = (): RuntimeInstances => ({
  components: new Map(),
  markerExpansions: new Map(),
  regions: new Map(),
  resourceArguments: new Map(),
});

const recordResourceArguments = (
  instances: RuntimeInstances,
  bindingId: string,
  arguments_: readonly unknown[],
  location: ServerRenderLocation,
): void => {
  const runtimeId = runtimeResourceId(bindingId, location.componentInstancePath);
  const existing = instances.resourceArguments.get(runtimeId);
  if (existing) {
    invalidPlan(`Runtime async resource "${runtimeId}" was captured more than once.`);
  }
  instances.resourceArguments.set(runtimeId, {
    arguments: arguments_,
    bindingId,
    instancePath: location.componentInstancePath,
  });
};

const recordComponentInstance = (
  instances: RuntimeInstances,
  location: ServerRenderLocation,
): void => {
  const existing = instances.components.get(location.componentInstancePath);
  if (existing && existing.componentId !== location.componentId) {
    invalidPlan(
      `Runtime component path "${location.componentInstancePath}" maps to multiple templates.`,
    );
  }
  instances.components.set(location.componentInstancePath, {
    componentId: location.componentId,
    instancePath: location.componentInstancePath,
    ...(location.invocationId ? { invocationId: location.invocationId } : {}),
    ...(location.parentComponentInstancePath
      ? { parentInstancePath: location.parentComponentInstancePath }
      : {}),
  });
};

const recordRegionInstance = (
  template: ServerRenderPlanV2['regions'][number],
  location: ServerRenderLocation,
  instances: RuntimeInstances,
): RegionInstance => {
  const id = runtimeMarkerId(template.id, location.instancePath);
  const existing = instances.regions.get(id);
  if (existing && existing.template.id !== template.id) {
    invalidPlan(`Runtime region marker "${id}" maps to multiple templates.`);
  }
  const instance = { id, location, template } satisfies RegionInstance;
  instances.regions.set(id, instance);
  return instance;
};

const instantiateTransformedText = (
  value: string,
  location: ServerRenderLocation,
  plan: ServerRenderPlanV2,
  markerIds: ReadonlyMap<string, string>,
  instances: RuntimeInstances,
  targetRegionId?: string,
): string => {
  let transformed = value;
  for (const template of plan.regions) {
    const rootId =
      markerIds.get(template.id) ?? invalidPlan(`Region "${template.id}" has no root marker.`);
    const rootToken = markerToken(rootId);
    if (!transformed.includes(rootToken)) continue;
    const { id } = recordRegionInstance(template, location, instances);
    const token = markerToken(id);
    instances.markerExpansions.set(token, serializePendingRegion(plan, template, id));
    transformed = transformed.replaceAll(rootToken, token);
  }
  if (targetRegionId) {
    transformed = transformed
      .replaceAll(
        captureStartToken(targetRegionId),
        captureStartToken(runtimeMarkerId(targetRegionId, location.instancePath)),
      )
      .replaceAll(
        captureEndToken(targetRegionId),
        captureEndToken(runtimeMarkerId(targetRegionId, location.instancePath)),
      );
  }
  return transformed;
};

const instantiateTransformedAttribute = (
  name: string,
  value: boolean | number | string,
  location: ServerRenderLocation,
  plan: ServerRenderPlanV2,
  markerIds: ReadonlyMap<string, string>,
  instances: RuntimeInstances,
): boolean | number | string => {
  if (name !== 'data-oxe-attr-region' || typeof value !== 'string') return value;
  const templatesByRootId = new Map(
    plan.regions.map((template) => {
      const rootId =
        markerIds.get(template.id) ?? invalidPlan(`Region "${template.id}" has no root marker.`);
      return [rootId, template] as const;
    }),
  );
  return value
    .split(' ')
    .map((rootId) => {
      const template =
        templatesByRootId.get(rootId) ??
        invalidPlan(`Deferred attribute marker "${rootId}" has no region template.`);
      return recordRegionInstance(template, location, instances).id;
    })
    .join(' ');
};

const nearestComponentInstance = (
  instances: RuntimeInstances,
  startPath: string,
  componentId: string,
): ComponentInstance | undefined => {
  let path: string | undefined = startPath;
  while (path) {
    const instance = instances.components.get(path);
    if (!instance) return undefined;
    if (instance.componentId === componentId) return instance;
    path = instance.parentInstancePath;
  }
  return undefined;
};

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' &&
  value !== null &&
  'then' in value &&
  typeof value.then === 'function';

const syncCapability =
  (
    options: ServerJavaScriptReadinessOptions,
    signal: AbortSignal,
  ): ((capability: ServerCapabilityPlanV1, arguments_: readonly unknown[]) => unknown) =>
  (capability, arguments_) => {
    const value = options.callCapability(capability, arguments_, signal);
    if (isPromiseLike(value)) {
      return unsupported(
        `Pure capability "${capability.path.join('.')}" returned a promise during synchronous plan preparation.`,
      );
    }
    return value;
  };

const asyncBindingTemplates = (
  plan: ServerRenderPlanV2,
): ReadonlyMap<string, AsyncBindingTemplate> => {
  const capabilities = new Map(plan.capabilities.map((capability) => [capability.id, capability]));
  const result = new Map<string, AsyncBindingTemplate>();
  for (const component of plan.components) {
    for (const binding of component.bindings) {
      if (binding.kind !== 'async-resource') continue;
      const expression = binding.expression;
      if (expression.kind !== 'call') {
        return unsupported(`Async binding "${binding.id}" must be a direct capability call.`);
      }
      const callee = expression.callee;
      if (callee.kind !== 'capability') {
        return unsupported(`Async binding "${binding.id}" must be a direct capability call.`);
      }
      const capability =
        capabilities.get(callee.targetId) ??
        invalidPlan(`Async binding "${binding.id}" has no capability contract.`);
      if (capability.capabilityKind !== 'async') {
        invalidPlan(`Async binding "${binding.id}" references a non-async capability.`);
      }
      if (capability.target === 'client') {
        capabilityError(
          `Client-only async capability "${capability.path.join('.')}" cannot execute during SSR.`,
        );
      }
      result.set(binding.id, {
        binding,
        capability,
        componentId: component.id,
      });
    }
  }
  return result;
};

const resourceTemplates = (
  needed: ReadonlyMap<string, { readonly bindingId: string; readonly instancePath: string }>,
  bindings: ReadonlyMap<string, AsyncBindingTemplate>,
  instances: RuntimeInstances,
): ReadonlyMap<string, ResourceTemplate> => {
  const result = new Map<string, ResourceTemplate>();
  for (const [runtimeId, request] of needed) {
    const template =
      bindings.get(request.bindingId) ??
      invalidPlan(`Runtime resource "${runtimeId}" has no async binding template.`);
    const captured =
      instances.resourceArguments.get(runtimeId) ??
      unsupported(
        `Async binding "${request.bindingId}" was not instantiated at component path "${request.instancePath}".`,
      );
    result.set(runtimeId, {
      arguments: captured.arguments,
      binding: template.binding,
      capability: template.capability,
      componentId: template.componentId,
      instancePath: request.instancePath,
      runtimeId,
      statusGate: false,
    });
  }
  return result;
};

const deferredRequest = (
  arguments_: readonly unknown[],
  capability: ServerCapabilityPlanV1,
  scope: string,
  options: ServerJavaScriptReadinessOptions,
): ServerDeferredResourceRequestV2 => ({
  identity: asyncResourceIdentity(capability.path.join('.'), arguments_, scope),
  load: (signal) => options.callCapability(capability, arguments_, signal),
});

const deferredResource = (
  runtimeId: string,
  arguments_: readonly unknown[],
  capability: ServerCapabilityPlanV1,
  scope: string,
  options: ServerJavaScriptReadinessOptions,
): ServerDeferredResourceV2 => ({
  id: runtimeId,
  ...deferredRequest(arguments_, capability, scope, options),
});

const normalizePatchValue = (
  value: unknown,
  regionId: string,
): Extract<ServerStreamPatch, { readonly kind: 'attribute' }>['value'] => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  return unsupported(`Attribute region "${regionId}" produced a non-DOM value.`);
};

interface RuntimeResourceReference {
  readonly bindingId: string;
  readonly instancePath: string;
  readonly runtimeId: string;
}

const visitServerExpression = (
  expression: ServerExpressionV1,
  visitRead: (targetId: string) => void,
): void => {
  const visit = (value: ServerExpressionV1): void => visitServerExpression(value, visitRead);
  switch (expression.kind) {
    case 'array':
      expression.elements.forEach(visit);
      return;
    case 'binary':
      visit(expression.left);
      visit(expression.right);
      return;
    case 'call':
      visit(expression.callee);
      expression.arguments.forEach(visit);
      return;
    case 'collection':
      visit(expression.source);
      visit(expression.callback.result);
      if (expression.initial) visit(expression.initial);
      if (expression.options) visit(expression.options);
      return;
    case 'conditional':
      expression.branches.forEach((branch) => {
        if (branch.condition) visit(branch.condition);
        visit(branch.result);
      });
      return;
    case 'member':
      visit(expression.object);
      return;
    case 'record':
      expression.entries.forEach((entry) => visit(entry.value));
      return;
    case 'read': {
      visitRead(expression.targetId);
      return;
    }
    case 'capability':
    case 'literal':
    case 'local':
      return;
  }
};

interface ServerPlanIndexes {
  readonly bindings: ReadonlyMap<string, ServerBindingV1>;
  readonly components: ReadonlyMap<string, ServerComponentPlanV1>;
  readonly parameters: ReadonlyMap<string, ServerComponentPlanV1['parameters'][number]>;
  readonly views: ReadonlyMap<string, ServerViewV1>;
}

const indexServerPlan = (plan: ServerRenderPlanV2): ServerPlanIndexes => {
  const views = new Map<string, ServerViewV1>();
  const visitView = (view: ServerViewV1): void => {
    views.set(view.id, view);
    if (view.kind === 'element' || view.kind === 'component' || view.kind === 'context-provider') {
      view.children.forEach(visitView);
    } else if (view.kind === 'choice') {
      view.branches.forEach((branch) => visitView(branch.view));
    } else if (view.kind === 'collection') {
      visitView(view.row);
    }
  };
  plan.components.forEach((component) => visitView(component.boundary.root));
  return {
    bindings: new Map(
      plan.components.flatMap((component) =>
        component.bindings.map((binding) => [binding.id, binding] as const),
      ),
    ),
    components: new Map(plan.components.map((component) => [component.id, component])),
    parameters: new Map(
      plan.components.flatMap((component) =>
        component.parameters.map((parameter) => [parameter.id, parameter] as const),
      ),
    ),
    views,
  };
};

const runtimeDependenciesForBinding = (
  binding: Extract<ServerBindingV1, { readonly kind: 'async-resource' }>,
  instancePath: string,
  instances: RuntimeInstances,
  indexes: ServerPlanIndexes,
): readonly RuntimeResourceReference[] => {
  const result = new Map<string, RuntimeResourceReference>();
  const visited = new Set<string>();
  const visit = (expression: ServerExpressionV1, currentInstancePath: string): void => {
    visitServerExpression(expression, (targetId) => {
      const visitId = `${targetId}@${currentInstancePath}`;
      if (visited.has(visitId)) return;
      visited.add(visitId);

      const targetBinding = indexes.bindings.get(targetId);
      if (targetBinding) {
        if (targetBinding.kind === 'async-resource') {
          const runtimeId = runtimeResourceId(targetBinding.id, currentInstancePath);
          result.set(runtimeId, {
            bindingId: targetBinding.id,
            instancePath: currentInstancePath,
            runtimeId,
          });
        } else if (targetBinding.kind === 'computed') {
          visit(targetBinding.expression, currentInstancePath);
        } else if (targetBinding.kind === 'state') {
          visit(targetBinding.initial, currentInstancePath);
        }
        return;
      }

      const parameter = indexes.parameters.get(targetId);
      if (!parameter) return;
      const instance =
        instances.components.get(currentInstancePath) ??
        invalidPlan(`Component instance "${currentInstancePath}" is not registered.`);
      if (!instance.parentInstancePath || !instance.invocationId) {
        if (parameter.kind === 'value' && parameter.default) {
          visit(parameter.default, currentInstancePath);
        }
        return;
      }
      const invocation = indexes.views.get(instance.invocationId);
      if (!invocation || invocation.kind !== 'component') {
        return invalidPlan(`Component instance "${currentInstancePath}" has no invocation view.`);
      }
      const prop = invocation.props.find(
        (candidate) => candidate.kind === 'value' && candidate.parameterId === parameter.id,
      );
      if (prop?.kind === 'value') {
        visit(prop.value, instance.parentInstancePath);
      } else if (parameter.kind === 'value' && parameter.default) {
        visit(parameter.default, currentInstancePath);
      }
    });
  };

  if (binding.expression.kind === 'call') {
    binding.expression.arguments.forEach((argument) => visit(argument, instancePath));
  }
  result.delete(runtimeResourceId(binding.id, instancePath));
  return [...result.values()].sort((left, right) => compareText(left.runtimeId, right.runtimeId));
};

const resourceReferencesForRegion = (
  region: RegionInstance,
  instances: RuntimeInstances,
  bindings: ReadonlyMap<string, AsyncBindingTemplate>,
): readonly RuntimeResourceReference[] =>
  region.template.resourceIds.map((bindingId) => {
    const binding =
      bindings.get(bindingId) ??
      invalidPlan(`Deferred region "${region.id}" references unknown resource "${bindingId}".`);
    const owner =
      nearestComponentInstance(
        instances,
        region.location.componentInstancePath,
        binding.componentId,
      ) ??
      invalidPlan(
        `Deferred region "${region.id}" cannot find an owning instance for resource "${bindingId}".`,
      );
    return {
      bindingId,
      instancePath: owner.instancePath,
      runtimeId: runtimeResourceId(bindingId, owner.instancePath),
    };
  });

const captureDependentResourceRequest = (
  plan: ServerRenderPlanV2,
  markerIds: ReadonlyMap<string, string>,
  target: ResourceTemplate,
  dependencies: readonly RuntimeResourceReference[],
  bindings: ReadonlyMap<string, AsyncBindingTemplate>,
  values: ReadonlyMap<string, unknown>,
  scope: string,
  options: ServerJavaScriptReadinessOptions,
  signal: AbortSignal,
): ServerDeferredResourceRequestV2 => {
  const transformed = transformPlan(
    plan,
    markerIds,
    undefined,
    new Set(dependencies.map((dependency) => dependency.bindingId)),
  );
  const instances = createRuntimeInstances();
  const dependenciesByBinding = new Map<string, RuntimeResourceReference[]>();
  for (const dependency of dependencies) {
    const current = dependenciesByBinding.get(dependency.bindingId) ?? [];
    current.push(dependency);
    dependenciesByBinding.set(dependency.bindingId, current);
  }
  renderToString(transformed.plan, {
    callCapability: syncCapability(options, signal),
    captureAsyncResource: (bindingId, arguments_, location) =>
      recordResourceArguments(instances, bindingId, arguments_, location),
    onComponentInstance: (location) => recordComponentInstance(instances, location),
    resolveResourceValue: (bindingId, location) => {
      const binding = bindings.get(bindingId);
      if (!binding) return { found: false };
      const owner = nearestComponentInstance(
        instances,
        location.componentInstancePath,
        binding.componentId,
      );
      const dependency = dependenciesByBinding
        .get(bindingId)
        ?.find((candidate) => candidate.instancePath === owner?.instancePath);
      return dependency
        ? { found: true, value: values.get(dependency.runtimeId) }
        : { found: false };
    },
    tolerateUnresolvedAsyncResources: true,
  });
  const captured =
    instances.resourceArguments.get(target.runtimeId) ??
    unsupported(
      `Dependent async resource "${target.runtimeId}" was not instantiated after its dependencies resolved.`,
    );
  return deferredRequest(captured.arguments, target.capability, scope, options);
};

const renderPreparedRegion = (
  plan: ServerRenderPlanV2,
  prepared: ServerPreparedRegionV2,
  instance: RegionInstance,
  markerIds: ReadonlyMap<string, string>,
  references: readonly RuntimeResourceReference[],
  bindings: ReadonlyMap<string, AsyncBindingTemplate>,
  knownRegionIds: Set<string>,
  knownResourceIds: Set<string>,
  scope: string,
  resources: ReadonlyMap<string, unknown>,
  options: ServerJavaScriptReadinessOptions,
  signal: AbortSignal,
): ServerDeferredRegionOutput => {
  const transformed = transformPlan(
    plan,
    markerIds,
    prepared.template.id,
    new Set(references.map((reference) => reference.bindingId)),
  );
  const runtimeInstances = createRuntimeInstances();
  const referencesByBinding = new Map<string, RuntimeResourceReference[]>();
  for (const reference of references) {
    const current = referencesByBinding.get(reference.bindingId) ?? [];
    current.push(reference);
    referencesByBinding.set(reference.bindingId, current);
  }
  let capturedValue: unknown;
  let capturedValues = 0;
  const html = renderToString(transformed.plan, {
    callCapability: syncCapability(options, signal),
    captureAsyncResource: (bindingId, arguments_, location) =>
      recordResourceArguments(runtimeInstances, bindingId, arguments_, location),
    captureValue: (id, value, location) => {
      if (
        id === transformed.valueCaptureId &&
        location.instancePath === instance.location.instancePath
      ) {
        capturedValue = value;
        capturedValues += 1;
      }
    },
    onComponentInstance: (location) => recordComponentInstance(runtimeInstances, location),
    resolveResourceValue: (bindingId, location) => {
      const binding = bindings.get(bindingId);
      if (!binding) return { found: false };
      const owner = nearestComponentInstance(
        runtimeInstances,
        location.componentInstancePath,
        binding.componentId,
      );
      const reference = referencesByBinding
        .get(bindingId)
        ?.find((candidate) => candidate.instancePath === owner?.instancePath);
      return reference
        ? { found: true, value: resources.get(reference.runtimeId) }
        : { found: false };
    },
    tolerateUnresolvedAsyncResources: true,
    transformStaticAttribute: (name, value, location) =>
      instantiateTransformedAttribute(name, value, location, plan, markerIds, runtimeInstances),
    transformStaticText: (value, location) =>
      instantiateTransformedText(
        value,
        location,
        plan,
        markerIds,
        runtimeInstances,
        prepared.template.id,
      ),
  });

  if (prepared.template.kind === 'attribute') {
    const attribute =
      transformed.targetAttribute ??
      invalidPlan(`Attribute region "${prepared.template.id}" has no dynamic attribute.`);
    if (capturedValues !== 1) {
      unsupported(
        `Attribute region "${prepared.template.id}" expected one runtime instance, received ${capturedValues}.`,
      );
    }
    return {
      kind: 'attribute',
      mode: attribute.mode,
      name: attribute.name,
      regionId: prepared.id,
      token: 1,
      value: normalizePatchValue(capturedValue, prepared.id),
    };
  }

  const captured = extractCapture(html, prepared.id);
  const expansions = new Map([...transformed.markers, ...runtimeInstances.markerExpansions]);
  const patch = {
    html: expandMarkers(captured, expansions),
    kind: 'replace' as const,
    regionId: prepared.id,
    token: 1,
  };
  const nestedInstances = [...runtimeInstances.regions.values()].filter(
    (nested) =>
      !knownRegionIds.has(nested.id) &&
      (captured.includes(markerToken(nested.id)) || captured.includes(nested.id)),
  );
  if (nestedInstances.length === 0) return patch;

  const nestedResources: ServerDeferredResourceV2[] = [];
  const nestedRegions: ServerPreparedRegionV2[] = [];
  const indexes = indexServerPlan(plan);
  for (const nested of nestedInstances) {
    const directReferences = resourceReferencesForRegion(nested, runtimeInstances, bindings);
    const nestedReferenceMap = new Map(
      [...references, ...directReferences].map((reference) => [reference.runtimeId, reference]),
    );
    const pendingReferences = [...directReferences];
    for (let index = 0; index < pendingReferences.length; index += 1) {
      const reference = pendingReferences[index];
      if (!reference) continue;
      const binding =
        bindings.get(reference.bindingId) ??
        invalidPlan(`Nested async resource "${reference.runtimeId}" has no binding template.`);
      for (const dependency of runtimeDependenciesForBinding(
        binding.binding,
        reference.instancePath,
        runtimeInstances,
        indexes,
      )) {
        if (nestedReferenceMap.has(dependency.runtimeId)) continue;
        nestedReferenceMap.set(dependency.runtimeId, dependency);
        pendingReferences.push(dependency);
      }
    }
    const nestedReferences = [...nestedReferenceMap.values()];
    const dependenciesByRuntimeId = new Map(
      nestedReferences.map((reference) => {
        const binding =
          bindings.get(reference.bindingId) ??
          invalidPlan(`Nested async resource "${reference.runtimeId}" has no binding template.`);
        return [
          reference.runtimeId,
          runtimeDependenciesForBinding(
            binding.binding,
            reference.instancePath,
            runtimeInstances,
            indexes,
          ),
        ] as const;
      }),
    );
    const newReferences = nestedReferences.filter(
      (reference) => !knownResourceIds.has(reference.runtimeId),
    );
    const orderedReferences: RuntimeResourceReference[] = [];
    const visitState = new Map<string, 'done' | 'visiting'>();
    const visitReference = (reference: RuntimeResourceReference): void => {
      if (visitState.get(reference.runtimeId) === 'done') return;
      if (visitState.get(reference.runtimeId) === 'visiting') {
        invalidPlan(`Nested async dependencies cycle through "${reference.runtimeId}".`);
      }
      visitState.set(reference.runtimeId, 'visiting');
      for (const dependency of dependenciesByRuntimeId.get(reference.runtimeId) ?? []) {
        if (knownResourceIds.has(dependency.runtimeId)) continue;
        const dependencyReference = nestedReferenceMap.get(dependency.runtimeId);
        if (dependencyReference) visitReference(dependencyReference);
      }
      orderedReferences.push(reference);
      visitState.set(reference.runtimeId, 'done');
    };
    newReferences.forEach(visitReference);
    for (const reference of orderedReferences) {
      const capturedArguments =
        runtimeInstances.resourceArguments.get(reference.runtimeId) ??
        unsupported(
          `Nested async resource "${reference.runtimeId}" was revealed without captured arguments.`,
        );
      const binding =
        bindings.get(reference.bindingId) ??
        invalidPlan(`Nested async resource "${reference.runtimeId}" has no binding template.`);
      const dependencies = dependenciesByRuntimeId.get(reference.runtimeId) ?? [];
      if (dependencies.length === 0) {
        nestedResources.push(
          deferredResource(
            reference.runtimeId,
            capturedArguments.arguments,
            binding.capability,
            scope,
            options,
          ),
        );
      } else {
        const preparationDependencies = [...dependencies, ...references].filter(
          (dependency, index, all) =>
            dependency.runtimeId !== reference.runtimeId &&
            all.findIndex((candidate) => candidate.runtimeId === dependency.runtimeId) === index,
        );
        const target: ResourceTemplate = {
          arguments: capturedArguments.arguments,
          binding: binding.binding,
          capability: binding.capability,
          componentId: binding.componentId,
          instancePath: reference.instancePath,
          runtimeId: reference.runtimeId,
          statusGate: false,
        };
        nestedResources.push({
          id: reference.runtimeId,
          prepare: (values, prepareSignal) =>
            captureDependentResourceRequest(
              plan,
              markerIds,
              target,
              preparationDependencies,
              bindings,
              values,
              scope,
              options,
              prepareSignal,
            ),
          resourceIds: preparationDependencies.map((dependency) => dependency.runtimeId),
        });
      }
      knownResourceIds.add(reference.runtimeId);
    }
    const nestedPrepared: ServerPreparedRegionV2 = {
      id: nested.id,
      render: (nestedValues, nestedSignal) =>
        renderPreparedRegion(
          plan,
          nestedPrepared,
          nested,
          markerIds,
          nestedReferences,
          bindings,
          knownRegionIds,
          knownResourceIds,
          scope,
          nestedValues,
          options,
          nestedSignal,
        ),
      resourceIds: nestedReferences.map((reference) => reference.runtimeId),
      template: nested.template,
    };
    nestedRegions.push(nestedPrepared);
    knownRegionIds.add(nested.id);
  }
  return {
    kind: 'expansion',
    patches: [patch],
    regions: nestedRegions,
    resources: nestedResources,
  };
};

/** Instantiates compiler templates into request-local component and keyed-row paths. */
export const createJavaScriptReadinessAdapter = (
  options: ServerJavaScriptReadinessOptions,
): ServerReadinessAdapter => ({
  prepare: (plan, signal): ServerReadinessPreparation => {
    const markerIds = new Map(
      plan.regions.map((region) => [region.id, runtimeMarkerId(region.id)] as const),
    );
    const transformedShell = transformPlan(plan, markerIds);
    const shellInstances = createRuntimeInstances();
    const shell = expandMarkers(
      renderToString(transformedShell.plan, {
        callCapability: syncCapability(options, signal),
        captureAsyncResource: (bindingId, arguments_, location) =>
          recordResourceArguments(shellInstances, bindingId, arguments_, location),
        onComponentInstance: (location) => recordComponentInstance(shellInstances, location),
        tolerateUnresolvedAsyncResources: true,
        transformStaticAttribute: (name, value, location) =>
          instantiateTransformedAttribute(name, value, location, plan, markerIds, shellInstances),
        transformStaticText: (value, location) =>
          instantiateTransformedText(value, location, plan, markerIds, shellInstances),
      }),
      new Map([...transformedShell.markers, ...shellInstances.markerExpansions]),
    );
    const bindings = asyncBindingTemplates(plan);
    const indexes = indexServerPlan(plan);
    const activeRegions = [...shellInstances.regions.values()];
    const referencesByRegion = new Map<string, readonly RuntimeResourceReference[]>();
    const neededResources = new Map<
      string,
      { readonly bindingId: string; readonly instancePath: string }
    >();
    for (const instance of activeRegions) {
      const references = resourceReferencesForRegion(instance, shellInstances, bindings);
      referencesByRegion.set(instance.id, references);
      for (const reference of references) {
        neededResources.set(reference.runtimeId, {
          bindingId: reference.bindingId,
          instancePath: reference.instancePath,
        });
      }
    }
    const pendingResources = [...neededResources.values()];
    for (let index = 0; index < pendingResources.length; index += 1) {
      const request = pendingResources[index];
      if (!request) continue;
      const binding =
        bindings.get(request.bindingId) ??
        invalidPlan(`Runtime resource "${request.bindingId}" has no async binding template.`);
      for (const dependency of runtimeDependenciesForBinding(
        binding.binding,
        request.instancePath,
        shellInstances,
        indexes,
      )) {
        if (neededResources.has(dependency.runtimeId)) continue;
        const needed = {
          bindingId: dependency.bindingId,
          instancePath: dependency.instancePath,
        };
        neededResources.set(dependency.runtimeId, needed);
        pendingResources.push(needed);
      }
    }
    const templates = resourceTemplates(neededResources, bindings, shellInstances);
    const scope = options.scope ?? 'default';
    const dependenciesByResource = new Map<string, readonly RuntimeResourceReference[]>();
    for (const template of templates.values()) {
      const dependencies = runtimeDependenciesForBinding(
        template.binding,
        template.instancePath,
        shellInstances,
        indexes,
      );
      dependenciesByResource.set(template.runtimeId, dependencies);
    }
    const inferredStatusResources = new Set(
      activeRegions
        .filter((region) => region.template.statusGate)
        .flatMap((region) => referencesByRegion.get(region.id) ?? [])
        .map((reference) => reference.runtimeId),
    );
    for (const template of templates.values()) {
      const component =
        indexes.components.get(template.componentId) ??
        invalidPlan(`Async binding "${template.binding.id}" has no component plan.`);
      const inferred = inferredStatusResources.has(template.runtimeId);
      template.statusGate =
        inferred ||
        Boolean(
          options.statusGate?.({
            binding: template.binding,
            capability: template.capability,
            component,
            inferred,
          }),
        );
    }
    let changedStatusGate = true;
    while (changedStatusGate) {
      changedStatusGate = false;
      for (const template of templates.values()) {
        if (!template.statusGate) continue;
        for (const dependency of dependenciesByResource.get(template.runtimeId) ?? []) {
          const dependencyTemplate = templates.get(dependency.runtimeId);
          if (dependencyTemplate && !dependencyTemplate.statusGate) {
            dependencyTemplate.statusGate = true;
            changedStatusGate = true;
          }
        }
      }
    }
    const orderedTemplates: ResourceTemplate[] = [];
    const resourceVisitState = new Map<string, 'done' | 'visiting'>();
    const visitResource = (runtimeId: string): void => {
      if (resourceVisitState.get(runtimeId) === 'done') return;
      if (resourceVisitState.get(runtimeId) === 'visiting') {
        invalidPlan(`Async resource dependencies cycle through "${runtimeId}".`);
      }
      resourceVisitState.set(runtimeId, 'visiting');
      for (const dependency of dependenciesByResource.get(runtimeId) ?? []) {
        if (!templates.has(dependency.runtimeId)) {
          invalidPlan(
            `Async resource "${runtimeId}" depends on inactive resource "${dependency.runtimeId}".`,
          );
        }
        visitResource(dependency.runtimeId);
      }
      const template =
        templates.get(runtimeId) ?? invalidPlan(`Runtime resource "${runtimeId}" has no template.`);
      orderedTemplates.push(template);
      resourceVisitState.set(runtimeId, 'done');
    };
    [...templates.keys()].sort(compareText).forEach(visitResource);
    const preparedResources = orderedTemplates.map((template): ServerDeferredResourceV2 => {
      const dependencies = dependenciesByResource.get(template.runtimeId) ?? [];
      const resource: ServerDeferredResourceV2 =
        dependencies.length === 0
          ? deferredResource(
              template.runtimeId,
              template.arguments,
              template.capability,
              scope,
              options,
            )
          : {
              id: template.runtimeId,
              prepare: (values, prepareSignal) =>
                captureDependentResourceRequest(
                  plan,
                  markerIds,
                  template,
                  dependencies,
                  bindings,
                  values,
                  scope,
                  options,
                  prepareSignal,
                ),
              resourceIds: dependencies.map((dependency) => dependency.runtimeId),
              ...(template.statusGate ? { statusGate: true } : {}),
            };
      return template.statusGate && !resource.statusGate
        ? { ...resource, statusGate: true }
        : resource;
    });
    const knownRegionIds = new Set(activeRegions.map((instance) => instance.id));
    const knownResourceIds = new Set(templates.keys());
    const regions: ServerPreparedRegionV2[] = activeRegions.map((instance) => {
      const references =
        referencesByRegion.get(instance.id) ??
        invalidPlan(`Runtime region "${instance.id}" has no resource references.`);
      const prepared: ServerPreparedRegionV2 = {
        id: instance.id,
        render: (resources, renderSignal) =>
          renderPreparedRegion(
            plan,
            prepared,
            instance,
            markerIds,
            references,
            bindings,
            knownRegionIds,
            knownResourceIds,
            scope,
            resources,
            options,
            renderSignal,
          ),
        resourceIds: references.map((reference) => reference.runtimeId),
        template: instance.template,
      };
      return prepared;
    });
    return {
      regions,
      resources: preparedResources,
      shell,
    };
  },
});
