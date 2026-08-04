export type ServerStreamPatch =
  | {
      readonly html: string;
      readonly kind: 'replace';
      readonly regionId: string;
      readonly token: number;
    }
  | {
      readonly mode: 'attribute' | 'property';
      readonly name: string;
      readonly kind: 'attribute';
      readonly regionId: string;
      readonly token: number;
      readonly value: boolean | number | string | null;
    };

const escapeAttribute = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

/**
 * Fixed, CSP-hashable bootstrap. Streamed templates remain inert until this
 * observer moves renderer-produced content into its stable region marker.
 */
export const OXE_STREAM_BOOTSTRAP_SOURCE = `(()=>{const d=document,q=[],f=(a,v)=>[...d.querySelectorAll('['+a+']')].find(n=>(n.getAttribute(a)||'').split(' ').includes(v)),p=t=>{const i=t.dataset.oxePatch,k=t.dataset.oxeKind||'replace',x=f(k==='attribute'?'data-oxe-attr-region':'data-oxe-region',i);if(!x){t.remove();return}const n=+(t.dataset.oxeToken||0),o=+(x.getAttribute('data-oxe-token')||0);if(n<o){t.remove();return}if(k==='attribute'){const a=t.dataset.oxeAttribute,m=t.dataset.oxeMode,v=JSON.parse(decodeURIComponent(t.dataset.oxeValue));m==='property'?x[a]=v:v==null||v===false?x.removeAttribute(a):x.setAttribute(a,v===true?'':String(v));const r=(x.getAttribute('data-oxe-attr-region')||'').split(' ').filter(v=>v!==i);r.length?x.setAttribute('data-oxe-attr-region',r.join(' ')):(x.removeAttribute('data-oxe-attr-region'),x.removeAttribute('data-oxe-pending'),x.removeAttribute('aria-busy'))}else{x.replaceWith(t.content.cloneNode(true))}t.remove()},s=n=>{if(n.nodeType!==1)return;n.matches?.('template[data-oxe-patch]')&&p(n);n.querySelectorAll?.('template[data-oxe-patch]').forEach(p)};new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(s))).observe(d.documentElement,{childList:true,subtree:true});d.querySelectorAll('template[data-oxe-patch]').forEach(p);['click','input'].forEach(e=>addEventListener(e,v=>{const t=v.target,c=t?.closest?.('[data-oxe-event]'),i=c?.getAttribute('data-oxe-event'),o=i?[...d.querySelectorAll('[data-oxe-event]')].filter(n=>n.getAttribute('data-oxe-event')===i).indexOf(c):0;i&&q.length<100&&q.push({type:e,target:i,occurrence:o,time:Date.now(),value:e==='input'?t.value:void 0})},true));globalThis.__oxeEarly={events:q,apply:p}})();`;

/** Update only with the source above; a test verifies the digest. */
export const OXE_STREAM_BOOTSTRAP_CSP_HASH = 'sha256-PZMXr6D7/gmJ/dP/WhynoqD/1Rg7UkDr6F3YG7NOneU=';

export const serializeServerStreamPatch = (patch: ServerStreamPatch): string => {
  const common = `data-oxe-patch="${escapeAttribute(patch.regionId)}" data-oxe-kind="${patch.kind}" data-oxe-token="${patch.token}"`;
  if (patch.kind === 'replace') {
    return `<template ${common}>${patch.html}</template>`;
  }
  return `<template ${common} data-oxe-attribute="${escapeAttribute(patch.name)}" data-oxe-mode="${patch.mode}" data-oxe-value="${escapeAttribute(encodeURIComponent(JSON.stringify(patch.value)))}"></template>`;
};

export const serializeServerRegionMarker = (
  regionId: string,
  token = 0,
  options: { readonly kind?: 'structural' | 'text'; readonly skeletonHtml?: string } = {},
): string => {
  if (!Number.isSafeInteger(token) || token < 0) {
    throw new RangeError('A server region marker token must be a non-negative safe integer.');
  }
  const marker = `data-oxe-region="${escapeAttribute(regionId)}" data-oxe-token="${token}"`;
  if (options.kind === 'text') {
    return `<span ${marker} data-oxe-skeleton aria-hidden="true">████████</span>`;
  }
  if (options.kind === 'structural' && options.skeletonHtml) {
    return options.skeletonHtml.replace(
      /^(<[a-z][a-z0-9]*)(?=[\s>])/u,
      `$1 ${marker} data-oxe-skeleton aria-hidden="true" aria-busy="true"`,
    );
  }
  return `<template ${marker}></template>`;
};

export const serializeAsyncCheckpoints = (
  checkpoints: readonly { readonly identity: string; readonly value: unknown }[],
  buildFingerprint?: string,
): string => {
  const json = JSON.stringify(checkpoints)
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
  const build = buildFingerprint ? ` data-oxe-build="${escapeAttribute(buildFingerprint)}"` : '';
  return `<script type="application/json" data-oxe-state${build}>${json}</script>`;
};
