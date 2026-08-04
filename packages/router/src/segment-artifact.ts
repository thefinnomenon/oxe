import { createCell, createDerived, createRoot } from '@oxe/runtime';

import { createDomRouteOutlet } from './dom-segments.js';
import { OxeRouterError } from './errors.js';
import { createRouteSearchRecord } from './match.js';
import type {
  DomRouteSegmentArtifact,
  DomRouteSegmentArtifactOptions,
  DomRouteSegmentContent,
} from './types.js';

const isNodeList = (content: DomRouteSegmentContent): content is readonly ChildNode[] =>
  Array.isArray(content);

const contentNodes = (content: DomRouteSegmentContent): readonly ChildNode[] =>
  isNodeList(content) ? content : [content];

/**
 * Owns one independently loaded layout or page. Compiler output can use this
 * boundary without coupling the router to the generated component internals.
 */
export const createDomRouteSegmentArtifact = (
  options: DomRouteSegmentArtifactOptions,
): DomRouteSegmentArtifact => ({
  id: options.id,
  create: (context) => {
    const childOutlet =
      options.kind === 'layout' ? createDomRouteOutlet(context.document, options.id) : undefined;
    const root = createRoot(
      () => {
        const match = createCell(context.match, { name: `${options.id} route match` });
        const location = createDerived([match], () => match.read().location, {
          name: `${options.id} route location`,
        });
        const params = createDerived([match], () => match.read().params, {
          name: `${options.id} route params`,
        });
        const search = createDerived(
          [match],
          () => createRouteSearchRecord(match.read().location.search),
          { name: `${options.id} route search params` },
        );
        const unavailable = (): never => {
          throw new OxeRouterError(
            'OXE_ROUTE_NAVIGATION_UNAVAILABLE',
            `Route navigation is unavailable while building ${JSON.stringify(options.id)}.`,
          );
        };
        const route = Object.freeze({
          location,
          navigate: options.navigation?.navigate ?? unavailable,
          params,
          search,
          setSearchParams: options.navigation?.setSearchParams ?? unavailable,
        });
        const children = childOutlet
          ? ([childOutlet.start, childOutlet.end] as const)
          : ([] as const);
        const nodes = Object.freeze([
          ...contentNodes(options.build({ ...context, children, match, route })),
        ]);
        return { match, nodes };
      },
      { name: options.id },
    );
    return {
      ...(childOutlet ? { childOutlet } : {}),
      nodes: root.value.nodes,
      dispose: () => root.dispose(),
      update: (next) => root.value.match.write(next),
    };
  },
});
