import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import packageJson from '../../package.json'

const electronState = vi.hoisted(() => ({
  openExternal: vi.fn(async () => undefined)
}))

vi.mock('electron', () => ({
  shell: { openExternal: electronState.openExternal }
}))

let updates: typeof import('./updates')

beforeEach(async () => {
  vi.resetModules()
  electronState.openExternal.mockClear()
  updates = await import('./updates')
})

function repoUrlFromPackage(): string {
  const repo = (packageJson as { repository?: string | { url?: string } }).repository
  const raw = typeof repo === 'string' ? repo : (repo?.url ?? '')
  return raw
    .trim()
    .replace(/^git\+/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
}

describe('updates manual (v1)', () => {
  it('abre apenas https', async () => {
    // `isHttpsUrl`: so https; recusa http, javascript, file, ftp, lixo.
    expect(updates.isHttpsUrl('https://github.com/Gui-Kol/kolnd-hub/releases')).toBe(true)
    expect(updates.isHttpsUrl('http://github.com/x/releases')).toBe(false)
    expect(updates.isHttpsUrl('javascript:alert(1)')).toBe(false)
    expect(updates.isHttpsUrl('file:///C:/x')).toBe(false)
    expect(updates.isHttpsUrl('ftp://x/y')).toBe(false)
    expect(updates.isHttpsUrl('github.com')).toBe(false)
    expect(updates.isHttpsUrl('')).toBe(false)
    expect(updates.isHttpsUrl('nao-url')).toBe(false)

    const openExternal = vi.fn(async (_url: string) => undefined)
    const result = await updates.openReleasesPage({ openExternal })
    expect(result.ok).toBe(true)
    expect(openExternal).toHaveBeenCalledTimes(1)
    const calledWith = openExternal.mock.calls[0]?.[0] ?? ''
    expect(updates.isHttpsUrl(calledWith)).toBe(true)
    expect(calledWith.startsWith('https://')).toBe(true)
  })

  it('URL vem do package.json', async () => {
    // Le o package.json real e confirma derivacao; nada hardcoded no modulo.
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      repository?: string | { url?: string }
    }
    const repoRaw =
      typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? '')
    expect(repoRaw.length).toBeGreaterThan(0)

    const expectedBase = repoUrlFromPackage()
    expect(updates.repositoryUrl()).toBe(expectedBase)
    expect(updates.releasesUrl()).toBe(`${expectedBase}/releases`)

    // A URL nao e literal fixa no codigo do modulo.
    const source = readFileSync(resolve(process.cwd(), 'src/main/updates.ts'), 'utf8')
    expect(source).toContain('package.json')
    expect(source).toMatch(/packageJson|require\(['"].*package\.json/)
    expect(source).not.toMatch(/https:\/\/[^\s'"]+\/releases/)
  })

  it('nao baixa nada', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('nao deve chamar fetch')
    })
    const openExternal = vi.fn(async (_url: string) => undefined)

    const result = await updates.openReleasesPage({ openExternal })

    expect(result.ok).toBe(true)
    // Unica acao: abrir no navegador. Nada de download/execucao/instalacao.
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
