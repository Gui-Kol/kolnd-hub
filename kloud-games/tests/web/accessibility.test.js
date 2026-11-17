import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { THEME_IDS } from '../../src_assets/common/assets/web/theme'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../src_assets/common/assets/web')
const themesCss = readFileSync(resolve(webRoot, 'design/themes.css'), 'utf8')
const baseCss = readFileSync(resolve(webRoot, 'design/base.css'), 'utf8')
const tokensCss = readFileSync(resolve(webRoot, 'design/tokens.css'), 'utf8')
const componentsCss = readFileSync(resolve(webRoot, 'design/components.css'), 'utf8')

/**
 * @brief Parse one `#rrggbb` color.
 *
 * @param {string} value Color token value.
 * @return {number[]|null} RGB components.
 */
function toRgb(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value).trim())
  if (!match) return null
  const number = parseInt(match[1], 16)
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255]
}

/**
 * @brief Relative luminance per WCAG 2.2.
 *
 * @param {number[]} rgb RGB components.
 * @return {number} Relative luminance.
 */
function luminance(rgb) {
  const channels = rgb.map(channel => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

/**
 * @brief Contrast ratio between two colors.
 *
 * @param {string} foreground Foreground color.
 * @param {string} background Background color.
 * @return {number} WCAG contrast ratio.
 */
function contrast(foreground, background) {
  const [lighter, darker] = [luminance(toRgb(foreground)), luminance(toRgb(background))].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

/** @return {Map<string, object>} Tokens defined per theme. */
function parseThemeTokens() {
  const themes = new Map()
  for (const match of themesCss.matchAll(/\[data-theme="([^"]+)"\]\s*\{([\s\S]*?)\}/g)) {
    const tokens = {}
    for (const line of match[2].split('\n')) {
      const token = /--kg-([\w-]+):\s*(#[0-9a-f]{6});/i.exec(line)
      if (token) tokens[token[1]] = token[2]
    }
    themes.set(match[1], tokens)
  }
  return themes
}

describe('color contrast (WCAG AA) across the 21 themes', () => {
  const themes = parseThemeTokens()

  it.each(THEME_IDS)('keeps secondary text readable on every surface in %s', theme => {
    const tokens = themes.get(theme)
    for (const surface of ['surface-1', 'surface-2', 'surface-3']) {
      expect(contrast(tokens['text-secondary'], tokens[surface]), `${theme} secondary on ${surface}`)
        .toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(THEME_IDS)('keeps tertiary text readable on every surface in %s', theme => {
    const tokens = themes.get(theme)
    for (const surface of ['surface-1', 'surface-2', 'surface-3']) {
      expect(contrast(tokens['text-tertiary'], tokens[surface]), `${theme} tertiary on ${surface}`)
        .toBeGreaterThanOrEqual(3)
    }
  })

  it.each(THEME_IDS)('keeps button text readable on the accent in %s', theme => {
    const tokens = themes.get(theme)
    expect(contrast(tokens['accent-contrast'], tokens.accent), `${theme} accent contrast`)
      .toBeGreaterThanOrEqual(4.5)
  })
})

describe('accessibility and responsive rules', () => {
  it('shows a visible focus ring', () => {
    expect(baseCss).toContain(':focus-visible')
    expect(baseCss).toContain('outline: 2px solid var(--kg-focus-ring)')
  })

  it('disables animation when the user prefers reduced motion', () => {
    expect(baseCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(baseCss).toContain('transition-duration: 0.01ms !important')
  })

  it('keeps interactive targets at least 32px tall', () => {
    expect(componentsCss).toContain('height: var(--kg-tap-min)')
    expect(tokensCss).toContain('--kg-tap-min: 32px')
  })

  it('ships the responsive breakpoints used by the shell', () => {
    for (const width of [1100, 980, 860, 620]) {
      expect(readFileSync(resolve(webRoot, 'design/layout.css'), 'utf8')).toContain(`@media (max-width: ${width}px)`)
    }
  })
})
