/**
 * The shared flow canvas, browser half: the React Flow graph editor. This
 * package is a component library, not an interactive plugin — the browser
 * roster mounts it only to serve these module bytes, which the agent-preset
 * composer requires as `@deepseek-ai/dsh-client-ui-flow-editor/client`.
 * The former session conversation view is gone; flow orchestration lives in the
 * composer, and the session-level run surface was removed (Known Limitation in
 * the package README).
 */

// The shared canvas is exported for the composer, which drives the same
// gestures over its graph-backed composition rows.
export { FlowCanvas, type FlowCanvasProps, type FlowCanvasSurface } from './FlowCanvas.tsx'

/**
 * Browser plugin entry for the component-provider row. Mounts nothing: the
 * `apply` exists to keep the row a valid plugin for the boot kernel's
 * activation audit, which throws on an entry whose module has no `apply`
 * (vendor/cordis/src/registry.ts). The row's only effect is supplying the
 * client bundle to the module table.
 */
export function apply(): void {}
