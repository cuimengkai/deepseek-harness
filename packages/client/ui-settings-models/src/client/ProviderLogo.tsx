/**
 * The provider logo: an inline SVG mark from the vendored icon set, or the
 * display name's first character on the route's palette color when no mark
 * exists — the same fallback shape cc-switch gives a preset-less provider.
 *
 * The icon shown is the profile's own `icon` field when one is set, else the
 * built-in mark the route id maps to in {@link ROUTE_ICONS}, so a configured
 * provider keeps its chosen logo everywhere the page names it: the card, the
 * pick grid, and the editor's icon button.
 */

import type { ReactNode } from 'react'
import { PROVIDER_ICONS, ROUTE_ICONS } from './provider-icons.ts'
import styles from './ModelsSection.module.css'

/** Avatar palette classes, cycled by the route-id hash in {@link avatarClassOf}. */
const AVATAR_CLASSES = ['avatarBlue', 'avatarDeepseek', 'avatarGreen', 'avatarRed', 'avatarAmber'] as const

/**
 * Deterministic avatar class for a provider route. The route set is open —
 * catalog entries and hand-declared routes alike — so no logo assets exist to
 * ship; the palette hash gives each card a stable identity color instead.
 * @param provider - the provider route id.
 * @returns the palette class name for its avatar.
 */
function avatarClassOf(provider: string): string {
  let hash = 0
  for (const char of provider) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return styles[AVATAR_CLASSES[hash % AVATAR_CLASSES.length] as keyof typeof styles] as string
}

/**
 * The icon a route shows: the profile's own choice first, then the built-in
 * mark the route id maps to. Both read as `undefined` for a route with no
 * mark, which renders the letter avatar.
 * @param provider - the provider route id.
 * @param profile - the route's resolved profile value, when one exists.
 * @returns the icon name, or undefined when no mark applies.
 */
export function providerIconOf(provider: string, profile: unknown): string | undefined {
  const named = typeof profile === 'object' && profile !== null
    ? (profile as { icon?: unknown }).icon
    : undefined
  const icon = typeof named === 'string' && named.length > 0 ? named : ROUTE_ICONS[provider]
  if (icon === undefined || PROVIDER_ICONS[icon] === undefined) return undefined
  return icon
}

/** Props of {@link ProviderLogo}. */
export interface ProviderLogoProps {
  /** The provider route id (the letter avatar's palette seed). */
  provider: string
  /** The display name to take the initial from when no icon applies. */
  displayName: string
  /** The icon name, from {@link providerIconOf}; absent renders the avatar. */
  icon?: string | undefined
  /** Rendered box size in pixels (the SVG set scales by `1em`). */
  size?: number
  /** Additional class names on the rendered element. */
  className?: string
}

/**
 * Render one provider's logo or letter avatar.
 * @param props - the route identity and the icon name to prefer.
 * @returns the logo element.
 */
export function ProviderLogo({
  provider, displayName, icon, size = 36, className,
}: ProviderLogoProps): ReactNode {
  const mark = icon === undefined ? undefined : PROVIDER_ICONS[icon]
  if (mark === undefined) {
    const first = displayName.trim().codePointAt(0)
    const initial = first === undefined ? '?' : String.fromCodePoint(first).toUpperCase()
    return (
      <span
        className={`${styles['avatar']} ${avatarClassOf(provider)} ${className ?? ''}`}
        aria-hidden="true"
        style={{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.46)}px` }}
      >
        {initial}
      </span>
    )
  }
  return (
    <span
      className={`${styles['providerLogo']} ${className ?? ''}`}
      aria-hidden="true"
      style={{ width: `${size}px`, height: `${size}px`, fontSize: `${size}px`, lineHeight: 1 }}
      // The vendored set ships hand-curated SVG marks; injecting the string
      // is what lets them render without a bundler asset pipeline.
      dangerouslySetInnerHTML={{ __html: mark }}
    />
  )
}
