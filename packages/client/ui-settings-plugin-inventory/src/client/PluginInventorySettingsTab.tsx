import { useEffect, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type {
  PluginInventorySnapshot,
  PluginManagerCatalogSnapshot,
  PluginManagerCatalogSourceStatus,
  PluginManagerCatalogEntry,
  PluginManagerInstallCapabilities,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button,
  IconChevronDownOutline14,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconWarningOutline16,
  Menu,
  Modal,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import type { PluginInventoryClientStore } from './store.ts'
import css from './PluginInventorySettingsTab.module.css'

/** Registration-side injected dependency: the tab controller. */
export interface PluginInventorySettingsTabInjected {
  /** Controller owning both host-backed faces; the tab subscribes to its store. */
  controller: PluginInventoryClientStore
}

type PluginInventoryEntry = PluginInventorySnapshot['entries'][number]
type PluginFiberPhase = PluginInventoryEntry['fiberPhase']

/** Full component props assembled by the Settings slot renderer. */
export type PluginInventorySettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginInventorySettingsTabInjected>

/** Business rejection codes shared by install and uninstall. */
type PluginManagerBusinessCode =
  | 'invalid-name'
  | 'already-installed'
  | 'not-installed'
  | 'not-managed'
  | 'not-found'
  | 'offline'
  | 'install-failed'
  | 'remove-failed'
  | 'in-use'
  | 'confirmation-required'
  | 'sandbox-unavailable'

/** Managed installs' Loader entry ids carry this ownership prefix and are
 * represented by their catalog card instead of a bare Loader card. */
const MANAGED_ENTRY_PREFIX = 'dsh-managed-'

/** Loader entries under the root Include surface with `include:`-prefixed
 * getter ids, while ownership classification and patches match the bare
 * `options.id`; strip the prefix so both compare on the same value. */
function bareEntryId(entryId: string): string {
  return entryId.replace(/^include:/, '')
}

const PHASE_KEYS = {
  pending: 'pending',
  loading: 'loadingPhase',
  active: 'active',
  failed: 'failed',
  unloading: 'unloading',
} satisfies Record<Exclude<PluginFiberPhase, null>, PluginInventoryLocaleKey>

const ACTION_ERROR_KEYS = {
  'invalid-name': 'errorInvalidName',
  'already-installed': 'errorAlreadyInstalled',
  'not-installed': 'errorNotInstalled',
  'not-managed': 'errorNotManaged',
  'not-found': 'errorNotFound',
  'offline': 'errorOffline',
  'install-failed': 'errorInstallFailed',
  'remove-failed': 'errorRemoveFailed',
  'in-use': 'errorInUse',
  'confirmation-required': 'errorConfirmationRequired',
  'sandbox-unavailable': 'errorSandboxUnavailable',
} satisfies Record<PluginManagerBusinessCode, PluginInventoryLocaleKey>

/** Source-kind badge labels, keyed by the source status kind. */
const SOURCE_KIND_KEYS = {
  static: 'sourceStatic',
  awesome: 'sourceAwesome',
  topic: 'sourceTopic',
  manifest: 'sourceManifest',
} satisfies Record<PluginManagerCatalogSourceStatus['kind'], PluginInventoryLocaleKey>

/** Source-state labels for the per-source status lines. */
const SOURCE_STATE_KEYS = {
  ok: 'sourceOk',
  error: 'sourceError',
  stale: 'sourceStale',
  offline: 'sourceOffline',
} satisfies Record<PluginManagerCatalogSourceStatus['state'], PluginInventoryLocaleKey>

/** Localized accessible label for one root Fiber phase. */
function phaseLabel(
  phase: PluginFiberPhase,
  t: PluginInventorySettingsTabProps['t'],
): string {
  return phase === null ? t('unobserved') : t(PHASE_KEYS[phase])
}

/** Compact a module specifier without guessing whether its Loader id was generated. */
function moduleShortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped
    .replace(/^cordis:/, '')
    .replace(/^cordis-plugin-/, '')
    .replace(/^dsh-(?:host-|client-)?/, '')
}

/** One row of the unified plugin list: a Loader entry or a catalog entry. */
type UnifiedRow =
  | { readonly kind: 'installed'; readonly entry: PluginInventoryEntry }
  | { readonly kind: 'market'; readonly entry: PluginManagerCatalogEntry }

/** Stable disclosure key: Loader entry ids and catalog names live in separate
 * namespaces, so the expanded card is keyed by kind plus identity. */
function rowKey(row: UnifiedRow): string {
  return row.kind === 'installed' ? `installed:${row.entry.entryId}` : `market:${row.entry.name}`
}

/** Whether a unified row matches the local query. */
function matches(row: UnifiedRow, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  const values = row.kind === 'installed'
    ? [row.entry.moduleName, bareEntryId(row.entry.entryId), row.entry.category, row.entry.description]
    : [row.entry.name, row.entry.category, row.entry.description]
  return values.some(value => value !== undefined && value.toLocaleLowerCase().includes(normalizedQuery))
}

/** One category block of the grouped list. */
interface CategoryGroup {
  /** The category name, or null for rows with no projected category. */
  readonly category: string | null
  readonly count: number
  readonly rows: readonly UnifiedRow[]
}

/** Partition rows into category groups, preserving first-seen order. */
function groupByCategory(rows: readonly UnifiedRow[]): readonly CategoryGroup[] {
  const byCategory = new Map<string | null, UnifiedRow[]>()
  for (const row of rows) {
    const category = row.entry.category ?? null
    const list = byCategory.get(category)
    if (list === undefined) byCategory.set(category, [row])
    else list.push(row)
  }
  return [...byCategory.entries()].map(([category, groupRows]) => ({
    category,
    count: groupRows.length,
    rows: groupRows,
  }))
}

/** The network-install surface advertised by the host, defaulting to the safe
 * posture when a snapshot carries no capabilities (a legacy or partial read). */
function installCapabilities(
  catalog: PluginManagerCatalogSnapshot | undefined,
): PluginManagerInstallCapabilities {
  const capabilities = catalog?.capabilities
  return {
    networkConfirmation: capabilities?.networkConfirmation ?? true,
    allowInstallScripts: capabilities?.allowInstallScripts ?? false,
    installSandbox: capabilities?.installSandbox ?? 'confined',
  }
}

/** Render the Loader inventory and the installable catalog as one grouped list. */
export function PluginInventorySettingsTab({
  controller,
  t,
}: PluginInventorySettingsTabProps): ReactNode {
  const state = useSyncExternalStore(
    fn => controller.store.subscribe(fn),
    () => controller.store.getSnapshot(),
    () => controller.store.getSnapshot(),
  )
  // Load on first mount; a later remount hits the store's cached snapshot
  // unless a pushed invalidation marked it stale.
  useEffect(() => { controller.ensureLoaded() }, [controller])

  const catalogId = useId()
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [actionPending, setActionPending] = useState<string | null>(null)
  const [actionError, setActionError] = useState<PluginInventoryLocaleKey | null>(null)
  const [confirming, setConfirming] = useState<PluginManagerCatalogEntry | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [allowScripts, setAllowScripts] = useState(false)

  const inventory = state.inventory
  const catalog = state.catalog
  const inventoryReady = inventory.status === 'ready'
  const catalogReady = catalog.status === 'ready'
  const capabilities = installCapabilities(catalogReady ? catalog.snapshot : undefined)

  /** Source status lines by id, for per-entry badge labels. */
  const sourcesById = useMemo(() => {
    if (!catalogReady) return new Map<string, PluginManagerCatalogSourceStatus>()
    return new Map(catalog.snapshot.sources.map(source => [source.id, source]))
  }, [catalog, catalogReady])

  const normalizedQuery = query.trim().toLocaleLowerCase()

  /** Merged rows: the Loader inventory first, then the catalog entries. */
  const rows = useMemo<UnifiedRow[]>(() => {
    const installed = inventoryReady
      ? inventory.snapshot.entries
        .filter(entry => !bareEntryId(entry.entryId).startsWith(MANAGED_ENTRY_PREFIX))
        .map(entry => ({ kind: 'installed', entry }) as const)
      : []
    const market = catalogReady
      ? catalog.snapshot.entries.map(entry => ({ kind: 'market', entry }) as const)
      : []
    return [...installed, ...market]
  }, [inventory, inventoryReady, catalog, catalogReady])

  /** Rows narrowed by the query. */
  const filteredRows = useMemo(
    () => rows.filter(row => matches(row, normalizedQuery)),
    [normalizedQuery, rows],
  )

  /** Rows narrowed by the query and the active category filter. */
  const visibleRows = useMemo(
    () => categoryFilter === null
      ? filteredRows
      : filteredRows.filter(row => row.entry.category === categoryFilter),
    [categoryFilter, filteredRows],
  )

  const groups = useMemo(() => groupByCategory(visibleRows), [visibleRows])

  /** Rows by category for the filter menu counts, over the whole list. */
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      const category = row.entry.category
      if (category === undefined) continue
      counts.set(category, (counts.get(category) ?? 0) + 1)
    }
    return counts
  }, [rows])

  const menuItems = useMemo<readonly MenuEntry[]>(() => [
    { id: 'all', label: `${t('allCategories')} (${rows.length})` },
    ...[...categoryCounts.entries()].map(([category, count]) => ({ id: category, label: `${category} (${count})` })),
  ], [categoryCounts, rows, t])

  /** Current row keys, so an expanded card clears when its row is removed. */
  const rowKeys = useMemo(() => new Set(rows.map(rowKey)), [rows])
  useEffect(() => {
    if (expanded !== null && !rowKeys.has(expanded)) {
      setExpanded(null)
    }
  }, [expanded, rowKeys])

  const retry = (): void => { controller.load() }

  /** Re-fetch every network catalog source, bypassing the cache. */
  const refreshCatalogNow = async (): Promise<void> => {
    setRefreshing(true)
    await controller.refreshCatalog()
    setRefreshing(false)
  }

  /** Install one catalog entry with an explicit trust confirmation. */
  const runInstall = async (entry: PluginManagerCatalogEntry, scripts: boolean): Promise<void> => {
    setActionPending(entry.name)
    setActionError(null)
    try {
      const result = await controller.install(entry.name, { confirmed: true, allowScripts: scripts })
      if (!result.ok) setActionError(ACTION_ERROR_KEYS[result.error.code])
    } catch {
      setActionError('actionFailed')
    } finally {
      setActionPending(null)
    }
  }

  /** Uninstall one managed plugin. */
  const runUninstall = async (name: string): Promise<void> => {
    setActionPending(name)
    setActionError(null)
    try {
      const result = await controller.uninstall(name)
      if (!result.ok) setActionError(ACTION_ERROR_KEYS[result.error.code])
    } catch {
      setActionError('actionFailed')
    } finally {
      setActionPending(null)
    }
  }

  /** Install click: a network install with host-enforced confirmation opens the
   * trust dialog first; anything else installs directly with scripts disabled. */
  const onInstallClick = (entry: PluginManagerCatalogEntry): void => {
    if (entry.installKind === 'network' && capabilities.networkConfirmation) {
      setAcknowledged(false)
      setAllowScripts(false)
      setConfirming(entry)
    } else {
      void runInstall(entry, false)
    }
  }

  const closeConfirmation = (): void => { setConfirming(null) }

  /** Detail fields of one installed (spine) card. */
  const renderInstalledDetails = (entry: PluginInventoryEntry, statusText: string): ReactNode => {
    return (
      <>
        <code className={css.entryValue} data-loader-entry>{entry.entryId}</code>
        <dl className={css.details}>
          <div>
            <dt>{t('status')}</dt>
            <dd>{statusText}</dd>
          </div>
          {entry.enabled ? (
            <div>
              <dt>{t('cordis')}</dt>
              <dd>{phaseLabel(entry.fiberPhase, t)}</dd>
            </div>
          ) : null}
          {entry.category !== undefined ? (
            <div>
              <dt>{t('category')}</dt>
              <dd>{entry.category}</dd>
            </div>
          ) : null}
          {entry.description !== undefined ? (
            <div>
              <dt>{t('description')}</dt>
              <dd>{entry.description}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t('moduleName')}</dt>
            <dd><code>{entry.moduleName}</code></dd>
          </div>
        </dl>
        <p className={css.harnessNote}>{t('harnessNote')}</p>
      </>
    )
  }

  /** Detail fields of one market card. */
  const renderMarketDetails = (entry: PluginManagerCatalogEntry): ReactNode => {
    return (
      <>
        <code className={css.entryValue}>{entry.name}</code>
        <div className={css.marketMeta}>
          {entry.stars !== undefined ? <span className={css.stars}>★ {entry.stars}</span> : null}
          {entry.url !== undefined
            ? <a className={css.repoLink} href={entry.url} target="_blank" rel="noreferrer">{t('repo')}</a>
            : null}
        </div>
        <dl className={css.details}>
          <div>
            <dt>{t('status')}</dt>
            <dd>{entry.installed ? t('installedTag') : t('notInstalled')}</dd>
          </div>
          {entry.category !== undefined ? (
            <div>
              <dt>{t('category')}</dt>
              <dd>{entry.category}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t('source')}</dt>
            <dd>{entry.source}</dd>
          </div>
          {entry.description !== undefined ? (
            <div>
              <dt>{t('description')}</dt>
              <dd>{entry.description}</dd>
            </div>
          ) : null}
          {entry.installRef !== undefined ? (
            <div>
              <dt>{t('installSpec')}</dt>
              <dd><code>{entry.installRef}</code></dd>
            </div>
          ) : null}
          {entry.version !== undefined ? (
            <div>
              <dt>{t('version')}</dt>
              <dd><code>{entry.version}</code></dd>
            </div>
          ) : null}
          {entry.integrityStatus === 'tampered' ? (
            <div>
              <dt>{t('integrity')}</dt>
              <dd className={css.integrityDetail}>{t('integrityTampered')}</dd>
            </div>
          ) : null}
        </dl>
      </>
    )
  }

  /** One unified card: disclosure button and action button as siblings. */
  const renderRow = (row: UnifiedRow): ReactNode => {
    const isInstalled = row.kind === 'installed' ? row.entry.enabled : row.entry.installed
    const name = row.kind === 'installed' ? row.entry.moduleName : row.entry.name
    const title = moduleShortName(name)
    const statusText = isInstalled ? t('installedTag') : t('notInstalled')
    const key = rowKey(row)
    const open = expanded === key
    const detailId = `${catalogId}-details-${encodeURIComponent(key)}`
    const pending = actionPending === name
    const busy = actionPending !== null
    const networkInstall = row.kind === 'market' && row.entry.installKind === 'network'
    const sourceKind = row.kind === 'market' ? sourcesById.get(row.entry.source)?.kind : undefined

    const badges: ReactNode[] = row.kind === 'installed'
      ? [<span key="origin" className={css.harnessBadge}>{t('harnessRuntime')}</span>]
      : sourceKind !== undefined
        ? [<span key="origin" className={css.sourceBadge} data-source-kind={sourceKind}>{t(SOURCE_KIND_KEYS[sourceKind])}</span>]
        : []
    if (row.entry.category !== undefined) {
      badges.push(<span key="category" className={css.categoryBadge}>{row.entry.category}</span>)
    }
    if (row.kind === 'market' && row.entry.installed && row.entry.integrityStatus === 'tampered') {
      badges.push(<span key="integrity" className={css.tamperedBadge}>{t('integrityTampered')}</span>)
    }

    const ariaLabel = row.kind === 'installed' && row.entry.enabled
      ? `${title}, ${phaseLabel(row.entry.fiberPhase, t)}, ${statusText}`
      : `${title}, ${statusText}`

    return (
      <li
        className={css.card}
        key={key}
        data-open={open ? 'true' : undefined}
        {...(row.kind === 'installed' ? { 'data-plugin-entry': row.entry.entryId } : { 'data-catalog-entry': row.entry.name })}
      >
        <div className={css.cardHeader}>
          <button
            className={css.cardContent}
            type="button"
            aria-expanded={open}
            aria-controls={detailId}
            aria-label={ariaLabel}
            onClick={() => { setExpanded(current => current === key ? null : key) }}
          >
            <span className={css.cardMain}>
              <span className={css.cardBadges}>{badges}</span>
              <strong className={css.cardTitle} title={name}>{title}</strong>
            </span>
            <span className={css.cardTrailing}>
              {row.kind === 'installed' && row.entry.enabled ? (
                <span
                  className={css.statusDot}
                  data-phase={row.entry.fiberPhase ?? 'unobserved'}
                  role="img"
                  aria-label={phaseLabel(row.entry.fiberPhase, t)}
                  title={phaseLabel(row.entry.fiberPhase, t)}
                />
              ) : null}
              <span className={css.statusTag} data-state={isInstalled ? 'installed' : 'not-installed'}>{statusText}</span>
              <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
            </span>
          </button>
          <span className={css.cardAction}>
            {row.kind === 'market' && !row.entry.installable
              ? <span className={css.browseOnly}>{t('browseOnly')}</span>
              : (
                <button
                  className={css.installAction}
                  type="button"
                  disabled={busy}
                  aria-busy={pending ? 'true' : undefined}
                  onClick={() => {
                    if (isInstalled) void runUninstall(name)
                    else if (row.kind === 'market') onInstallClick(row.entry)
                    else void runInstall({ name, installKind: 'static' } as PluginManagerCatalogEntry, false)
                  }}
                >
                  {pending
                    ? networkInstall && !isInstalled ? t('installing') : t('working')
                    : isInstalled ? t('uninstall') : t('install')}
                </button>
              )}
          </span>
        </div>
        {open ? (
          <div className={css.cardDetails} id={detailId}>
            {row.kind === 'installed' ? renderInstalledDetails(row.entry, statusText) : renderMarketDetails(row.entry)}
          </div>
        ) : null}
      </li>
    )
  }

  const showEmpty = inventoryReady && catalogReady && rows.length === 0
  const showEmptySearch = inventoryReady && catalogReady && rows.length > 0 && visibleRows.length === 0
  const confirmingSourceKind = confirming !== null ? sourcesById.get(confirming.source)?.kind : undefined

  return (
    <div className={css.section} aria-busy={inventory.status === 'loading' || catalog.status === 'loading'}>
      {catalogReady && catalog.snapshot.sources.length > 0 ? (
        <ul className={css.sourceStatuses}>
          {catalog.snapshot.sources.map(source => (
            <li className={css.sourceStatus} key={source.id} data-source-state={source.state}>
              <code className={css.sourceId}>{source.id}</code>
              <span className={css.sourceKind}>{t(SOURCE_KIND_KEYS[source.kind])}</span>
              <span className={css.sourceState} data-state={source.state}>{t(SOURCE_STATE_KEYS[source.state])}</span>
              <span className={css.sourceCount} data-source-count={source.entryCount}>{source.entryCount}</span>
              {source.filteredCount !== undefined
                ? <span className={css.sourceFiltered} data-source-filtered>{t('filteredCount', { count: source.filteredCount })}</span>
                : null}
              {source.error !== undefined
                ? <span className={css.sourceErrorDetail} title={source.error}>{source.error}</span>
                : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className={css.toolbar}>
        <label className={css.search}>
          <IconSearchOutline16 aria-hidden="true" />
          <span className={css.visuallyHidden}>{t('search')}</span>
          <input
            type="search"
            value={query}
            placeholder={t('search')}
            aria-label={t('search')}
            onChange={(event) => { setQuery(event.currentTarget.value) }}
          />
        </label>
        <Menu
          open={menuOpen}
          onClose={() => { setMenuOpen(false) }}
          items={menuItems}
          selectedId={categoryFilter ?? 'all'}
          onSelect={(id) => {
            setMenuOpen(false)
            setCategoryFilter(id === 'all' ? null : id)
          }}
          align="end"
          portal
          anchor={(
            <button
              type="button"
              className={css.categoryButton}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title={t('category')}
              onClick={() => { setMenuOpen(open => !open) }}
            >
              <span>{categoryFilter ?? t('allCategories')}</span>
              <IconChevronDownOutline14 aria-hidden="true" />
            </button>
          )}
        />
        <button
          className={css.refreshButton}
          type="button"
          title={t('refresh')}
          disabled={!catalogReady || refreshing}
          onClick={() => void refreshCatalogNow()}
        >
          <IconRefreshOutline16 aria-hidden="true" />
          {refreshing ? t('refreshing') : t('refresh')}
        </button>
      </div>

      {inventory.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {inventory.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {inventoryReady && catalog.status === 'error' ? (
        <p className={css.status} role="alert">{t('errorInstallable')}</p>
      ) : null}
      {showEmpty ? <p className={css.status}>{t('empty')}</p> : null}
      {showEmptySearch ? <p className={css.status}>{t('emptySearch')}</p> : null}

      {groups.length > 0 ? (
        <div className={css.groups}>
          {groups.map(group => (
            <section className={css.group} key={group.category ?? 'uncategorized'}>
              <h3 className={css.groupHead}>
                <span>{group.category ?? t('uncategorized')}</span>
                <span className={css.groupCount}>{group.count}</span>
              </h3>
              <ul className={css.rows}>
                {group.rows.map(renderRow)}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
      {actionError !== null ? <p className={css.installError} role="alert">{t(actionError)}</p> : null}

      {confirming !== null ? (
        <Modal
          open
          onClose={closeConfirmation}
          title={t('confirmTitle')}
          className={css.confirmation ?? ''}
          contentClassName={css.confirmationContent ?? ''}
          footer={(
            <>
              <Button variant="outline" className={css.modalAction} onClick={closeConfirmation}>
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                className={css.confirmAction}
                disabled={!acknowledged || capabilities.installSandbox === 'unavailable'}
                onClick={() => {
                  const entry = confirming
                  closeConfirmation()
                  void runInstall(entry, allowScripts)
                }}
              >
                {t('install')}
              </Button>
            </>
          )}
        >
          <div className={css.warning}>
            <IconWarningOutline16 size={18} className={css.warningIcon} />
            <p>{t('confirmRisk')}</p>
          </div>
          <dl className={css.confirmDetails}>
            <div>
              <dt>{t('moduleName')}</dt>
              <dd><code>{confirming.name}</code></dd>
            </div>
            {confirming.installRef !== undefined ? (
              <div>
                <dt>{t('installSpec')}</dt>
                <dd><code>{confirming.installRef}</code></dd>
              </div>
            ) : null}
            <div>
              <dt>{t('source')}</dt>
              <dd>{confirmingSourceKind !== undefined ? t(SOURCE_KIND_KEYS[confirmingSourceKind]) : confirming.source}</dd>
            </div>
            {confirming.url !== undefined ? (
              <div>
                <dt>{t('repo')}</dt>
                <dd>
                  <a className={css.repoLink} href={confirming.url} target="_blank" rel="noreferrer">{confirming.url}</a>
                </dd>
              </div>
            ) : null}
          </dl>
          {capabilities.allowInstallScripts ? (
            <label className={css.scriptCheckbox}>
              <input
                type="checkbox"
                checked={allowScripts}
                onChange={(event) => { setAllowScripts(event.currentTarget.checked) }}
              />
              <span>{t('allowScripts')}</span>
            </label>
          ) : null}
          {capabilities.installSandbox === 'unavailable' ? (
            <p className={css.sandboxNotice} role="alert">{t('sandboxUnavailable')}</p>
          ) : null}
          <label className={css.acknowledgement}>
            <input
              type="checkbox"
              checked={acknowledged}
              autoFocus
              onChange={(event) => { setAcknowledged(event.currentTarget.checked) }}
            />
            <span>{t('confirmAcknowledge')}</span>
          </label>
        </Modal>
      ) : null}
    </div>
  )
}
