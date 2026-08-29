/**
 * LayoutController: the cross-plugin panel-action face behind ctx.layout.
 * Panel geometry itself lives in the root entry's layout store (stores.ts);
 * the current-session selection lives with the runtime sessions service, and
 * the per-session active view dissolved into ui-conversation's session store
 * (its only consumer). What remains here is the contract other plugins'
 * apply worlds reach for panel transitions (sidebar toggle from ui-sidebar,
 * details open/close from ui-conversation) — writes stay inside the store's
 * declared action set, delivered as the registration's bound actions.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { createLayoutStore } from './stores.ts'

/** The layout store's bound action set (framework-baked, draft params peeled). */
export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>

/**
 * The outward layout face (`ctx.layout`): the panel transitions other
 * plugins may trigger — and exactly what a test fake must supply. The
 * attachPanels wiring hook stays on the concrete class (root-entry assembly
 * only).
 */
export interface ILayout {
  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void
  /** Open the details panel (no-op when already open). */
  openDetails(): void
  /** Close the details panel. */
  closeDetails(): void
  /** Open when closed; close when open. */
  toggleDetails(): void
  /** Whether the details column currently has a non-zero preferred width. */
  getDetailsOpen(): boolean
  /**
   * Subscribe to details open/closed changes (driven by AppFrame panel sync).
   * @param listener - called after open state changes.
   * @returns disposer.
   */
  subscribeDetails(listener: () => void): () => void
  /**
   * Mirror the root layout store snapshot so open state tracks drag-close and
   * session-switch closes that write the store directly.
   * @param state - latest panel geometry.
   */
  syncPanels(state: { readonly details: number }): void
}

/** Cross-plugin panel-action face (ctx.layout). */
export class LayoutController implements ILayout {
  #panels: PanelActions | undefined
  #detailsOpen = false
  readonly #detailsListeners = new Set<() => void>()

  /**
   * Adopt the root entry's bound store actions. Called from the root
   * registration's inject hook (a sanctioned assembly side effect), so the
   * face is live from the entry's first render; on entry re-register the
   * fresh actions overwrite the stale set.
   * @param actions - bound actions of the entry's layout store instance.
   */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
  }

  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Open the details panel (no-op when already open). */
  openDetails(): void {
    this.#require().openDetails()
    this.#setDetailsOpen(true)
  }

  /** Close the details panel. */
  closeDetails(): void {
    this.#require().closeDetails()
    this.#setDetailsOpen(false)
  }

  /** Open when closed; close when open. */
  toggleDetails(): void {
    if (this.#detailsOpen) this.closeDetails()
    else this.openDetails()
  }

  /** Whether the details column currently has a non-zero preferred width. */
  getDetailsOpen(): boolean {
    return this.#detailsOpen
  }

  /**
   * Subscribe to details open/closed changes.
   * @param listener - called after open state changes.
   * @returns disposer.
   */
  subscribeDetails(listener: () => void): () => void {
    this.#detailsListeners.add(listener)
    return () => { this.#detailsListeners.delete(listener) }
  }

  /**
   * Mirror the root layout store snapshot.
   * @param state - latest panel geometry.
   */
  syncPanels(state: { readonly details: number }): void {
    this.#setDetailsOpen(state.details > 0)
  }

  #setDetailsOpen(open: boolean): void {
    if (this.#detailsOpen === open) return
    this.#detailsOpen = open
    for (const listener of this.#detailsListeners) listener()
  }

  #require(): PanelActions {
    // Callers are UI gestures, which cannot fire before the root entry
    // rendered (the inject hook runs in its first render) — reaching this
    // unwired is a boot-order bug, not a race to tolerate.
    if (this.#panels === undefined) throw new Error('layout: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
}
