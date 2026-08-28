// @vitest-environment jsdom
/** Section, setup-card, and hand-written editor behavior over a scripted wire face. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { RpcResponse, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  duplicablePathOf, modelCopy, ModelsSection, needsSetup, profileFactsOf, providerCopy,
  providerTargetLabel, removeProviderProfile,
} from '../src/client/ModelsSection.tsx'
import type { ModelsSectionInjected, ModelsSectionProps } from '../src/client/ModelsSection.tsx'
import { pathOps } from '../src/client/ProviderEditor.tsx'
import {
  DeepSeekModelsEditor, formatCapacity, modelDrafts, parseCapacity, validateDeepSeekModels,
} from '../src/client/DeepSeekModelsEditor.tsx'
import { apiKeyFailure } from '../src/client/apiKey.ts'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { deriveKeyRef, ModelsSettingsStore } from '../src/client/store.ts'
import type { ProviderRow } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(cleanup)

const t: ModelsSectionInjected['t'] = key => en[key]
const OPENAI_TARGET = { provider: 'openai', displayName: 'openai' }
const openaiCopy = (template: string): string => providerCopy(template, OPENAI_TARGET)
const DEEPSEEK_TARGET = { provider: 'deepseek-official', displayName: 'DeepSeek' }
const deepSeekCopy = (template: string): string => providerCopy(template, DEEPSEEK_TARGET)

/** Open one row's capacity disclosure (1-based, as the labels read). */
function expandRow(position: number): void {
  fireEvent.click(screen.getByLabelText(`${en.modelAdvanced} ${String(position)}`))
}

/** The capacity inputs of every open row, in row order. */
function capacityInputs(label: string): HTMLInputElement[] {
  return screen.getAllByLabelText<HTMLInputElement>(new RegExp(label))
}

const PiAiConfig = Schema.object({
  providers: Schema.dict(Schema.object({
    apiKeyEnv: Schema.string().role('credential-ref'),
    baseURL: Schema.string(),
    reasoning: Schema.union(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
    headers: Schema.dict(Schema.string()),
  })),
})

const DeepSeekConfig = Schema.object({
  apiKeyEnv: Schema.string().role('credential-ref'),
  baseURL: Schema.string().pattern(/^https:\/\//),
  reasoningEffort: Schema.union(['off', 'low', 'high', 'max']),
  defaultContextWindow: Schema.number().step(1).min(1),
  models: Schema.array(Schema.object({
    id: Schema.string().required(),
    name: Schema.string(),
    description: Schema.string(),
    contextWindow: Schema.number().step(1).min(1),
  // The adapter declares its catalog as a schema default rather than a
  // composition entry, which is what the restore-defaults path has to read.
  })).default([
    {
      id: 'deepseek-v4-flash',
      name: 'DeepSeek-V4-Flash',
      description: '',
      contextWindow: 1_000_000,
    },
    {
      id: 'deepseek-v4-pro',
      name: 'DeepSeek-V4-Pro',
      description: '',
      contextWindow: 1_000_000,
    },
  ]),
})

const DEFAULT_DEEPSEEK_MODELS = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek-V4-Flash',
    description: 'Preserved hidden detail',
    contextWindow: 1_000_000,
  },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 1_000_000 },
]

function wireNamespaces(): SettingsNamespaceView[] {
  return [
    {
      ns: 'llm-deepseek',
      schema: JSON.parse(JSON.stringify(DeepSeekConfig.toJSON())) as unknown,
      value: {
        apiKeyEnv: 'DEEPSEEK_API_KEY',
        baseURL: 'https://base',
        defaultContextWindow: 1_000_000,
        maxTokens: 256_000,
        models: DEFAULT_DEEPSEEK_MODELS,
      },
      base: { defaultContextWindow: 1_000_000, maxTokens: 256_000, models: DEFAULT_DEEPSEEK_MODELS },
      user: { baseURL: 'https://base' },
      applies: 'live',
      secrets: [],
      revision: 0,
    },
    {
      ns: 'llm-plain',
      schema: JSON.parse(JSON.stringify(Schema.object({
        profiles: Schema.dict(Schema.object({ note: Schema.string() })),
      }).toJSON())) as unknown,
      value: {},
      applies: 'live',
      secrets: [],
      revision: 0,
    },
    {
      ns: 'llm-pi-ai',
      schema: JSON.parse(JSON.stringify(PiAiConfig.toJSON())) as unknown,
      value: { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://proxy', headers: { 'X-Team': 'a' } }, zombie: {} } },
      user: { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://proxy', headers: { 'X-Team': 'a' } }, zombie: {} } },
      applies: 'live',
      secrets: [],
      revision: 0,
    },
    {
      ns: 'agent-default-model',
      schema: JSON.parse(JSON.stringify(Schema.object({
        provider: Schema.string(),
        model: Schema.string(),
      }).toJSON())) as unknown,
      value: { provider: 'openai', model: 'gpt-4o' },
      user: {},
      applies: 'live',
      secrets: [],
      revision: 0,
    },
  ]
}

let nextRpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: true, value } }
}
function fail<T>(message: string, code = 'settings-rejected'): RpcResponse<T> {
  return {
    rpcId: `r-${nextRpc++}` as never,
    result: { ok: false, error: { code, message, details: { ns: 'x' } } as never },
  }
}

function scriptedFace(overrides: {
  update?: ReturnType<typeof vi.fn>
  replace?: ReturnType<typeof vi.fn>
  mutate?: ReturnType<typeof vi.fn>
  set?: ReturnType<typeof vi.fn>
  unset?: ReturnType<typeof vi.fn>
} = {}) {
  const update = overrides.update ?? vi.fn(() => Promise.resolve(ok(wireNamespaces()[2])))
  const replace = overrides.replace ?? vi.fn(() => Promise.resolve(ok(wireNamespaces()[2])))
  const mutate = overrides.mutate ?? vi.fn(() => Promise.resolve(ok(wireNamespaces()[2])))
  const set = overrides.set ?? vi.fn(() => Promise.resolve(ok({})))
  const unset = overrides.unset ?? vi.fn(() => Promise.resolve(ok({})))
  const face = {
    llm: {
      providers: vi.fn(() => Promise.resolve(ok({
        providers: [
          { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [], active: true },
          { provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], active: true },
          { provider: 'anthropic', displayName: 'anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'], active: false },
          { provider: 'zombie', displayName: 'zombie', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'zombie'], active: false },
          { provider: 'broken', displayName: 'broken', settingsNs: 'llm-pi-ai', settingsPath: ['nope', 'x'], active: false },
          { provider: 'plain', displayName: 'plain', settingsNs: 'llm-plain', settingsPath: ['profiles', 'plain'], active: false },
        ],
      }))),
      models: vi.fn(() => Promise.resolve(ok({
        groups: [{
          id: 'openai',
          name: 'openai',
          models: [
            { id: 'gpt-4o', name: 'GPT-4o' },
            { id: 'gpt-4o-mini', name: 'GPT-4o mini' },
          ],
        }],
        failures: [],
      }))),
    },
    settings: {
      describe: vi.fn(() => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: wireNamespaces() }))),
      update,
      replace,
      mutate,
    },
    credentials: {
      describe: vi.fn((payload: { refs: string[] }) => Promise.resolve(ok({
        credentials: Object.fromEntries(payload.refs.map(ref => [ref, {
          configured: ref === 'OPENAI_API_KEY',
          ...ref === 'OPENAI_API_KEY' ? { source: 'file' } : {},
          writable: true,
        }])),
      }))),
      set,
      unset,
    },
  }
  return { face, update, replace, mutate, set, unset }
}

type WireFace = ConstructorParameters<typeof ModelsSettingsStore>[0]

async function mountFace(scripted: ReturnType<typeof scriptedFace>) {
  const { face, update, replace, mutate, set, unset } = scripted
  const mirror = new SettingsDescribeMirror(face as never)
  const controller = new ModelsSettingsStore(face as unknown as WireFace, settingsSchema, mirror)
  await controller.load()
  const injected: ModelsSectionProps = {
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    api: face as never,
    schema: settingsSchema,
    t,
  }
  const view = render(<ModelsSection {...injected} />)
  return { view, face, update, replace, mutate, set, unset, controller, mirror }
}

async function mountSection(overrides: Parameters<typeof scriptedFace>[0] = {}) {
  return mountFace(scriptedFace(overrides))
}

/**
 * Mount for a user who cannot reach any provider yet: no credential is stored
 * anywhere, so the whole-section DeepSeek route owns the first-run setup card.
 */
async function mountFirstRun(overrides: Parameters<typeof scriptedFace>[0] = {}) {
  const scripted = scriptedFace(overrides)
  scripted.face.credentials.describe.mockImplementation((payload: { refs: string[] }) =>
    Promise.resolve(ok({
      credentials: Object.fromEntries(payload.refs.map(ref => [ref, { configured: false, writable: true }])),
    })))
  return mountFace(scripted)
}

/**
 * Mount and open the DeepSeek editor. The shared fixture already has a usable
 * openai route, so DeepSeek is an ordinary row whose card opens through Edit
 * rather than by itself.
 */
async function mountDeepSeekCard(overrides: Parameters<typeof scriptedFace>[0] = {}) {
  const mounted = await mountSection(overrides)
  fireEvent.click(screen.getByRole('button', { name: deepSeekCopy(en.editProvider) }))
  return mounted
}

/**
 * Open the add dialog from the grid tile, pick the first dormant provider
 * (anthropic), and land on its embedded configuration form.
 */
async function openAddEditor(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: en.add }))
  fireEvent.click(await screen.findByRole('button', { name: 'anthropic' }))
  await screen.findByLabelText(en.keyInput)
}

describe('ModelsSection', () => {
  it('renders nothing before the slot injects its dependencies', () => {
    const uninjected = {} as ModelsSectionProps
    render(<ModelsSection {...uninjected} />)
    expect(document.body.textContent).toBe('')
  })

  it('renders the unkeyed whole-section provider as an open setup card in the first-run posture', async () => {
    await mountFirstRun()
    // Nothing is reachable yet, and DeepSeek has no configured credential and
    // no stored apiKey → setup card.
    expect(screen.getByText('DeepSeek')).toBeTruthy()
    expect(screen.getByLabelText(en.keyInput)).toBeTruthy()
    expect(screen.getByText('openai')).toBeTruthy()
    expect(screen.queryByText('Active')).toBeNull()
    expect(screen.queryByText('Inactive')).toBeNull()
    // Dormant directory providers stay behind the add dialog's grid — the
    // list carries only configured providers plus the add entry.
    expect(screen.getByRole('button', { name: en.add })).toBeTruthy()
    expect(screen.queryByText('anthropic')).toBeNull()
  })

  it('marks every card with a logo or a stable letter avatar derived from its route', async () => {
    await mountSection()
    // A route the icon set has no mark for — deepseek-official is not
    // `deepseek` — carries the display name's first character on a palette
    // color hashed from the route id: decorative (aria-hidden) and identical
    // on every load.
    const cardOf = (name: string): HTMLElement => {
      const card = screen.getByText(name).closest('li')
      if (card === null) throw new Error(`no card for ${name}`)
      return card
    }
    const deepSeekAvatar = within(cardOf('DeepSeek')).getByText('D')
    expect(deepSeekAvatar.className).toMatch(/avatar/)
    expect(deepSeekAvatar.getAttribute('aria-hidden')).toBe('true')
    // A route the icon set knows wears its vendored mark instead; anthropic
    // is dormant, so its only surface is the pick grid.
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    const cell = screen.getByRole('button', { name: 'anthropic' })
    const logo = cell.querySelector('span[class*="providerLogo"] > svg')
    expect(logo).not.toBeNull()
    expect(logo?.parentElement?.getAttribute('aria-hidden')).toBe('true')
  })

  it('narrows the pick dialog preset grid to what the search names', async () => {
    await mountSection()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    // Every dormant directory entry starts adoptable beside the declare tile;
    // zombie is configured (an empty profile still counts), so it never joins.
    expect(screen.getByRole('button', { name: 'anthropic' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'broken' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'zombie' })).toBeNull()
    expect(screen.getByRole('button', { name: en.customAdd })).toBeTruthy()
    fireEvent.change(screen.getByLabelText(en.pickSearch), { target: { value: 'anth' } })
    expect(screen.getByRole('button', { name: 'anthropic' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'broken' })).toBeNull()
    // The declare tile is not a preset, so it stays whatever the search says.
    expect(screen.getByRole('button', { name: en.customAdd })).toBeTruthy()
    // A query naming nothing says so rather than showing an empty grid.
    fireEvent.change(screen.getByLabelText(en.pickSearch), { target: { value: 'nonsense' } })
    expect(screen.getByText(en.pickNoMatches)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'anthropic' })).toBeNull()
  })

  it('widens the pick and editor dialog cards, not their content regions', async () => {
    // The Modal caps its card at 380px; a width class on the content region
    // inside stretches nothing, so both wide dialogs must ride the card
    // through `className`, where the sheet can override the cap.
    await mountSection()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    const dialog = screen.getByRole('dialog', { name: en.addTitle })
    expect(dialog.className).toMatch(/pickDialog/)
    // Picking a provider embeds its form under the grid inside the SAME
    // dialog — pick above, configure below — never a second dialog.
    fireEvent.click(screen.getByRole('button', { name: 'anthropic' }))
    await screen.findByLabelText(en.keyInput)
    expect(screen.getByRole('dialog', { name: en.addTitle })).toBe(dialog)
    fireEvent.click(within(dialog).getByRole('button', { name: en.close }))
    fireEvent.click(screen.getByRole('button', { name: deepSeekCopy(en.editProvider) }))
    expect((await screen.findByRole('dialog')).className).toMatch(/editorDialog/)
  })

  it('leaves the unkeyed provider a plain row once another provider is usable', async () => {
    await mountSection()
    // openai's key is stored, so the user is not blocked and nothing on the
    // page opens itself over them.
    expect(screen.queryByLabelText(en.keyInput)).toBeNull()
    const configured = screen.getByRole('img', { name: en.credentialConfigured })
    expect(configured.getAttribute('title')).toBe(en.credentialConfigured)
    expect(configured.className).toContain('credentialDotConfigured')
    expect(configured.closest('li')?.textContent).toContain('openai')
    const missing = screen.getByRole('img', { name: en.credentialMissing })
    expect(missing.closest('li')?.textContent).toContain('DeepSeek')
    // The card is still one click away.
    fireEvent.click(screen.getByRole('button', { name: deepSeekCopy(en.editProvider) }))
    expect(screen.getByLabelText(en.keyInput)).toBeTruthy()
  })

  it('marks only a confirmed missing reference and leaves native or unavailable state unmarked', async () => {
    const { face } = scriptedFace()
    face.credentials.describe.mockImplementation((payload: { refs: string[] }) => Promise.resolve(ok({
      credentials: Object.fromEntries(payload.refs.map(ref => [ref, { configured: false, writable: true }])),
    })))
    const controller = new ModelsSettingsStore(face as unknown as WireFace, settingsSchema, new SettingsDescribeMirror(face as never))
    await controller.load()
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      api={face as never}
      schema={settingsSchema}
      t={t}
    />)

    const missing = screen.getByRole('img', { name: en.credentialMissing })
    expect(missing.getAttribute('title')).toBe(en.credentialMissing)
    expect(missing.className).toContain('credentialDotMissing')
    expect(missing.closest('li')?.textContent).toContain('openai')
    expect(screen.queryByRole('img', { name: en.credentialConfigured })).toBeNull()
    expect(screen.getByText('zombie').closest('li')?.querySelector('[role="img"]')).toBeNull()
  })

  it('turns the setup card into a row once the credential reports configured', async () => {
    const { face } = await mountFirstRun()
    face.credentials.describe.mockImplementation((payload: { refs: string[] }) => Promise.resolve(ok({
      credentials: Object.fromEntries(payload.refs.map(ref => [ref, { configured: true, writable: true }])),
    })))
    const controller = new ModelsSettingsStore(face as unknown as WireFace, settingsSchema, new SettingsDescribeMirror(face as never))
    await controller.load()
    cleanup()
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      api={face as never}
      schema={settingsSchema}
      t={t}
    />)
    // Now rows with Edit icon actions, not an open card.
    expect(screen.getAllByTitle(en.edit).length).toBeGreaterThan(1)
    expect(screen.queryByLabelText(en.keyInput)).toBeNull()
  })

  it('decides setup need from the joined credential state and the first-run posture', () => {
    const entry = { provider: 'p', displayName: 'p', settingsNs: 'llm-deepseek', settingsPath: [], active: true }
    const row = (credential: ProviderRow['credential']): ProviderRow => ({
      entry,
      configured: true,
      removable: false,
      profile: {},
      apiKeyEnv: 'X',
      credential,
    })
    expect(needsSetup(row(undefined), false)).toBe(true)
    expect(needsSetup(row({ configured: true, writable: true }), false)).toBe(false)
    const nested = { ...row(undefined), entry: { ...entry, settingsPath: ['providers', 'x'] } }
    expect(needsSetup(nested, false)).toBe(false)
    // A user who can already reach some provider is not in the first-run
    // posture, so nothing on the page opens itself.
    expect(needsSetup(row(undefined), true)).toBe(false)
  })

  it('derives conventional credential references from route ids', () => {
    expect(deriveKeyRef('anthropic')).toBe('ANTHROPIC_API_KEY')
    expect(deriveKeyRef('minimax-cn')).toBe('MINIMAX_CN_API_KEY')
  })

  it('uses one stable provider identity in action copy', () => {
    const target = { provider: 'deepseek-official', displayName: 'DeepSeek' }
    expect(providerTargetLabel(target)).toBe('DeepSeek (deepseek-official)')
    expect(providerCopy(en.deleteTitle, target)).toBe('Delete DeepSeek (deepseek-official)?')
    expect(providerTargetLabel(OPENAI_TARGET)).toBe('openai')
  })

  it('names only changed fields instead of rebuilding the section', () => {
    expect(pathOps(['providers', 'openai'], { baseURL: 'https://old', reasoning: 'high' }, { reasoning: 'high' }))
      .toEqual([{ op: 'unset', path: ['providers', 'openai', 'baseURL'] }])
    expect(pathOps([], { b: 1 }, { b: 2, d: 3 }))
      .toEqual([{ op: 'set', path: ['b'], value: 2 }, { op: 'set', path: ['d'], value: 3 }])
    expect(pathOps([], undefined, {})).toEqual([])
    expect(pathOps([], { a: 1 }, { a: 1 })).toEqual([])
  })

  it('stores a typed key write-only from the setup card without touching settings', async () => {
    const { set, update, face } = await mountFirstRun()
    const key = screen.getByLabelText<HTMLInputElement>(en.keyInput)
    fireEvent.change(key, { target: { value: '  sk-live  ' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(set).toHaveBeenCalledWith({ ref: 'DEEPSEEK_API_KEY', value: 'sk-live' }) })
    expect(update).not.toHaveBeenCalled()
    // The saved key re-loads the join; the settings answer rides the shared
    // mirror, so the reload shows as a directory read rather than a describe.
    await waitFor(() => { expect(face.llm.providers.mock.calls.length).toBeGreaterThan(1) })
    expect((await screen.findByRole('status')).textContent).toBe(
      providerCopy(en.savedProvider, { provider: 'deepseek-official', displayName: 'DeepSeek' }),
    )
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('reuses the provider editor as a required credential-only onboarding form', async () => {
    let finishSet: ((response: RpcResponse<Record<string, never>>) => void) | undefined
    const set = vi.fn(() => new Promise<RpcResponse<Record<string, never>>>((resolve) => {
      finishSet = resolve
    }))
    const { face, mutate } = scriptedFace({ set })
    const onClose = vi.fn()
    const { ProviderEditor } = await import('../src/client/ProviderEditor.tsx')

    render(<ProviderEditor
      provider="deepseek-official"
      displayName="DeepSeek"
      hideTitle
      namespace={wireNamespaces()[0]!}
      schema={settingsSchema}
      settingsPath={[]}
      api={face as never}
      t={t}
      readOnly={false}
      credentialOnly
      credentialRequired
      autoFocusCredential
      cancelLabel="onboardingLater"
      submitLabel="onboardingSave"
      submitBusyLabel="onboardingSaving"
      onClose={onClose}
    />)

    const key = screen.getByLabelText<HTMLInputElement>(en.keyInput)
    const save = screen.getByText<HTMLButtonElement>(en.onboardingSave)
    expect(document.activeElement).toBe(key)
    expect(key.required).toBe(true)
    expect(save.disabled).toBe(true)
    expect(screen.getByText(en.onboardingLater)).toBeTruthy()
    expect(screen.queryByText(en.advanced)).toBeNull()
    expect(screen.queryByLabelText(en.baseUrl)).toBeNull()

    fireEvent.change(key, { target: { value: '   ' } })
    expect(screen.getByText(en.keyRequired)).toBeTruthy()
    expect(key.getAttribute('aria-invalid')).toBe('true')
    expect(save.disabled).toBe(true)

    fireEvent.change(key, { target: { value: '  sk-onboarding  ' } })
    expect(screen.queryByText(en.keyRequired)).toBeNull()
    expect(save.disabled).toBe(false)
    fireEvent.click(save)

    expect(await screen.findByText(en.onboardingSaving)).toBeTruthy()
    expect(set).toHaveBeenCalledWith({ ref: 'DEEPSEEK_API_KEY', value: 'sk-onboarding' })
    expect(mutate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    if (finishSet === undefined) throw new Error('credential write did not start')
    await act(async () => {
      finishSet?.(ok({}))
      await Promise.resolve()
    })
    expect(onClose).toHaveBeenCalledWith(true)
  })

  it('applies customized deepseek fields as path ops', async () => {
    const { mutate } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(ok(wireNamespaces()[0]))),
    })
    fireEvent.click(screen.getByText(en.advanced))
    const baseURL = screen.getByLabelText<HTMLInputElement>(en.baseUrl)
    // The deepseek placeholder is pinned to the public endpoint, not the
    // effective value (which may reflect a launch-environment override).
    expect(baseURL.placeholder).toBe('https://api.deepseek.com')
    fireEvent.change(baseURL, { target: { value: 'https://next2' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    // Only the field that actually changed: reasoningEffort was already
    // 'high' in the loaded profile, so it produces no op.
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-deepseek',
      ops: [{ op: 'set', path: ['baseURL'], value: 'https://next2' }],
      expectedRevision: 0,
    })
  })

  it('materializes inherited models and adds an arbitrary DeepSeek id', async () => {
    const { mutate } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(ok(wireNamespaces()[0]))),
    })
    fireEvent.click(screen.getByText(en.advanced))
    expect(screen.getByText(en.modelsInherited)).toBeTruthy()
    expect(screen.getAllByLabelText(new RegExp(en.modelId)).map(input => (input as HTMLInputElement).value))
      .toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])

    fireEvent.click(screen.getByText(en.addModel))
    const ids = screen.getAllByLabelText(new RegExp(en.modelId))
    const names = screen.getAllByLabelText(new RegExp(en.modelName))
    expandRow(3)
    fireEvent.change(ids[2] as HTMLInputElement, { target: { value: 'private-preview' } })
    fireEvent.change(names[2] as HTMLInputElement, { target: { value: 'Private Preview' } })
    // Only row 3 is open, so its capacity is addressed by its own label.
    fireEvent.change(screen.getByLabelText(`${en.contextWindow} 3`), { target: { value: '131072' } })
    fireEvent.click(screen.getByText(en.apply))

    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-deepseek',
      ops: [{
        op: 'set',
        path: ['models'],
        value: [
          ...DEFAULT_DEEPSEEK_MODELS,
          { id: 'private-preview', name: 'Private Preview', contextWindow: 131_072 },
        ],
      }],
      expectedRevision: 0,
    })
  })

  it('declares input modalities and roles on a DeepSeek catalog row', async () => {
    const { mutate } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(ok(wireNamespaces()[0]))),
    })
    fireEvent.click(screen.getByText(en.advanced))
    expandRow(1)
    // A row without a declaration reads as the adapter's text default, so text
    // is pre-checked and the other boxes start unchecked — adding "image" then
    // means multimodal instead of a model that accepts only images.
    const text = screen.getByLabelText(`${en.inputModalities} text`) as HTMLInputElement
    expect(text.checked).toBe(true)
    const image = screen.getByLabelText(`${en.inputModalities} image`) as HTMLInputElement
    const audio = screen.getByLabelText(`${en.modelKinds} audio`) as HTMLInputElement
    expect(image.checked).toBe(false)
    expect(audio.checked).toBe(false)

    fireEvent.click(image)
    fireEvent.click(audio)
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    const call = mutate.mock.calls[0]?.[0] as { ops: { path: string[]; value: unknown }[] } | undefined
    const value = call?.ops[0]?.value as Record<string, unknown>[] | undefined
    expect(value?.[0]).toEqual({
      ...DEFAULT_DEEPSEEK_MODELS[0],
      inputModalities: ['text', 'image'],
      kinds: ['text', 'audio'],
    })
  })

  it('rejects duplicate DeepSeek model ids before writing', async () => {
    const { mutate } = await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.advanced))
    fireEvent.click(screen.getByText(en.addModel))
    const ids = screen.getAllByLabelText(new RegExp(en.modelId))
    fireEvent.change(ids[2] as HTMLInputElement, { target: { value: 'deepseek-v4-flash' } })
    fireEvent.click(screen.getByText(en.apply))

    await screen.findByText(`Model 3: ${en.modelIdDuplicate}`)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('validates every adapter-owned model catalog invariant', () => {
    expect(modelDrafts(undefined)).toEqual([])
    expect(modelDrafts([null, 'bad', { id: 'ok' }])).toEqual([{}, {}, { id: 'ok' }])
    expect(validateDeepSeekModels([{}])).toEqual({ index: 0, key: 'modelIdRequired' })
    expect(validateDeepSeekModels([{ id: 'same' }, { id: 'same' }]))
      .toEqual({ index: 1, key: 'modelIdDuplicate' })
    expect(validateDeepSeekModels([{ id: 'model', name: '' }]))
      .toEqual({ index: 0, key: 'modelNameInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', contextWindow: null }]))
      .toEqual({ index: 0, key: 'modelContextInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', contextWindow: 1.5 }]))
      .toEqual({ index: 0, key: 'modelContextInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', contextWindow: 0 }]))
      .toEqual({ index: 0, key: 'modelContextInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', contextWindow: 1 }])).toBeUndefined()
    expect(validateDeepSeekModels([{ id: 'model', maxTokens: null }]))
      .toEqual({ index: 0, key: 'modelMaxTokensInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', maxTokens: 1.5 }]))
      .toEqual({ index: 0, key: 'modelMaxTokensInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', maxTokens: 0 }]))
      .toEqual({ index: 0, key: 'modelMaxTokensInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', maxTokens: 8192 }])).toBeUndefined()
    // Modality lists must be non-empty, on the menu, and duplicate-free — the
    // adapter's own load-time rules, mirrored here so a hand-written catalog
    // fails in the editor instead of at mount.
    expect(validateDeepSeekModels([{ id: 'model', inputModalities: [] }]))
      .toEqual({ index: 0, key: 'modelInputModalitiesInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', inputModalities: ['audio'] }]))
      .toEqual({ index: 0, key: 'modelInputModalitiesInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', inputModalities: ['text', 'text'] }]))
      .toEqual({ index: 0, key: 'modelInputModalitiesInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', inputModalities: ['text', 'image'] }])).toBeUndefined()
    expect(validateDeepSeekModels([{ id: 'model', kinds: ['multimodal'] }]))
      .toEqual({ index: 0, key: 'modelKindsInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', kinds: ['text', 'audio', 'embedding', 'image'] }])).toBeUndefined()
  })

  it('reads context windows written as counts, thousands, or millions', () => {
    expect(parseCapacity('')).toBeUndefined()
    expect(parseCapacity('   ')).toBeUndefined()
    expect(parseCapacity('131072')).toBe(131_072)
    expect(parseCapacity(' 256K ')).toBe(256_000)
    expect(parseCapacity('256k')).toBe(256_000)
    expect(parseCapacity('1M')).toBe(1_000_000)
    expect(parseCapacity('1m')).toBe(1_000_000)
    // 1M is 1000K, not 1024K: capacities are quoted in decimal.
    expect(parseCapacity('1M')).toBe(parseCapacity('1000K'))
    // 2.3 * 1e6 is a few ULPs high in binary floating point; an integral
    // intent must not become a fractional count the validator rejects.
    expect(parseCapacity('2.3M')).toBe(2_300_000)
    expect(Number.isInteger(parseCapacity('1.5M'))).toBe(true)
    // A genuinely fractional count survives as one, for the validator to reject.
    expect(parseCapacity('0.0001K')).toBeCloseTo(0.1)
    expect(parseCapacity('abc')).toBeNaN()
    expect(parseCapacity('1G')).toBeNaN()
    expect(parseCapacity('1M1')).toBeNaN()
  })

  it('spells a stored count in the shortest form that round-trips', () => {
    expect(formatCapacity(1_000_000)).toBe('1M')
    expect(formatCapacity(256_000)).toBe('256K')
    expect(formatCapacity(1_500_000)).toBe('1500K')
    expect(formatCapacity(131_072)).toBe('131072')
    // Values the validator will reject are shown as-is rather than dressed up.
    expect(formatCapacity(Number.NaN)).toBe('NaN')
    expect(formatCapacity(0)).toBe('0')
    for (const text of ['1M', '256K', '131072', '1500K']) {
      expect(formatCapacity(parseCapacity(text) as number)).toBe(text)
    }
  })

  it('accepts a suffixed context window and stores the plain count', async () => {
    const { mutate } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(ok(wireNamespaces()[0]))),
    })
    fireEvent.click(screen.getByText(en.advanced))
    expandRow(1)
    expandRow(2)
    const windows = capacityInputs(en.contextWindow)
    // The inherited 1000000 reads back short.
    expect((windows[0] as HTMLInputElement).value).toBe('1M')

    // Keystrokes stay verbatim while the row has focus, so typing `1000` does
    // not rewrite itself to `1K` mid-word.
    fireEvent.change(windows[0] as HTMLInputElement, { target: { value: '1000' } })
    expect((windows[0] as HTMLInputElement).value).toBe('1000')
    fireEvent.change(windows[0] as HTMLInputElement, { target: { value: '1000K' } })
    expect((windows[0] as HTMLInputElement).value).toBe('1000K')
    // Blur settles the row to the canonical spelling of the same count.
    fireEvent.blur(windows[0] as HTMLInputElement)
    expect((windows[0] as HTMLInputElement).value).toBe('1M')

    fireEvent.change(windows[1] as HTMLInputElement, { target: { value: '256K' } })
    fireEvent.blur(windows[1] as HTMLInputElement)
    fireEvent.click(screen.getByText(en.apply))

    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-deepseek',
      ops: [{
        op: 'set',
        path: ['models'],
        value: [
          { ...DEFAULT_DEEPSEEK_MODELS[0], contextWindow: 1_000_000 },
          { ...DEFAULT_DEEPSEEK_MODELS[1], contextWindow: 256_000 },
        ],
      }],
      expectedRevision: 0,
    })
  })

  it('keeps unreadable context-window text on screen and refuses the write', async () => {
    const { mutate } = await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.advanced))
    expandRow(1)
    expandRow(2)
    const windows = capacityInputs(en.contextWindow)
    fireEvent.change(windows[0] as HTMLInputElement, { target: { value: '1 gazillion' } })
    // Blurring a row that is not the edited one leaves the buffer alone.
    fireEvent.blur(windows[1] as HTMLInputElement)
    fireEvent.blur(windows[0] as HTMLInputElement)
    // The text the user typed is still there to correct.
    expect((windows[0] as HTMLInputElement).value).toBe('1 gazillion')

    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText(`Model 1: ${en.modelContextInvalid}`)
    expect(mutate).not.toHaveBeenCalled()
  })

  it.each([
    ['the schema default', undefined],
    ['the composition entry', { models: [{ id: 'pinned-by-deployment' }] }],
  ])('restores %s the moment the override is dropped, not after a reload', async (_label, base) => {
    // The regression: reset read the EFFECTIVE value, which still carries the
    // stored override until the unset is applied — so the rows did not change
    // and the catalog only looked restored after reopening the card.
    const { face } = scriptedFace()
    const stored = { models: [{ id: 'user-only-model', name: 'User Only' }] }
    const overridden: SettingsNamespaceView = {
      ns: 'llm-deepseek',
      schema: JSON.parse(JSON.stringify(DeepSeekConfig.toJSON())) as unknown,
      value: { ...stored, defaultContextWindow: 1_000_000 },
      ...base === undefined ? {} : { base },
      user: stored,
      applies: 'live',
      secrets: [],
      revision: 0,
    }
    const { ProviderEditor } = await import('../src/client/ProviderEditor.tsx')
    render(<ProviderEditor
      provider="deepseek-official"
      displayName="DeepSeek"
      namespace={overridden}
      schema={settingsSchema}
      settingsPath={[]}
      api={face as never}
      t={t}
      readOnly={false}
      onClose={() => {}}
    />)
    fireEvent.click(screen.getByText(en.advanced))
    expect(screen.getByText(en.modelsCustomized)).toBeTruthy()
    expect(screen.getAllByLabelText(new RegExp(en.modelId)).map(input => (input as HTMLInputElement).value))
      .toEqual(['user-only-model'])

    fireEvent.click(screen.getByText(en.resetModels))

    expect(screen.getByText(en.modelsInherited)).toBeTruthy()
    expect(screen.getAllByLabelText(new RegExp(en.modelId)).map(input => (input as HTMLInputElement).value))
      .toEqual(base === undefined ? ['deepseek-v4-flash', 'deepseek-v4-pro'] : ['pinned-by-deployment'])
  })

  it('keeps every row\'s unreadable text, not just the last one edited', async () => {
    // The regression: one active buffer meant editing a second row displaced
    // the first, which then fell back to rendering its stored NaN as `NaN` —
    // losing the text the user was told they could still correct.
    await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.advanced))
    expandRow(1)
    expandRow(2)
    const windows = capacityInputs(en.contextWindow)
    fireEvent.change(windows[0] as HTMLInputElement, { target: { value: 'not a number' } })
    fireEvent.blur(windows[0] as HTMLInputElement)
    fireEvent.change(windows[1] as HTMLInputElement, { target: { value: '2M' } })

    expect((windows[0] as HTMLInputElement).value).toBe('not a number')
    expect((windows[1] as HTMLInputElement).value).toBe('2M')
  })

  it('re-keys the typed text around a removed row', async () => {
    await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.advanced))
    const windows = (): HTMLInputElement[] => capacityInputs(en.contextWindow)
    const removeRow = (at: number): void => {
      fireEvent.click(screen.getAllByLabelText(new RegExp(en.removeModel))[at] as HTMLElement)
    }
    // Three rows, with text parked on the outer two.
    fireEvent.click(screen.getByText(en.addModel))
    expandRow(1)
    expandRow(2)
    expandRow(3)
    fireEvent.change(windows()[0] as HTMLInputElement, { target: { value: 'top text' } })
    fireEvent.blur(windows()[0] as HTMLInputElement)
    fireEvent.change(windows()[2] as HTMLInputElement, { target: { value: 'bottom text' } })
    fireEvent.blur(windows()[2] as HTMLInputElement)

    // Dropping the middle row leaves the row above untouched and carries the
    // row below down with its own text, rather than stranding it.
    removeRow(1)
    expect(windows()).toHaveLength(2)
    expect((windows()[0] as HTMLInputElement).value).toBe('top text')
    expect((windows()[1] as HTMLInputElement).value).toBe('bottom text')

    // Dropping a row that holds text takes that text with it; the survivor
    // keeps its own rather than inheriting the deleted row's.
    removeRow(0)
    expect(windows()).toHaveLength(1)
    expect((windows()[0] as HTMLInputElement).value).toBe('bottom text')
  })

  it('drops the typed text when reset replaces the rows it annotated', async () => {
    // The regression: reset removed the override but left the buffer, so an
    // inherited row displayed text no settings layer stores — and because an
    // unreadable buffer never settles, it stayed there indefinitely.
    const { mutate } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(ok(wireNamespaces()[0]))),
    })
    fireEvent.click(screen.getByText(en.advanced))
    expandRow(1)
    const windows = capacityInputs(en.contextWindow)
    fireEvent.change(windows[0] as HTMLInputElement, { target: { value: 'garbage' } })
    fireEvent.blur(windows[0] as HTMLInputElement)
    fireEvent.click(screen.getByText(en.resetModels))

    // Reset collapses every row, so the restored capacity needs opening again.
    expandRow(1)
    const restored = capacityInputs(en.contextWindow)
    expect((restored[0] as HTMLInputElement).value).toBe('1M')

    // Reset put the draft back where it started, so Apply writes nothing at
    // all rather than persisting whatever the stale text had parsed to.
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(screen.queryByText(en.apply)).toBeNull() })
    expect(mutate).not.toHaveBeenCalled()
  })

  it('edits an output cap per model and carries its text across a removal', async () => {
    const { mutate } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(ok(wireNamespaces()[0]))),
    })
    fireEvent.click(screen.getByText(en.advanced))
    expandRow(1)
    expandRow(2)
    // The profile's own cap is the placeholder both rows inherit.
    expect(capacityInputs(en.maxTokens).map(input => input.placeholder)).toEqual(['256K', '256K'])

    fireEvent.change(screen.getByLabelText(`${en.maxTokens} 2`), { target: { value: '64K' } })
    fireEvent.blur(screen.getByLabelText(`${en.maxTokens} 2`))
    expect(screen.getByLabelText<HTMLInputElement>(`${en.maxTokens} 2`).value).toBe('64K')

    // Dropping the row above carries the cap text down with its own row.
    fireEvent.click(screen.getAllByLabelText(new RegExp(en.removeModel))[0] as HTMLElement)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.maxTokens} 1`).value).toBe('64K')
    // The disclosure closes on a second press.
    expandRow(1)
    expect(screen.queryByLabelText(`${en.maxTokens} 1`)).toBeNull()

    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-deepseek',
      ops: [{
        op: 'set',
        path: ['models'],
        value: [{ ...DEFAULT_DEEPSEEK_MODELS[1], maxTokens: 64_000 }],
      }],
      expectedRevision: 0,
    })
  })

  it('settles a pasted id and refuses whitespace that would never match', async () => {
    await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.advanced))
    const ids = screen.getAllByLabelText<HTMLInputElement>(new RegExp(en.modelId))
    fireEvent.change(ids[0] as HTMLInputElement, { target: { value: '  deepseek-v4-flash  ' } })
    fireEvent.blur(ids[0] as HTMLInputElement)
    expect((ids[0] as HTMLInputElement).value).toBe('deepseek-v4-flash')
    // A settled id needs no second trim.
    fireEvent.blur(ids[0] as HTMLInputElement)
    expect((ids[0] as HTMLInputElement).value).toBe('deepseek-v4-flash')

    // An id that is only whitespace is as absent as an empty one, and a padded
    // id is a duplicate of its trimmed twin.
    expect(validateDeepSeekModels([{ id: '   ' }])).toEqual({ index: 0, key: 'modelIdRequired' })
    expect(validateDeepSeekModels([{ id: 'model' }, { id: 'model ' }]))
      .toEqual({ index: 1, key: 'modelIdDuplicate' })
  })

  it('renders malformed draft fallbacks without inventing catalog values', () => {
    render(<DeepSeekModelsEditor
      models={[{}]}
      overridden={false}
      defaultContextWindow={undefined}
      defaultMaxTokens={undefined}
      t={t}
      disabled={true}
      onChange={vi.fn()}
      onReset={vi.fn()}
    />)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelId} 1`).value).toBe('')
    expandRow(1)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.contextWindow} 1`).placeholder)
      .toBe(en.contextWindowPlaceholder)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.maxTokens} 1`).placeholder)
      .toBe(en.maxTokensPlaceholder)
  })

  it('can empty and reset the model override, then clear optional fields without dropping hidden data', async () => {
    const { mutate } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(ok(wireNamespaces()[0]))),
    })
    fireEvent.click(screen.getByText(en.advanced))
    fireEvent.click(screen.getAllByLabelText(new RegExp(en.removeModel))[0] as HTMLElement)
    fireEvent.click(screen.getByLabelText(new RegExp(en.removeModel)))
    expect(screen.getByText(en.modelsEmpty)).toBeTruthy()
    fireEvent.click(screen.getByText(en.resetModels))
    expect(screen.getByText(en.modelsInherited)).toBeTruthy()

    const names = screen.getAllByLabelText(new RegExp(en.modelName))
    expandRow(1)
    const windows = capacityInputs(en.contextWindow)
    fireEvent.change(names[0] as HTMLInputElement, { target: { value: '' } })
    fireEvent.change(windows[0] as HTMLInputElement, { target: { value: '' } })
    fireEvent.click(screen.getByText(en.apply))

    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-deepseek',
      ops: [{
        op: 'set',
        path: ['models'],
        value: [
          { id: 'deepseek-v4-flash', description: 'Preserved hidden detail' },
          DEFAULT_DEEPSEEK_MODELS[1],
        ],
      }],
      expectedRevision: 0,
    })
  })

  it('clears an inherited override with an unset op, never a whole-section replace', async () => {
    // A whole-section replace would clobber sibling overrides to clear one field.
    const { replace, update, mutate } = await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.advanced))
    const url = screen.getByLabelText<HTMLInputElement>(en.baseUrl)
    expect(url.value).toBe('https://base')
    fireEvent.change(url, { target: { value: '' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(replace).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-deepseek',
      ops: [{ op: 'unset', path: ['baseURL'] }],
      expectedRevision: 0,
    })
  })

  it('pins the deepseek placeholder and clears typed input back to inherited', async () => {
    const { face } = scriptedFace()
    const bare: SettingsNamespaceView = {
      ns: 'llm-deepseek',
      schema: JSON.parse(JSON.stringify(DeepSeekConfig.toJSON())) as unknown,
      value: {},
      applies: 'live',
      secrets: [],
      revision: 0,
    }
    const { ProviderEditor } = await import('../src/client/ProviderEditor.tsx')
    render(<ProviderEditor
      provider="deepseek-official"
      displayName="DeepSeek"
      namespace={bare}
      schema={settingsSchema}
      settingsPath={[]}
      api={face as never}
      t={t}
      readOnly={false}
      onClose={() => {}}
    />)
    fireEvent.click(screen.getByText(en.advanced))
    const baseURL = screen.getByLabelText<HTMLInputElement>(en.baseUrl)
    expect(baseURL.placeholder).toBe('https://api.deepseek.com')
    fireEvent.change(baseURL, { target: { value: 'https://x' } })
    expect(baseURL.value).toBe('https://x')
    fireEvent.change(baseURL, { target: { value: '' } })
    expect(baseURL.value).toBe('')
  })

  it('rejects an invalid draft before writing', async () => {
    const { update } = await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.advanced))
    fireEvent.change(screen.getByLabelText(en.baseUrl), { target: { value: 'not-a-url' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText(/baseURL/)
    expect(update).not.toHaveBeenCalled()
  })

  it('edits a pi-ai profile with the curated fields only', async () => {
    const { mutate } = await mountSection()
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.editProvider) }))
    // The configured credential shows as the stored placeholder.
    const editorKey = await screen.findByLabelText<HTMLInputElement>(en.keyInput)
    await waitFor(() => { expect(editorKey.placeholder).toBe(en.keyStored) })
    // pi-ai carries Base URL too, flat beside the key: the stored override
    // shows as the value and the effective profile endpoint as its placeholder.
    const url = screen.getByLabelText<HTMLInputElement>(en.baseUrl)
    expect(url.value).toBe('https://proxy')
    fireEvent.change(url, { target: { value: 'https://proxy/v2' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    // Only the edited field travels: apiKeyEnv and headers were already stored
    // with these values, so no op restates them.
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-pi-ai',
      ops: [{ op: 'set', path: ['providers', 'openai', 'baseURL'], value: 'https://proxy/v2' }],
      expectedRevision: 0,
    })
  })

  it('adds a dormant provider with a derived reference and stores its key', async () => {
    const { mutate, set } = await mountSection()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    // The pick dialog lists every dormant directory provider; picking one
    // embeds its form under the grid, the picked cell marked.
    fireEvent.click(await screen.findByRole('button', { name: 'anthropic' }))
    await screen.findByLabelText(en.keyInput)
    expect(screen.getByRole('button', { name: 'broken' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'plain' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'anthropic' }).getAttribute('aria-pressed')).toBe('true')
    // A dormant profile has no endpoint anywhere: the pi-ai placeholder
    // falls back to the provider-default wording, flat beside the key.
    expect(screen.getByLabelText<HTMLInputElement>(en.baseUrl).placeholder).toBe(en.baseUrlDefault)
    const addKey = screen.getByLabelText<HTMLInputElement>(en.keyInput)
    expect(addKey.placeholder).toBe(en.keyPlaceholderNative)
    fireEvent.change(addKey, { target: { value: 'sk-ant' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    // The picked preset's built-in identity travels with the write: the add
    // flow prefills the display name the directory reports, cc-switch's
    // preset fill, and the key stores under the derived reference.
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-pi-ai',
      ops: [
        { op: 'set', path: ['providers', 'anthropic', 'displayName'], value: 'anthropic' },
        { op: 'set', path: ['providers', 'anthropic', 'apiKeyEnv'], value: 'ANTHROPIC_API_KEY' },
      ],
      expectedRevision: 0,
    })
    await waitFor(() => { expect(set).toHaveBeenCalledWith({ ref: 'ANTHROPIC_API_KEY', value: 'sk-ant' }) })
  })

  it('keeps pi-ai provider-native authentication when no key is entered', async () => {
    const { mutate, set } = await mountSection()
    await openAddEditor()
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    // No key means no credential reference: the write carries only the
    // prefilled display name, never an apiKeyEnv naming an unset reference.
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-pi-ai',
      ops: [{ op: 'set', path: ['providers', 'anthropic', 'displayName'], value: 'anthropic' }],
      expectedRevision: 0,
    })
    expect(set).not.toHaveBeenCalled()
  })

  it('retries only the credential after refreshed settings already committed', async () => {
    const committed = wireNamespaces()[2]!
    const afterSettings: SettingsNamespaceView = {
      ...committed,
      value: { providers: {
        ...(committed.value as { providers: object }).providers,
        anthropic: { displayName: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY' },
      } },
      user: { providers: {
        ...(committed.user as { providers: object }).providers,
        anthropic: { displayName: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY' },
      } },
      revision: 1,
    }
    const mutate = vi.fn(() => Promise.resolve(ok(afterSettings)))
    const set = vi.fn()
      .mockResolvedValueOnce(fail('credential store unavailable', 'credential-rejected'))
      .mockResolvedValueOnce(ok({}))
    const { face, controller, mirror } = await mountSection({ mutate, set })
    await openAddEditor()
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.keyInput), { target: { value: 'sk-ant' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText('credential store unavailable')
    expect(mutate).toHaveBeenCalledOnce()
    face.settings.describe.mockResolvedValue(ok({
      writable: true,
      hasDocument: false,
      namespaces: wireNamespaces().map(namespace => namespace.ns === 'llm-pi-ai' ? afterSettings : namespace),
    }))
    // The refreshed settings answer reaches the page through the mirror's own
    // refresh (the document commit's invalidation in production).
    await act(async () => {
      await mirror.load()
      await controller.load()
    })
    expect(controller.store.getSnapshot().namespaces.get('llm-pi-ai')?.revision).toBe(1)
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(set).toHaveBeenCalledTimes(2) })
    expect(mutate).toHaveBeenCalledOnce()
    expect(set).toHaveBeenLastCalledWith({ ref: 'ANTHROPIC_API_KEY', value: 'sk-ant' })
  })

  it('switches the add form target by clicking another cell and degrades unknown or broken targets loudly', async () => {
    await mountSection()
    await openAddEditor()
    // The grid above the form IS the target selector now: clicking another
    // cell swaps the embedded form, the old provider select's whole job.
    fireEvent.click(screen.getByRole('button', { name: 'broken' }))
    await screen.findByText(/unresolvable settings path/)
    fireEvent.click(screen.getByRole('button', { name: 'plain' }))
    await waitFor(() => {
      expect(screen.getAllByText(content => content.includes(en.advancedHint)).length).toBeGreaterThan(0)
    })
    // The hint-only card cannot apply anything, and offers no key field.
    expect(screen.getByText<HTMLButtonElement>(en.apply).disabled).toBe(true)
    expect(screen.queryAllByLabelText(en.keyInput)).toHaveLength(0)
  })

  it('surfaces a rejected settings write and never stores the key after it', async () => {
    const { set } = await mountSection({
      mutate: vi.fn(() => Promise.resolve(fail('llm-pi-ai: unknown pi-ai provider "bogus"'))),
    })
    await openAddEditor()
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.keyInput), { target: { value: 'sk-x' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText(/unknown pi-ai provider/)
    expect(set).not.toHaveBeenCalled()
  })

  it('renders the card without the stored-key hint when the credential probe rejects', async () => {
    // The probe is a placeholder hint, not a precondition: an escaping
    // rejection would surface in the browser as an unhandled rejection.
    const { face } = scriptedFace()
    face.credentials.describe = vi.fn(() => Promise.reject(new Error('connection lost')))
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const controller = new ModelsSettingsStore(face as unknown as WireFace, settingsSchema, new SettingsDescribeMirror(face as never))
      await controller.load()
      render(<ModelsSection
        controller={controller}
        useSnapshot={bindSnapshotSelector(controller.store)}
        api={face as never}
        schema={settingsSchema}
        t={t}
      />)
      const key = await screen.findByLabelText<HTMLInputElement>(en.keyInput)
      expect(key.placeholder).toBe(en.keyPlaceholder)
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('tells the user to reopen when another writer moved the namespace first', async () => {
    // The stale-draft overwrite: two tabs open the same card, the other saves,
    // and this one must be refused rather than replay its opening snapshot.
    const { set } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(fail('changed since it was read', 'settings-conflict'))),
    })
    fireEvent.click(screen.getByText(en.advanced))
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.baseUrl), { target: { value: 'https://mine' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText(en.conflict)
    expect(set).not.toHaveBeenCalled()
  })

  it('keeps the card usable when the write rejects instead of answering', async () => {
    // A transport failure (disconnect, or the 403 a non-loopback browser now
    // gets on the whole configuration plane) rejects rather than returning a
    // failed envelope: without a catch the card would stay busy forever.
    await mountDeepSeekCard({ mutate: vi.fn(() => Promise.reject(new Error('connection lost'))) })
    fireEvent.click(screen.getByText(en.advanced))
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.baseUrl), { target: { value: 'https://next' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText('connection lost')
    // Not stuck in `applying…`: the finally cleared busy, so Apply is live again.
    expect(screen.getByText(en.apply)).toBeTruthy()
  })

  it('surfaces a shadowed credential write on the card', async () => {
    await mountFirstRun({
      set: vi.fn(() => Promise.resolve(fail('credentials: DEEPSEEK_API_KEY is shadowed by the read-only environment', 'credential-rejected'))),
    })
    const key = screen.getByLabelText<HTMLInputElement>(en.keyInput)
    fireEvent.change(key, { target: { value: 'sk-live' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText(/shadowed by the read-only environment/)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('locks the key input when the launch environment provides the credential', async () => {
    const { face } = await mountSection()
    face.credentials.describe.mockImplementation((payload: { refs: string[] }) => Promise.resolve(ok({
      credentials: Object.fromEntries(payload.refs.map(ref => [ref, {
        configured: ref === 'OPENAI_API_KEY', source: 'env', writable: false,
      }])),
    })))
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.editProvider) }))
    const editorKey = await screen.findByLabelText<HTMLInputElement>(en.keyInput)
    await waitFor(() => { expect(editorKey.placeholder).toBe(en.keyEnvLocked) })
    expect(editorKey.disabled).toBe(true)
  })

  it('keeps a failed credential describe silent and the input usable', async () => {
    const { face, set } = await mountSection()
    face.credentials.describe.mockImplementation(() => Promise.resolve(fail('down', 'internal')) as never)
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.editProvider) }))
    const editorKey = await screen.findByLabelText<HTMLInputElement>(en.keyInput)
    expect(editorKey.placeholder).toBe(en.keyPlaceholderNative)
    fireEvent.change(editorKey, { target: { value: 'sk-live' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(set).toHaveBeenCalledTimes(1) })
  })

  it('requires confirmation before removing a user-added provider', async () => {
    const { replace, mutate, unset } = await mountSection()
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.removeProvider) }))
    const dialog = screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) })
    expect(dialog.textContent).toContain(openaiCopy(en.deleteDescriptionWithCredential))
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: en.cancel }))
    expect(unset).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: en.cancel }))
    expect(screen.queryByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBeNull()
    expect(mutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.removeProvider) }))
    fireEvent.click(within(screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) }))
      .getByRole('button', { name: en.close }))
    expect(screen.queryByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBeNull()
    expect(mutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.removeProvider) }))
    fireEvent.click(within(screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) }))
      .getByRole('button', { name: openaiCopy(en.deleteConfirm) }))
    await waitFor(() => { expect(unset).toHaveBeenCalledWith({ ref: 'OPENAI_API_KEY' }) })
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(unset.mock.invocationCallOrder[0]).toBeLessThan(mutate.mock.invocationCallOrder[0] as number)
    expect(screen.queryByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBeNull()
    expect(replace).not.toHaveBeenCalled()
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-pi-ai',
      ops: [{ op: 'unset', path: ['providers', 'openai'] }],
    })
  })

  it('blocks duplicate deletion while the confirmed removal is pending', async () => {
    let resolveRemoval!: (response: RpcResponse<SettingsNamespaceView>) => void
    const mutate = vi.fn(() => new Promise<RpcResponse<SettingsNamespaceView>>((resolve) => {
      resolveRemoval = resolve
    }))
    await mountSection({ mutate })
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.removeProvider) }))
    const dialog = screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) })
    const confirm = within(dialog).getByRole<HTMLButtonElement>('button', { name: openaiCopy(en.deleteConfirm) })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(confirm.disabled).toBe(true)
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: en.cancel }).disabled).toBe(true)
    expect(within(dialog).getByRole('button', { name: openaiCopy(en.deleting) })).toBe(confirm)
    fireEvent.click(within(dialog).getByRole('button', { name: en.close }))
    expect(screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBe(dialog)
    expect(mutate).toHaveBeenCalledOnce()
    await act(async () => { resolveRemoval(ok(wireNamespaces()[2]!)) })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBeNull()
    })
  })

  it('renders the load failure with a retry control', async () => {
    const face = scriptedFace()
    face.face.llm.providers = vi.fn(() => Promise.resolve(fail('directory down', 'internal'))) as never
    const controller = new ModelsSettingsStore(
      face.face as unknown as WireFace, settingsSchema, new SettingsDescribeMirror(face.face as never))
    await controller.load()
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      api={face.face as never}
      schema={settingsSchema}
      t={t}
    />)
    expect(screen.getByText(/directory down/)).toBeTruthy()
    fireEvent.click(screen.getByText(en.retry))
    await waitFor(() => { expect(screen.queryByText(/directory down/)).toBeNull() })
  })

  it('shows the read-only notice and disables mutations for a read-only provider', async () => {
    const { face } = await mountSection()
    face.settings.describe.mockImplementation(() => Promise.resolve(ok({
      writable: false,
      hasDocument: false,
      namespaces: wireNamespaces(),
    })))
    const controller = new ModelsSettingsStore(face as unknown as WireFace, settingsSchema, new SettingsDescribeMirror(face as never))
    await controller.load()
    cleanup()
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      api={face as never}
      schema={settingsSchema}
      t={t}
    />)
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    // Removal is a hover-revealed icon action named by its title; read-only
    // disables it wherever it appears.
    expect(screen.getAllByTitle<HTMLButtonElement>(en.remove).every(button => button.disabled)).toBe(true)
    // Every add entry — the list tile and each dormant card — refuses writes.
    expect(screen.getAllByText<HTMLButtonElement>(en.add).every(button => button.disabled)).toBe(true)
  })

  it('opens the row editor in a modal and closes it on cancel without writing', async () => {
    const { update } = await mountSection()
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.editProvider) }))
    await waitFor(() => { expect(screen.queryAllByLabelText(en.keyInput).length).toBe(1) })
    fireEvent.click(screen.getByText(en.cancel))
    expect(screen.queryAllByLabelText(en.keyInput)).toHaveLength(0)
    // The modal reopens for another pass at the same row.
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.editProvider) }))
    await waitFor(() => { expect(screen.queryAllByLabelText(en.keyInput).length).toBe(1) })
    fireEvent.click(screen.getByText(en.cancel))
    expect(screen.queryAllByLabelText(en.keyInput)).toHaveLength(0)
    expect(update).not.toHaveBeenCalled()
  })

  it('cancels the add card back to the grid tile', async () => {
    await mountSection()
    await openAddEditor()
    fireEvent.click(screen.getByText(en.cancel))
    await screen.findByRole('button', { name: en.add })
    // Cancel closes the whole pick dialog — grid, search, and embedded form
    // together — rather than leaving a picked cell's form behind.
    expect(screen.queryByLabelText(en.keyInput)).toBeNull()
    expect(screen.queryByRole('dialog', { name: en.addTitle })).toBeNull()
  })

  it('marks the default provider and refuses a switch the catalog cannot serve', async () => {
    const { face, controller, mutate } = await mountSection()
    // openai is the composed default: its card carries the in-use command and
    // no second default action, while the catalog summary quotes its model count.
    expect(screen.getByText(en.inUse).closest('li')?.textContent).toContain('openai')
    expect(screen.queryAllByRole('button', { name: openaiCopy(en.setDefaultProvider) })).toHaveLength(0)
    // DeepSeek becomes usable once its credential is described as stored…
    face.credentials.describe.mockImplementation((payload: { refs: string[] }) =>
      Promise.resolve(ok({ credentials: Object.fromEntries(payload.refs.map(ref => [ref, {
        configured: true, source: 'file', writable: true,
      }])) })))
    await act(async () => { await controller.load() })
    // …but the host catalog advertises no DeepSeek group, so the one-click
    // command stays disabled with the reason as its title instead of offering
    // a free-typed id the host would refuse to resolve.
    const switchCommand = screen.getByRole<HTMLButtonElement>('button', { name: deepSeekCopy(en.setDefaultProvider) })
    expect(switchCommand.disabled).toBe(true)
    expect(switchCommand.title).toBe(en.defaultNoModels)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('switches the default model through the card command and reloads the page', async () => {
    const afterDefault = wireNamespaces().map(namespace => namespace.ns === 'agent-default-model'
      ? {
        ...namespace,
        value: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
        revision: 1,
      }
      : namespace)
    const mutate = vi.fn((_request: unknown) => Promise.resolve(ok(afterDefault[3]!)))
    const { face, controller, mirror } = await mountSection({ mutate })
    // DeepSeek needs a stored credential and a catalog group before its card
    // offers the switch.
    face.credentials.describe.mockImplementation((payload: { refs: string[] }) =>
      Promise.resolve(ok({ credentials: Object.fromEntries(payload.refs.map(ref => [ref, {
        configured: true, source: 'file', writable: true,
      }])) })))
    face.llm.models.mockResolvedValue(ok({
      groups: [{
        id: 'deepseek-official',
        name: 'DeepSeek',
        models: [
          { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
          { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
        ],
      }],
      failures: [],
    }))
    await act(async () => { await controller.load() })
    face.settings.describe.mockResolvedValue(ok({
      writable: true,
      hasDocument: false,
      namespaces: afterDefault,
    }))
    // The mirror holds its view; refresh it so the write's own reload reads
    // the committed default rather than the opening snapshot.
    await act(async () => { await mirror.load() })

    // Several catalog models: the command opens a model menu; picking one
    // commits the write — one click from the card, no dialog.
    fireEvent.click(screen.getByRole('button', { name: deepSeekCopy(en.setDefaultProvider) }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /DeepSeek-V4-Pro/ }))

    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'agent-default-model',
      ops: [
        { op: 'set', path: ['provider'], value: 'deepseek-official' },
        { op: 'set', path: ['model'], value: 'deepseek-v4-pro' },
        { op: 'unset', path: ['reasoningEffort'] },
      ],
      expectedRevision: 0,
    })
    // The reload moved the in-use command and reports the saved model.
    expect((await screen.findByRole('status')).textContent).toBe(modelCopy(en.savedDefault, 'deepseek-v4-pro'))
    expect(screen.getByText(en.inUse).closest('li')?.textContent).toContain('DeepSeek')
  })

  it('expands a card to its profile facts and serving models', async () => {
    await mountSection()
    // openai: a dict-keyed pi-ai profile with an endpoint and a named
    // credential reference, plus a catalog group of two serving models.
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.detailsProvider) }))
    const openaiRow = screen.getByText('openai').closest('li')
    if (openaiRow === null) throw new Error('no openai row')
    expect(openaiRow.textContent).toContain('https://proxy')
    expect(openaiRow.textContent).toContain('OPENAI_API_KEY')
    expect(openaiRow.textContent).toContain('GPT-4o')
    expect(openaiRow.textContent).toContain('GPT-4o mini')
    // The whole-section DeepSeek card reads its endpoint from the section
    // value; with no catalog group, the models line says so.
    fireEvent.click(screen.getByRole('button', { name: deepSeekCopy(en.detailsProvider) }))
    const deepSeekRow = screen.getByText('DeepSeek').closest('li')
    if (deepSeekRow === null) throw new Error('no DeepSeek row')
    expect(deepSeekRow.textContent).toContain('https://base')
    expect(deepSeekRow.textContent).toContain(en.defaultNoModels)
  })

  it('duplicates a dict-keyed provider profile under a fresh route key', async () => {
    const mutate = vi.fn((_request: unknown) => Promise.resolve(ok(wireNamespaces()[2])))
    await mountSection({ mutate })
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.duplicateProvider) }))
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-pi-ai',
      ops: [{
        op: 'set',
        path: ['providers', 'openai-copy'],
        // The copy shares the source's credential reference: a stored key is
        // write-only, so the page cannot re-store it under a new reference.
        value: { apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://proxy', headers: { 'X-Team': 'a' } },
      }],
      expectedRevision: 0,
    })
    expect((await screen.findByRole('status')).textContent).toContain('openai-copy')
    // Only a providers-dict route offers the copy: the whole-section
    // DeepSeek route and a non-providers dict layout have no sibling key.
    expect(screen.queryByRole('button', { name: deepSeekCopy(en.duplicateProvider) })).toBeNull()
    expect(screen.queryByRole('button', {
      name: providerCopy(en.duplicateProvider, { provider: 'plain', displayName: 'plain' }),
    })).toBeNull()
  })

  it('keeps dormant directory providers out of the list, behind the add dialog', async () => {
    await mountSection()
    // The list carries only configured providers plus the add tile — a dormant
    // preset is not a card, the cc-switch list posture.
    expect(screen.queryByText(en.notConfigured)).toBeNull()
    expect(screen.queryByRole('button', {
      name: providerCopy(en.addProvider, { provider: 'anthropic', displayName: 'anthropic' }),
    })).toBeNull()
    // It stays adoptable in the pick dialog's grid.
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    expect(screen.getByRole('button', { name: 'anthropic' })).toBeTruthy()
  })

  it('reads endpoint facts and addresses only providers-dict routes for a duplicate', () => {
    expect(profileFactsOf({ baseURL: 'https://x', api: 'openai-completions' }))
      .toEqual({ baseURL: 'https://x', api: 'openai-completions' })
    expect(profileFactsOf({ baseURL: '' })).toEqual({})
    expect(profileFactsOf(undefined)).toEqual({})
    const row = (settingsPath: string[]): ProviderRow => ({
      entry: {
        provider: 'p', displayName: 'p', settingsNs: 'llm-pi-ai', settingsPath, active: true,
      },
      configured: true,
      removable: false,
      profile: {},
      apiKeyEnv: undefined,
      credential: undefined,
    })
    expect(duplicablePathOf(row(['providers', 'x']))).toEqual(['providers', 'x'])
    expect(duplicablePathOf(row([]))).toBeUndefined()
    expect(duplicablePathOf(row(['profiles', 'x']))).toBeUndefined()
  })

  it('collapses the setup card on cancel without disturbing an open editor modal', async () => {
    // The regression: the setup card shared the dialogs' close handler, so
    // cancelling it discarded the editor modal's draft while staying open itself.
    await mountFirstRun()
    expect(screen.getAllByLabelText(en.keyInput)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.editProvider) }))
    await waitFor(() => { expect(screen.getAllByLabelText(en.keyInput).length).toBe(2) })

    // The setup card is the first one on the page, under the modal's mask.
    fireEvent.click(screen.getAllByText(en.cancel)[0] as HTMLElement)
    // The editor modal kept its draft…
    expect(screen.getAllByLabelText(en.keyInput).length).toBe(1)
    // …and DeepSeek collapsed to an ordinary card carrying the missing-key dot.
    expect(screen.getAllByRole('img', { name: en.credentialMissing })
      .some(dot => dot.closest('li')?.textContent?.includes('DeepSeek') === true)).toBe(true)
    // Its card reopens through Edit, which replaces the open modal.
    fireEvent.click(screen.getByRole('button', { name: deepSeekCopy(en.editProvider) }))
    expect(screen.getAllByLabelText(en.keyInput)).toHaveLength(1)
  })

  it('loads on first render of an idle controller', async () => {
    const { face } = scriptedFace()
    const controller = new ModelsSettingsStore(face as unknown as WireFace, settingsSchema, new SettingsDescribeMirror(face as never))
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      api={face as never}
      schema={settingsSchema}
      t={t}
    />)
    await screen.findByText('DeepSeek')
  })

  it('removes by unsetting the profile path, never by rebuilding the section', async () => {
    // The page only needs to name the profile path; rebuilding the section
    // would widen the write for no benefit.
    const { face, mutate, replace, controller } = await mountSection()
    await removeProviderProfile(
      face as unknown as Parameters<typeof removeProviderProfile>[0],
      controller,
      { settingsNs: 'llm-plain', settingsPath: ['ghost-profile'] },
    )
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-plain',
      ops: [{ op: 'unset', path: ['ghost-profile'] }],
    })
    expect(replace).not.toHaveBeenCalled()
  })

  it('keeps the snapshot untouched and reports the message when a removal write is refused', async () => {
    const { face, controller } = await mountSection({
      mutate: vi.fn(() => Promise.resolve(fail('read-only'))),
    })
    const before = controller.store.getSnapshot().rows
    const failure = await removeProviderProfile(
      face as unknown as Parameters<typeof removeProviderProfile>[0],
      controller,
      { settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
    )
    expect(failure).toBe('read-only')
    expect(controller.store.getSnapshot().rows).toBe(before)
  })

  it('keeps a failed identified deletion recoverable in its confirmation dialog', async () => {
    const mutate = vi.fn()
      .mockResolvedValueOnce(fail('the host refused'))
      .mockResolvedValueOnce(ok(wireNamespaces()[2]!))
    const { unset } = await mountSection({ mutate })
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.removeProvider) }))
    const dialog = screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) })
    const confirm = within(dialog).getByRole('button', { name: openaiCopy(en.deleteConfirm) })
    fireEvent.click(confirm)
    await within(dialog).findByText('the host refused')
    expect(screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBe(dialog)
    expect(unset).toHaveBeenCalledOnce()
    expect(mutate).toHaveBeenCalledOnce()

    fireEvent.click(confirm)
    await waitFor(() => { expect(unset).toHaveBeenCalledTimes(2) })
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(2) })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBeNull()
    })
  })

  it('retains credentials that are not identified as page-managed', async () => {
    const { unset, mutate } = await mountSection()
    const target = { provider: 'zombie', displayName: 'zombie' }
    fireEvent.click(screen.getByRole('button', { name: providerCopy(en.removeProvider, target) }))
    const dialog = screen.getByRole('dialog', { name: providerCopy(en.deleteTitle, target) })
    expect(dialog.textContent).toContain(providerCopy(en.deleteDescription, target))
    fireEvent.click(within(dialog).getByRole('button', { name: providerCopy(en.deleteConfirm, target) }))
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(unset).not.toHaveBeenCalled()
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-pi-ai',
      ops: [{ op: 'unset', path: ['providers', 'zombie'] }],
    })
  })

  it('does not remove provider settings when its managed credential removal is refused', async () => {
    const { face, controller, mutate } = await mountSection({
      unset: vi.fn(() => Promise.resolve(fail('credential is read-only', 'credential-rejected'))),
    })
    const failure = await removeProviderProfile(
      face as unknown as Parameters<typeof removeProviderProfile>[0],
      controller,
      {
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', 'openai'],
        credentialRef: 'OPENAI_API_KEY',
      },
    )
    expect(failure).toBe('credential is read-only')
    expect(mutate).not.toHaveBeenCalled()
  })

  it('reports a transport rejection instead of failing the removal silently', async () => {
    const { face, controller } = await mountSection({
      mutate: vi.fn(() => Promise.reject(new Error('connection lost'))),
    })
    const failure = await removeProviderProfile(
      face as unknown as Parameters<typeof removeProviderProfile>[0],
      controller,
      { settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
    )
    expect(failure).toBe('connection lost')
  })
})

describe('apiKeyFailure', () => {
  it('treats a blank field as no failure — it means keep the stored key', () => {
    expect(apiKeyFailure('')).toBeUndefined()
  })

  it.each([
    ['a printable-ASCII key', 'sk-0123456789'],
    ['a padded key, which the caller trims', '  sk-abc  '],
    ['the printable-ASCII boundary characters', '!~'],
    ['a hyphenated key carrying an equals sign', 'sk-ABC=xyz'],
    ['an all-upper-case key ending in base64 padding', 'ABCD=='],
    ['an all-upper-case key ending in one padding character', 'MNOPQRST='],
  ])('accepts %s', (_label, draft) => {
    expect(apiKeyFailure(draft)).toBeUndefined()
  })

  it.each([
    ['spaces', '   '],
    ['a tab', '\t'],
  ])('fails a field holding only %s instead of silently dropping it', (_label, draft) => {
    expect(apiKeyFailure(draft)).toBe('keyBlank')
  })

  it.each([
    ['an emoji', 'sk-\u{1F600}'],
    ['CJK text', 'sk-你好'],
    ['full-width punctuation', 'sk-abc，'],
    ['an interior space', 'sk-abc def'],
    ['a C0 control character', 'sk-abc\x01'],
    ['a latin-1 character', 'sk-café'],
  ])('fails %s as illegal characters', (_label, draft) => {
    expect(apiKeyFailure(draft)).toBe('keyIllegalCharacters')
  })

  it.each([
    ['a pasted environment line', 'DEEPSEEK_API_KEY=sk-abc'],
    ['double quotes', '"sk-abc"'],
    ['single quotes', '\'sk-abc\''],
    ['backticks', '`sk-abc`'],
  ])('fails %s as a format failure', (_label, draft) => {
    expect(apiKeyFailure(draft)).toBe('keyIllegalCharacters')
  })

  it('needs a matching closing quote before it calls a value wrapped', () => {
    // A lone quote and an unbalanced one are legal printable ASCII, so the
    // heuristic leaves them alone rather than guessing at a paste error.
    expect(apiKeyFailure('"')).toBeUndefined()
    expect(apiKeyFailure('"a')).toBeUndefined()
  })
})
