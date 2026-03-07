import type { AuthInput } from './auth.js';
import type { TransformDefinition, ValidatorDefinition } from './custom.js';
import type { TableDeclaration } from './declarations.js';
import {
  cloneFieldDefinition,
  createEmptyDbMetadata,
  type BuiltInTransformKind,
  type FieldDefinition,
  type FieldTypeRef,
  type FieldValidator,
  type OnDeleteBehavior,
} from './field-types.js';

type TableReference = string | Pick<TableDeclaration, 'name'>;

type FieldBuilderStage = 'type' | 'auth' | 'db' | 'transform' | 'validator';
type StageAllowAuth = 'type' | 'auth';
type StageAllowDb = 'type' | 'auth' | 'db';
type StageAllowTransform = 'type' | 'auth' | 'db' | 'transform';
type StageAllowValidator = 'type' | 'auth' | 'db' | 'transform' | 'validator';

type StageRuleError<Message extends string> = {
  readonly __fieldBuilderOrderError__: Message;
};

type EnsureStage<
  Current extends FieldBuilderStage,
  Allowed extends FieldBuilderStage,
  Message extends string,
> = Current extends Allowed ? unknown : StageRuleError<Message>;

export class FieldBuilder<TStage extends FieldBuilderStage = FieldBuilderStage> {
  // Phantom marker so stage-specific builder types remain distinct at compile time.
  declare private readonly stage: TStage;
  private readonly definition: FieldDefinition;

  constructor(definition: FieldDefinition) {
    this.definition = cloneFieldDefinition(definition);
  }

  /** Marks the field as nullable/optional in the schema. */
  public optional(this: FieldBuilder<TStage>): FieldBuilder<TStage> {
    return this.update<TStage>((next) => {
      next.optional = true;
    });
  }

  /** Marks the field as an array/list of its underlying type. */
  public array(this: FieldBuilder<TStage>): FieldBuilder<TStage> {
    return this.update<TStage>((next) => {
      next.array = true;
    });
  }

  /**
   * Sets field-level auth rules for canonical/sugar actions.
   * Field auth must be declared before DB directives, transforms, and validators.
   */
  public auth(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowAuth,
        'auth()/owner() must be declared before DB directives, transforms, and validators.'
      >,
    auth: AuthInput,
  ): FieldBuilder<'auth'> {
    return this.update<'auth'>((next) => {
      next.auth = auth;
    });
  }

  /** Marks this field as the owner field for table/bucket ownership semantics. */
  public owner(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowAuth,
        'auth()/owner() must be declared before DB directives, transforms, and validators.'
      >,
  ): FieldBuilder<'auth'> {
    return this.update<'auth'>((next) => {
      next.owner = true;
    });
  }

  /** Trims surrounding whitespace from string values. */
  public trim(
    this: FieldBuilder<TStage> &
      EnsureStage<TStage, StageAllowTransform, 'Transforms must be declared before validators.'>,
  ): FieldBuilder<'transform'> {
    return this.pushTransform('trim');
  }

  /** Lowercases string values. */
  public lowercase(
    this: FieldBuilder<TStage> &
      EnsureStage<TStage, StageAllowTransform, 'Transforms must be declared before validators.'>,
  ): FieldBuilder<'transform'> {
    return this.pushTransform('lowercase');
  }

  /** Uppercases string values. */
  public uppercase(
    this: FieldBuilder<TStage> &
      EnsureStage<TStage, StageAllowTransform, 'Transforms must be declared before validators.'>,
  ): FieldBuilder<'transform'> {
    return this.pushTransform('uppercase');
  }

  /** Applies Math.floor to numeric values. */
  public floor(
    this: FieldBuilder<TStage> &
      EnsureStage<TStage, StageAllowTransform, 'Transforms must be declared before validators.'>,
  ): FieldBuilder<'transform'> {
    return this.pushTransform('floor');
  }

  /** Applies Math.ceil to numeric values. */
  public ceiling(
    this: FieldBuilder<TStage> &
      EnsureStage<TStage, StageAllowTransform, 'Transforms must be declared before validators.'>,
  ): FieldBuilder<'transform'> {
    return this.pushTransform('ceiling');
  }

  /** Applies Math.round to numeric values. */
  public round(
    this: FieldBuilder<TStage> &
      EnsureStage<TStage, StageAllowTransform, 'Transforms must be declared before validators.'>,
  ): FieldBuilder<'transform'> {
    return this.pushTransform('round');
  }

  /**
   * Applies a custom transform defined with defineTransform(...).
   * Custom transforms are stored by name in the schema graph.
   */
  public transform<TValue>(
    this: FieldBuilder<TStage> &
      EnsureStage<TStage, StageAllowTransform, 'Transforms must be declared before validators.'>,
    transform: TransformDefinition<TValue>,
  ): FieldBuilder<'transform'> {
    return this.pushCustomTransform(transform);
  }

  /** Requires string length to be >= value. */
  public minLength(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowValidator,
        'Validators must be declared after DB directives/transforms and cannot be followed by transforms.'
      >,
    value: number,
  ): FieldBuilder<'validator'> {
    return this.pushValidator({ kind: 'minLength', value });
  }

  /** Requires string length to be <= value. */
  public maxLength(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowValidator,
        'Validators must be declared after DB directives/transforms and cannot be followed by transforms.'
      >,
    value: number,
  ): FieldBuilder<'validator'> {
    return this.pushValidator({ kind: 'maxLength', value });
  }

  /** Requires exact length when passed one arg, or range when passed min/max. */
  public length(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowValidator,
        'Validators must be declared after DB directives/transforms and cannot be followed by transforms.'
      >,
    value: number,
  ): FieldBuilder<'validator'>;
  public length(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowValidator,
        'Validators must be declared after DB directives/transforms and cannot be followed by transforms.'
      >,
    min: number,
    max: number,
  ): FieldBuilder<'validator'>;
  public length(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowValidator,
        'Validators must be declared after DB directives/transforms and cannot be followed by transforms.'
      >,
    min: number,
    max?: number,
  ): FieldBuilder<'validator'> {
    return this.pushValidator({ kind: 'length', min, max: max ?? min });
  }

  /** Requires value to be a valid email address format. */
  public email(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowValidator,
        'Validators must be declared after DB directives/transforms and cannot be followed by transforms.'
      >,
  ): FieldBuilder<'validator'> {
    return this.pushValidator({ kind: 'email' });
  }

  /** Requires value to be a valid URL format. */
  public url(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowValidator,
        'Validators must be declared after DB directives/transforms and cannot be followed by transforms.'
      >,
  ): FieldBuilder<'validator'> {
    return this.pushValidator({ kind: 'url' });
  }

  /** Requires value to be a valid UUID format. */
  public uuid(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowValidator,
        'Validators must be declared after DB directives/transforms and cannot be followed by transforms.'
      >,
  ): FieldBuilder<'validator'> {
    return this.pushValidator({ kind: 'uuid' });
  }

  /** Requires value to match the provided regular expression. */
  public regex(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowValidator,
        'Validators must be declared after DB directives/transforms and cannot be followed by transforms.'
      >,
    pattern: RegExp | string,
  ): FieldBuilder<'validator'> {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    return this.pushValidator({ kind: 'regex', source: regex.source, flags: regex.flags });
  }

  /** Requires numeric value to be >= value. */
  public min(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowValidator,
        'Validators must be declared after DB directives/transforms and cannot be followed by transforms.'
      >,
    value: number,
  ): FieldBuilder<'validator'> {
    return this.pushValidator({ kind: 'min', value });
  }

  /** Requires numeric value to be <= value. */
  public max(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowValidator,
        'Validators must be declared after DB directives/transforms and cannot be followed by transforms.'
      >,
    value: number,
  ): FieldBuilder<'validator'> {
    return this.pushValidator({ kind: 'max', value });
  }

  /** Requires exact numeric value when passed one arg, or range when passed min/max. */
  public num(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowValidator,
        'Validators must be declared after DB directives/transforms and cannot be followed by transforms.'
      >,
    value: number,
  ): FieldBuilder<'validator'>;
  public num(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowValidator,
        'Validators must be declared after DB directives/transforms and cannot be followed by transforms.'
      >,
    min: number,
    max: number,
  ): FieldBuilder<'validator'>;
  public num(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowValidator,
        'Validators must be declared after DB directives/transforms and cannot be followed by transforms.'
      >,
    min: number,
    max?: number,
  ): FieldBuilder<'validator'> {
    return this.pushValidator({ kind: 'num', min, max: max ?? min });
  }

  /**
   * Applies a custom validator defined with defineValidator(...).
   * Custom validators are stored by name in the schema graph.
   */
  public validate<TValue>(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowValidator,
        'Validators must be declared after DB directives/transforms and cannot be followed by transforms.'
      >,
    validator: ValidatorDefinition<TValue>,
  ): FieldBuilder<'validator'> {
    return this.pushValidator({ kind: 'custom', name: validator.name });
  }

  /** Marks this field as a primary key. */
  public primary(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowDb,
        'DB directives must be declared before transforms and validators.'
      >,
  ): FieldBuilder<'db'> {
    return this.update<'db'>((next) => {
      next.db.primary = true;
    });
  }

  /** Sets a default value for this field. */
  public default(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowDb,
        'DB directives must be declared before transforms and validators.'
      >,
    value: unknown,
  ): FieldBuilder<'db'> {
    return this.update<'db'>((next) => {
      next.db.defaultValue = value;
    });
  }

  /** Adds a unique constraint for this field. */
  public unique(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowDb,
        'DB directives must be declared before transforms and validators.'
      >,
  ): FieldBuilder<'db'> {
    return this.update<'db'>((next) => {
      next.db.unique = true;
    });
  }

  /** Adds an index for this field. */
  public index(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowDb,
        'DB directives must be declared before transforms and validators.'
      >,
  ): FieldBuilder<'db'> {
    return this.update<'db'>((next) => {
      next.db.index = true;
    });
  }

  /** Declares a foreign key reference to a target table. */
  public references(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowDb,
        'DB directives must be declared before transforms and validators.'
      >,
    target: TableReference,
  ): FieldBuilder<'db'> {
    const tableName = typeof target === 'string' ? target : target.name;
    return this.update<'db'>((next) => {
      next.db.references = tableName;
    });
  }

  /** Sets the foreign-key onDelete behavior (requires references(...)). */
  public onDelete(
    this: FieldBuilder<TStage> &
      EnsureStage<
        TStage,
        StageAllowDb,
        'DB directives must be declared before transforms and validators.'
      >,
    behavior: OnDeleteBehavior,
  ): FieldBuilder<'db'> {
    return this.update<'db'>((next) => {
      next.db.onDelete = behavior;
    });
  }

  public toDefinition(): FieldDefinition {
    return cloneFieldDefinition(this.definition);
  }

  private update<TNextStage extends FieldBuilderStage>(
    mutator: (next: FieldDefinition) => void,
  ): FieldBuilder<TNextStage> {
    const next = cloneFieldDefinition(this.definition);
    mutator(next);
    return new FieldBuilder(next) as FieldBuilder<TNextStage>;
  }

  private pushTransform<TCurrent extends FieldBuilderStage>(
    this: FieldBuilder<TCurrent> &
      EnsureStage<TCurrent, StageAllowTransform, 'Transforms must be declared before validators.'>,
    kind: BuiltInTransformKind,
  ): FieldBuilder<'transform'> {
    return this.update<'transform'>((next) => {
      if (
        next.transforms.some((transform) => transform.kind === 'builtIn' && transform.name === kind)
      ) {
        return;
      }
      next.transforms.push({ kind: 'builtIn', name: kind });
    });
  }

  private pushCustomTransform<TCurrent extends FieldBuilderStage, TValue>(
    this: FieldBuilder<TCurrent> &
      EnsureStage<TCurrent, StageAllowTransform, 'Transforms must be declared before validators.'>,
    transform: TransformDefinition<TValue>,
  ): FieldBuilder<'transform'> {
    return this.update<'transform'>((next) => {
      if (
        next.transforms.some((entry) => entry.kind === 'custom' && entry.name === transform.name)
      ) {
        return;
      }

      next.transforms.push({
        kind: 'custom',
        name: transform.name,
      });
    });
  }

  private pushValidator<TCurrent extends FieldBuilderStage>(
    this: FieldBuilder<TCurrent> &
      EnsureStage<
        TCurrent,
        StageAllowValidator,
        'Validators must be declared after DB directives/transforms and cannot be followed by transforms.'
      >,
    validator: FieldValidator,
  ): FieldBuilder<'validator'> {
    return this.update<'validator'>((next) => {
      next.validators.push(validator);
    });
  }
}

export type FieldInput = FieldBuilder<FieldBuilderStage> | FieldDefinition;

export const createFieldBuilder = (type: FieldTypeRef): FieldBuilder<'type'> =>
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
