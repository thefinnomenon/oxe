import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const baseUrl = process.env.OXE_TODO_URL ?? 'http://127.0.0.1:3000';
const chrome =
  process.env.OXE_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await mkdtemp(`${tmpdir()}/oxe-chrome-`);
const startedAt = performance.now();
const process_ = spawn(
  chrome,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--no-first-run',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

const browserWebSocket = await new Promise((resolve, reject) => {
  let output = '';
  const timeout = setTimeout(() => reject(new Error('Chrome did not expose DevTools.')), 10_000);
  process_.once('error', reject);
  process_.stderr.on('data', (chunk) => {
    output += String(chunk);
    const match = /DevTools listening on (ws:\/\/[^\s]+)/u.exec(output);
    if (!match?.[1]) return;
    clearTimeout(timeout);
    resolve(match[1]);
  });
});
const debuggerOrigin = new URL(browserWebSocket.replace('ws:', 'http:')).origin;
const target = await fetch(
  `${debuggerOrigin}/json/new?${encodeURIComponent(`${baseUrl}/sign-in`)}`,
  {
    method: 'PUT',
  },
).then((response) => response.json());
if (typeof target.webSocketDebuggerUrl !== 'string')
  throw new Error('Chrome target has no debugger URL.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let nextId = 0;
const pending = new Map();
const events = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (typeof message.id === 'number') {
    const handler = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) handler?.reject(new Error(message.error.message));
    else handler?.resolve(message.result);
    return;
  }
  const listeners = events.get(message.method) ?? [];
  events.delete(message.method);
  listeners.forEach((resolve) => resolve(message.params));
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { reject, resolve });
    socket.send(JSON.stringify({ id, method, params }));
  });
const once = (event) =>
  new Promise((resolve) => {
    const listeners = events.get(event) ?? [];
    listeners.push(resolve);
    events.set(event, listeners);
  });

await send('Page.enable');
await send('Runtime.enable');
await send('Performance.enable');
await send('Emulation.setDeviceMetricsOverride', {
  deviceScaleFactor: 1,
  height: 844,
  mobile: true,
  screenHeight: 844,
  screenWidth: 390,
  width: 390,
});
await send('Emulation.setEmulatedMedia', {
  features: [
    { name: 'prefers-color-scheme', value: 'dark' },
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ],
  media: 'screen',
});
const loaded = once('Page.loadEventFired');
await send('Page.navigate', { url: `${baseUrl}/sign-in` });
await loaded;
await new Promise((resolve) => setTimeout(resolve, 250));
const evaluated = await send('Runtime.evaluate', {
  awaitPromise: true,
  expression: `(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (let index = 0; index < 40 && !document.querySelector('form'); index += 1) await delay(50);
    const form = document.querySelector('form');
    const firstInput = form?.querySelector('input');
    firstInput?.focus();
    const button = form?.querySelector('button');
    const style = getComputedStyle(document.body);
    const buttonStyle = button ? getComputedStyle(button) : undefined;
    const navigation = performance.getEntriesByType('navigation')[0];
    return {
      activeInput: document.activeElement?.getAttribute('name') ?? null,
      backgroundColor: style.backgroundColor,
      buttonName: button?.textContent ?? null,
      buttonTransitionDuration: buttonStyle?.transitionDuration ?? null,
      documentTitle: document.title,
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
      formPresent: Boolean(form),
      inputNames: [...(form?.querySelectorAll('input') ?? [])].map((input) => input.name),
      labels: [...(form?.querySelectorAll('label') ?? [])].map((label) => label.textContent?.trim()),
      mainBusy: document.querySelector('main')?.getAttribute('aria-busy'),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      resourceBytes: performance.getEntriesByType('resource').reduce((total, entry) => total + (entry.transferSize || 0), 0),
    };
  })()`,
  returnByValue: true,
});
const page = evaluated.result?.value;
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `new MutationObserver(() => {
    const node = document.querySelector('[data-oxe-browser-view]');
    if (node && !globalThis.__oxeInitialSsrView) globalThis.__oxeInitialSsrView = node;
  }).observe(document, { childList: true, subtree: true });`,
});
const signUpLoaded = once('Page.loadEventFired');
await send('Page.navigate', { url: `${baseUrl}/sign-up` });
await signUpLoaded;
const credentials = {
  email: 'oxe-browser-conformance@example.test',
  name: 'OXE Browser Conformance',
  password: 'Conformance123!',
};
const submitAuthentication = async () => {
  try {
    await send('Runtime.evaluate', {
      awaitPromise: true,
      expression: `(async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      for (let index = 0; index < 40 && !document.querySelector('form'); index += 1) await delay(50);
      const values = ${JSON.stringify(credentials)};
      for (const [name, value] of Object.entries(values)) {
        const input = document.querySelector('[name="' + name + '"]');
        if (input) input.value = value;
      }
      document.querySelector('form')?.requestSubmit();
      for (let index = 0; index < 80 && location.pathname !== '/tasks'; index += 1) await delay(50);
      return location.pathname;
    })()`,
      returnByValue: true,
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('navigated')) throw error;
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  return send('Runtime.evaluate', {
    expression: 'location.pathname',
    returnByValue: true,
  }).then((result) => result.result?.value === '/tasks');
};
let authenticated = await submitAuthentication();
if (!authenticated) {
  const signInLoaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: `${baseUrl}/sign-in` });
  await signInLoaded;
  authenticated = await submitAuthentication();
}
const hydration = await send('Runtime.evaluate', {
  awaitPromise: true,
  expression: `(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (let index = 0; index < 80 && document.querySelector('main')?.getAttribute('aria-busy') !== 'false'; index += 1) await delay(50);
    const current = document.querySelector('[data-oxe-browser-view]');
    return {
      adopted: Boolean(current && globalThis.__oxeInitialSsrView === current && current.isConnected),
      authenticated: location.pathname === '/tasks',
      hydrationKey: current?.getAttribute('data-oxe-browser-view') ?? null,
    };
  })()`,
  returnByValue: true,
}).then((result) => result.result?.value);
const metrics = await send('Performance.getMetrics');
const metric = Object.fromEntries(metrics.metrics.map(({ name, value }) => [name, value]));
const ssr = await fetch(`${baseUrl}/tasks`).then((response) => response.text());
const generatedRuntimeStatus = await fetch(
  `${baseUrl}/generated/application-client-runtime.js`,
).then((response) => response.status);
const assertions = {
  darkThemeApplied: page.backgroundColor !== 'rgb(247, 247, 245)',
  generatedRuntimeServed: generatedRuntimeStatus === 200,
  authenticatedSsrShellAdopted: authenticated && hydration.adopted,
  keyboardFocusWorks: page.activeInput === 'email',
  labeledAuthenticationFields: page.labels.length === page.inputNames.length,
  mobileHasNoHorizontalOverflow: page.overflow === false,
  reducedMotionApplied: page.buttonTransitionDuration === '0s',
  signInFormRendered: page.formPresent && page.buttonName === 'Sign in',
  ssrHydrationIdentityPresent: ssr.includes('data-oxe-browser-view="app.todo@r16:view.tasks"'),
  ssrSkeletonCollections: (ssr.match(/data-oxe-loading-collection=/gu) ?? []).length === 3,
};
const failed = Object.entries(assertions)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);
const report = {
  assertions,
  browser: 'Google Chrome headless',
  metrics: {
    domContentLoadedMs: page.domContentLoadedMs,
    jsHeapUsedBytes: metric.JSHeapUsedSize,
    resourceBytes: page.resourceBytes,
    scriptDurationMs: metric.ScriptDuration * 1_000,
    startupAndNavigationWallMs: performance.now() - startedAt,
  },
  page,
  hydration,
  schemaVersion: 'oxe.browser-conformance.v1',
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
socket.close();
process_.kill('SIGTERM');
await rm(profile, { force: true, recursive: true });
if (failed.length > 0) throw new Error(`Browser conformance failed: ${failed.join(', ')}`);
