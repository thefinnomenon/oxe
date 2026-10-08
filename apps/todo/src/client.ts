import type {
  ApplicationFieldV1,
  ApplicationOperationInvocationV1,
  ApplicationValueExpressionV1,
  ApplicationViewElementV1,
} from '@oxe/graph';
import type { ApplicationSkeletonNodeV1 } from '@oxe/compiler';

import {
  bootstrapApplicationClientModule,
  type ApplicationClientHandleV1,
  type ApplicationClientModuleNameV1,
} from './generated/application-client-loader.js';
import { applicationView } from './generated/application-view.js';
import { installApplicationDevelopmentBridge } from './development.js';

interface TodoBrowserConfigurationV1 {
  readonly authBasePath: string;
  readonly basePath: string;
  readonly developmentParentOrigin?: string;
}

interface SessionUserV1 {
  readonly email: string;
  readonly id: string;
  readonly name: string;
}

interface ContextOptionV1 {
  readonly contextId: string;
  readonly entityId: string;
  readonly label: string;
  readonly recordId: string;
}

type ViewFunctionV1 = (typeof applicationView.functions)[number];

declare global {
  interface Window {
    readonly __OXE_TODO__: TodoBrowserConfigurationV1;
  }
}

const configuration = window.__OXE_TODO__;
const withBasePath = (path: string): string =>
  configuration.basePath === '/' ? path : `${configuration.basePath}${path}`;
const applicationPath = (path: string): string | undefined => {
  if (configuration.basePath === '/') return path;
  if (path === configuration.basePath) return '/';
  return path.startsWith(`${configuration.basePath}/`)
    ? path.slice(configuration.basePath.length)
    : undefined;
};
const development = installApplicationDevelopmentBridge(configuration.developmentParentOrigin);
const app = document.querySelector<HTMLElement>('#app');
const status = document.querySelector<HTMLElement>('#status');
if (!app || !status) throw new Error('Application page shell is incomplete.');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const announce = (message: string): void => {
  status.textContent = message;
};

const errorMessage = (value: unknown, fallback: string): string => {
  if (isRecord(value) && typeof value.message === 'string') return value.message;
  if (isRecord(value) && isRecord(value.error) && typeof value.error.message === 'string')
    return value.error.message;
  return fallback;
};

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Server returned invalid JSON (${response.status}).`);
  }
};

const sessionUser = async (): Promise<SessionUserV1 | undefined> => {
  const response = await fetch(`${configuration.authBasePath}/get-session`, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) return undefined;
  const value = await readJson(response);
  if (!isRecord(value) || !isRecord(value.user)) return undefined;
  const { email, id, name } = value.user;
  return typeof email === 'string' && typeof id === 'string' && typeof name === 'string'
    ? { email, id, name }
    : undefined;
};

const contextOptions = async (contextId: string): Promise<readonly ContextOptionV1[]> => {
  const response = await fetch(
    `${withBasePath('/api/context-options')}?contextId=${encodeURIComponent(contextId)}`,
    {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    },
  );
  const value = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(value, 'Could not load available contexts.'));
  if (!Array.isArray(value)) throw new Error('Server returned invalid context options.');
  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.contextId !== 'string' ||
      typeof item.entityId !== 'string' ||
      typeof item.label !== 'string' ||
      typeof item.recordId !== 'string'
    )
      throw new Error('Server returned an invalid context option.');
    return {
      contextId: item.contextId,
      entityId: item.entityId,
      label: item.label,
      recordId: item.recordId,
    };
  });
};

const authenticationRequest = async (
  endpoint: string,
  body?: Readonly<Record<string, string>>,
): Promise<void> => {
  const response = await fetch(`${configuration.authBasePath}/${endpoint}`, {
    ...(body ? { body: JSON.stringify(body) } : {}),
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    method: 'POST',
  });
  const value = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(value, 'Authentication failed.'));
};

const modeForError = (error: unknown): keyof typeof applicationView.modes => {
  if (isRecord(error)) {
    if (error.status === 401 || error.kind === 'unauthorized') return 'unauthorized';
    if (error.status === 403 || error.kind === 'forbidden') return 'forbidden';
    if (error.status === 404 || error.kind === 'not-found') return 'notFound';
  }
  return 'error';
};

const renderMode = (target: HTMLElement, name: keyof typeof applicationView.modes): void => {
  const mode = applicationView.modes[name];
  const section = document.createElement('section');
  section.className = `view-mode view-mode-${name}`;
  section.setAttribute('aria-busy', String(mode.ariaBusy));
  const heading = document.createElement('h2');
  heading.textContent = mode.title;
  const message = document.createElement('p');
  message.className = name === 'error' ? 'error' : 'muted';
  message.textContent = mode.message;
  section.append(heading, message);
  target.replaceChildren(section);
};

const skeletonNode = (descriptor: ApplicationSkeletonNodeV1): HTMLElement => {
  if (descriptor.kind === 'collection') return skeletonNode(descriptor.template);
  const element = document.createElement('div');
  element.className = `skeleton-component skeleton-${descriptor.component.replace('ui.', '').toLowerCase()}`;
  element.setAttribute('aria-hidden', 'true');
  if (descriptor.shape) {
    const placeholder = document.createElement('span');
    placeholder.className = `skeleton-${descriptor.shape === 'control' ? 'button' : descriptor.shape}${descriptor.width ? ` skeleton-width-${descriptor.width}` : ''}`;
    element.append(placeholder);
    return element;
  }
  if (descriptor.component === 'ui.CheckboxRow') {
    const checkbox = document.createElement('span');
    checkbox.className = 'skeleton-box';
    const line = document.createElement('span');
    line.className = 'skeleton-line skeleton-line-wide';
    element.append(checkbox, line);
    return element;
  }
  if (descriptor.component === 'ui.TextField') {
    const line = document.createElement('span');
    line.className = 'skeleton-line';
    element.append(line);
    return element;
  }
  if (descriptor.component === 'ui.Button') {
    const button = document.createElement('span');
    button.className = 'skeleton-button';
    element.append(button);
    return element;
  }
  descriptor.children.forEach((child) => element.append(skeletonNode(child)));
  return element;
};

const renderSkeleton = (target: HTMLElement): void => {
  target.replaceChildren();
  target.setAttribute('aria-busy', 'true');
  for (const collection of applicationView.loading.collections) {
    for (let row = 0; row < collection.rows; row += 1) {
      const item = document.createElement('div');
      item.className = 'task skeleton-task';
      item.append(skeletonNode(collection.template));
      target.append(item);
    }
  }
};

const renderAuthentication = (mode: 'signIn' | 'signUp'): void => {
  const signingUp = mode === 'signUp';
  const authentication = applicationView.authentication;
  if (!authentication) throw new Error('The application does not declare authentication.');
  const section = document.createElement('section');
  section.className = 'card auth-card stack';
  const heading = document.createElement('h1');
  heading.textContent = signingUp ? 'Create your account' : `Sign in to ${applicationView.appName}`;
  const form = document.createElement('form');
  form.className = 'stack';
  const error = document.createElement('p');
  error.className = 'error';
  error.setAttribute('role', 'alert');
  const input = (
    labelText: string,
    name: string,
    type: string,
    autocomplete: string,
  ): HTMLLabelElement => {
    const label = document.createElement('label');
    label.textContent = labelText;
    const control = document.createElement('input');
    control.name = name;
    control.type = type;
    control.setAttribute('autocomplete', autocomplete);
    control.required = true;
    label.append(control);
    return label;
  };
  if (signingUp) form.append(input('Name', 'name', 'text', 'name'));
  form.append(
    input('Email', 'email', 'email', 'email'),
    input('Password', 'password', 'password', signingUp ? 'new-password' : 'current-password'),
    error,
  );
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = signingUp ? 'Create account' : 'Sign in';
  development.annotate(submit, { label: submit.textContent });
  form.append(submit);
  const alternative = document.createElement('a');
  alternative.href = withBasePath(
    signingUp ? authentication.signInPath : authentication.signUpPath,
  );
  alternative.textContent = signingUp
    ? 'Already have an account? Sign in'
    : 'New here? Create an account';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const email = data.get('email');
    const password = data.get('password');
    const name = data.get('name');
    if (typeof email !== 'string' || typeof password !== 'string') return;
    submit.disabled = true;
    error.textContent = '';
    void authenticationRequest(
      signingUp ? 'sign-up/email' : 'sign-in/email',
      signingUp && typeof name === 'string' ? { email, name, password } : { email, password },
    )
      .then(() => window.location.assign(withBasePath(applicationView.route.path)))
      .catch((caught: unknown) => {
        error.textContent = caught instanceof Error ? caught.message : 'Authentication failed.';
        submit.disabled = false;
      });
  });
  section.append(heading, form, alternative);
  app.replaceChildren(section);
  app.setAttribute('aria-busy', 'false');
};

const fieldsById = new Map<string, ApplicationFieldV1>(
  (applicationView.fields as readonly ApplicationFieldV1[]).map((field) => [field.id, field]),
);
const functionsBySemanticId = new Map<string, ViewFunctionV1>(
  applicationView.functions.map((definition) => [definition.semanticId, definition]),
);
const contextById = new Map<string, (typeof applicationView.contexts)[number]>(
  applicationView.contexts.map((context) => [context.id, context]),
);
const primaryContexts = applicationView.contexts.filter(
  (context, index, contexts) =>
    contexts.findIndex((candidate) => candidate.entityId === context.entityId) === index,
);
const selectedRecords = new Map<string, string>();
const optionsByEntity = new Map<string, readonly ContextOptionV1[]>();
const clients = new Map<string, ApplicationClientHandleV1>();

const contextKey = (contexts: readonly string[]): string => [...contexts].sort().join('\u0000');

const callClient = async (
  client: ApplicationClientHandleV1,
  name: string,
  arguments_: readonly unknown[],
): Promise<unknown> => {
  const method: unknown = Reflect.get(client, name);
  if (typeof method !== 'function')
    throw new TypeError(`Generated client method ${name} is unavailable.`);
  return Reflect.apply(method, client, arguments_) as Promise<unknown>;
};

const clientFor = (definition: ViewFunctionV1): ApplicationClientHandleV1 | undefined =>
  clients.get(contextKey(definition.contexts));

const reloadContextOptions = async (
  preferred?: Readonly<Record<string, string>>,
): Promise<void> => {
  for (const context of primaryContexts) {
    const options = await contextOptions(context.id);
    optionsByEntity.set(context.entityId, options);
    const requested = preferred?.[context.entityId] ?? selectedRecords.get(context.entityId);
    const selected = options.find((option) => option.recordId === requested) ?? options[0];
    if (selected) selectedRecords.set(context.entityId, selected.recordId);
    else selectedRecords.delete(context.entityId);
  }
};

const buildClients = async (): Promise<void> => {
  clients.forEach((client) => client.clearCache());
  clients.clear();
  const endpoints = {
    contextEndpoint: withBasePath('/api/context'),
    endpoint: withBasePath('/api/functions'),
  };
  clients.set('', await bootstrapApplicationClientModule('account-client', endpoints));
  const contextSets = new Map<
    string,
    { readonly contexts: readonly string[]; readonly module: ApplicationClientModuleNameV1 }
  >();
  applicationView.functions.forEach((definition) => {
    if (definition.contexts.length > 0)
      contextSets.set(contextKey(definition.contexts), {
        contexts: definition.contexts,
        module: definition.clientModule,
      });
  });
  for (const [key, contextSet] of contextSets) {
    const contextIds = contextSet.contexts;
    const requestedContexts = contextIds.flatMap((contextId) => {
      const context = contextById.get(contextId);
      const recordId = context ? selectedRecords.get(context.entityId) : undefined;
      return recordId ? [{ contextId, recordId }] : [];
    });
    if (requestedContexts.length !== contextIds.length) continue;
    try {
      clients.set(
        key,
        await bootstrapApplicationClientModule(contextSet.module, {
          ...endpoints,
          requestedContexts,
        }),
      );
    } catch (error) {
      if (!isRecord(error) || error.status !== 403) throw error;
    }
  }
};

interface RenderEnvironmentV1 {
  readonly data: Readonly<Record<string, unknown>>;
  readonly form?: FormData;
  readonly locals: Readonly<Record<string, unknown>>;
}

const evaluate = (
  expression: ApplicationValueExpressionV1,
  environment: RenderEnvironmentV1,
): unknown => {
  switch (expression.kind) {
    case 'literal':
      return expression.value;
    case 'local':
      return environment.locals[expression.name];
    case 'viewData':
      return environment.data[expression.name];
    case 'formValue':
      return environment.form?.get(expression.name);
    case 'not':
      return !evaluate(expression.value, environment);
    case 'recordField': {
      const record = evaluate(expression.record, environment);
      const field = fieldsById.get(expression.field);
      return isRecord(record) && field ? record[field.name] : undefined;
    }
    case 'semanticReference':
      return expression.target;
    case 'activeContext': {
      const context = contextById.get(expression.context);
      return context ? selectedRecords.get(context.entityId) : undefined;
    }
    case 'actor':
    case 'inputField':
      return undefined;
  }
};

let viewContent: HTMLElement | undefined;
let viewError: HTMLElement | undefined;
let contextControls: HTMLElement | undefined;

const invoke = async (
  invocation: ApplicationOperationInvocationV1,
  environment: RenderEnvironmentV1,
): Promise<void> => {
  development.operation(invocation.operation, 'started');
  try {
    const definition = functionsBySemanticId.get(invocation.operation);
    const client = definition ? clientFor(definition) : undefined;
    if (!definition || !client)
      throw new Error('This action is unavailable in the active context.');
    const arguments_ = definition.parameters.map((name) => {
      const expression = invocation.arguments[name];
      if (!expression) throw new Error(`Action ${definition.name} is missing argument ${name}.`);
      return evaluate(expression as ApplicationValueExpressionV1, environment);
    });
    const result = await callClient(client, definition.name, arguments_);
    announce(`${definition.name} completed.`);
    if (definition.refreshContexts) {
      const preferred: Record<string, string> = {};
      if (definition.outputEntity && isRecord(result)) {
        const idField = applicationView.fields.find(
          (field) =>
            field.entity === definition.outputEntity && field.valueType.kind === 'entityId',
        );
        const id = idField ? result[idField.name] : undefined;
        if (typeof id === 'string') preferred[definition.outputEntity] = id;
      }
      await reloadContextOptions(preferred);
      await buildClients();
      renderContextControls();
    }
    await loadAndRenderView();
    development.operation(invocation.operation, 'succeeded');
  } catch (error) {
    development.operation(invocation.operation, 'failed');
    throw error;
  }
};

const operationAvailable = (invocation: ApplicationOperationInvocationV1): boolean => {
  const definition = functionsBySemanticId.get(invocation.operation);
  return Boolean(definition && clientFor(definition));
};

const prop = (
  element: Extract<ApplicationViewElementV1, { readonly kind: 'component' }>,
  name: string,
  environment: RenderEnvironmentV1,
): unknown => {
  const expression = element.props?.[name];
  return expression ? evaluate(expression, environment) : undefined;
};

const staticTextProp = (
  element: Extract<ApplicationViewElementV1, { readonly kind: 'component' }>,
  name: string,
): string | undefined => {
  const expression = element.props?.[name];
  return expression?.kind === 'literal' && typeof expression.value === 'string'
    ? expression.value
    : undefined;
};

const renderElement = (
  element: ApplicationViewElementV1,
  environment: RenderEnvironmentV1,
): HTMLElement => {
  if (element.kind === 'repeat') {
    if (element.source.kind === 'viewData') {
      const binding =
        applicationView.view.data[element.source.name as keyof typeof applicationView.view.data];
      const definition = binding ? functionsBySemanticId.get(binding.query) : undefined;
      if (!definition || !clientFor(definition)) {
        const hidden = document.createElement('div');
        hidden.hidden = true;
        return hidden;
      }
    }
    const list = document.createElement('ul');
    list.className = 'task-list semantic-list';
    development.annotate(list, {
      ...(element.id ? { elementId: element.id } : {}),
    });
    const source = evaluate(element.source, environment);
    const records = Array.isArray(source) ? source : [];
    if (records.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty muted';
      empty.textContent = applicationView.modes.empty.message;
      list.append(empty);
      return list;
    }
    for (const record of records) {
      const locals = { ...environment.locals, [element.itemName]: record };
      const itemEnvironment = { ...environment, locals };
      const item = document.createElement('li');
      item.className = 'task semantic-row';
      for (const fieldId of element.display ?? []) {
        const field = fieldsById.get(fieldId);
        const value = field && isRecord(record) ? record[field.name] : undefined;
        const output = document.createElement('span');
        output.className = 'semantic-value';
        output.textContent = `${field?.name ?? fieldId}: ${String(value ?? '')}`;
        item.append(output);
      }
      item.append(renderElement(element.template, itemEnvironment));
      list.append(item);
    }
    return list;
  }

  if (element.submit && !operationAvailable(element.submit)) {
    const hidden = document.createElement('div');
    hidden.hidden = true;
    return hidden;
  }

  if (element.component === 'ui.Heading') {
    const heading = document.createElement('h1');
    heading.textContent = String(prop(element, 'text', environment) ?? '');
    return heading;
  }
  if (element.component === 'ui.Text') {
    const paragraph = document.createElement('p');
    paragraph.textContent = String(prop(element, 'text', environment) ?? '');
    return paragraph;
  }
  if (element.component === 'ui.TextField') {
    const label = document.createElement('label');
    label.textContent = String(prop(element, 'label', environment) ?? 'Field');
    const input = document.createElement('input');
    input.name = String(prop(element, 'name', environment) ?? 'value');
    const value = prop(element, 'value', environment);
    if (typeof value === 'string') input.value = value;
    const sourceField = prop(element, 'sourceField', environment);
    const field = typeof sourceField === 'string' ? fieldsById.get(sourceField) : undefined;
    const staticLabel = staticTextProp(element, 'label');
    development.annotate(input, {
      ...(element.id ? { elementId: element.id } : {}),
      ...(typeof sourceField === 'string' ? { fieldId: sourceField } : {}),
      ...(staticLabel ? { label: staticLabel } : {}),
    });
    input.required = field?.required ?? false;
    const length = field?.validation?.find((constraint) => constraint.kind === 'stringLength');
    if (length?.min !== undefined) input.minLength = length.min;
    if (length?.max !== undefined) input.maxLength = length.max;
    label.append(input);
    return label;
  }
  if (element.component === 'ui.CheckboxRow') {
    const label = document.createElement('label');
    label.className = 'checkbox-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(prop(element, 'checked', environment));
    const text = document.createElement('span');
    text.textContent = String(prop(element, 'label', environment) ?? '');
    const change = element.events?.change;
    const staticLabel = staticTextProp(element, 'label');
    development.annotate(input, {
      ...(element.id ? { elementId: element.id } : {}),
      ...(staticLabel ? { label: staticLabel } : {}),
      ...(change ? { operationId: change.operation } : {}),
    });
    if (change && operationAvailable(change))
      input.addEventListener('change', () => {
        input.disabled = true;
        void invoke(change, environment).catch(showViewError);
      });
    else input.disabled = true;
    label.append(input, text);
    return label;
  }
  if (element.component === 'ui.Button') {
    const button = document.createElement('button');
    button.type = prop(element, 'type', environment) === 'submit' ? 'submit' : 'button';
    button.textContent = String(prop(element, 'text', environment) ?? 'Continue');
    if (/delete|revoke/iu.test(button.textContent)) button.className = 'danger compact';
    const click = element.events?.click;
    const staticLabel = staticTextProp(element, 'text');
    development.annotate(button, {
      ...(element.id ? { elementId: element.id } : {}),
      ...(staticLabel ? { label: staticLabel } : {}),
      ...(click ? { operationId: click.operation } : {}),
    });
    if (click) {
      if (!operationAvailable(click)) button.hidden = true;
      else
        button.addEventListener('click', (event) => {
          event.preventDefault();
          button.disabled = true;
          void invoke(click, environment).catch(showViewError);
        });
    }
    return button;
  }

  const container =
    element.component === 'ui.Form'
      ? document.createElement('form')
      : document.createElement('div');
  container.className = element.component === 'ui.Page' ? 'stack generated-view' : 'semantic-form';
  development.annotate(container, {
    ...(element.id ? { elementId: element.id } : {}),
    ...(element.submit ? { operationId: element.submit.operation } : {}),
  });
  element.children?.forEach((child) => container.append(renderElement(child, environment)));
  if (container instanceof HTMLFormElement && element.submit) {
    const submit = element.submit;
    container.addEventListener('submit', (event) => {
      event.preventDefault();
      const controls = container.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        'button, input',
      );
      controls.forEach((control) => (control.disabled = true));
      void invoke(submit, { ...environment, form: new FormData(container) }).catch(showViewError);
    });
  }
  return container;
};

const showViewError = (error: unknown): void => {
  if (!viewError) return;
  viewError.textContent =
    error instanceof Error ? error.message : 'The action could not be completed.';
  announce('The action could not be completed.');
};

const loadAndRenderView = async (): Promise<void> => {
  if (!viewContent || !viewError) return;
  renderSkeleton(viewContent);
  viewError.textContent = '';
  try {
    const entries = await Promise.all(
      Object.entries(applicationView.view.data).map(async ([name, binding]) => {
        const definition = functionsBySemanticId.get(binding.query);
        const client = definition ? clientFor(definition) : undefined;
        return [
          name,
          definition && client ? await callClient(client, definition.name, []) : [],
        ] as const;
      }),
    );
    const data = Object.fromEntries(entries);
    const tree = renderElement(applicationView.view.tree as ApplicationViewElementV1, {
      data,
      locals: {},
    });
    viewContent.replaceChildren(tree);
    viewContent.setAttribute('aria-busy', 'false');
  } catch (error) {
    renderMode(viewContent, modeForError(error));
    viewError.textContent = error instanceof Error ? error.message : 'Could not load this view.';
  }
};

const renderContextControls = (): void => {
  if (!contextControls) return;
  contextControls.replaceChildren();
  for (const context of primaryContexts) {
    const label = document.createElement('label');
    label.textContent = context.name;
    const select = document.createElement('select');
    const options = optionsByEntity.get(context.entityId) ?? [];
    if (options.length === 0) {
      const option = document.createElement('option');
      option.textContent = `No ${context.name.toLocaleLowerCase()} available`;
      select.append(option);
      select.disabled = true;
    } else {
      options.forEach((contextOption) => {
        const option = document.createElement('option');
        option.textContent = contextOption.label;
        option.value = contextOption.recordId;
        select.append(option);
      });
      select.value = selectedRecords.get(context.entityId) ?? options[0]?.recordId ?? '';
      select.addEventListener('change', () => {
        selectedRecords.set(context.entityId, select.value);
        renderSkeleton(viewContent!);
        void buildClients()
          .then(() => loadAndRenderView())
          .catch(showViewError);
      });
    }
    development.annotate(select, { elementId: context.id, label: context.name });
    label.append(select);
    contextControls.append(label);
  }
};

const renderApplication = async (user: SessionUserV1): Promise<void> => {
  const existingSection = [...app.querySelectorAll<HTMLElement>('[data-oxe-browser-view]')].find(
    (candidate) => candidate.dataset.oxeBrowserView === applicationView.hydrationKey,
  );
  const section = existingSection ?? document.createElement('section');
  section.className = 'card stack';
  section.dataset.oxeBrowserView = applicationView.hydrationKey;
  const header =
    section.querySelector<HTMLElement>('[data-oxe-shell-header]') ??
    document.createElement('header');
  header.className = 'header';
  header.dataset.oxeShellHeader = '';
  const identity = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = user.name;
  const details = document.createElement('p');
  details.className = 'muted';
  details.textContent = `${user.email} · User ID: ${user.id}`;
  identity.append(name, details);
  const signOut = document.createElement('button');
  signOut.className = 'secondary';
  signOut.type = 'button';
  signOut.textContent = 'Sign out';
  development.annotate(signOut, { label: 'Sign out' });
  header.replaceChildren(identity, signOut);
  contextControls =
    section.querySelector<HTMLElement>('[data-oxe-context-controls]') ??
    document.createElement('section');
  contextControls.className = 'team-controls';
  contextControls.dataset.oxeContextControls = '';
  viewError =
    section.querySelector<HTMLElement>('[data-oxe-view-error]') ?? document.createElement('p');
  viewError.className = 'error';
  viewError.setAttribute('role', 'alert');
  viewError.dataset.oxeViewError = '';
  viewContent =
    section.querySelector<HTMLElement>('[data-oxe-view-content]') ?? document.createElement('div');
  viewContent.dataset.oxeViewContent = '';
  if (!existingSection) {
    renderSkeleton(viewContent);
    section.append(header, contextControls, viewError, viewContent);
    app.replaceChildren(section);
  }
  app.setAttribute('aria-busy', 'false');
  signOut.addEventListener('click', () => {
    signOut.disabled = true;
    clients.forEach((client) => client.clearCache());
    void authenticationRequest('sign-out')
      .then(() =>
        window.location.assign(withBasePath(applicationView.authentication?.signInPath ?? '/')),
      )
      .catch(showViewError);
  });
  await reloadContextOptions();
  await buildClients();
  renderContextControls();
  await loadAndRenderView();
};

const start = async (): Promise<void> => {
  const user = await sessionUser();
  const path = applicationPath(window.location.pathname);
  const authentication = applicationView.authentication;
  if (!authentication)
    throw new Error('The generated application view requires authentication metadata.');
  if (path === '/') {
    window.location.replace(
      withBasePath(user ? applicationView.route.path : authentication.signInPath),
    );
    return;
  }
  if (path === authentication.signInPath || path === authentication.signUpPath) {
    if (user) {
      window.location.replace(withBasePath(applicationView.route.path));
      return;
    }
    renderAuthentication(path === authentication.signUpPath ? 'signUp' : 'signIn');
    return;
  }
  if (path === applicationView.route.path) {
    if (!user) {
      window.location.replace(withBasePath(authentication.signInPath));
      return;
    }
    await renderApplication(user);
    return;
  }
  window.location.replace(withBasePath('/'));
};

void start().catch((caught: unknown) => {
  app.setAttribute('aria-busy', 'false');
  renderMode(app, modeForError(caught));
});

export {};
