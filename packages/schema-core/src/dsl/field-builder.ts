import type { AuthInput } from './auth.js';
import type { TableDeclaration } from './declarations.js';
import { cloneFieldDefinition, createEmptyDbMetadata, type FieldDefinition, type FieldTypeRef, type FieldValidator, type OnDeleteBehavior, type TransformKind } from './field-types.js';

type TableReference = string | Pick<TableDeclaration, 'name'>;

export class FieldBuilder {
  private readonly definition: FieldDefinition;

  constructor(definition: FieldDefinition) {
    this.definition = cloneFieldDefinition(definition);
  }

  public optional(): FieldBuilder {
    return this.update((next) => {
      next.optional = true;
    });
  }

  public array(): FieldBuilder {
    return this.update((next) => {
      next.array = true;
    });
  }

  public auth(auth: AuthInput): FieldBuilder {
    return this.update((next) => {
      next.auth = auth;
    });
  }

  public owner(): FieldBuilder {
    return this.update((next) => {
      next.owner = true;
    });
  }

  public trim(): FieldBuilder {
    return this.pushTransform('trim');
  }

  public lowercase(): FieldBuilder {
    return this.pushTransform('lowercase');
  }

  public uppercase(): FieldBuilder {
    return this.pushTransform('uppercase');
  }

  public floor(): FieldBuilder {
    return this.pushTransform('floor');
  }

  public ceiling(): FieldBuilder {
    return this.pushTransform('ceiling');
  }

  public round(): FieldBuilder {
    return this.pushTransform('round');
  }

  public minLength(value: number): FieldBuilder {
    return this.pushValidator({ kind: 'minLength', value });
  }

  public maxLength(value: number): FieldBuilder {
    return this.pushValidator({ kind: 'maxLength', value });
  }

  public length(min: number, max: number): FieldBuilder {
    return this.pushValidator({ kind: 'length', min, max });
  }

  public email(): FieldBuilder {
    return this.pushValidator({ kind: 'email' });
  }

  public url(): FieldBuilder {
    return this.pushValidator({ kind: 'url' });
  }

  public uuid(): FieldBuilder {
    return this.pushValidator({ kind: 'uuid' });
  }

  public regex(pattern: RegExp | string): FieldBuilder {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    return this.pushValidator({ kind: 'regex', source: regex.source, flags: regex.flags });
  }

  public min(value: number): FieldBuilder {
    return this.pushValidator({ kind: 'min', value });
  }

  public max(value: number): FieldBuilder {
    return this.pushValidator({ kind: 'max', value });
  }

  public num(min: number, max: number): FieldBuilder {
    return this.pushValidator({ kind: 'num', min, max });
  }

  public primary(): FieldBuilder {
    return this.update((next) => {
      next.db.primary = true;
    });
  }

  public default(value: unknown): FieldBuilder {
    return this.update((next) => {
      next.db.defaultValue = value;
    });
  }

  public unique(): FieldBuilder {
    return this.update((next) => {
      next.db.unique = true;
    });
  }

  public index(): FieldBuilder {
    return this.update((next) => {
      next.db.index = true;
    });
  }

  public references(target: TableReference): FieldBuilder {
    const tableName = typeof target === 'string' ? target : target.name;
    return this.update((next) => {
      next.db.references = tableName;
    });
  }

  public onDelete(behavior: OnDeleteBehavior): FieldBuilder {
    return this.update((next) => {
      next.db.onDelete = behavior;
    });
  }

  public toDefinition(): FieldDefinition {
    return cloneFieldDefinition(this.definition);
  }

  private update(mutator: (next: FieldDefinition) => void): FieldBuilder {
    const next = cloneFieldDefinition(this.definition);
    mutator(next);
    return new FieldBuilder(next);
  }

  private pushTransform(kind: TransformKind): FieldBuilder {
    return this.update((next) => {
      if (next.transforms.some((transform) => transform.kind === kind)) {
        return;
      }
      next.transforms.push({ kind });
    });
  }

  private pushValidator(validator: FieldValidator): FieldBuilder {
    return this.update((next) => {
      next.validators.push(validator);
    });
  }
}

export type FieldInput = FieldBuilder | FieldDefinition;

export const createFieldBuilder = (type: FieldTypeRef): FieldBuilder =>
  new FieldBuilder({
    kind: 'field',
    type,
    optional: false,
    array: false,
    owner: false,
    transforms: [],
    validators: [],
    db: createEmptyDbMetadata(),
  });

export const toFieldDefinition = (input: FieldInput): FieldDefinition =>
  input instanceof FieldBuilder ? input.toDefinition() : cloneFieldDefinition(input);
