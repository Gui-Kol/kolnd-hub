import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_THEME,
  THEME_IDS,
  applyRandomTheme,
  applyTheme,
  getPreferredTheme,
  pickRandomTheme,
} from '../../src_assets/common/assets/web/theme'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const webRoot = resolve(projectRoot, 'src_assets/common/assets/web')

/**
 * @brief Extract `[data-theme="..."]` blocks and their custom properties.
 *
 * @param {string} css Stylesheet contents.
 * @return {Map<string, Set<string>>} Tokens defined per theme.
 */
function parseThemes(css) {
  const themes = new Map()
  const blockPattern = /\[data-theme="([^"]+)"\]\s*\{([\s\S]*?)\}/g
  let match
  while ((match = blockPattern.exec(css))) {
    const tokens = new Set()
    for (const line of match[2].split('\n')) {
      const token = /^\s*(--kg-[\w-]+)\s*:/.exec(line)
      if (token) tokens.add(token[1])
    }
    themes.set(match[1], tokens)
  }
  return themes
}

/** Tokens obrigatorios em toda paleta. */
const PALETTE_TOKENS = [
  '--kg-bg-base',
  '--kg-bg-sunken',
  '--kg-surface-1',
  '--kg-surface-2',
  '--kg-surface-3',
  '--kg-border-subtle',
  '--kg-border-strong',
  '--kg-text-primary',
  '--kg-text-secondary',
  '--kg-text-tertiary',
  '--kg-accent',
  '--kg-accent-hover',
  '--kg-accent-active',
  '--kg-accent-contrast',
  '--kg-accent-muted',
  '--kg-accent-border',
  '--kg-focus-ring',
  '--kg-success',
  '--kg-success-muted',
  '--kg-success-border',
  '--kg-warning',
  '--kg-warning-muted',
  '--kg-warning-border',
  '--kg-danger',
  '--kg-danger-muted',
  '--kg-danger-border',
  '--kg-info',
  '--kg-shadow-sm',
  '--kg-shadow-md',
  '--kg-shadow-lg',
]

/** Tokens estruturais (independentes de paleta). */
const STRUCTURAL_TOKENS = [
  '--kg-font-sans',
  '--kg-font-mono',
  '--kg-radius-sm',
  '--kg-radius-control',
  '--kg-radius-card',
  '--kg-radius-pill',
  '--kg-motion-fast',
  '--kg-motion-base',
  '--kg-motion-slow',
  '--kg-motion-screen',
  '--kg-ease-out',
  '--kg-z-rail',
  '--kg-z-chrome',
  '--kg-z-dropdown',
  '--kg-z-toast',
  '--kg-z-overlay',
  '--kg-z-modal',
  '--kg-brandstrip-h',
  '--kg-topbar-h',
]

describe('design tokens', () => {
  const tokensCss = readFileSync(resolve(webRoot, 'design/tokens.css'), 'utf8')
  const themesCss = readFileSync(resolve(webRoot, 'design/themes.css'), 'utf8')
  const themes = parseThemes(themesCss)

  it('defines every structural token once', () => {
    for (const token of STRUCTURAL_TOKENS) {
      expect(tokensCss).toContain(`${token}:`)
    }
  })

  it('ships all 21 themes', () => {
    expect(THEME_IDS).toHaveLength(21)
    expect([...themes.keys()].sort()).toEqual([...THEME_IDS].sort())
    expect(DEFAULT_THEME).toBe('KLOUD_GAMES')
  })

  it.each(THEME_IDS)('theme %s defines every palette token', theme => {
    const tokens = themes.get(theme)
    expect(tokens, `missing theme block for ${theme}`).toBeDefined()
    const missing = PALETTE_TOKENS.filter(token => !tokens.has(token))
    expect(missing, `missing tokens in ${theme}`).toEqual([])
  })

  it('uses the Kolnd amber identity for the default theme', () => {
    expect(themesCss).toContain('--kg-accent: #e2a33f;')
    expect(themesCss).toContain(':root,\n[data-theme="KLOUD_GAMES"]')
  })

  it('aggregates the design system from KLOUD_GAMES.css', () => {
    const aggregate = readFileSync(resolve(webRoot, 'KLOUD_GAMES.css'), 'utf8')
    for (const file of ['tokens', 'themes', 'base', 'layout', 'components']) {
      expect(aggregate).toContain(`@import './design/${file}.css';`)
    }
  })
})

describe('theme menu wiring', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
    document.body.innerHTML = `
      <button id="kg-theme" data-kg-theme-label="Theme">Theme</button>
      <span id="kg-theme-text" data-kg-theme-label="Theme">Theme</span>
      <button data-kg-theme-value="auto" data-kg-theme-label="Auto" aria-pressed="false">Auto</button>
      <button data-kg-theme-value="dark" data-kg-theme-label="Dark" aria-pressed="false">Dark</button>
      <button id="kg-theme-random">Random</button>`
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('marks the active theme and updates the trigger label', async () => {
    const { showActiveTheme } = await import('../../src_assets/common/assets/web/theme')
    showActiveTheme('dark')
    const dark = document.querySelector('[data-kg-theme-value="dark"]')
    expect(dark.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('[data-kg-theme-value="auto"]').getAttribute('aria-pressed')).toBe('false')
    expect(document.querySelector('#kg-theme').getAttribute('aria-label')).toBe('Theme (Dark)')
  })

  it('wires click handlers for theme buttons and random', async () => {
    const { setupThemeToggleListener } = await import('../../src_assets/common/assets/web/theme')
    setupThemeToggleListener()
    document.querySelector('[data-kg-theme-value="dark"]').click()
    expect(localStorage.getItem('theme')).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    vi.spyOn(Math, 'random').mockReturnValue(0)
    document.querySelector('#kg-theme-random').click()
    expect(['dark', 'auto']).not.toContain(localStorage.getItem('theme'))
  })

  it('applies the saved preference on startup and follows OS changes for auto', async () => {
    const listeners = []
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: (_event, handler) => listeners.push(handler),
    })))
    const { loadAutoTheme } = await import('../../src_assets/common/assets/web/theme')

    localStorage.setItem('theme', 'nord')
    loadAutoTheme()
    expect(document.documentElement.dataset.theme).toBe('nord')

    localStorage.setItem('theme', 'auto')
    listeners.forEach(listener => listener())
    expect(document.documentElement.dataset.theme).toBe('KLOUD_GAMES')
  })
})

describe('theme preference', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
    })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.bsTheme
  })

  it('defaults to the KLOUD_GAMES theme', () => {
    expect(getPreferredTheme()).toBe('KLOUD_GAMES')
  })

  it('keeps a stored theme', () => {
    localStorage.setItem('theme', 'dracula')
    expect(getPreferredTheme()).toBe('dracula')
  })

  it('persists and applies a theme without touching data-bs-theme', () => {
    applyTheme('nord')
    expect(localStorage.getItem('theme')).toBe('nord')
    expect(document.documentElement.dataset.theme).toBe('nord')
    expect(document.documentElement.dataset.bsTheme).toBeUndefined()
  })

  it('resolves auto to the default dark identity', () => {
    applyTheme('auto')
    expect(document.documentElement.dataset.theme).toBe('KLOUD_GAMES')
    expect(localStorage.getItem('theme')).toBe('auto')
  })

  it('falls back to the default for unknown themes', () => {
    applyTheme('__proto__')
    expect(document.documentElement.dataset.theme).toBe('KLOUD_GAMES')
  })

  it('picks a random theme that differs from the stored one', () => {
    localStorage.setItem('theme', 'dark')
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    const theme = pickRandomTheme()
    random.mockRestore()
    expect(theme).not.toBe('dark')
    expect(THEME_IDS).toContain(theme)
  })

  it('applies the random theme', () => {
    const theme = applyRandomTheme()
    expect(localStorage.getItem('theme')).toBe(theme)
    expect(document.documentElement.dataset.theme).toBe(theme)
  })
})
