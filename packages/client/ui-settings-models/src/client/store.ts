/**
 * Models settings page store: one snapshot joining the configurable-provider
 * directory (`llm/listProviders` joined with `llm/listConfigurableProviders`),
 * the settings namespaces (shared settings mirror),
 * the referenced credentials (`credentials/describe`), the host model
 * catalog, and the composed default-model selection. The host stays the
 * single fact source — every mutation writes through the wire and the page
 * re-renders from the next describe, pushed or refetched.
 */

import type {
  ClientRemote, CredentialInfo, LlmConfigurableProvider, LlmDiscoveredModel, LlmProviderInfo,
  ModelProviderGroup, SettingsNamespaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsDescribeFace, SettingsRemote } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsSchemaOperations } from './schema-operations.ts'

/**
 * Any route key walks a dict schema to the same profile node, so the lookup
 * names one that cannot collide with a configured route.
 */
const PROBE_ROUTE = '\u0000probe'

/**
 * Settings namespace carrying the default model selection for future Agents
 * (`@deepseek-ai/dsh-agent-default-model`). The page reads the composed value
 * through the shared mirror and writes provider/model through `settings.mutate`.
 */
export const DEFAULT_MODEL_NS = 'agent-default-model'

/** The default-model selection as this page reads and writes it. */
export interface DefaultModelSelection {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
}

/**
 * The composed default-model selection, or undefined when the namespace is
 * not mounted or holds no complete pair. The stored reasoning-effort override
 * stays unread here: effort is a per-model capability this page never offers.
 */
function defaultSelectionOf(namespace: SettingsNamespaceView | undefined): DefaultModelSelection | undefined {
  if (namespace === undefined) return undefined
  const value = namespace.value as { provider?: unknown; model?: unknown }
  if (typeof value.provider !== 'string' || value.provider.length === 0) return undefined
  if (typeof value.model !== 'string' || value.model.length === 0) return undefined
  return { provider: value.provider, model: value.model }
}

/** The credentials Remote methods the Models page reads and writes through. */
export type ModelsCredentials = Pick<ClientRemote['credentials'], 'describe' | 'set' | 'unset'>

/** LLM Remote methods used by the Models page. */
export type ModelsLlm = Pick<
  ClientRemote['llm'],
  'discoverModels' | 'listConfigurableProviders' | 'listProviders'
>

/** One provider row after joining the configurable directory with live routes. */
export interface ProviderDirectoryEntry {
  readonly provider: string
  readonly displayName: string
  readonly settingsNs: string
  readonly settingsPath: readonly string[]
  readonly active: boolean
  readonly declared?: boolean
  /**
   * The endpoint the adapter's installed catalog ships for this route.
   * Absent for a route the catalog has no endpoint for (ambient-auth or
   * gateway routes) or knows nothing about at all; configuration surfaces
   * prefill it as the route's built-in base URL.
   */
  readonly catalogBaseURL?: string
  /**
   * The single wire protocol every installed model of this route speaks.
   * Absent when the catalog does not ship the route, ships no models, or its
   * models disagree — no value is invented to fill the field.
   */
  readonly catalogApi?: string
  /**
   * The models the adapter's installed catalog ships for this route, in
   * catalog order. Absent for a route the catalog knows nothing about;
   * configuration surfaces prefill a picked preset's model mapping from
   * these.
   */
  readonly catalogModels?: readonly LlmDiscoveredModel[]
}

/**
 * Join declared configurable providers with the currently registered routes.
 * @param registered - live provider routes in registration order.
 * @param directory - declared configurable providers in declaration order.
 * @returns declared rows followed by live routes with no declaration.
 */
export function joinProviderDirectory(
  registered: readonly LlmProviderInfo[],
  directory: readonly LlmConfigurableProvider[],
): ProviderDirectoryEntry[] {
  const active = new Set(registered.map(provider => provider.id))
  const declared = new Set(directory.map(entry => entry.provider))
  const rows: ProviderDirectoryEntry[] = directory.map(entry => ({
    provider: entry.provider,
    displayName: entry.displayName,
    settingsNs: entry.settingsNs,
    settingsPath: [...entry.settingsPath],
    active: active.has(entry.provider),
    ...entry.declared === undefined ? {} : { declared: entry.declared },
    ...entry.catalogBaseURL === undefined ? {} : { catalogBaseURL: entry.catalogBaseURL },
    ...entry.catalogApi === undefined ? {} : { catalogApi: entry.catalogApi },
    ...entry.catalogModels === undefined ? {} : { catalogModels: entry.catalogModels },
  }))
  for (const provider of registered) {
    if (declared.has(provider.id)) continue
    rows.push({
      provider: provider.id,
      displayName: provider.name,
      settingsNs: '',
      settingsPath: [],
      active: true,
    })
  }
  return rows
}

/**
 * Every Remote wire face the Models page reaches.
 */
export interface ModelsWire {
  /** The settings Remote namespace: the redacted read and the profile writes. */
  settings: SettingsRemote
  /** Credential state and writes for the references provider profiles name. */
  credentials: ModelsCredentials
  /** Provider directory reads and draft endpoint discovery. */
  llm: ModelsLlm
  /** Host-generation model catalog behind the default-model picker. */
  session: Pick<ClientRemote['session'], 'modelCatalog'>
}

/** One provider row the page renders. */
export interface ProviderRow {
  /** The directory entry (route id, display name, settings address, live state). */
  entry: ProviderDirectoryEntry
  /** Whether any layer configures this provider (its profile resolves). */
  configured: boolean
  /** Whether the user layer alone carries the profile (removal restores the base). */
  removable: boolean
  /**
   * The resolved profile value at the entry's settings address (the whole
   * section for an empty path). Read-only facts for the card's details view
   * and the duplicate command; every write still goes through the editor.
   */
  profile: unknown
  /** The credential reference the resolved profile names, when one does. */
  apiKeyEnv: string | undefined
  /** Credential state for {@link apiKeyEnv}, once described. */
  credential: CredentialInfo | undefined
  /**
   * Credential state for the page's derived `<ROUTE>_API_KEY`, described only
   * while the profile names no reference — the provider-card seat's
   * `keyConfigured` fact for dormant and keyless rows, matching the editor's
   * own derivation rule.
   */
  derivedCredential?: CredentialInfo
}

/** Page snapshot. */
export interface ModelsSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text; row-level write failures stay in the editor. */
  error: string | null
  /** Credential enrichment failure; provider/settings rows remain usable. */
  credentialError: string | null
  /** Whether the settings provider accepts writes. */
  writable: boolean
  /** Every configurable provider joined with its configured/credential state. */
  rows: readonly ProviderRow[]
  /** Namespace views by ns, for the editor's schema/layers/secrets. */
  namespaces: ReadonlyMap<string, SettingsNamespaceView>
  /** The default model selection for future Agents, when the namespace is mounted. */
  defaultSelection: DefaultModelSelection | undefined
  /** Host model catalog by provider (advisory enrichment; empty when unavailable). */
  catalog: readonly ModelProviderGroup[]
  /** Catalog enrichment failure; provider rows and the default badge remain usable. */
  catalogError: string | null
}

/**
 * Human text for a rejected wire call. A transport failure rejects with an
 * Error; a host or a runtime can reject with anything, and the page still has
 * to say something.
 * @param error - the rejection value.
 * @returns the message to show.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Derive the conventional credential reference for a provider route: the v1
 * page never asks for an environment-variable name, so a typed key stores
 * under this derived reference and the profile records it as `apiKeyEnv`.
 * @param provider - provider route id (e.g. `anthropic`, `minimax-cn`).
 * @returns the derived reference name (e.g. `MINIMAX_CN_API_KEY`).
 */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * The wire protocols a hand-declared route may name, read out of the owning
 * namespace's own schema. This stays a schema read rather than a wire field so
 * the choices the page offers cannot drift from the ones the adapter accepts:
 * both come from the same `Config`.
 * @param namespace - the namespace view whose schema declares the profile shape.
 * @param schema - settings schema operations.
 * @returns the protocol identifiers, or an empty list when the schema has none.
 */
export function protocolChoices(
  namespace: SettingsNamespaceView | undefined,
  schema: SettingsSchemaOperations,
): string[] {
  if (namespace === undefined) return []
  const node = schema.nodeAtPath(schema.rehydrate(namespace.schema), ['providers', PROBE_ROUTE, 'api'])
  const list = (node as { type?: string; list?: readonly { value?: unknown }[] } | undefined)
  if (list?.type !== 'union' || list.list === undefined) return []
  return list.list.map(entry => entry.value).filter((value): value is string => typeof value === 'string')
}

/** The credential reference a resolved profile names (its `apiKeyEnv` field). */
function apiKeyEnvOf(
  namespace: SettingsNamespaceView | undefined,
  path: readonly string[],
  schema: SettingsSchemaOperations,
): string | undefined {
  if (namespace === undefined) return undefined
  const profile = schema.getPath(namespace.value, path)
  if (typeof profile !== 'object' || profile === null) return undefined
  const ref = (profile as { apiKeyEnv?: unknown }).apiKeyEnv
  return typeof ref === 'string' && ref.length > 0 ? ref : undefined
}

/** The models settings page controller (one per settings surface). */
export class ModelsSettingsStore {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<ModelsSettingsState> = createSnapshotStore<ModelsSettingsState>({
    status: 'idle', error: null, credentialError: null, writable: false, rows: [], namespaces: new Map(),
    defaultSelection: undefined, catalog: [], catalogError: null,
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0

  /**
   * @param api - the page's settings, credentials, and LLM wire faces.
   * @param describeFace - the shared mirror's describe face (namespace views and writability).
   */
  constructor(
    private readonly api: Pick<ModelsWire, 'settings' | 'credentials' | 'llm' | 'session'>,
    private readonly schema: SettingsSchemaOperations,
    private readonly describeFace: SettingsDescribeFace,
  ) {}

  /**
   * Refresh the whole page snapshot: the provider directory and the mirror's
   * settings answer in parallel, then one batched credential describe over
   * every referenced ref. Provider failure or absence of an initial settings
   * answer keeps the last good rows and surfaces an error; a failed settings
   * refresh reuses the mirror's held view.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    let providers: ProviderDirectoryEntry[]
    let writable: boolean
    let views: readonly SettingsNamespaceView[]
    try {
      const [registered, declared] = await Promise.all([
        this.api.llm.listProviders(),
        this.api.llm.listConfigurableProviders(),
        this.describeFace.ensure(),
      ])
      if (!registered.ok) throw new Error(registered.error.message)
      if (!declared.ok) throw new Error(declared.error.message)
      const mirrored = this.describeFace.getSnapshot()
      if (mirrored.view === undefined) {
        throw new Error(mirrored.error ?? 'settings are unavailable in this browser')
      }
      providers = joinProviderDirectory(registered.value, declared.value)
      writable = mirrored.view.writable
      views = mirrored.view.namespaces
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = error instanceof Error ? error.message : String(error)
      })
      return
    }
    const namespaces = new Map(views.map(view => [view.ns, view]))
    const rows: ProviderRow[] = providers.map((entry) => {
      const namespace = namespaces.get(entry.settingsNs)
      const profile = namespace === undefined ? undefined : this.schema.getPath(namespace.value, entry.settingsPath)
      const configured = namespace !== undefined
        && (entry.settingsPath.length === 0 || profile !== undefined)
      const removable = namespace !== undefined
        && entry.settingsPath.length > 0
        && this.schema.hasPath(namespace.user, entry.settingsPath)
        && !this.schema.hasPath(namespace.base, entry.settingsPath)
      return {
        entry,
        configured,
        removable,
        profile,
        apiKeyEnv: apiKeyEnvOf(namespace, entry.settingsPath, this.schema),
        credential: undefined,
      }
    })
    const refs = [...new Set(rows.map(row => row.apiKeyEnv ?? deriveKeyRef(row.entry.provider)))]
    // Both enrichments fold their own failure into their half and never
    // reject, so the page load itself cannot fail on either.
    const [credentialsResult, catalogResult] = await Promise.all([
      this.describeCredentials(refs),
      this.loadCatalog(),
    ])
    const { credentials } = credentialsResult
    const credentialError = credentialsResult.error
    const { groups: catalog } = catalogResult
    const catalogError = catalogResult.error
    if (generation !== this.generation) return
    this.store.update((s) => {
      s.status = 'ready'
      s.error = null
      s.credentialError = credentialError
      s.writable = writable
      s.rows = rows.map((row) => {
        const named = row.apiKeyEnv === undefined ? undefined : credentials[row.apiKeyEnv]
        const derived = row.apiKeyEnv !== undefined ? undefined : credentials[deriveKeyRef(row.entry.provider)]
        return {
          ...row,
          ...named === undefined ? {} : { credential: named },
          ...derived === undefined ? {} : { derivedCredential: derived },
        }
      })
      s.namespaces = namespaces
      s.defaultSelection = defaultSelectionOf(namespaces.get(DEFAULT_MODEL_NS))
      s.catalog = catalog
      s.catalogError = catalogError
    })
  }

  /**
   * Credential enrichment for the joined rows: neither a business rejection
   * nor a transport failure fails the load.
   * @param refs - credential references the resolved profiles name.
   * @returns the described views and a failure message, never a rejection.
   */
  private async describeCredentials(refs: readonly string[]): Promise<{
    credentials: Record<string, CredentialInfo>
    error: string | null
  }> {
    if (refs.length === 0) return { credentials: {}, error: null }
    try {
      const response = await this.api.credentials.describe([...refs])
      // Credential state is an enrichment for the Models page: neither a
      // business rejection nor a transport failure fails the load. The
      // onboarding projection below retains the failure distinction.
      if (response.ok) return { credentials: response.value, error: null }
      return { credentials: {}, error: response.error.message }
    } catch (error) {
      return { credentials: {}, error: messageOf(error) }
    }
  }

  /**
   * Host model catalog enrichment: the per-provider model lists behind the
   * default-model picker and the card summaries. A failure degrades those
   * two surfaces without failing the load.
   * @returns the provider groups and a failure message, never a rejection.
   */
  private async loadCatalog(): Promise<{ groups: ModelProviderGroup[]; error: string | null }> {
    try {
      const response = await this.api.session.modelCatalog()
      if (response.ok) return { groups: [...response.value.groups], error: null }
      return { groups: [], error: `${response.error.code}: ${response.error.message}` }
    } catch (error) {
      return { groups: [], error: messageOf(error) }
    }
  }

  /**
   * Save the default model selection for future Agents. The stored
   * reasoning-effort override is dropped with the switch: effort is a
   * per-model capability, and the level the previous model accepted could
   * only fail resolution on the new one.
   * @param selection - provider route and model id, as the host catalog names them.
   * @returns the failure message, or undefined once the write and reload landed.
   */
  async setDefaultModel(selection: DefaultModelSelection): Promise<string | undefined> {
    const namespace = this.store.getSnapshot().namespaces.get(DEFAULT_MODEL_NS)
    try {
      const response = await this.api.settings.mutate(
        DEFAULT_MODEL_NS,
        [
          { op: 'set', path: ['provider'], value: selection.provider },
          { op: 'set', path: ['model'], value: selection.model },
          { op: 'unset', path: ['reasoningEffort'] },
        ],
        namespace?.revision,
      )
      if (!response.ok) return response.error.message
    } catch (error) {
      // The transport rejected rather than answering; the caller can retry the
      // idempotent write once the failure is read.
      return messageOf(error)
    }
    await this.load()
    return undefined
  }
}

/**
 * Whether a joined row can serve model requests as it stands: the route is
 * registered with the adapter registry, and whatever credential its resolved
 * profile names is stored. A profile naming no reference authenticates through
 * the provider's own path (the Bedrock chain, Vertex ADC, a gateway that needs
 * nothing), as does a live route with no settings address at all, so neither
 * owes this page a key.
 * @param row - one joined provider row.
 * @returns whether the user already has this provider to talk to.
 */
export function providerUsable(row: ProviderRow): boolean {
  if (!row.entry.active) return false
  if (row.apiKeyEnv === undefined) return true
  return row.credential?.configured === true
}

/** First-run onboarding readiness derived only from the shared Models join. */
export type OnboardingReadiness =
  | { kind: 'loading' }
  | { kind: 'adapter-absent' }
  | { kind: 'provider-ready' }
  | { kind: 'credential-missing' }
  | {
    kind: 'unavailable'
    reason:
      | 'load-failed'
      | 'provider-inactive'
      | 'credentials-unavailable'
      | 'settings-read-only'
      | 'credential-read-only'
  }

/**
 * Project first-run readiness from the provider/settings/credential join used
 * by the Models page. The step exists to leave the user with a model to talk
 * to, so ANY usable provider ends it; only when none exists does the official
 * DeepSeek route — the one route the prompt can offer a key field for — decide
 * whether prompting can help. A missing official configurable-provider
 * declaration means the adapter is not repairable by navigating to Models.
 * @param state - current shared Models join snapshot.
 * @returns the onboarding state without reading a parallel fact source.
 */
export function onboardingReadiness(state: ModelsSettingsState): OnboardingReadiness {
  if ((state.status === 'idle' || state.status === 'loading') && state.rows.length === 0) {
    return { kind: 'loading' }
  }
  if (state.status === 'error') {
    return {
      kind: 'unavailable',
      reason: 'load-failed',
    }
  }
  if (state.rows.some(providerUsable)) return { kind: 'provider-ready' }
  const row = state.rows.find(candidate =>
    candidate.entry.provider === 'deepseek-official'
    && candidate.entry.settingsNs === 'llm-deepseek'
    && candidate.entry.settingsPath.length === 0)
  if (row === undefined) return { kind: 'adapter-absent' }
  if (!row.entry.active) {
    return {
      kind: 'unavailable',
      reason: 'provider-inactive',
    }
  }
  // Past the usable gate an active route names a reference it has no stored
  // credential for, so the remaining questions are all about that credential.
  if (state.credentialError !== null || row.credential === undefined) {
    return {
      kind: 'unavailable',
      reason: 'credentials-unavailable',
    }
  }
  if (!state.writable) {
    return {
      kind: 'unavailable',
      reason: 'settings-read-only',
    }
  }
  if (!row.credential.writable) {
    return {
      kind: 'unavailable',
      reason: 'credential-read-only',
    }
  }
  return { kind: 'credential-missing' }
}
