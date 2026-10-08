export interface WorkspaceApplicationTargetV1 {
  readonly databaseName?: string;
  readonly databaseURL?: string;
  readonly id: string;
  readonly revision: number;
  readonly url: string;
}

/** In-memory traffic pointer; only a prepared publication candidate may replace it. */
export class WorkspaceApplicationTarget {
  #current: WorkspaceApplicationTargetV1;

  public constructor(initial: WorkspaceApplicationTargetV1) {
    this.#current = Object.freeze({ ...initial });
  }

  public current(): WorkspaceApplicationTargetV1 {
    return this.#current;
  }

  public activate(candidate: WorkspaceApplicationTargetV1): WorkspaceApplicationTargetV1 {
    const previous = this.#current;
    this.#current = Object.freeze({ ...candidate });
    return previous;
  }

  public restore(expectedCurrentId: string, previous: WorkspaceApplicationTargetV1): boolean {
    if (this.#current.id !== expectedCurrentId) return false;
    this.#current = previous;
    return true;
  }
}
