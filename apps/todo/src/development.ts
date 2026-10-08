import type {
  ApplicationDevelopmentInteractionOutcomeV1,
  ApplicationDevelopmentInteractionTargetV1,
  ApplicationDevelopmentInteractionV1,
} from '@oxe/graph';

const APPLICATION_DEVELOPMENT_INTERACTION_SCHEMA =
  'oxe.application-development-interaction.v1' as const;

export interface ApplicationDevelopmentElementDescriptorV1 {
  readonly elementId?: string;
  readonly fieldId?: string;
  readonly label?: string;
  readonly operationId?: string;
}

export interface ApplicationDevelopmentBridgeV1 {
  annotate(element: HTMLElement, descriptor: ApplicationDevelopmentElementDescriptorV1): void;
  dispose(): void;
  operation(operationId: string, outcome: ApplicationDevelopmentInteractionOutcomeV1): void;
}

const exactParentOrigin = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
};

const controlKind = (
  element: HTMLElement,
): ApplicationDevelopmentInteractionTargetV1['control'] => {
  if (element instanceof HTMLButtonElement) return 'button';
  if (element instanceof HTMLFormElement) return 'form';
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return 'input';
  if (element instanceof HTMLAnchorElement) return 'link';
  if (element instanceof HTMLSelectElement) return 'select';
  return 'other';
};

const targetFor = (element: HTMLElement): ApplicationDevelopmentInteractionTargetV1 => {
  const annotated =
    element.closest<HTMLElement>(
      '[data-oxe-semantic-id], [data-oxe-operation-id], [data-oxe-field-id], [data-oxe-interaction-label]',
    ) ?? element;
  return {
    control: controlKind(element),
    ...(annotated.dataset.oxeSemanticId ? { elementId: annotated.dataset.oxeSemanticId } : {}),
    ...(annotated.dataset.oxeFieldId ? { fieldId: annotated.dataset.oxeFieldId } : {}),
    ...(annotated.dataset.oxeInteractionLabel
      ? { label: annotated.dataset.oxeInteractionLabel }
      : {}),
    ...(annotated.dataset.oxeOperationId ? { operationId: annotated.dataset.oxeOperationId } : {}),
  };
};

/**
 * Installs an opt-in, exact-origin development bridge. It emits semantic breadcrumbs only;
 * input values, record data, full page text, query parameters, and fragments never cross it.
 */
export const installApplicationDevelopmentBridge = (
  configuredParentOrigin: string | undefined,
): ApplicationDevelopmentBridgeV1 => {
  const parentOrigin = exactParentOrigin(configuredParentOrigin);
  let sequence = 0;
  const emit = (
    kind: ApplicationDevelopmentInteractionV1['kind'],
    target?: ApplicationDevelopmentInteractionTargetV1,
    outcome?: ApplicationDevelopmentInteractionOutcomeV1,
  ): void => {
    if (!parentOrigin || window.parent === window) return;
    const interaction: ApplicationDevelopmentInteractionV1 = {
      at: Date.now(),
      kind,
      ...(outcome ? { outcome } : {}),
      route: window.location.pathname,
      schemaVersion: APPLICATION_DEVELOPMENT_INTERACTION_SCHEMA,
      sequence: (sequence += 1),
      ...(target ? { target } : {}),
    };
    window.parent.postMessage(interaction, parentOrigin);
  };
  const capture = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const kind = event.type === 'click' ? 'click' : event.type === 'change' ? 'change' : 'submit';
    emit(kind, targetFor(target));
  };
  if (parentOrigin && window.parent !== window) {
    document.addEventListener('click', capture, true);
    document.addEventListener('change', capture, true);
    document.addEventListener('submit', capture, true);
    emit('navigation');
  }
  return Object.freeze({
    annotate: (element: HTMLElement, descriptor: ApplicationDevelopmentElementDescriptorV1) => {
      if (descriptor.elementId) element.dataset.oxeSemanticId = descriptor.elementId;
      if (descriptor.fieldId) element.dataset.oxeFieldId = descriptor.fieldId;
      if (descriptor.label) element.dataset.oxeInteractionLabel = descriptor.label.slice(0, 160);
      if (descriptor.operationId) element.dataset.oxeOperationId = descriptor.operationId;
    },
    dispose: () => {
      document.removeEventListener('click', capture, true);
      document.removeEventListener('change', capture, true);
      document.removeEventListener('submit', capture, true);
    },
    operation: (operationId: string, outcome: ApplicationDevelopmentInteractionOutcomeV1) =>
      emit('operation', { control: 'other', operationId }, outcome),
  });
};
