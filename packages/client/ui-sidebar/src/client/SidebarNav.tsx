/**
 * WorkBuddy-style primary sidebar nav: Assistant, Projects, Experts · skills,
 * Automation, and More.
 */

import { useSyncExternalStore, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconAgentPresetOutline16, IconEllipsisOutline16, IconFolderOpenOutline16,
  IconLinkOutline16, IconPlayOutline16, IconSettingsOutline16, IconUserOutline16, Menu, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarKey } from './locales.ts'
import css from './SidebarNav.module.css'

/** Nav identity used for active highlighting. */
export type SidebarNavId = 'assistant' | 'projects' | 'expert' | 'automation' | 'connectors'

/** Callbacks the shell injects for navigation. */
export interface SidebarNavActions {
  /** Current location pathname. */
  getPathname: () => string
  /** Subscribe to pathname changes. */
  subscribePathname: (listener: () => void) => () => void
  /** Navigate to a path (or `/` for Assistant). */
  navigate: (path: string) => void
  /** Open the workspace directory / files flow when available. */
  openFiles?: () => void
}

/**
 * Primary nav row list for the wide and rail sidebar.
 * @param props - column width flag, actions, translator.
 * @returns nav element.
 */
export function SidebarNav({
  wide, actions, t,
}: {
  wide: boolean
  actions: SidebarNavActions
  t: TranslateNS<'sidebar'>
}): ReactNode {
  const pathname = useSyncExternalStore(
    actions.subscribePathname,
    actions.getPathname,
    actions.getPathname,
  )
  const active = activeNav(pathname)
  const [moreOpen, setMoreOpen] = useState(false)

  const items: { id: SidebarNavId; label: SidebarKey; icon: ReactNode; onClick: () => void }[] = [
    {
      id: 'assistant',
      label: 'nav.assistant',
      icon: <IconUserOutline16 size={wide ? 16 : 18} />,
      onClick: () => { actions.navigate('/') },
    },
    {
      id: 'projects',
      label: 'nav.projects',
      icon: <IconFolderOpenOutline16 size={wide ? 16 : 18} />,
      onClick: () => { actions.navigate('/projects') },
    },
    {
      id: 'expert',
      label: 'nav.expert',
      icon: <IconAgentPresetOutline16 size={wide ? 16 : 18} />,
      onClick: () => { actions.navigate('/settings/agent') },
    },
    {
      id: 'automation',
      label: 'nav.automation',
      icon: <IconPlayOutline16 size={wide ? 16 : 18} />,
      onClick: () => { actions.navigate('/automation') },
    },
    {
      id: 'connectors',
      label: 'nav.connectors',
      icon: <IconLinkOutline16 size={wide ? 16 : 18} />,
      onClick: () => { actions.navigate('/connectors') },
    },
  ]

  return (
    <nav className={clsx(css.nav, !wide && css.navRail)} aria-label={t('nav.label')} data-sidebar-nav="">
      {items.map(item => (
        <Tooltip key={item.id} label={t(item.label)} delayMs={500} disabled={wide}>
          <button
            type="button"
            className={clsx(css.item, active === item.id && css.active)}
            aria-label={t(item.label)}
            aria-current={active === item.id ? 'page' : undefined}
            data-nav={item.id}
            onClick={item.onClick}
          >
            <span className={css.icon} aria-hidden>{item.icon}</span>
            {wide ? <span className={css.label}>{t(item.label)}</span> : null}
          </button>
        </Tooltip>
      ))}
      <Menu
        open={moreOpen}
        onClose={() => { setMoreOpen(false) }}
        align="start"
        portal
        items={[
          ...(actions.openFiles === undefined
            ? []
            : [{
              id: 'files',
              label: t('nav.more.files'),
              icon: <IconFolderOpenOutline16 size={14} />,
            }]),
          {
            id: 'settings',
            label: t('nav.more.settings'),
            icon: <IconSettingsOutline16 size={14} />,
          },
        ]}
        onSelect={(id) => {
          setMoreOpen(false)
          if (id === 'files') actions.openFiles?.()
          if (id === 'settings') actions.navigate('/settings')
        }}
        anchor={(
          <Tooltip label={t('nav.more')} delayMs={500} disabled={wide}>
            <button
              type="button"
              className={css.item}
              aria-label={t('nav.more')}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              data-nav="more"
              onClick={() => { setMoreOpen(open => !open) }}
            >
              <span className={css.icon} aria-hidden>
                <IconEllipsisOutline16 size={wide ? 16 : 18} />
              </span>
              {wide ? <span className={css.label}>{t('nav.more')}</span> : null}
            </button>
          </Tooltip>
        )}
      />
    </nav>
  )
}

/**
 * Map a pathname to the primary nav highlight.
 * @param pathname - router pathname.
 * @returns nav id.
 */
export function activeNav(pathname: string): SidebarNavId {
  if (pathname === '/projects' || pathname.startsWith('/projects/')) return 'projects'
  if (pathname === '/automation' || pathname.startsWith('/automation/')) return 'automation'
  if (pathname === '/connectors' || pathname.startsWith('/connectors/')) return 'connectors'
  if (pathname.startsWith('/settings/agent') || pathname.startsWith('/settings/agent-')) return 'expert'
  return 'assistant'
}
