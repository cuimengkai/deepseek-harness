// @vitest-environment jsdom
/** Results panel shell: tabs, produced paths, and header toggle registration. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, fireEvent } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionProviderComponent } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { EMPTY_CONVERSATION_SNAPSHOT } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { createChatStore } from '../src/client/stores.ts'
import { DetailsPanel, sessionProducedPaths } from '../src/client/details/DetailsPanel.tsx'
import { ResultsToggle } from '../src/client/details/ResultsToggle.tsx'
import type { ResultsToggleProps } from '../src/client/details/ResultsToggle.tsx'
import { zh } from '../src/client/locale.ts'
import { EMPTY_CHAT_SNAPSHOT, type ChatSnapshot } from '../src/client/contract/snapshot.ts'

const SID = 's1' as SessionId
const t = makeTranslate(zh, commonZh)

const SessionProviderStub: SessionProviderComponent = ({ children }) => children

afterEach(() => { cleanup() })

function emptyWorkspaces() {
  return createSnapshotStore<WorkspaceSnapshot>({
    ids: [], byId: {}, phase: 'ready', current: undefined,
  } as never)
}

function chatWithDeliverables(paths: readonly string[]): ChatSnapshot {
  const produced = paths.map((path, index) => ({ seq: index + 1, path }))
  const turnData = {
    get(key: string) {
      return key === 'deliverables' ? { produced } : undefined
    },
  }
  return {
    ...EMPTY_CHAT_SNAPSHOT,
    timeline: {
      turnOrder: [1],
      turns: new Map([[1, { turn: 1, data: turnData } as never]]),
    },
  }
}

describe('sessionProducedPaths', () => {
  it('dedupes first-seen mutation paths across turns', () => {
    expect(sessionProducedPaths(chatWithDeliverables(['a.ts', 'b.ts', 'a.ts']))).toEqual(['a.ts', 'b.ts'])
    expect(sessionProducedPaths(EMPTY_CHAT_SNAPSHOT)).toEqual([])
  })
})

describe('DetailsPanel Results shell', () => {
  it('lists artifacts and switches to Changes / Inspect tabs', () => {
    const chat = createChatStore().create()
    const sessions = createSnapshotStore<SessionListState>({
      ids: [SID],
      byId: { [SID]: { id: SID, displayTitle: 'r', running: false, blank: false, updatedAt: 0, cwd: '/ws' } },
      current: SID,
      phase: 'ready',
      subagentsByParent: {},
      jobsBySession: {},
      currentAddress: undefined,
    })
    const view = render(
      <DetailsPanel
        SessionProvider={SessionProviderStub}
        renderSlot={() => null}
        sessionId={SID}
        useSession={bindSnapshotSelector(createSnapshotStore({ id: SID } as never))}
        useChat={bindSnapshotSelector(createSnapshotStore(chatWithDeliverables(['out/index.html'])))}
        useConversation={bindSnapshotSelector(createSnapshotStore(EMPTY_CONVERSATION_SNAPSHOT))}
        useTrajectory={(() => { throw new Error('unused') })}
        useSessions={bindSnapshotSelector(sessions)}
        useSessionPendingInteraction={bindSnapshotSelector(
          createSnapshotStore<SessionPendingInteractionSnapshot>(new Map()),
        )}
        useWorkspaces={bindSnapshotSelector(emptyWorkspaces())}
        useProjection={(() => undefined)}
        useInput={(() => { throw new Error('unused') })}
        inputActions={{
          setDraft: () => {},
          addImages: () => true,
          removeImage: () => {},
          pruneImages: () => {},
          submit: () => {},
        }}
        useStore={bindSnapshotSelector(chat)}
        actions={chat.actions}
        closeDetails={vi.fn()}
        openFile={vi.fn(async () => {})}
        t={t}
      />,
    )
    expect(view.getByText('结果')).toBeTruthy()
    expect(view.container.querySelector('[data-results-panel]')).not.toBeNull()
    expect(view.getByText('index.html')).toBeTruthy()
    fireEvent.click(view.getByRole('tab', { name: /变更/ }))
    expect(view.container.querySelector('[data-results-kind="change"]')).not.toBeNull()
    expect(view.getByText('已修改')).toBeTruthy()
    fireEvent.click(view.getByRole('tab', { name: /检视/ }))
    expect(view.getByText('点击消息流中的工具行查看详情')).toBeTruthy()
  })
})

describe('ResultsToggle', () => {
  it('toggles layout details and badges when closed with artifacts', () => {
    const toggleDetails = vi.fn()
    const openDetails = vi.fn()
    let open = false
    const listeners = new Set<() => void>()
    const view = render(<ResultsToggle {...({
      useChat: bindSnapshotSelector(createSnapshotStore(chatWithDeliverables(['a.ts']))),
      getDetailsOpen: () => open,
      subscribeDetails: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      toggleDetails: () => {
        open = !open
        toggleDetails()
        for (const listener of listeners) listener()
      },
      openDetails: () => {
        open = true
        openDetails()
        for (const listener of listeners) listener()
      },
      t,
    } as unknown as ResultsToggleProps)}
    />)
    // Auto-open on first artifact.
    expect(openDetails).toHaveBeenCalled()
    const button = view.getByRole('button', { name: /关闭结果|打开结果/ })
    fireEvent.click(button)
    expect(toggleDetails).toHaveBeenCalled()
  })
})
