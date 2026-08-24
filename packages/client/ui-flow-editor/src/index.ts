/**
 * Host loader entry for the flow-canvas component-provider row: the node half
 * mounts nothing. The row exists so the web composition's module table serves
 * the browser client bundle (`…/client`) to the agent-preset composer; this
 * empty `apply` keeps the host-side entry a valid plugin.
 */

/** Provides no host-side behavior. */
export function apply(): void {}
