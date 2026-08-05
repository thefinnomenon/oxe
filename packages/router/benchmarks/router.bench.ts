import { bench, describe } from 'vitest';

import { createFileRouteManifest, matchRoute } from '../src/index.js';

const routeModules = [
  'src/routes/layout.oxe',
  ...Array.from({ length: 500 }, (_, index) => `src/routes/project-${index}/page.oxe`),
  'src/routes/projects/[projectId]/page.oxe',
  'src/routes/docs/[...path]/page.oxe',
];
const manifest = createFileRouteManifest(routeModules);

describe('router baselines', () => {
  bench('build a 502-route filesystem manifest', () => {
    createFileRouteManifest(routeModules);
  });

  bench('match a route near the end of a 502-route manifest', () => {
    matchRoute(manifest, '/projects/alpha?tab=activity');
  });
});
