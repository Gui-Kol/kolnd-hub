import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Versão única (task 12, T3).
 *
 * `package.json.version` é a ÚNICA fonte da versão do app. `electron.vite.config.ts`
 * injeta `__APP_VERSION__`, a UI Sobre usa `app.getVersion()` (= mesmo valor do
 * `package.json` no app empacotado) e `electron-builder.yml` usa `${version}` no
 * `artifactName`. Este teste falha se qualquer versão for hardcoded em `src/`.
 */

const PROJECT_ROOT = resolve(process.cwd())
const SRC_DIR = join(PROJECT_ROOT, 'src')
const SELF = 'version.test.ts'
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.html']

function readPackageVersion(): string {
  const raw = readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8')
  const parsed = JSON.parse(raw) as { version?: unknown }
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error('package.json sem campo version válido.')
  }
  return parsed.version
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full))
      continue
    }
    if (entry === SELF) continue
    if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full)
  }
  return out
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('versão única', () => {
  it('package.json.version é a fonte única (semver válido)', () => {
    const version = readPackageVersion()
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('nenhuma versao hardcoded', () => {
    const version = readPackageVersion()
    // A versão do app não pode aparecer como literal em src/ (exceto este teste).
    const needle = new RegExp(`(?<![\\w.])${escapeRegExp(version)}(?![\\w.])`)
    const files = listSourceFiles(SRC_DIR)
    expect(files.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      if (needle.test(content)) offenders.push(file)
    }

    expect(
      offenders,
      `Versão hardcoded "${version}" encontrada em src/. Fonte única: package.json.`
    ).toEqual([])
  })

  it('__APP_VERSION__ vem do package.json e artifactName usa ${version}', () => {
    const version = readPackageVersion()
    const viteConfig = readFileSync(join(PROJECT_ROOT, 'electron.vite.config.ts'), 'utf8')
    expect(viteConfig).toContain('__APP_VERSION__')
    expect(viteConfig).toContain('pkg.version')

    const builderConfig = readFileSync(join(PROJECT_ROOT, 'electron-builder.yml'), 'utf8')
    expect(builderConfig).toContain('artifactName')
    expect(builderConfig).toMatch(/artifactName:\s*Absolem Setup \$\{version\}\.exe/)
    // `version` referenciado no artifactName nunca é literal.
    expect(builderConfig).not.toContain(`Absolem Setup ${version}.exe`)
  })
})
