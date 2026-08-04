import { createI18n } from '../../packages/i18n/dist/runtime.js';

const locales = ['en-US', 'es', 'pt', 'fr', 'it'];
const catalogs = await Promise.all(
  locales.map(async (locale) => {
    const response = await fetch(`./locales/${locale}.json`);
    if (!response.ok) throw new Error(`Could not load the ${locale} catalog.`);
    return response.json();
  }),
);

const i18n = createI18n({ catalogs, locale: 'en-US' });
const elements = {
  greeting: document.querySelector('#greeting'),
  locale: document.querySelector('#locale'),
  poweredBy: document.querySelector('#powered-by'),
  rank: document.querySelector('#rank'),
  ready: document.querySelector('#ready'),
  storyCount: document.querySelector('#story-count'),
};
let stories = 3;
let rank = 2;

const render = () => {
  document.documentElement.lang = i18n.locale;
  elements.greeting.textContent = i18n.format('home.greeting', { values: { name: 'Ada' } });
  elements.ready.textContent = i18n.format('home.ready');
  elements.storyCount.textContent = i18n.format('home.story-count', {
    count: stories,
    values: { stories },
  });
  elements.rank.textContent = i18n.format('home.rank', {
    ordinal: rank,
    values: { rank },
  });
  elements.poweredBy.textContent = i18n.format('home.powered-by');
};

elements.locale.addEventListener('change', () => {
  i18n.setLocale(elements.locale.value);
  render();
});
document.querySelector('#remove-story').addEventListener('click', () => {
  stories = Math.max(0, stories - 1);
  render();
});
document.querySelector('#add-story').addEventListener('click', () => {
  stories += 1;
  render();
});
document.querySelector('#better-rank').addEventListener('click', () => {
  rank = Math.max(1, rank - 1);
  render();
});
document.querySelector('#lower-rank').addEventListener('click', () => {
  rank += 1;
  render();
});

render();
