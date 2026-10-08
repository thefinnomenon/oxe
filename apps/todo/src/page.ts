export interface TodoBrowserConfigurationV1 {
  readonly appName: string;
  readonly authBasePath: string;
  readonly basePath: string;
  readonly developmentParentOrigin?: string;
}

const withBasePath = (basePath: string, path: string): string =>
  basePath === '/' ? path : `${basePath}${path}`;

export const serializeTodoBrowserConfiguration = (
  configuration: TodoBrowserConfigurationV1,
): string => `window.__OXE_TODO__=${JSON.stringify(configuration).replaceAll('<', '\\u003c')};\n`;

const escapedHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export const renderTodoPage = (
  configuration: TodoBrowserConfigurationV1,
  applicationShell = '<p class="muted">Loading…</p>',
): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <title>${escapedHtml(configuration.appName)}</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --background: #f7f7f5;
        --surface: #ffffff;
        --text: #171717;
        --muted: #686868;
        --border: #deded9;
        --accent: #2855d9;
        --accent-hover: #1f46ba;
        --danger: #b42318;
        --focus: #5b7cfa;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --background: #111210;
          --surface: #1a1b18;
          --text: #f4f4f0;
          --muted: #aaa9a3;
          --border: #343530;
          --accent: #87a2ff;
          --accent-hover: #a9baff;
          --danger: #ff8c82;
          --focus: #a9baff;
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-width: 320px;
        min-height: 100vh;
        background: var(--background);
        color: var(--text);
      }
      body, button, input, select { font: inherit; }
      button, input, select { border-radius: 0.55rem; }
      button, a { -webkit-tap-highlight-color: transparent; }
      button:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible {
        outline: 3px solid color-mix(in srgb, var(--focus) 55%, transparent);
        outline-offset: 2px;
      }
      main {
        width: min(100% - 2rem, 42rem);
        margin: 0 auto;
        padding: clamp(2rem, 8vw, 5rem) 0;
      }
      .card {
        border: 1px solid var(--border);
        border-radius: 1rem;
        background: var(--surface);
        padding: clamp(1.25rem, 4vw, 2rem);
        box-shadow: 0 1rem 2.5rem color-mix(in srgb, #000 8%, transparent);
      }
      .auth-card { max-width: 28rem; margin: 0 auto; }
      h1 { margin: 0; font-size: clamp(1.75rem, 5vw, 2.4rem); letter-spacing: -0.04em; }
      h2 { margin: 0; font-size: 1rem; }
      p { line-height: 1.55; }
      .muted { color: var(--muted); }
      .stack { display: grid; gap: 1rem; }
      label { display: grid; gap: 0.4rem; font-weight: 650; }
      input {
        min-height: 2.75rem;
        width: 100%;
        border: 1px solid var(--border);
        background: var(--background);
        color: var(--text);
        padding: 0.65rem 0.8rem;
      }
      select {
        min-height: 2.75rem;
        width: 100%;
        border: 1px solid var(--border);
        background: var(--background);
        color: var(--text);
        padding: 0.65rem 2.25rem 0.65rem 0.8rem;
      }
      button {
        min-height: 2.75rem;
        border: 1px solid transparent;
        background: var(--accent);
        color: #fff;
        cursor: pointer;
        padding: 0.65rem 1rem;
        font-weight: 700;
      }
      @media (prefers-color-scheme: dark) { button { color: #101218; } }
      button:hover:not(:disabled) { background: var(--accent-hover); }
      button:disabled { cursor: wait; opacity: 0.6; }
      button.secondary { border-color: var(--border); background: transparent; color: var(--text); }
      button.secondary:hover:not(:disabled) { background: var(--background); }
      button.danger { border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); background: transparent; color: var(--danger); }
      button.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--danger) 10%, transparent); }
      button.compact { min-height: 2.25rem; padding: 0.4rem 0.65rem; }
      a { color: var(--accent); font-weight: 650; }
      .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
      .team-controls {
        display: grid;
        grid-template-columns: minmax(10rem, 1fr) minmax(15rem, 2fr);
        align-items: end;
        gap: 0.65rem;
        border-block: 1px solid var(--border);
        padding-block: 1rem;
      }
      .team-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.65rem; }
      .invite-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 0.65rem; }
      .invite-form[hidden] { display: none; }
      .invitation-panel { display: grid; gap: 0.65rem; border: 1px solid var(--border); border-radius: 0.65rem; padding: 0.8rem; }
      .invitation-panel[hidden], #member-content[hidden] { display: none; }
      #invitation-content, #member-content { display: grid; gap: 0.5rem; }
      .member-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; border-bottom: 1px solid var(--border); padding-block: 0.5rem; }
      .member-row:last-child { border-bottom: 0; }
      .task-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.65rem; }
      .generated-view { gap: 1.25rem; }
      .semantic-form {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: end;
        gap: 0.65rem;
      }
      .semantic-list + .semantic-list { margin-top: -0.4rem; }
      .semantic-row { display: grid; gap: 0.65rem; }
      .semantic-row > .semantic-form { grid-template-columns: auto minmax(0, 1fr) auto auto; }
      .semantic-value { color: var(--muted); font-size: 0.875rem; overflow-wrap: anywhere; }
      .checkbox-row { display: flex; align-items: center; gap: 0.65rem; font-weight: 500; }
      .checkbox-row input { width: 1.15rem; min-height: 1.15rem; accent-color: var(--accent); }
      .view-mode { border: 1px dashed var(--border); border-radius: 0.65rem; padding: 1.25rem; }
      .task-list { list-style: none; display: grid; gap: 0.6rem; margin: 0; padding: 0; }
      .task {
        min-height: 3rem;
        border: 1px solid var(--border);
        border-radius: 0.65rem;
        padding: 0.7rem 0.8rem;
      }
      .task-editor { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 0.75rem; }
      .task input[type="checkbox"] { width: 1.15rem; min-height: 1.15rem; accent-color: var(--accent); }
      .task-title { min-height: 2.3rem; background: transparent; }
      .task.done .task-title { color: var(--muted); text-decoration: line-through; }
      .task-actions { display: flex; gap: 0.4rem; }
      .skeleton-task { overflow: hidden; }
      .skeleton-component { display: flex; align-items: center; gap: 0.75rem; width: 100%; }
      .skeleton-form { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; }
      .skeleton-box, .skeleton-line, .skeleton-button, .skeleton-block {
        display: block;
        border-radius: 0.4rem;
        background: color-mix(in srgb, var(--muted) 18%, var(--surface));
      }
      .skeleton-box { width: 1.15rem; height: 1.15rem; }
      .skeleton-line { width: min(15rem, 55vw); height: 2.3rem; }
      .skeleton-line-wide { width: min(9rem, 30vw); height: 0.8rem; }
      .skeleton-button { width: 3.5rem; height: 2.25rem; }
      .skeleton-block { width: 100%; height: 2.5rem; }
      .skeleton-width-short { width: 28%; }
      .skeleton-width-medium { width: 58%; }
      .skeleton-width-full { width: 100%; }
      .empty { border: 1px dashed var(--border); border-radius: 0.65rem; padding: 1.25rem; text-align: center; }
      .error { color: var(--danger); min-height: 1.5rem; margin: 0; }
      .sr-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
      @media (max-width: 34rem) {
        .header { align-items: stretch; flex-direction: column; }
        .team-controls, .team-form, .invite-form, .task-form, .semantic-form, .semantic-row > .semantic-form { grid-template-columns: 1fr; }
        .task-editor, .skeleton-form { grid-template-columns: auto minmax(0, 1fr); }
        .task-actions { grid-column: 1 / -1; justify-content: flex-end; }
        .member-row { align-items: stretch; flex-direction: column; }
      }
      @media (prefers-reduced-motion: no-preference) {
        button { transition: background-color 120ms ease, opacity 120ms ease; }
        .skeleton-box, .skeleton-line, .skeleton-button {
          animation: skeleton-pulse 1.4s ease-in-out infinite alternate;
        }
      }
      @keyframes skeleton-pulse { to { opacity: 0.45; } }
    </style>
  </head>
  <body>
    <main id="app" aria-busy="true">${applicationShell}</main>
    <div id="status" class="sr-status" aria-live="polite"></div>
    <script src="${withBasePath(configuration.basePath, '/config.js')}"></script>
    <script type="module" src="${withBasePath(configuration.basePath, '/app.js')}"></script>
  </body>
</html>
`;
