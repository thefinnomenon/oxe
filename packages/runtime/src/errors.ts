export type RuntimeErrorCode =
  | 'OXE_RUNTIME_CYCLE'
  | 'OXE_RUNTIME_FLUSH_LIMIT'
  | 'OXE_RUNTIME_INVALID_ASYNC_COORDINATOR'
  | 'OXE_RUNTIME_INVALID_DEPENDENCY'
  | 'OXE_RUNTIME_INVALID_WRITE_PATH'
  | 'OXE_RUNTIME_INVALID_DISPOSABLE'
  | 'OXE_RUNTIME_MISSING_CONTEXT'
  | 'OXE_RUNTIME_MISSING_OWNER'
  | 'OXE_RUNTIME_OWNER_LIFETIME';

export class OxeRuntimeError extends Error {
  public readonly code: RuntimeErrorCode;

  public constructor(code: RuntimeErrorCode, message: string) {
    super(message);
    this.name = 'OxeRuntimeError';
    this.code = code;
  }
}
