import {
  renderToString,
  renderToStringWithHydrationState,
  type ServerCapabilityPlanV1,
  type ServerRenderOptions,
  type ServerRenderPlanV1,
  type ServerViewV1,
} from '@oxe/runtime-server';

import { OxeRouterError } from './errors.js';
import { createRouteSearchRecord } from './match.js';
import { serializeRouteSnapshotData } from './snapshot.js';
import type { RouteMatch, RouteSegmentDefinitionV1, RouteSnapshot } from './types.js';

export type LoadRouteServerPlan = (
  segment: RouteSegmentDefinitionV1,
) => Promise<ServerRenderPlanV1>;

const invalidPlan = (message: string): never => {
  throw new OxeRouterError('OXE_ROUTE_INVALID_SERVER_PLAN', message);
};

const replaceContentSlot = (
  view: ServerViewV1,
  childComponentId: string,
  replacementId: string,
  count: { value: number },
): ServerViewV1 => {
  if (view.kind === 'content-slot') {
    count.value += 1;
    return {
      children: [],
      componentId: childComponentId,
      id: replacementId,
      kind: 'component',
      props: [],
    };
  }
  if (view.kind === 'element' || view.kind === 'component' || view.kind === 'context-provider') {
    return {
      ...view,
      children: view.children.map((child, index) =>
        replaceContentSlot(child, childComponentId, `${replacementId}/${index}`, count),
      ),
    };
  }
  if (view.kind === 'choice') {
    return {
      ...view,
      branches: view.branches.map((branch, index) => ({
        ...branch,
        view: replaceContentSlot(
          branch.view,
          childComponentId,
          `${replacementId}/branch[${index}]`,
          count,
        ),
      })),
    };
  }
  if (view.kind === 'collection') {
    return {
      ...view,
      row: replaceContentSlot(view.row, childComponentId, `${replacementId}/row`, count),
    };
  }
  return view;
};

const uniqueById = <Value extends { readonly id: string }>(
  values: readonly Value[],
  description: string,
): readonly Value[] => {
  const result = new Map<string, Value>();
  for (const value of values) {
    const existing = result.get(value.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(value)) {
      return invalidPlan(
        `Route server plans contain conflicting ${description} ${JSON.stringify(value.id)}.`,
      );
    }
    result.set(value.id, value);
  }
  return [...result.values()];
};

export const composeRouteServerPlan = async (
  match: RouteMatch,
  load: LoadRouteServerPlan,
): Promise<ServerRenderPlanV1> => {
  const loaded = await Promise.all(
    match.route.segments.map(async (segment) => ({ plan: await load(segment), segment })),
  );
  for (const { plan, segment } of loaded) {
    if (plan.source.moduleId !== segment.moduleId) {
      return invalidPlan(
        `Loaded server plan ${JSON.stringify(plan.source.moduleId)} for route segment ${JSON.stringify(segment.moduleId)}.`,
      );
    }
  }
  const leaf = loaded.at(-1);
  if (!leaf) return invalidPlan(`Route ${JSON.stringify(match.route.id)} has no server segments.`);
  let composed = leaf.plan;
  for (const { plan, segment } of loaded.slice(0, -1).reverse()) {
    if (segment.kind !== 'layout') {
      return invalidPlan(`Only layouts may precede the leaf page in a route server plan.`);
    }
    const entry = plan.components.find((component) => component.id === plan.entry.componentId);
    if (!entry)
      return invalidPlan(`Layout plan ${JSON.stringify(segment.id)} has no entry component.`);
    const count = { value: 0 };
    const root = replaceContentSlot(
      entry.boundary.root,
      composed.entry.componentId,
      `${entry.id}/route-child`,
      count,
    );
    if (count.value !== 1) {
      return invalidPlan(
        `Route layout ${JSON.stringify(segment.moduleId)} must render children exactly once.`,
      );
    }
    const entryWithChild = { ...entry, boundary: { ...entry.boundary, root } };
    composed = {
      ...plan,
      capabilities: uniqueById([...plan.capabilities, ...composed.capabilities], 'capability'),
      components: uniqueById(
        [
          entryWithChild,
          ...plan.components.filter((component) => component.id !== entry.id),
          ...composed.components,
        ],
        'component',
      ),
      contexts: uniqueById([...plan.contexts, ...composed.contexts], 'context'),
      nonRenderingWork: uniqueById(
        [...plan.nonRenderingWork, ...composed.nonRenderingWork],
        'non-rendering work',
      ),
      source: {
        ...plan.source,
        buildFingerprint: `route:${match.route.segments
          .map((routeSegment) => routeSegment.id)
          .join('|')}`,
        moduleId: `route:${match.route.id}`,
      },
    };
  }
  return composed;
};

const routeCapabilityValue = (capability: ServerCapabilityPlanV1, match: RouteMatch): unknown => {
  if (capability.routeIntrinsic === 'location') return match.location;
  if (capability.routeIntrinsic === 'params') return match.params;
  if (capability.routeIntrinsic === 'search-params') {
    return createRouteSearchRecord(match.location.search);
  }
  return undefined;
};

export const routeServerRenderOptions = (
  match: RouteMatch,
  options: ServerRenderOptions = {},
): ServerRenderOptions => ({
  ...options,
  callCapability: (capability, arguments_) => {
    if (capability.routeIntrinsic) {
      const value = routeCapabilityValue(capability, match);
      if (value !== undefined) return value;
      return invalidPlan(
        `Route mutation ${JSON.stringify(capability.routeIntrinsic)} cannot execute during SSR.`,
      );
    }
    if (!options.callCapability) {
      return invalidPlan(
        `SSR requires a host resolver for capability ${JSON.stringify(capability.path.join('.'))}.`,
      );
    }
    return options.callCapability(capability, arguments_);
  },
});

export const renderRouteToString = (
  plan: ServerRenderPlanV1,
  match: RouteMatch,
  options: ServerRenderOptions = {},
): string => renderToString(plan, routeServerRenderOptions(match, options));

export const renderRouteToStringWithHydrationState = (
  plan: ServerRenderPlanV1,
  match: RouteMatch,
  options: ServerRenderOptions = {},
): string => renderToStringWithHydrationState(plan, routeServerRenderOptions(match, options));

export const serializeRouteSnapshotScript = (match: RouteMatch): string => {
  const snapshot: RouteSnapshot = { ...match, navigationId: 0 };
  return `<script type="application/json" data-oxe-route-snapshot>${serializeRouteSnapshotData(snapshot)}</script>`;
};
