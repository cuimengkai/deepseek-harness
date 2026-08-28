/**
 * The icon-selection dialog a provider form's logo button opens: every icon
 * the vendored set ships, searchable by display name, one click to choose.
 * The dialog writes the chosen icon name back through the form, which stores
 * it as the profile's `icon` field; restoring the route's own default clears
 * that field again.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { PROVIDER_ICONS, PROVIDER_ICON_NAMES } from './provider-icons.ts'
import { ProviderLogo } from './ProviderLogo.tsx'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Every icon name the set ships, in the vendored file's own order. */
const ICON_NAMES = Object.keys(PROVIDER_ICONS)

/** Props of {@link IconPickerDialog}. */
export interface IconPickerDialogProps {
  /** The currently chosen icon name, when one is. */
  value?: string | undefined
  /** Write the chosen icon name into the form (undefined restores default). */
  onChange: (icon: string | undefined) => void
  /** Close the dialog. */
  onClose: () => void
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Render the icon-selection dialog.
 * @param props - the current choice, the write, and copy.
 * @returns the dialog over the provider form.
 */
export function IconPickerDialog(props: IconPickerDialogProps): ReactNode {
  const { t } = props
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const matches = needle.length === 0
    ? ICON_NAMES
    : ICON_NAMES.filter(name =>
      PROVIDER_ICON_NAMES[name]?.toLowerCase().includes(needle) === true
      || name.includes(needle))

  const choose = (icon: string): void => {
    props.onChange(icon)
    props.onClose()
  }

  return (
    <Modal
      open
      onClose={props.onClose}
      title={t('iconPickerTitle')}
      closeLabel={t('close')}
      description={t('iconPickerDescription')}
      className={styles['iconDialog'] as string}
      contentClassName={styles['iconDialogContent'] as string}
      bodyClassName={styles['iconDialogBody'] as string}
      footer={(
        <>
          {props.value === undefined
            ? null
            : (
              <Button variant="outline" onClick={() => { props.onChange(undefined); props.onClose() }}>
                {t('iconRestoreDefault')}
              </Button>
            )}
          <Button variant="outline" onClick={props.onClose}>{t('cancel')}</Button>
        </>
      )}
    >
      <input
        className={`${styles['input']} ${styles['iconSearch'] as string}`}
        type="search"
        value={query}
        placeholder={t('iconSearchPlaceholder')}
        aria-label={t('iconSearch')}
        onChange={(event) => { setQuery(event.target.value) }}
      />
      <ul className={styles['iconGrid']}>
        {matches.map(name => (
          <li key={name}>
            <button
              type="button"
              className={`${styles['iconCell']} ${props.value === name ? styles['iconCellSelected'] : ''}`}
              aria-pressed={props.value === name}
              title={PROVIDER_ICON_NAMES[name] ?? name}
              onClick={() => { choose(name) }}
            >
              <ProviderLogo provider={name} displayName={PROVIDER_ICON_NAMES[name] ?? name} icon={name} size={28} />
              <span className={styles['iconCellName']}>{PROVIDER_ICON_NAMES[name] ?? name}</span>
            </button>
          </li>
        ))}
      </ul>
      {matches.length === 0 ? <p className={styles['modelEmpty']}>{t('iconNoMatches')}</p> : null}
    </Modal>
  )
}

/**
 * The form's centered logo button: the current icon (or the letter avatar),
 * opening the icon-selection dialog on click. The chosen icon stores as the
 * profile's `icon` field; clearing it restores the route's built-in mark.
 * @param props - the route identity, the current icon, the write, and copy.
 * @returns the logo button with its dialog mounted while open.
 */
export function IconField(props: {
  /** The provider route id (the avatar palette seed). */
  provider: string
  /** The display name to take the initial from when no icon applies. */
  displayName: string
  /** The icon name currently chosen, when one is. */
  icon?: string | undefined
  /** Write the chosen icon name into the form (undefined restores default). */
  onChange: (icon: string | undefined) => void
  /** Disable the button (read-only deployment or a pending write). */
  disabled: boolean
  /** Section copy. */
  t: (key: keyof typeof en) => string
}): ReactNode {
  const [open, setOpen] = useState(false)
  const { t } = props
  return (
    <div className={styles['iconField']}>
      <button
        type="button"
        className={styles['iconPickButton']}
        disabled={props.disabled}
        title={t(props.icon === undefined ? 'iconPick' : 'iconChange')}
        onClick={() => { setOpen(true) }}
      >
        <ProviderLogo
          provider={props.provider}
          displayName={props.displayName}
          icon={props.icon}
          size={44}
        />
      </button>
      {open
        ? (
          <IconPickerDialog
            value={props.icon}
            onChange={props.onChange}
            onClose={() => { setOpen(false) }}
            t={t}
          />
        )
        : null}
    </div>
  )
}
