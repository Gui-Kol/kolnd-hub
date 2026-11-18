import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../src_assets/common/assets/web')
const en = JSON.parse(readFileSync(resolve(webRoot, 'public/assets/locale/en.json'), 'utf8').replace(/^\uFEFF/, ''))

/**
 * @brief List source files that can contain UI strings.
 *
 * @param {string} directory Directory to scan.
 * @return {string[]} Absolute file paths.
 */
function sourceFiles(directory) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) {
      return name === 'public' ? [] : sourceFiles(path)
    }
    return /\.(vue|js)$/.test(name) ? [path] : []
  })
}

/**
 * @brief Check a dotted translation key against the English catalog.
 *
 * @param {string} key Dot-separated key.
 * @return {boolean} Whether the key resolves to a string.
 */
function hasKey(key) {
  let node = en
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object' || !(part in node)) return false
    node = node[part]
  }
  return typeof node === 'string'
}

describe('i18n keys', () => {
  it('defines every literal translation key used by the components', () => {
    const keys = new Set()
    for (const file of sourceFiles(webRoot)) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/\$t\(\s*['"]([A-Za-z0-9_.]+)['"]/g)) {
        // Dynamic keys are built by concatenation and end with an underscore.
        if (!match[1].endsWith('_')) keys.add(match[1])
      }
      for (const match of source.matchAll(/(?:title-key|description-key|empty-key)="'([A-Za-z0-9_.]+)'"/g)) {
        keys.add(match[1])
      }
    }

    const missing = [...keys].filter(key => !hasKey(key)).sort()
    expect(missing).toEqual([])
  })

  it('keeps the Portuguese catalog in sync for the new strings', () => {
    const pt = JSON.parse(readFileSync(resolve(webRoot, 'public/assets/locale/pt_BR.json'), 'utf8').replace(/^\uFEFF/, ''))
    const newSections = {
      _common: ['skip_to_content', 'local_server', 'main_navigation'],
      index: ['host_status', 'health', 'recent_activity', 'clients_paired', 'encoder', 'version_title', 'config_loaded'],
      config: ['unsaved_changes', 'discard', 'apply_restart'],
      apps: ['details', 'open_editor'],
      troubleshooting: ['logs_copy', 'logs_copied'],
    }
    for (const [section, entries] of Object.entries(newSections)) {
      for (const entry of entries) {
        expect(pt[section][entry], `${section}.${entry}`).toBeTruthy()
      }
    }
  })
})
