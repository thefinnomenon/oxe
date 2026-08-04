const escapeText = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const escapeAttribute = (value: string): string => escapeText(value).replaceAll('"', '&quot;');

export abstract class FakeNode {
  public readonly childNodes: FakeNode[] = [];
  public parentNode: FakeNode | null = null;

  public get nextSibling(): FakeNode | null {
    if (!this.parentNode) {
      return null;
    }
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index + 1] ?? null;
  }

  public appendChild<Child extends FakeNode>(child: Child): Child {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  public insertBefore<Child extends FakeNode>(child: Child, reference: FakeNode | null): Child {
    if (reference === null) {
      return this.appendChild(child);
    }
    if (child === reference) {
      return child;
    }
    const referenceIndex = this.childNodes.indexOf(reference);
    if (referenceIndex < 0) {
      throw new Error('The reference node is not a child of this parent.');
    }
    child.parentNode?.removeChild(child);
    const nextReferenceIndex = this.childNodes.indexOf(reference);
    child.parentNode = this;
    this.childNodes.splice(nextReferenceIndex, 0, child);
    return child;
  }

  public removeChild<Child extends FakeNode>(child: Child): Child {
    const index = this.childNodes.indexOf(child);
    if (index < 0) {
      throw new Error('The node is not a child of this parent.');
    }
    this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  public abstract cloneNode(deep?: boolean): FakeNode;
}

export class FakeText extends FakeNode {
  public constructor(public data: string) {
    super();
  }

  public cloneNode(): FakeText {
    return new FakeText(this.data);
  }
}

export class FakeElement extends FakeNode {
  readonly #attributes = new Map<string, string>();
  readonly #listeners = new Map<string, Set<(event: unknown) => void>>();

  public constructor(
    public readonly ownerDocument: FakeDocument,
    public readonly tagName: string,
  ) {
    super();
  }

  public addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.#listeners.get(type) ?? new Set<(event: unknown) => void>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  public removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.#listeners.get(type)?.delete(listener);
  }

  public setAttribute(name: string, value: string): void {
    this.#attributes.set(name, value);
  }

  public removeAttribute(name: string): void {
    this.#attributes.delete(name);
  }

  public attributes(): readonly (readonly [string, string])[] {
    return [...this.#attributes.entries()];
  }

  public cloneNode(deep = false): FakeElement {
    const clone = new FakeElement(this.ownerDocument, this.tagName);
    for (const [name, value] of this.#attributes) {
      clone.setAttribute(name, value);
    }
    if (deep) {
      for (const child of this.childNodes) {
        clone.appendChild(child.cloneNode(true));
      }
    }
    return clone;
  }
}

export class FakeDocument {
  public createElement(tagName: string): FakeElement {
    return new FakeElement(this, tagName);
  }

  public createTextNode(value: string): FakeText {
    return new FakeText(value);
  }
}

const serializeNode = (node: FakeNode): string => {
  if (node instanceof FakeText) {
    return escapeText(node.data);
  }
  if (!(node instanceof FakeElement)) {
    return '';
  }
  const attributes = node
    .attributes()
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('');
  const children = node.childNodes.map(serializeNode).join('');
  return `<${node.tagName}${attributes}>${children}</${node.tagName}>`;
};

export const serializeChildren = (node: FakeNode): string =>
  node.childNodes.map(serializeNode).join('');
