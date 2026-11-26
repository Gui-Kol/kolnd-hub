import { describe, expect, it, vi } from 'vitest'
import {
  createAppCatalog,
  type CatalogFs,
  type DirentLike,
  type ShortcutResolution
} from './appCatalog'

/**
 * Catálogo/abertura (T2) sem executar nada: `spawn`, PowerShell, tasklist,
 * relógio e `fs` são fakes em memória.
 */

function entry(name: string, kind: 'file' | 'dir' | 'symlink' = 'file'): DirentLike {
  return {
    name,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir',
    isSymbolicLink: () => kind === 'symlink'
  }
}

function createFs(
  listing: Record<string, DirentLike[]>,
  mtimes: Record<string, number>
): CatalogFs & { files: Map<string, string> } {
  const files = new Map<string, string>()
  return {
    files,
    readdir: async (path) => {
      const entries = listing[path]
      if (!entries) throw new Error('ENOENT')
      return entries
    },
    stat: async (path) => {
      if (!(path in mtimes)) throw new Error('ENOENT')
      return { mtimeMs: mtimes[path] }
    },
    readFile: async (path) => {
      const value = files.get(path)
      if (value === undefined) throw new Error('ENOENT')
      return value
    },
    writeFile: async (path, data) => {
      files.set(path, data)
    },
    mkdir: async () => undefined
  }
}

function baseOptions(
  overrides: Partial<Parameters<typeof createAppCatalog>[0]> = {}
): Parameters<typeof createAppCatalog>[0] {
  const fs = createFs(
    {
      'C:\\MenuA': [entry('Bloco de Notas.lnk'), entry('Pasta', 'dir')],
      'C:\\MenuA\\Pasta': [entry('Calculadora.lnk')],
      'C:\\MenuB': [entry('Paint.lnk'), entry('AtalhoQuebrado.lnk'), entry('Link', 'symlink')]
    },
    { 'C:\\MenuA': 1000, 'C:\\MenuB': 2000 }
  )
  return {
    cachePath: 'C:\\UserData\\app-catalog.json',
    startMenuDirs: ['C:\\MenuA', 'C:\\MenuB'],
    fs,
    resolveShortcuts: async (paths) =>
      paths
        .filter((path) => !path.includes('AtalhoQuebrado'))
        .map<ShortcutResolution>((path) => ({
          path,
          target: path.includes('Bloco')
            ? 'C:\\Windows\\notepad.exe'
            : path.includes('Calculadora')
              ? 'C:\\Windows\\calc.exe'
              : 'C:\\Windows\\mspaint.exe'
        })),
    spawn: () => ({ pid: 4242, unref: () => undefined }),
    isProcessAlive: async () => true,
    wait: async () => undefined,
    now: () => 0,
    ...overrides
  }
}

describe('catálogo de programas', () => {
  it('resolve .lnk em lote (uma chamada) e ignora symlink/quebrado', async () => {
    const resolveShortcuts = vi.fn(baseOptions().resolveShortcuts)
    const catalog = createAppCatalog(baseOptions({ resolveShortcuts }))

    const { apps, cached } = await catalog.load()

    expect(cached).toBe(false)
    expect(resolveShortcuts).toHaveBeenCalledTimes(1)
    expect(resolveShortcuts.mock.calls[0]?.[0]).toHaveLength(4)
    expect(apps.map((app) => app.name)).toEqual(['Bloco de Notas', 'Calculadora', 'Paint'])
    expect(apps[0]).toMatchObject({ kind: 'shortcut', target: 'C:\\Windows\\notepad.exe' })
    expect(await catalog.listNames()).toContain('Calculadora')
  })

  it('cache é reutilizado quando mtime não muda', async () => {
    const options = baseOptions()
    const first = createAppCatalog(options)
    await first.load()

    const resolveAgain = vi.fn(options.resolveShortcuts)
    const second = createAppCatalog({ ...options, resolveShortcuts: resolveAgain })
    const { apps, cached } = await second.load()

    expect(cached).toBe(true)
    expect(resolveAgain).not.toHaveBeenCalled()
    expect(apps.map((app) => app.name)).toEqual(['Bloco de Notas', 'Calculadora', 'Paint'])

    // mtime mudou: invalida e varre de novo.
    const changedFs = options.fs as CatalogFs & { files: Map<string, string> }
    const invalidated = createAppCatalog({
      ...options,
      fs: {
        ...changedFs,
        stat: async (path) => ({ mtimeMs: path === 'C:\\MenuA' ? 9999 : 2000 })
      },
      resolveShortcuts: resolveAgain
    })
    await invalidated.load()
    expect(resolveAgain).toHaveBeenCalledTimes(1)
  })

  it('nome desconhecido é recusado sem spawn', async () => {
    const spawn = vi.fn(() => ({ pid: 1, unref: () => undefined }))
    const catalog = createAppCatalog(baseOptions({ spawn }))
    await catalog.load()

    const result = await catalog.open('Programa Inexistente')

    expect(result).toMatchObject({ ok: false, reason: 'unknown' })
    expect(result.ok === false && result.error).toContain('Disponíveis')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('falha de spawn ou PID ausente não reporta sucesso', async () => {
    const throwing = createAppCatalog(
      baseOptions({
        spawn: () => {
          throw new Error('EACCES')
        }
      })
    )
    await expect(throwing.open('Bloco de Notas')).resolves.toMatchObject({
      ok: false,
      reason: 'spawn'
    })

    const noPid = createAppCatalog(
      baseOptions({ spawn: () => ({ pid: 0, unref: () => undefined }) })
    )
    await expect(noPid.open('Bloco de Notas')).resolves.toMatchObject({
      ok: false,
      reason: 'spawn'
    })

    const died = createAppCatalog(
      baseOptions({
        isProcessAlive: async () => false,
        verifyTimeoutMs: 0,
        spawn: () => ({ pid: 555, unref: () => undefined })
      })
    )
    await expect(died.open('Bloco de Notas')).resolves.toMatchObject({
      ok: false,
      reason: 'verify'
    })
  })
})
