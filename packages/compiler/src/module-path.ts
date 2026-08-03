export type ModulePathErrorCode =
  'INVALID_IMPORT_SPECIFIER' | 'INVALID_MODULE_ID' | 'MODULE_OUTSIDE_PROJECT';

export class OxeModulePathError extends TypeError {
  public readonly code: ModulePathErrorCode;

  public constructor(code: ModulePathErrorCode, message: string) {
    super(message);
    this.name = 'OxeModulePathError';
    this.code = code;
  }
}

const isAbsolutePath = (value: string): boolean =>
  value.startsWith('/') || /^[A-Za-z]:\//u.test(value);

const normalizeSegments = (value: string, kind: 'import specifier' | 'module id'): string => {
  const segments: string[] = [];
  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length === 0) {
        throw new OxeModulePathError(
          'MODULE_OUTSIDE_PROJECT',
          `OXE ${kind}s cannot escape the project root.`,
        );
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
};

export const normalizeProjectModuleId = (value: string): string => {
  if (value.length === 0 || isAbsolutePath(value) || value.includes('\\')) {
    throw new OxeModulePathError(
      'INVALID_MODULE_ID',
      'OXE module ids must be project-relative, non-empty paths using forward slashes.',
    );
  }
  const normalized = normalizeSegments(value, 'module id');
  if (normalized.length === 0) {
    throw new OxeModulePathError('INVALID_MODULE_ID', 'An OXE module id cannot be empty.');
  }
  return normalized;
};

export const resolveImportModuleId = (fromModuleId: string, specifier: string): string => {
  const normalizedFrom = normalizeProjectModuleId(fromModuleId);
  if (
    (!specifier.startsWith('./') && !specifier.startsWith('../')) ||
    !specifier.endsWith('.oxe') ||
    specifier.includes('\\') ||
    specifier.includes('?') ||
    specifier.includes('#')
  ) {
    throw new OxeModulePathError(
      'INVALID_IMPORT_SPECIFIER',
      'OXE imports must use an exact relative path beginning with ./ or ../ and ending in .oxe.',
    );
  }

  const slash = normalizedFrom.lastIndexOf('/');
  const directory = slash < 0 ? '' : normalizedFrom.slice(0, slash);
  return normalizeProjectModuleId(directory.length === 0 ? specifier : `${directory}/${specifier}`);
};
