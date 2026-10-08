import { describe, expect, it } from 'vitest';

import {
  renderTodoPage,
  serializeTodoBrowserConfiguration,
  type TodoBrowserConfigurationV1,
} from '../src/page.js';

const configuration = (appName = 'TinyTodo'): TodoBrowserConfigurationV1 => ({
  appName,
  authBasePath: '/api/auth',
  basePath: '/',
});

describe('Todo browser projection', () => {
  it('renders an accessible external-script shell and escapes graph-owned text', () => {
    const page = renderTodoPage(configuration('<Tiny & Todo>'));

    expect(page).toContain('<title>&lt;Tiny &amp; Todo&gt;</title>');
    expect(page).toContain('<main id="app" aria-busy="true">');
    expect(page).toContain('id="status" class="sr-status" aria-live="polite"');
    expect(page).toContain('<script src="/config.js"></script>');
    expect(page).toContain('<script type="module" src="/app.js"></script>');
    expect(page).not.toContain('<Tiny & Todo>');
    expect(page).not.toContain('window.__OXE_TODO__');
  });

  it('serializes graph-lowered browser configuration without an inline-script escape', () => {
    const source = serializeTodoBrowserConfiguration(configuration('</script><script>'));

    expect(source).toContain('window.__OXE_TODO__=');
    expect(source).toContain('\\u003c/script>\\u003cscript>');
    expect(source).not.toContain('</script>');
  });

  it('serializes an exact opt-in development parent without exposing application data', () => {
    const source = serializeTodoBrowserConfiguration({
      ...configuration(),
      developmentParentOrigin: 'https://oxe-dev.finnternet.com',
    });

    expect(source).toContain('"developmentParentOrigin":"https://oxe-dev.finnternet.com"');
    expect(source).not.toContain('userId');
    expect(source).not.toContain('recordId');
  });

  it('renders browser assets below a configured development mount path', () => {
    const page = renderTodoPage({
      ...configuration(),
      authBasePath: '/__app/api/auth',
      basePath: '/__app',
    });

    expect(page).toContain('<script src="/__app/config.js"></script>');
    expect(page).toContain('<script type="module" src="/__app/app.js"></script>');
  });
});
