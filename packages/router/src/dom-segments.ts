import { OxeRouterError, abortedNavigation } from './errors.js';
import type {
  DomRouteOutlet,
  DomRouteSegmentInstance,
  DomSegmentRendererOptions,
  LoadDomRouteSegment,
  PreparedRouteTransition,
  RouteMatch,
  RouteSnapshot,
  RouteTransition,
} from './types.js';

const parentOf = (outlet: DomRouteOutlet): Node => {
  const startParent = outlet.start.parentNode;
  if (!startParent || startParent !== outlet.end.parentNode) {
    throw new OxeRouterError(
      'OXE_ROUTE_INVALID_OUTLET',
      'A route outlet requires start and end markers with the same parent.',
    );
  }
  let current: Node | null = outlet.start;
  while (current && current !== outlet.end) current = current.nextSibling;
  if (current !== outlet.end) {
    throw new OxeRouterError(
      'OXE_ROUTE_INVALID_OUTLET',
      'A route outlet end marker must follow its start marker.',
    );
  }
  return startParent;
};

const removeOutletContents = (outlet: DomRouteOutlet): void => {
  const parent = parentOf(outlet);
  let current = outlet.start.nextSibling;
  while (current && current !== outlet.end) {
    const next = current.nextSibling;
    parent.removeChild(current);
    current = next;
  }
};

const insertOutletContents = (outlet: DomRouteOutlet, nodes: readonly ChildNode[]): void => {
  const parent = parentOf(outlet);
  for (const node of nodes) parent.insertBefore(node, outlet.end);
};

const reportErrors = (
  errors: readonly unknown[],
  handler: ((error: unknown) => void) | undefined,
) => {
  if (errors.length === 0) return;
  const error =
    errors.length === 1 ? errors[0] : new AggregateError(errors, 'Route segment disposal failed.');
  if (handler) handler(error);
  else
    queueMicrotask(() => {
      throw error;
    });
};

export const createDomRouteOutlet = (document: Document, name = 'route'): DomRouteOutlet =>
  Object.freeze({
    end: document.createComment(`oxe:${name}:end`),
    start: document.createComment(`oxe:${name}:start`),
  });

export const appendDomRouteOutlet = (parent: Node, outlet: DomRouteOutlet): void => {
  parent.appendChild(outlet.start);
  parent.appendChild(outlet.end);
};

interface ActiveSegment {
  readonly id: string;
  readonly instance: DomRouteSegmentInstance;
}

export const createDomSegmentTransition = (
  container: Node,
  load: LoadDomRouteSegment,
  options: DomSegmentRendererOptions = {},
): RouteTransition & { dispose(): void; readonly outlet: DomRouteOutlet } => {
  const document = container.ownerDocument;
  if (!document) {
    throw new OxeRouterError(
      'OXE_ROUTE_INVALID_OUTLET',
      'The route container must have an ownerDocument.',
    );
  }
  const outlet = createDomRouteOutlet(document, 'root-route');
  const first = container.firstChild;
  container.insertBefore(outlet.start, first);
  container.appendChild(outlet.end);
  let active: readonly ActiveSegment[] = [];
  let disposed = false;

  const disposeInstances = (segments: readonly ActiveSegment[]): void => {
    const errors: unknown[] = [];
    for (const segment of [...segments].reverse()) {
      try {
        segment.instance.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    reportErrors(errors, options.onError);
  };

  return {
    outlet,
    prepare: async (match: RouteMatch, signal: AbortSignal): Promise<PreparedRouteTransition> => {
      if (disposed) throw abortedNavigation();
      const target = match.route.segments;
      let common = 0;
      while (common < active.length && active[common]?.id === target[common]?.id) common += 1;
      const suffix = target.slice(common);
      const artifacts = await Promise.all(suffix.map((segment) => load(segment, signal)));
      if (signal.aborted) throw signal.reason ?? abortedNavigation();
      for (const [index, artifact] of artifacts.entries()) {
        const expected = suffix[index];
        if (artifact.id !== expected?.id) {
          throw new OxeRouterError(
            'OXE_ROUTE_SEGMENT_MISMATCH',
            `Loaded route artifact ${JSON.stringify(artifact.id)} for ${JSON.stringify(expected?.id)}.`,
          );
        }
      }

      const staged: ActiveSegment[] = [];
      let topLevelNodes: readonly ChildNode[] = [];
      let stagingOutlet: DomRouteOutlet | undefined;
      try {
        for (const [index, artifact] of artifacts.entries()) {
          const segment = suffix[index];
          if (!segment) continue;
          const instance = artifact.create({ document, match, segment });
          if (index === 0) topLevelNodes = instance.nodes;
          else if (stagingOutlet) insertOutletContents(stagingOutlet, instance.nodes);
          else {
            throw new OxeRouterError(
              'OXE_ROUTE_INVALID_OUTLET',
              `Layout segment ${JSON.stringify(suffix[index - 1]?.id)} did not expose a child outlet.`,
            );
          }
          staged.push({ id: segment.id, instance });
          stagingOutlet = instance.childOutlet;
          if (index < artifacts.length - 1 && !stagingOutlet) {
            throw new OxeRouterError(
              'OXE_ROUTE_INVALID_OUTLET',
              `Layout segment ${JSON.stringify(segment.id)} did not expose a child outlet.`,
            );
          }
        }
      } catch (error) {
        disposeInstances(staged);
        throw error;
      }

      let cancelled = false;
      let committed = false;
      return {
        cancel: () => {
          if (cancelled || committed) return;
          cancelled = true;
          disposeInstances(staged);
        },
        commit: (next: RouteSnapshot) => {
          if (cancelled || committed) return;
          committed = true;
          for (const segment of active.slice(0, common)) segment.instance.update(next);
          if (suffix.length > 0) {
            const parentOutlet = common === 0 ? outlet : active[common - 1]?.instance.childOutlet;
            if (!parentOutlet) {
              throw new OxeRouterError(
                'OXE_ROUTE_INVALID_OUTLET',
                'The retained route layout does not expose its child outlet.',
              );
            }
            removeOutletContents(parentOutlet);
            insertOutletContents(parentOutlet, topLevelNodes);
          }
          disposeInstances(active.slice(common));
          active = Object.freeze([...active.slice(0, common), ...staged]);
        },
      };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      removeOutletContents(outlet);
      disposeInstances(active);
      active = [];
      outlet.start.parentNode?.removeChild(outlet.start);
      outlet.end.parentNode?.removeChild(outlet.end);
    },
  };
};
