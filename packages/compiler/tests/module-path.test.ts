import { describe, expect, it } from 'vitest';

import {
  normalizeProjectModuleId,
  OxeModulePathError,
  resolveImportModuleId,
} from '../src/module-path.js';

describe('OXE module paths', () => {
  it('canonicalizes project module ids and exact relative imports', () => {
    expect(normalizeProjectModuleId('./src/./ui/../App.oxe')).toBe('src/App.oxe');
    expect(resolveImportModuleId('src/App.oxe', './ui/Card.oxe')).toBe('src/ui/Card.oxe');
    expect(resolveImportModuleId('src/pages/App.oxe', '../ui/Card.oxe')).toBe('src/ui/Card.oxe');
  });

  it.each(['Card.oxe', '@oxe/ui', './Card', './Card.oxe?raw', './Card.oxe#Card', '.\\Card.oxe'])(
    'rejects ambiguous import specifier %s',
    (specifier) => {
      expect(() => resolveImportModuleId('src/App.oxe', specifier)).toThrow('exact relative path');
    },
  );

  it('rejects absolute paths and project-root escapes with stable error codes', () => {
    expect(() => normalizeProjectModuleId('/src/App.oxe')).toThrow(OxeModulePathError);
    expect(() => resolveImportModuleId('src/App.oxe', '../../Card.oxe')).toThrow(
      expect.objectContaining({ code: 'MODULE_OUTSIDE_PROJECT' }),
    );
  });
});
