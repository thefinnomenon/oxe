import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const assetBuilder = readFileSync(new URL('../scripts/copy-assets.mjs', import.meta.url), 'utf8');
const client = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8');

describe('development workspace interface', () => {
  it('starts with a full-application floating agent and keeps deep tools in the panel', () => {
    expect(html).toContain('class="workspace agent-collapsed"');
    expect(html).toContain('class="agent-rail collapsed"');
    expect(html).toContain('data-agent-launcher');
    expect(html).toContain('data-rail-tab="graph"');
    expect(html).toContain('data-rail-tab="revisions"');
    expect(html).toContain('data-rail-tab="runtime"');
    expect(html).toContain('data-rail-tab="performance"');
    expect(html).toContain('data-performance-summary');
    expect(html).toContain('data-performance-resources');
    expect(html).toContain('data-interaction-context');
    expect(html).toContain('Development application');
    expect(html).toContain('class="workspace-info"');
    expect(html.indexOf('class="workspace-info"')).toBeGreaterThan(html.indexOf('<aside'));
    expect(html.indexOf('class="workspace-info"')).toBeGreaterThan(
      html.indexOf('data-rail-view="performance"'),
    );
    expect(html).toContain('aria-label="Reload application"');
    expect(html).toContain('data-retry-publication');
    expect(html).toContain('Open site');
    expect(html).not.toContain('class="preview-toolbar"');
    expect(html).not.toContain('OXE Development Preview');
  });

  it('supports keyboard tab navigation, reconnection polling, and revision recovery', () => {
    expect(html).toContain('role="tablist"');
    expect(html).toContain('tabindex="-1"');
    expect(client).toContain("event.key === 'ArrowRight'");
    expect(client).toContain("event.key === 'Home'");
    expect(client).toContain('window.setInterval(() => void refreshPreview(), 5_000)');
    expect(client).toContain("kind: 'revert'");
    expect(client).toContain("fetch('/api/publication/retry'");
  });

  it('uses the full mobile viewport and safe-area-aware controls', () => {
    expect(css).toMatch(/\.preview-shell\s*\{[\s\S]*?height: 100dvh;/u);
    expect(css).toMatch(/\.agent-rail\s*\{\s*inset: 0;\s*width: 100%;\s*height: 100dvh;/u);
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('fingerprints both workspace browser assets to prevent stale mobile styling', () => {
    expect(assetBuilder).toContain('href="/styles.css?v=${fingerprint(stylesSource)}"');
    expect(assetBuilder).toContain('src="/client.js?v=${fingerprint(clientSource)}"');
  });
});
