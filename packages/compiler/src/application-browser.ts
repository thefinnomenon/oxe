import type { ApplicationGraphV1 } from '@oxe/graph';

const header = '/* Generated from the normalized OXE application graph. Do not edit. */';

/** Shared, graph-agnostic browser host copied into production application builds. */
export const generateApplicationBrowserHostRuntime = (): string => `${header}
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const readJson = async (response) => {
  const text = await response.text();
  if (!text) return undefined;
  try { return JSON.parse(text); }
  catch { throw new Error('Server returned invalid JSON (' + response.status + ').'); }
};
const errorMessage = (value, fallback) =>
  isRecord(value) && typeof value.message === 'string' ? value.message :
    isRecord(value) && isRecord(value.error) && typeof value.error.message === 'string' ? value.error.message : fallback;

export const startApplicationBrowserHost = async ({ bootstrapClient, components, developmentParentOrigin, loadView }) => {
  const applicationView = await loadView(location.pathname);
  if (!applicationView) { location.replace('/'); return; }
  const app = document.querySelector('#app');
  const status = document.querySelector('#status');
  if (!app || !status) throw new Error('Application page shell is incomplete.');
  const announce = (message) => { status.textContent = message; };
  const semanticTarget = (element) => {
    const annotated = element.closest('[data-oxe-semantic-id], [data-oxe-operation-id], [data-oxe-field-id], [data-oxe-interaction-label]') ?? element;
    const tag = element.tagName.toLowerCase();
    return {
      control: tag === 'a' ? 'link' : tag === 'textarea' ? 'input' : ['button', 'form', 'input', 'select'].includes(tag) ? tag : 'other',
      ...(annotated.dataset.oxeSemanticId ? { elementId: annotated.dataset.oxeSemanticId } : {}),
      ...(annotated.dataset.oxeFieldId ? { fieldId: annotated.dataset.oxeFieldId } : {}),
      ...(annotated.dataset.oxeInteractionLabel ? { label: annotated.dataset.oxeInteractionLabel } : {}),
      ...(annotated.dataset.oxeOperationId ? { operationId: annotated.dataset.oxeOperationId } : {}),
    };
  };
  const developmentOrigin = (() => {
    if (!developmentParentOrigin) return undefined;
    try { const url = new URL(developmentParentOrigin); return ['http:', 'https:'].includes(url.protocol) && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password ? url.origin : undefined; }
    catch { return undefined; }
  })();
  let developmentSequence = 0;
  const emitDevelopment = (kind, target, outcome) => {
    if (!developmentOrigin || parent === window) return;
    parent.postMessage({
      at: Date.now(), kind, ...(outcome ? { outcome } : {}), route: location.pathname,
      schemaVersion: 'oxe.application-development-interaction.v1', sequence: ++developmentSequence,
      ...(target ? { target } : {}),
    }, developmentOrigin);
  };
  const annotate = (node, element, invocation, fieldId, label) => {
    if (element.id) node.dataset.oxeSemanticId = element.id;
    if (fieldId) node.dataset.oxeFieldId = fieldId;
    if (invocation) node.dataset.oxeOperationId = invocation.operation;
    if (label) node.dataset.oxeInteractionLabel = label.slice(0, 160);
    return node;
  };
  if (developmentOrigin && parent !== window) {
    for (const kind of ['click', 'change', 'submit']) document.addEventListener(kind, (event) => {
      if (event.target instanceof HTMLElement) emitDevelopment(kind, semanticTarget(event.target));
    }, true);
    emitDevelopment('navigation');
  }
  const authentication = applicationView.authentication;
  const authRequest = async (endpoint, body) => {
    const response = await fetch('/api/auth/' + endpoint, {
      ...(body ? { body: JSON.stringify(body) } : {}),
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : {},
      method: 'POST',
    });
    const value = await readJson(response);
    if (!response.ok) throw new Error(errorMessage(value, 'Authentication failed.'));
  };
  const sessionUser = async () => {
    if (!authentication) return undefined;
    const response = await fetch('/api/auth/get-session', { credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (!response.ok) return undefined;
    const value = await readJson(response);
    if (!isRecord(value) || !isRecord(value.user)) return undefined;
    const { email, id, name } = value.user;
    return typeof email === 'string' && typeof id === 'string' && typeof name === 'string' ? { email, id, name } : undefined;
  };
  const user = await sessionUser();
  if (location.pathname === '/') {
    location.replace(user || !authentication ? applicationView.route.path : authentication.signInPath);
    return;
  }
  const renderAuthentication = (signingUp) => {
    const section = document.createElement('section');
    section.className = 'card stack auth-card';
    const heading = document.createElement('h1');
    heading.textContent = signingUp ? 'Create your account' : 'Sign in to ' + applicationView.appName;
    const form = document.createElement('form');
    form.className = 'stack';
    const error = document.createElement('p');
    error.className = 'error'; error.setAttribute('role', 'alert');
    const input = (labelText, name, type, autocomplete) => {
      const label = document.createElement('label'); label.textContent = labelText;
      const control = document.createElement('input');
      control.name = name; control.type = type; control.autocomplete = autocomplete; control.required = true;
      label.append(control); return label;
    };
    if (signingUp) form.append(input('Name', 'name', 'text', 'name'));
    form.append(input('Email', 'email', 'email', 'email'), input('Password', 'password', 'password', signingUp ? 'new-password' : 'current-password'), error);
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = signingUp ? 'Create account' : 'Sign in';
    const alternative = document.createElement('a');
    alternative.href = signingUp ? authentication.signInPath : authentication.signUpPath;
    alternative.textContent = signingUp ? 'Already have an account? Sign in' : 'New here? Create an account';
    form.append(submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault(); const data = new FormData(form); submit.disabled = true; error.textContent = '';
      const email = data.get('email'); const password = data.get('password'); const name = data.get('name');
      if (typeof email !== 'string' || typeof password !== 'string') return;
      void authRequest(signingUp ? 'sign-up/email' : 'sign-in/email', signingUp && typeof name === 'string' ? { email, name, password } : { email, password })
        .then(() => location.assign(applicationView.route.path))
        .catch((caught) => { error.textContent = caught instanceof Error ? caught.message : 'Authentication failed.'; submit.disabled = false; });
    });
    section.append(heading, form, alternative); app.replaceChildren(section); app.setAttribute('aria-busy', 'false');
  };
  if (authentication && (location.pathname === authentication.signInPath || location.pathname === authentication.signUpPath)) {
    if (user) location.replace(applicationView.route.path);
    else renderAuthentication(location.pathname === authentication.signUpPath);
    return;
  }
  if (authentication && !user) { location.replace(authentication.signInPath); return; }

  const fields = new Map(applicationView.fields.map((field) => [field.id, field]));
  const functions = new Map(applicationView.functions.map((definition) => [definition.semanticId, definition]));
  const contexts = new Map(applicationView.contexts.map((context) => [context.id, context]));
  const primaryContexts = applicationView.contexts.filter((context, index, all) => all.findIndex((candidate) => candidate.entityId === context.entityId) === index);
  const selected = new Map(); const optionsByEntity = new Map(); const clients = new Map();
  const contextKey = (values) => [...values].sort().join('\\u0000');
  const call = (client, name, arguments_) => {
    const method = Reflect.get(client, name);
    if (typeof method !== 'function') throw new TypeError('Generated client method ' + name + ' is unavailable.');
    return Reflect.apply(method, client, arguments_);
  };
  const contextOptions = async (contextId) => {
    const response = await fetch('/api/context-options?contextId=' + encodeURIComponent(contextId), { credentials: 'same-origin', headers: { accept: 'application/json' } });
    const value = await readJson(response);
    if (!response.ok) throw new Error(errorMessage(value, 'Could not load available contexts.'));
    if (!Array.isArray(value)) throw new Error('Server returned invalid context options.');
    return value;
  };
  const reloadContexts = async (preferred = {}) => {
    for (const context of primaryContexts) {
      const values = await contextOptions(context.id); optionsByEntity.set(context.entityId, values);
      const requested = preferred[context.entityId] ?? selected.get(context.entityId);
      const choice = values.find((option) => option.recordId === requested) ?? values[0];
      if (choice) selected.set(context.entityId, choice.recordId); else selected.delete(context.entityId);
    }
  };
  const buildClients = async () => {
    for (const client of clients.values()) client.clearCache(); clients.clear();
    if (applicationView.functions.some((definition) => definition.clientModule === 'account-client'))
      clients.set('', await bootstrapClient('account-client'));
    const groups = new Map();
    for (const definition of applicationView.functions)
      if (definition.contexts.length) groups.set(contextKey(definition.contexts), definition);
    for (const [key, definition] of groups) {
      const requestedContexts = definition.contexts.flatMap((contextId) => {
        const context = contexts.get(contextId); const recordId = context ? selected.get(context.entityId) : undefined;
        return recordId ? [{ contextId, recordId }] : [];
      });
      if (requestedContexts.length !== definition.contexts.length) continue;
      try { clients.set(key, await bootstrapClient(definition.clientModule, { requestedContexts })); }
      catch (error) { if (!isRecord(error) || error.status !== 403) throw error; }
    }
  };
  const clientFor = (definition) => definition ? clients.get(contextKey(definition.contexts)) : undefined;
  const evaluate = (expression, environment) => {
    switch (expression.kind) {
      case 'literal': return expression.value;
      case 'local': return environment.locals[expression.name];
      case 'viewData': return environment.data[expression.name];
      case 'formValue': return environment.form?.get(expression.name);
      case 'not': return !evaluate(expression.value, environment);
      case 'semanticReference': return expression.target;
      case 'activeContext': { const context = contexts.get(expression.context); return context ? selected.get(context.entityId) : undefined; }
      case 'recordField': { const record = evaluate(expression.record, environment); const field = fields.get(expression.field); return isRecord(record) && field ? record[field.name] : undefined; }
      default: return undefined;
    }
  };
  const operationAvailable = (invocation) => clientFor(functions.get(invocation.operation)) !== undefined;
  let viewContent; let viewError; let contextControls;
  const showError = (error) => { if (viewError) viewError.textContent = error instanceof Error ? error.message : 'The action could not be completed.'; announce('The action could not be completed.'); };
  const invoke = async (invocation, environment) => {
    emitDevelopment('operation', { control: 'other', operationId: invocation.operation }, 'started');
    try {
      const definition = functions.get(invocation.operation); const client = clientFor(definition);
      if (!definition || !client) throw new Error('This action is unavailable in the active context.');
      const arguments_ = definition.parameters.map((name) => evaluate(invocation.arguments[name], environment));
      const result = await call(client, definition.name, arguments_); announce(definition.name + ' completed.');
      if (definition.refreshContexts) {
        const preferred = {};
        if (definition.outputEntity && isRecord(result)) {
          const idField = applicationView.fields.find((field) => field.entity === definition.outputEntity && field.valueType.kind === 'entityId');
          if (idField && typeof result[idField.name] === 'string') preferred[definition.outputEntity] = result[idField.name];
        }
        await reloadContexts(preferred); await buildClients(); renderContextControls();
      }
      await loadViewData(); emitDevelopment('operation', { control: 'other', operationId: invocation.operation }, 'succeeded');
    } catch (error) {
      emitDevelopment('operation', { control: 'other', operationId: invocation.operation }, 'failed'); throw error;
    }
  };
  const prop = (element, name, environment) => element.props?.[name] ? evaluate(element.props[name], environment) : undefined;
  const renderElement = (element, environment) => {
    if (element.kind === 'repeat') {
      const list = annotate(document.createElement('ul'), element); list.className = 'semantic-list';
      const records = evaluate(element.source, environment); const values = Array.isArray(records) ? records : [];
      if (!values.length) { const empty = document.createElement('li'); empty.className = 'muted'; empty.textContent = applicationView.modes.empty.message; list.append(empty); }
      for (const record of values) {
        const item = document.createElement('li'); item.className = 'semantic-row';
        const next = { ...environment, locals: { ...environment.locals, [element.itemName]: record } };
        for (const fieldId of element.display ?? []) { const field = fields.get(fieldId); const output = document.createElement('span'); output.textContent = (field?.name ?? fieldId) + ': ' + String(field && isRecord(record) ? record[field.name] ?? '' : ''); item.append(output); }
        item.append(renderElement(element.template, next)); list.append(item);
      }
      return list;
    }
    const customTag = components[element.component];
    if (customTag) {
      const custom = document.createElement(customTag);
      for (const [name, expression] of Object.entries(element.props ?? {})) {
        const value = evaluate(expression, environment); custom[name] = value;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') custom.setAttribute(name, String(value));
      }
      for (const [name, invocation] of Object.entries(element.events ?? {}))
        custom.addEventListener(name, () => void invoke(invocation, environment).catch(showError));
      for (const child of element.children ?? []) custom.append(renderElement(child, environment));
      return annotate(custom, element);
    }
    if (element.component === 'ui.Heading') { const output = document.createElement('h1'); output.textContent = String(prop(element, 'text', environment) ?? ''); return annotate(output, element); }
    if (element.component === 'ui.Text') { const output = document.createElement('p'); output.textContent = String(prop(element, 'text', environment) ?? ''); return annotate(output, element); }
    if (element.component === 'ui.Link') { const output = document.createElement('a'); output.textContent = String(prop(element, 'text', environment) ?? ''); output.href = String(prop(element, 'href', environment) ?? '#'); return annotate(output, element, undefined, undefined, typeof element.props?.text?.value === 'string' ? element.props.text.value : undefined); }
    if (element.component === 'ui.TextField' || element.component === 'ui.TextArea' || element.component === 'ui.NumberField') {
      const label = document.createElement('label'); label.textContent = String(prop(element, 'label', environment) ?? 'Field');
      const control = element.component === 'ui.TextArea' ? document.createElement('textarea') : document.createElement('input');
      control.name = String(prop(element, 'name', environment) ?? 'value');
      if (element.component === 'ui.NumberField') control.type = 'number';
      const value = prop(element, 'value', environment); if (typeof value === 'string' || typeof value === 'number') control.value = String(value);
      const source = prop(element, 'sourceField', environment); const field = typeof source === 'string' ? fields.get(source) : undefined; control.required = field?.required ?? false;
      annotate(control, element, undefined, typeof source === 'string' ? source : undefined, typeof element.props?.label?.value === 'string' ? element.props.label.value : undefined); label.append(control); return annotate(label, element);
    }
    if (element.component === 'ui.CheckboxRow') {
      const label = document.createElement('label'); label.className = 'checkbox-row'; const input = document.createElement('input'); input.type = 'checkbox'; input.checked = Boolean(prop(element, 'checked', environment));
      const text = document.createElement('span'); text.textContent = String(prop(element, 'label', environment) ?? ''); const change = element.events?.change;
      if (change && operationAvailable(change)) input.addEventListener('change', () => { input.disabled = true; void invoke(change, environment).catch(showError); }); else input.disabled = true;
      annotate(input, element, change, undefined, typeof element.props?.label?.value === 'string' ? element.props.label.value : undefined); label.append(input, text); return annotate(label, element);
    }
    if (element.component === 'ui.Button') {
      const button = document.createElement('button'); button.type = prop(element, 'type', environment) === 'submit' ? 'submit' : 'button'; button.textContent = String(prop(element, 'text', environment) ?? 'Continue');
      const click = element.events?.click;
      if (click) { if (!operationAvailable(click)) button.hidden = true; else button.addEventListener('click', (event) => { event.preventDefault(); button.disabled = true; void invoke(click, environment).catch(showError); }); }
      return annotate(button, element, click, undefined, typeof element.props?.text?.value === 'string' ? element.props.text.value : undefined);
    }
    const container = element.component === 'ui.Form' ? document.createElement('form') : document.createElement('div');
    annotate(container, element, element.submit);
    container.className = element.component === 'ui.Row' ? 'row' : 'stack';
    for (const child of element.children ?? []) container.append(renderElement(child, environment));
    if (element.component === 'ui.Form' && element.submit) container.addEventListener('submit', (event) => { event.preventDefault(); void invoke(element.submit, { ...environment, form: new FormData(container) }).catch(showError); });
    return container;
  };
  const renderMode = (name) => { const mode = applicationView.modes[name]; const section = document.createElement('section'); const heading = document.createElement('h2'); heading.textContent = mode.title; const message = document.createElement('p'); message.textContent = mode.message; section.append(heading, message); viewContent.replaceChildren(section); };
  const loadViewData = async () => {
    viewContent.setAttribute('aria-busy', 'true'); viewError.textContent = '';
    try {
      const entries = await Promise.all(Object.entries(applicationView.view.data).map(async ([name, binding]) => { const definition = functions.get(binding.query); const client = clientFor(definition); return [name, definition && client ? await call(client, definition.name, []) : []]; }));
      viewContent.replaceChildren(renderElement(applicationView.view.tree, { data: Object.fromEntries(entries), locals: {} })); viewContent.setAttribute('aria-busy', 'false');
    } catch (error) { renderMode(isRecord(error) && error.status === 403 ? 'forbidden' : isRecord(error) && error.status === 401 ? 'unauthorized' : 'error'); showError(error); }
  };
  const renderContextControls = () => {
    contextControls.replaceChildren();
    for (const context of primaryContexts) {
      const label = document.createElement('label'); label.textContent = context.name; const select = document.createElement('select'); const values = optionsByEntity.get(context.entityId) ?? [];
      if (!values.length) { const option = document.createElement('option'); option.textContent = 'No ' + context.name.toLowerCase() + ' available'; select.append(option); select.disabled = true; }
      else { for (const value of values) { const option = document.createElement('option'); option.textContent = value.label; option.value = value.recordId; select.append(option); } select.value = selected.get(context.entityId) ?? values[0].recordId; select.addEventListener('change', () => { selected.set(context.entityId, select.value); void buildClients().then(loadViewData).catch(showError); }); }
      label.append(select); contextControls.append(label);
    }
  };
  const existing = app.querySelector('[data-oxe-browser-view="' + CSS.escape(applicationView.hydrationKey) + '"]');
  const section = existing ?? document.createElement('section'); section.className = 'card stack'; section.dataset.oxeBrowserView = applicationView.hydrationKey;
  const headerElement = section.querySelector('[data-oxe-shell-header]') ?? document.createElement('header'); headerElement.dataset.oxeShellHeader = ''; headerElement.className = 'row header';
  const identity = document.createElement('div'); const name = document.createElement('strong'); name.textContent = user?.name ?? applicationView.appName; const detail = document.createElement('p'); detail.className = 'muted'; detail.textContent = user?.email ?? ''; identity.append(name, detail);
  const signOut = document.createElement('button'); signOut.type = 'button'; signOut.textContent = 'Sign out'; signOut.hidden = !authentication; headerElement.replaceChildren(identity, signOut);
  contextControls = section.querySelector('[data-oxe-context-controls]') ?? document.createElement('section'); contextControls.dataset.oxeContextControls = ''; contextControls.className = 'row';
  viewError = section.querySelector('[data-oxe-view-error]') ?? document.createElement('p'); viewError.dataset.oxeViewError = ''; viewError.className = 'error'; viewError.setAttribute('role', 'alert');
  viewContent = section.querySelector('[data-oxe-view-content]') ?? document.createElement('div'); viewContent.dataset.oxeViewContent = '';
  if (!existing) { section.append(headerElement, contextControls, viewError, viewContent); app.replaceChildren(section); }
  signOut.addEventListener('click', () => void authRequest('sign-out').then(() => location.assign(authentication.signInPath)).catch(showError));
  await reloadContexts(); await buildClients(); renderContextControls(); await loadViewData(); app.setAttribute('aria-busy', 'false');
};
`;

/** Small route-specific bootstrap over the shared browser host and lazy generated clients. */
export const generateApplicationBrowserStart = (graph: ApplicationGraphV1): string => {
  const routes = [...graph.routes].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const authentication = graph.app.authentication;
  const routeEntries = routes.map((route) => {
    const view = graph.views.find(({ id }) => id === route.view);
    if (!view) throw new TypeError(`Application route "${route.id}" has no view.`);
    return [route.path, `./views/${view.id}.js`] as const;
  });
  const defaultModule = routeEntries.find(([path]) => path === '/')?.[1] ?? routeEntries[0]?.[1];
  const components = Object.fromEntries(
    [...(graph.components ?? [])]
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((component) => [component.id, component.ssr.tag]),
  );
  return `${header}
import { bootstrapApplicationClientModule } from './application-client-loader.js';
import { startApplicationBrowserHost } from './application-browser-host.js';
${graph.components?.length ? "import './extensions.js';\n" : ''}
const routes = Object.freeze({${routeEntries
    .map(([path, module]) => `${JSON.stringify(path)}: () => import(${JSON.stringify(module)})`)
    .join(',')}});
const authenticationPaths = new Set(${JSON.stringify(
    authentication ? [authentication.signInPath, authentication.signUpPath] : [],
  )});
const loadView = async (path) => {
  const load = routes[path] ?? (authenticationPaths.has(path) || path === '/' ? ${defaultModule ? `() => import(${JSON.stringify(defaultModule)})` : 'undefined'} : undefined);
  return load ? (await load()).applicationView : undefined;
};
void startApplicationBrowserHost({ bootstrapClient: bootstrapApplicationClientModule, components: Object.freeze(${JSON.stringify(components)}), developmentParentOrigin: globalThis.__OXE_APPLICATION_DEVELOPMENT__?.parentOrigin, loadView }).catch((error) => {
  console.error(error);
  const app = document.querySelector('#app');
  if (app) { app.setAttribute('aria-busy', 'false'); app.textContent = 'The application could not start.'; }
});
`;
};
