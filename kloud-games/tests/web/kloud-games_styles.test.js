import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const webRoot = resolve(projectRoot, 'src_assets/common/assets/web')

const aggregate = readFileSync(resolve(webRoot, 'KLOUD_GAMES.css'), 'utf8')
const tokens = readFileSync(resolve(webRoot, 'design/tokens.css'), 'utf8')
const themes = readFileSync(resolve(webRoot, 'design/themes.css'), 'utf8')
const base = readFileSync(resolve(webRoot, 'design/base.css'), 'utf8')
const layout = readFileSync(resolve(webRoot, 'design/layout.css'), 'utf8')
const components = readFileSync(resolve(webRoot, 'design/components.css'), 'utf8')
const styles = [tokens, themes, base, layout, components].join('\n')

describe('design system stylesheet', () => {
  it('keeps KLOUD_GAMES.css as the aggregator', () => {
    for (const file of ['tokens', 'themes', 'base', 'layout', 'components']) {
      expect(aggregate).toContain(`@import './design/${file}.css';`)
    }
  })

  it('ships the 21 dark palettes plus the amber identity', () => {
    expect((themes.match(/\[data-theme="/g) || [])).toHaveLength(21)
    expect(themes).toContain('--kg-accent: #e2a33f;')
    expect(themes).toContain('--kg-bg-base: #0e141b;')
  })

  it('defines the required semantic tokens', () => {
    for (const token of [
      '--kg-bg-base', '--kg-surface-1', '--kg-surface-2', '--kg-surface-3',
      '--kg-border-subtle', '--kg-border-strong', '--kg-text-primary',
      '--kg-text-secondary', '--kg-text-tertiary', '--kg-accent',
      '--kg-success', '--kg-warning', '--kg-danger', '--kg-shadow-sm',
      '--kg-radius-card', '--kg-motion-base',
    ]) {
      expect(styles).toContain(`${token}:`)
    }
  })

  it('implements the component primitives with the kg prefix', () => {
    for (const selector of [
      '.kg-btn', '.kg-btn-primary', '.kg-btn-secondary', '.kg-btn-danger',
      '.kg-badge', '.kg-card', '.kg-hero', '.kg-input', '.kg-select',
      '.kg-check', '.kg-switch', '.kg-table', '.kg-tabs', '.kg-chip',
      '.kg-callout', '.kg-skeleton', '.kg-spinner', '.kg-progress', '.kg-kbd',
      '.kg-dropdown-menu', '.kg-modal', '.kg-toast', '.kg-rail', '.kg-terminal',
    ]) {
      expect(components).toContain(`${selector}`)
    }
  })

  it('respects reduced motion', () => {
    expect(base).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('does not ship Bootstrap utilities or components', () => {
    const forbidden = [
      /data-bs-/,
      /form-control/,
      /form-select/,
      /alert alert-/,
      /list-group/,
      /spinner-border/,
      /(?:^|[\s,{])dropdown-menu\b/,
      /accordion/,
      /\bbtn btn-/,
      /navbar-toggler/,
    ]
    for (const pattern of forbidden) {
      expect(styles, `stylesheet matches ${pattern}`).not.toMatch(pattern)
    }
  })
})
