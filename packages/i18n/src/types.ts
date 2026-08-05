export const I18N_CATALOG_SCHEMA = 'oxe.i18n.catalog.v2' as const;
export const I18N_MANIFEST_SCHEMA = 'oxe.i18n.manifest.v2' as const;
export const I18N_CHUNK_MANIFEST_SCHEMA = 'oxe.i18n.chunks.v1' as const;

export type MissingTranslationPolicy = 'error' | 'source' | 'warn';
export type MessageSelectionKind = 'cardinal' | 'ordinal';
export type PluralCategory = 'few' | 'many' | 'one' | 'other' | 'two' | 'zero';

export interface OxeGlossaryEntry {
  readonly description?: string;
  readonly preserve: boolean;
  readonly translations: Readonly<Record<string, string>>;
}

export interface OxeTranslationConfig {
  readonly apiKeyEnv: string;
  readonly concurrency: number;
  readonly model: string;
  readonly provider: 'openai';
}

export interface OxeI18nConfig {
  readonly catalogDirectory: string;
  readonly glossary: Readonly<Record<string, OxeGlossaryEntry>>;
  readonly include: readonly string[];
  readonly locales: readonly string[];
  readonly onMissing: MissingTranslationPolicy;
  readonly source: string;
  readonly translation: OxeTranslationConfig;
}

export interface OxeProjectConfig {
  readonly i18n: OxeI18nConfig;
  readonly projectDirectory: string;
}

export interface MessageLocation {
  readonly column: number;
  readonly file: string;
  readonly line: number;
}

export interface MessagePlaceholder {
  readonly kind: 'expression' | 'markup-close' | 'markup-open';
  readonly name: string;
  readonly token: string;
}

export interface MessageSelection {
  readonly kind: MessageSelectionKind;
}

export interface MessageTranslationContext {
  readonly attribute?: string;
  readonly component: string;
  readonly contextSelectors: readonly string[];
  readonly element: string;
  readonly purpose: string;
}

export interface ExtractedMessage {
  readonly explicitKey: boolean;
  readonly id: string;
  readonly locations: readonly MessageLocation[];
  readonly placeholders: readonly MessagePlaceholder[];
  readonly selection?: MessageSelection;
  readonly source: string;
  readonly sourceHash: string;
  readonly translationContext: MessageTranslationContext;
}

export interface ExtractMessagesResult {
  readonly diagnostics: readonly I18nDiagnostic[];
  readonly messages: readonly ExtractedMessage[];
}

export interface I18nDiagnostic {
  readonly code: string;
  readonly column?: number;
  readonly file?: string;
  readonly line?: number;
  readonly message: string;
}

export interface CatalogVariantMessage {
  readonly cases: Readonly<Partial<Record<PluralCategory, string>>>;
  readonly kind: MessageSelectionKind;
}

export type CatalogMessage = CatalogVariantMessage | string;

export interface LocaleCatalog {
  readonly locale: string;
  readonly messages: Readonly<Record<string, CatalogMessage>>;
  readonly schemaVersion: typeof I18N_CATALOG_SCHEMA;
}

export interface LocaleCatalogChunkV1 {
  readonly catalog: string;
  readonly locale: string;
  /** Empty for the default locale; otherwise the canonical lowercase URL segment. */
  readonly pathPrefix: string;
}

export interface LocaleCatalogChunkManifestV1 {
  readonly defaultLocale: string;
  readonly locales: readonly LocaleCatalogChunkV1[];
  readonly schemaVersion: typeof I18N_CHUNK_MANIFEST_SCHEMA;
}

export type TranslationProvenance = 'generated' | 'reviewed';

export interface TranslationState {
  readonly model?: string;
  readonly outputHash: string;
  readonly placeholderStrategy?: 'fixed' | 'movable';
  readonly provider: 'openai';
  readonly sourceHash: string;
  readonly status: TranslationProvenance;
}

export interface ManifestMessage {
  readonly explicitKey: boolean;
  readonly locations: readonly MessageLocation[];
  readonly placeholders: readonly MessagePlaceholder[];
  readonly selection?: MessageSelection;
  readonly source: string;
  readonly sourceHash: string;
  readonly translationContext: MessageTranslationContext;
}

export interface I18nManifest {
  readonly messages: Readonly<Record<string, ManifestMessage>>;
  readonly schemaVersion: typeof I18N_MANIFEST_SCHEMA;
  readonly sourceLocale: string;
  readonly translations: Readonly<Record<string, Readonly<Record<string, TranslationState>>>>;
}

export interface TranslationVariation {
  readonly category: PluralCategory;
  readonly example: number;
  readonly kind: MessageSelectionKind;
}

export interface TranslationInput {
  readonly context: MessageTranslationContext;
  readonly id: string;
  readonly text: string;
  readonly variation?: TranslationVariation;
}

export interface TranslationGlossaryTerm {
  readonly description?: string;
  readonly preserve: boolean;
  readonly source: string;
  readonly translation?: string;
}

export interface TranslationRequest {
  readonly glossary: readonly TranslationGlossaryTerm[];
  readonly items: readonly TranslationInput[];
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
}

export interface TranslationProvider {
  readonly id: 'openai';
  readonly model: string;
  translate(request: TranslationRequest): Promise<readonly string[]>;
}

export interface SyncProgress {
  readonly completed: number;
  readonly locale: string;
  readonly phase: 'extract' | 'translate' | 'write';
  readonly total: number;
}

export interface SyncI18nOptions {
  readonly onProgress?: (progress: SyncProgress) => void;
  readonly projectDirectory: string;
  readonly provider: TranslationProvider;
}

export interface SyncI18nResult {
  readonly generated: number;
  readonly messages: number;
  readonly preservedReviewed: number;
  readonly removedGenerated: number;
  readonly unchanged: number;
}

export interface ValidationIssue {
  readonly id: string;
  readonly locale: string;
  readonly message: string;
  readonly reason: 'invalid-placeholders' | 'missing' | 'missing-case' | 'stale';
}

export interface ValidateI18nResult {
  readonly issues: readonly ValidationIssue[];
  readonly valid: boolean;
}
