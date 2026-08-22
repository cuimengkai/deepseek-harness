/**
 * Demo-owned persona row with a configurable section name.
 *
 * The shipped `@deepseek-ai/dsh-persona` row registers the FIXED
 * `deployment:persona` section, and `systemPrompt.section()` throws on duplicate
 * section names within one layer — so a workbench tree carrying more than one
 * persona row (the role's base persona plus one per assembled capability) cannot
 * reuse it. This row registers whatever section the composition names, letting an
 * assembled preset contribute one persona section per capability in catalog
 * order. Demo-owned: the real platform ships persona variants behind section
 * names the workbench declares.
 * @module capability-market-demo-persona-row
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name. */
export const name = 'persona-row'

/** The prompt registry this row contributes to. */
export const inject = ['systemPrompt']

/** Plugin config: one persona section for the composition to contribute. */
export interface PersonaRowConfig {
  /** Section name registered for this row (must be unique within its layer). */
  section: string
  /** Render order, after the base persona's `deployment:persona` (order 0). */
  order: number
  /** Persona prose rendered as that section. */
  text: string
}

/**
 * Register one persona section under the configured name.
 * @param ctx - an agent scope context; an unscoped context would collide with
 * the prompt registry's own registrations and reject.
 * @param config - the section name, order, and persona text.
 */
export function apply(ctx: Context, config: PersonaRowConfig): void {
  ctx.effect(() => ctx.systemPrompt.section({
    name: config.section,
    order: config.order,
    text: config.text,
  }), 'persona-row.section()')
}
