import { describe, expect, it } from 'vitest';

import {
  appendDomRouteOutlet,
  createDomRouteOutlet,
  createDomRouteSegmentArtifact,
  createDomSegmentTransition,
  createFileRouteManifest,
  matchRoute,
  type DomRouteSegmentArtifact,
  type RouteMatch,
  type RouteSnapshot,
} from '../src/index.js';

class FakeNode {
  public readonly childNodes: FakeNode[] = [];
  public parentNode: FakeNode | null = null;

  public constructor(public readonly ownerDocument: FakeDocument) {}

  public get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }

  public get nextSibling(): FakeNode | null {
    if (!this.parentNode) return null;
    return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null;
  }

  public appendChild<Child extends FakeNode>(child: Child): Child {
    return this.insertBefore(child, null);
  }

  public insertBefore<Child extends FakeNode>(child: Child, reference: FakeNode | null): Child {
    child.parentNode?.removeChild(child);
    const index = reference === null ? this.childNodes.length : this.childNodes.indexOf(reference);
    if (index < 0) throw new Error('Reference is not a child.');
    child.parentNode = this;
    this.childNodes.splice(index, 0, child);
    return child;
  }

  public removeChild<Child extends FakeNode>(child: Child): Child {
    const index = this.childNodes.indexOf(child);
    if (index < 0) throw new Error('Node is not a child.');
    this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }
}

class FakeComment extends FakeNode {
  public constructor(
    document: FakeDocument,
    public readonly data: string,
  ) {
    super(document);
  }
}

class FakeElement extends FakeNode {
  public constructor(
    document: FakeDocument,
    public readonly label: string,
  ) {
    super(document);
  }
}

class FakeDocument {
  public createComment(data: string): FakeComment {
    return new FakeComment(this, data);
  }

  public createElement(label: string): FakeElement {
    return new FakeElement(this, label);
  }
}

const asNode = (node: FakeNode): Node => node as unknown as Node;
const asFake = (node: ChildNode): FakeNode => node as unknown as FakeNode;

const requiredMatch = (href: string): RouteMatch => {
  const match = matchRoute(
    createFileRouteManifest([
      'src/routes/layout.oxe',
      'src/routes/page.oxe',
      'src/routes/users/layout.oxe',
      'src/routes/users/[id]/page.oxe',
    ]),
    href,
  );
  if (!match) throw new Error(`Expected ${href} to match.`);
  return match;
};

const snapshot = (match: RouteMatch, navigationId: number): RouteSnapshot => ({
  ...match,
  navigationId,
});

describe('persistent DOM route segments', () => {
  it('adapts independently generated segment builders to owned route artifacts', () => {
    const document = new FakeDocument();
    const definition = requiredMatch('/').route.segments[0];
    if (!definition) throw new Error('Expected a root layout definition.');
    let currentPath = '';
    const artifact = createDomRouteSegmentArtifact({
      id: definition.id,
      kind: 'layout',
      build: ({ children, document: domDocument, match }) => {
        const node = domDocument.createElement('compiled-layout') as unknown as FakeElement;
        for (const child of children) node.appendChild(asFake(child));
        currentPath = match.read().location.pathname;
        return node as unknown as ChildNode;
      },
    });
    const home = requiredMatch('/');
    const instance = artifact.create({
      document: document as unknown as Document,
      match: home,
      segment: definition,
    });

    expect(currentPath).toBe('/');
    expect(instance.childOutlet?.start.parentNode).toBe(instance.nodes[0]);
    instance.update(snapshot(requiredMatch('/users/finn'), 1));
    instance.dispose();
  });

  it('keeps retained layouts visible while loading and reuses the full chain for param changes', async () => {
    const document = new FakeDocument();
    const container = document.createElement('container');
    const created = new Map<string, FakeElement[]>();
    const disposed: string[] = [];
    const updated: Array<{ id: string; pathname: string }> = [];
    let releaseUsersLayout: (() => void) | undefined;
    const usersLayoutReady = new Promise<void>((resolve) => {
      releaseUsersLayout = resolve;
    });

    const artifact = (id: string, kind: 'layout' | 'page'): DomRouteSegmentArtifact => ({
      id,
      create: ({ document: domDocument }) => {
        const node = domDocument.createElement(id) as unknown as FakeElement;
        const instances = created.get(id) ?? [];
        instances.push(node);
        created.set(id, instances);
        const childOutlet = kind === 'layout' ? createDomRouteOutlet(domDocument, id) : undefined;
        if (childOutlet) appendDomRouteOutlet(asNode(node), childOutlet);
        return {
          ...(childOutlet ? { childOutlet } : {}),
          nodes: [node as unknown as ChildNode],
          dispose: () => disposed.push(id),
          update: (next) => updated.push({ id, pathname: next.location.pathname }),
        };
      },
    });

    const transition = createDomSegmentTransition(asNode(container), async (segment) => {
      if (segment.id === 'layout:src/routes/users/layout.oxe') await usersLayoutReady;
      return artifact(segment.id, segment.kind);
    });

    const home = requiredMatch('/');
    const initial = await transition.prepare(home, new AbortController().signal);
    initial.commit(snapshot(home, 0));
    const rootLayout = created.get('layout:src/routes/layout.oxe')?.[0];
    const homePage = created.get('page:src/routes/page.oxe')?.[0];
    expect(rootLayout).toBeDefined();
    expect(homePage?.parentNode).not.toBeNull();

    const firstUser = requiredMatch('/users/first');
    const loading = transition.prepare(firstUser, new AbortController().signal);
    await Promise.resolve();
    expect(homePage?.parentNode).not.toBeNull();

    releaseUsersLayout?.();
    const preparedUser = await loading;
    expect(homePage?.parentNode).not.toBeNull();
    preparedUser.commit(snapshot(firstUser, 1));

    expect(created.get('layout:src/routes/layout.oxe')?.[0]).toBe(rootLayout);
    expect(homePage?.parentNode).toBeNull();
    expect(disposed).toEqual(['page:src/routes/page.oxe']);

    const secondUser = requiredMatch('/users/second');
    const sameRoute = await transition.prepare(secondUser, new AbortController().signal);
    sameRoute.commit(snapshot(secondUser, 2));

    expect(created.get('layout:src/routes/users/layout.oxe')).toHaveLength(1);
    expect(created.get('page:src/routes/users/[id]/page.oxe')).toHaveLength(1);
    expect(disposed).toEqual(['page:src/routes/page.oxe']);
    expect(updated.slice(-3)).toEqual([
      { id: 'layout:src/routes/layout.oxe', pathname: '/users/second' },
      { id: 'layout:src/routes/users/layout.oxe', pathname: '/users/second' },
      { id: 'page:src/routes/users/[id]/page.oxe', pathname: '/users/second' },
    ]);

    transition.dispose();
    expect(asFake(transition.outlet.start).parentNode).toBeNull();
  });
});
