import type { AsyncFailureKind } from '@oxe/runtime';

export const SERVER_FUNCTION_SCHEMA = 'oxe.server-function.v1' as const;
export const SERVER_FUNCTION_MANIFEST_SCHEMA = 'oxe.server-function-manifest.v1' as const;
export const SERVER_FUNCTION_REQUEST_SCHEMA = 'oxe.server-function-request.v1' as const;
export const SERVER_FUNCTION_RESPONSE_SCHEMA = 'oxe.server-function-response.v1' as const;

export interface BooleanSchemaV1 {
  readonly kind: 'boolean';
}

export interface NumberSchemaV1 {
  readonly integer?: boolean;
  readonly kind: 'number';
  readonly maximum?: number;
  readonly minimum?: number;
}

export interface StringSchemaV1 {
  readonly enum?: readonly string[];
  readonly kind: 'string';
  readonly maximumLength?: number;
  readonly minimumLength?: number;
}

export interface ArraySchemaV1<Item extends ServerValueSchemaV1 = ServerValueSchemaV1> {
  readonly items: Item;
  readonly kind: 'array';
  readonly maximumItems?: number;
  readonly minimumItems?: number;
}

export interface RecordFieldV1<
  Name extends string = string,
  Schema extends ServerValueSchemaV1 = ServerValueSchemaV1,
> {
  readonly name: Name;
  readonly schema: Schema;
}

export interface RecordSchemaV1<
  Fields extends readonly RecordFieldV1[] = readonly RecordFieldV1[],
> {
  readonly fields: Fields;
  readonly kind: 'record';
}

export type ServerValueSchemaV1 =
  ArraySchemaV1 | BooleanSchemaV1 | NumberSchemaV1 | RecordSchemaV1 | StringSchemaV1;

export type ServerSchemaValue<Schema extends ServerValueSchemaV1> = Schema extends BooleanSchemaV1
  ? boolean
  : Schema extends NumberSchemaV1
    ? number
    : Schema extends StringSchemaV1
      ? string
      : Schema extends ArraySchemaV1<infer Item>
        ? readonly ServerSchemaValue<Item>[]
        : Schema extends RecordSchemaV1<infer Fields>
          ? {
              readonly [Field in Fields[number] as Field['name']]: ServerSchemaValue<
                Field['schema']
              >;
            }
          : never;

export interface ServerFunctionParameterV1<
  Name extends string = string,
  Schema extends ServerValueSchemaV1 = ServerValueSchemaV1,
> {
  readonly name: Name;
  readonly schema: Schema;
}

export interface ServerFunctionDefinitionV1<
  Parameters extends readonly ServerFunctionParameterV1[] = readonly ServerFunctionParameterV1[],
  Returns extends ServerValueSchemaV1 = ServerValueSchemaV1,
> {
  readonly id: string;
  readonly mode: 'mutation' | 'query';
  readonly parameters: Parameters;
  /** Dot-path installed as the compiler-visible capability. */
  readonly path: readonly string[];
  readonly returns: Returns;
  readonly schemaVersion: typeof SERVER_FUNCTION_SCHEMA;
}

type ServerFunctionParameterValue<Parameter extends ServerFunctionParameterV1> =
  Parameter extends ServerFunctionParameterV1<string, infer Schema>
    ? ServerSchemaValue<Schema>
    : never;

type ServerFunctionParameterValues<Parameters extends readonly ServerFunctionParameterV1[]> =
  Parameters extends readonly []
    ? readonly []
    : Parameters extends readonly [
          infer Head extends ServerFunctionParameterV1,
          ...infer Tail extends readonly ServerFunctionParameterV1[],
        ]
      ? readonly [ServerFunctionParameterValue<Head>, ...ServerFunctionParameterValues<Tail>]
      : readonly ServerFunctionParameterValue<Parameters[number]>[];

export type ServerFunctionArguments<Definition extends ServerFunctionDefinitionV1> =
  ServerFunctionParameterValues<Definition['parameters']>;

export type ServerFunctionResult<Definition extends ServerFunctionDefinitionV1> = ServerSchemaValue<
  Definition['returns']
>;

export interface ServerFunctionManifestV1 {
  readonly functions: readonly ServerFunctionDefinitionV1[];
  readonly schemaVersion: typeof SERVER_FUNCTION_MANIFEST_SCHEMA;
}

export interface ServerFunctionRequestV1 {
  readonly arguments: readonly unknown[];
  readonly functionId: string;
  readonly schemaVersion: typeof SERVER_FUNCTION_REQUEST_SCHEMA;
}

export interface ServerFunctionValidationIssue {
  readonly message: string;
  readonly path: string;
}

export interface ServerFunctionErrorPayloadV1 {
  readonly issues?: readonly ServerFunctionValidationIssue[];
  readonly kind: AsyncFailureKind;
  readonly message: string;
  readonly status: number;
}

export type ServerFunctionResponseV1 =
  | {
      readonly functionId: string;
      readonly ok: true;
      readonly schemaVersion: typeof SERVER_FUNCTION_RESPONSE_SCHEMA;
      readonly value: unknown;
    }
  | {
      readonly error: ServerFunctionErrorPayloadV1;
      readonly functionId?: string;
      readonly ok: false;
      readonly schemaVersion: typeof SERVER_FUNCTION_RESPONSE_SCHEMA;
    };

export interface ServerFunctionSerializationLimits {
  /** Maximum nesting below the root value. Defaults to 32. */
  readonly maximumDepth?: number;
  /** Maximum encoded request or response size. Defaults to 1 MiB. */
  readonly maximumEncodedBytes?: number;
  /** Maximum scalar, array-item, and record-field values visited. Defaults to 10,000. */
  readonly maximumNodes?: number;
}

export interface ResolvedServerFunctionSerializationLimits {
  readonly maximumDepth: number;
  readonly maximumEncodedBytes: number;
  readonly maximumNodes: number;
}

export interface ServerFunctionTransport {
  invoke(payload: string, signal: AbortSignal): PromiseLike<string>;
}

export interface ServerFunctionCallOptions {
  readonly signal?: AbortSignal;
}

export type ServerFunctionCaller<Definition extends ServerFunctionDefinitionV1> = (
  arguments_: ServerFunctionArguments<Definition>,
  options?: ServerFunctionCallOptions,
) => Promise<ServerFunctionResult<Definition>>;

/** Positional shape used by compiler-emitted async capability calls. */
export type ServerFunctionCapability<Definition extends ServerFunctionDefinitionV1> = (
  ...argumentsAndSignal: [...ServerFunctionArguments<Definition>, signal: AbortSignal]
) => Promise<ServerFunctionResult<Definition>>;

export type ServerFunctionHandler<Definition extends ServerFunctionDefinitionV1, Context> = (
  arguments_: ServerFunctionArguments<Definition>,
  context: Context,
  signal: AbortSignal,
) => ServerFunctionResult<Definition> | PromiseLike<ServerFunctionResult<Definition>>;

export interface ServerFunctionImplementation<Context = unknown> {
  readonly definition: ServerFunctionDefinitionV1;
  invoke(arguments_: readonly unknown[], context: Context, signal: AbortSignal): unknown;
}

export interface DispatchServerFunctionOptions<Context> {
  readonly context: Context;
  readonly onError?: (error: unknown, functionId: string | undefined) => void;
  readonly signal?: AbortSignal;
}

export interface ServerFunctionRegistry<Context> {
  dispatch(payload: string, options: DispatchServerFunctionOptions<Context>): Promise<string>;
  readonly manifest: ServerFunctionManifestV1;
}
