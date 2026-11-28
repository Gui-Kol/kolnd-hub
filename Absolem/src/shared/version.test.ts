import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { HUB_VERSION_ENV, resolveHubVersion } from './version'

/**
 * Absolem sem versão/release/updater/instalador próprios (task 32).
 *
 * O Absolem é distribuído e atualizado junto com o Kolnd Hub. Este teste trava as
 * invariantes: `package.json.version` é só o placeholder `0.0.0` exigido pelo
 * Electron, o `electron-builder.yml` não gera NSIS/`artifactName`, o renderer não
 * tem `__APP_VERSION__` e nenhum caminho de updater próprio sobrevive.
 */

const PROJECT_ROOT = resolve(process.cwd())
const SRC_DIR = join(PROJECT_ROOT, 'src')
const SELF = 'version.test.ts'
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.html']
const PLACEHOLDER_VERSION = '0.0.0'

interface PackageJson {
  version?: unknown
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8')) as PackageJson
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

/** Arquivos de `src/` cujo conteúdo casa com `pattern`. */
function sourceFilesMatching(pattern: RegExp): string[] {
  return listSourceFiles(SRC_DIR).filter((file) => pattern.test(readFileSync(file, 'utf8')))
}

describe('versão do Absolem = versão do Kolnd Hub', () => {
  it('package.json.version é o placeholder mecânico 0.0.0', () => {
    expect(readPackageJson().version).toBe(PLACEHOLDER_VERSION)
  })

  it('não há script de instalador próprio; package:dir continua para o build da Hub', () => {
    const scripts = readPackageJson().scripts ?? {}
    expect(scripts['package:dir']).toBeDefined()
    expect(scripts.package).toBeUndefined()
    for (const [name, command] of Object.entries(scripts)) {
      expect(command, `script "${name}" ainda gera instalador`).not.toMatch(/--win\b|nsis/i)
    }
  })

  it('electron-builder não configura NSIS/artifactName (só win-unpacked)', () => {
    const builder = readFileSync(join(PROJECT_ROOT, 'electron-builder.yml'), 'utf8')
    expect(builder).toMatch(/^win:/m)
    expect(builder).toMatch(/icon:\s*resources\/icon\.ico/)
    expect(builder).toMatch(/asar:\s*true/)
    expect(builder).toMatch(/requestedExecutionLevel:\s*requireAdministrator/)
    expect(builder).not.toMatch(/artifactName/)
    expect(builder).not.toMatch(/^\s*nsis:/m)
    expect(builder).not.toMatch(/^\s*target:/m)
    expect(builder).not.toMatch(/installerIcon|uninstallerIcon/)
  })

  it('não há updater próprio (arquivo, canal, preload ou dependência)', () => {
    expect(existsSync(join(SRC_DIR, 'main', 'updates.ts'))).toBe(false)
    expect(existsSync(join(SRC_DIR, 'main', 'updates.test.ts'))).toBe(false)
    expect(
      sourceFilesMatching(/app:open-updates|appOpenUpdates|openUpdates|openReleasesPage/)
    ).toEqual([])

    const pkg = readPackageJson()
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    expect(Object.keys(deps)).not.toContain('electron-updater')
  })

  it('o renderer não tem __APP_VERSION__ (versão vem do main/Hub)', () => {
    expect(existsSync(join(PROJECT_ROOT, 'src', 'renderer', 'src', 'env.d.ts'))).toBe(true)
    const offenders = sourceFilesMatching(/__APP_VERSION__/)
    expect(offenders).toEqual([])

    for (const config of ['electron.vite.config.ts', 'vitest.config.ts']) {
      const content = readFileSync(join(PROJECT_ROOT, config), 'utf8')
      expect(content, `${config} ainda define __APP_VERSION__`).not.toContain('__APP_VERSION__')
    }
  })

  it('nenhuma versão hardcoded em src/', () => {
    const needle = new RegExp(`(?<![\\w.])${escapeRegExp(PLACEHOLDER_VERSION)}(?![\\w.])`)
    const files = listSourceFiles(SRC_DIR)
    expect(files.length).toBeGreaterThan(0)

    const offenders = files.filter((file) => needle.test(readFileSync(file, 'utf8')))
    expect(
      offenders,
      `Versão "${PLACEHOLDER_VERSION}" hardcoded em src/. A versão vem do Kolnd Hub em runtime.`
    ).toEqual([])
  })

  it('o main resolve a versão da Hub por ABSOLEM_HUB_VERSION', () => {
    const shared = readFileSync(join(SRC_DIR, 'shared', 'version.ts'), 'utf8')
    expect(shared).toContain('ABSOLEM_HUB_VERSION')
    expect(shared).toContain('resolveHubVersion')

    const ipcApp = readFileSync(join(SRC_DIR, 'main', 'ipc', 'app.ts'), 'utf8')
    expect(ipcApp).toContain('resolveHubVersion(process.env')
  })

  it('docs/scripts de release próprios foram removidos', () => {
    for (const removed of [
      'scripts/hash-artifact.ps1',
      'docs/RELEASE.md',
      'docs/SIGNING.md',
      'docs/FIRST-RUN-CHECKLIST.md',
      'docs/RELEASE-CHECKLIST.md'
    ]) {
      expect(existsSync(join(PROJECT_ROOT, removed)), `${removed} deveria ter sido removido`).toBe(
        false
      )
    }
  })
})

describe('resolveHubVersion (comportamento)', () => {
  it('expõe a variável combinada com a Hub', () => {
    expect(HUB_VERSION_ENV).toBe('ABSOLEM_HUB_VERSION')
  })

  it('usa a versão semver injetada pela Hub, com trim', () => {
    expect(resolveHubVersion({ ABSOLEM_HUB_VERSION: '1.2.2' }, '0.0.0')).toBe('1.2.2')
    expect(resolveHubVersion({ ABSOLEM_HUB_VERSION: '  1.2.2\n' }, '0.0.0')).toBe('1.2.2')
  })

  it('aceita pre-release e build metadata', () => {
    expect(resolveHubVersion({ ABSOLEM_HUB_VERSION: '1.3.0-beta.1' }, '0.0.0')).toBe('1.3.0-beta.1')
    expect(resolveHubVersion({ ABSOLEM_HUB_VERSION: '1.3.0+build.7' }, '0.0.0')).toBe(
      '1.3.0+build.7'
    )
  })

  it('cai no fallback sem env, vazio ou valor inválido', () => {
    expect(resolveHubVersion({}, '0.0.0')).toBe('0.0.0')
    expect(resolveHubVersion(undefined, '0.0.0')).toBe('0.0.0')
    expect(resolveHubVersion({ ABSOLEM_HUB_VERSION: '' }, '0.0.0')).toBe('0.0.0')
    expect(resolveHubVersion({ ABSOLEM_HUB_VERSION: '   ' }, '0.0.0')).toBe('0.0.0')
    expect(resolveHubVersion({ ABSOLEM_HUB_VERSION: 'v1.2.2' }, '0.0.0')).toBe('0.0.0')
    expect(resolveHubVersion({ ABSOLEM_HUB_VERSION: '1.2' }, '0.0.0')).toBe('0.0.0')
    expect(resolveHubVersion({ ABSOLEM_HUB_VERSION: 'abc' }, '0.0.0')).toBe('0.0.0')
  })

  it('o fallback pode ser vazio (diagnóstico sem a versão da Hub)', () => {
    expect(resolveHubVersion({}, '')).toBe('')
  })
})
