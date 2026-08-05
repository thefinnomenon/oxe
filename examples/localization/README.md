# OpenAI translation example

Build the CLI packages, set the configured API-key environment variable, then run
an explicit sync from the repository root:

```sh
pnpm --filter @oxe/compiler build
pnpm --filter @oxe/i18n build
pnpm --filter @oxe/cli build
# Add OPENAI_API_KEY="your-key" to the repository-root .env file.
node packages/cli/dist/cli.js i18n sync --project examples/localization
```

The key is read from `.env` or the shell environment, not the configuration file.
Later syncs hash the extracted source and send only new or changed messages to
OpenAI. Use `i18n check` in deterministic build or CI preparation; it never
accesses the network or changes a catalog.

The example generates complete cardinal and ordinal cases for English, Spanish,
Portuguese, French, and Italian. Its glossary preserves `OXE` and supplies an
approved translation of “reading list.” Purpose and element/component context are
included in each generation request, while `translation.concurrency` limits how
many locale batches can be in flight at once.

The compiler-backed **Localization and Intl** Playground example mounts the
Spanish catalog and demonstrates lowered prose, automatic placeholder
translation, plural and ordinal cases, safe movable `<strong>` markup, currency,
date formatting, and semantic `value`/`datetime` attributes. The standalone page
below remains useful for switching among all five locales interactively.

To try the generated catalogs in the language switcher, serve the repository root
after building `@oxe/i18n`:

```sh
python3 -m http.server 4174
```

Then open `http://localhost:4174/examples/localization/`. Change the story count
and challenge rank to exercise cardinal and ordinal selection in every language.
