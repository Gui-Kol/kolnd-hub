import { describe, expect, it, vi } from 'vitest'
import {
  createAppCatalog,
  imageNameFromTarget,
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

  it('cache da versão 1 é descartado e regravado como versão 2', async () => {
    const options = baseOptions()
    const fs = options.fs as CatalogFs & { files: Map<string, string> }
    // Cache vazio gravado pelo bug do `-Command` (v1).
    fs.files.set(
      options.cachePath,
      JSON.stringify({ version: 1, signature: 'C:\\MenuA:1000|C:\\MenuB:2000', apps: [] })
    )
    const resolveShortcuts = vi.fn(options.resolveShortcuts)

    const catalog = createAppCatalog({ ...options, resolveShortcuts })
    const { apps, cached } = await catalog.load()

    expect(cached).toBe(false)
    expect(resolveShortcuts).toHaveBeenCalledTimes(1)
    expect(apps.map((app) => app.name)).toEqual(['Bloco de Notas', 'Calculadora', 'Paint'])
    const written = JSON.parse(fs.files.get(options.cachePath) ?? '{}') as { version: number }
    expect(written.version).toBe(2)
  })

  it('mescla apps conhecidos sem duplicar nome e mantém known na frente do varrido', async () => {
    const catalog = createAppCatalog(
      baseOptions({
        knownApps: [
          { name: 'Bloco de Notas', kind: 'known', target: 'C:\\Windows\\System32\\notepad.exe' },
          { name: 'Notepad', kind: 'known', target: 'C:\\Windows\\System32\\notepad.exe' }
        ]
      })
    )

    const { apps } = await catalog.load()
    const names = apps.map((app) => app.name)

    // "Bloco de Notas" existe como .lnk e como known: aparece uma única vez,
    // com o alvo do known (precedência do nome normalizado).
    expect(names.filter((name) => name === 'Bloco de Notas')).toHaveLength(1)
    expect(apps.find((app) => app.name === 'Bloco de Notas')).toMatchObject({
      kind: 'known',
      target: 'C:\\Windows\\System32\\notepad.exe'
    })
    expect(names).toContain('Notepad')
    expect(names).toContain('Calculadora')
    expect(names).toContain('Paint')
    expect(await catalog.listNames()).toEqual(names)
  })

  it('apps conhecidos aparecem mesmo sem nenhum atalho no Menu Iniciar', async () => {
    const catalog = createAppCatalog(
      baseOptions({
        startMenuDirs: ['C:\\Vazio'],
        knownApps: [
          { name: 'Notepad', kind: 'known', target: 'C:\\Windows\\System32\\notepad.exe' }
        ]
      })
    )

    const { apps, cached } = await catalog.load()

    expect(cached).toBe(false)
    expect(apps).toEqual([
      { name: 'Notepad', kind: 'known', target: 'C:\\Windows\\System32\\notepad.exe' }
    ])
    expect(await catalog.listNames()).toEqual(['Notepad'])
  })

  it('open de app conhecido abre por spawn sem verificar o PID', async () => {
    const spawn = vi.fn(() => ({ pid: 777, unref: () => undefined }))
    const isProcessAlive = vi.fn(async () => false)
    const catalog = createAppCatalog(
      baseOptions({
        knownApps: [
          { name: 'Notepad', kind: 'known', target: 'C:\\Windows\\System32\\notepad.exe' }
        ],
        spawn,
        isProcessAlive
      })
    )

    const result = await catalog.open('notepad')

    expect(result).toMatchObject({
      ok: true,
      verified: false,
      pid: 777,
      app: { name: 'Notepad', kind: 'known' }
    })
    expect(spawn).toHaveBeenCalledWith('C:\\Windows\\System32\\notepad.exe', [], {
      detached: true,
      stdio: 'ignore',
      shell: false
    })
    expect(isProcessAlive).not.toHaveBeenCalled()
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
    const failed = await died.open('Bloco de Notas')
    expect(failed.ok === false && failed.error).toMatch(/^Não consegui abrir o aplicativo/)
  })

  it('espera o processo com o nome da imagem do alvo aparecer', async () => {
    let clock = 0
    let calls = 0
    const findRunning = vi.fn(async (_image: string) => {
      calls += 1
      // Primeira checagem (antes do spawn) falsa; depois o app aparece.
      return calls > 1
    })
    const spawn = vi.fn(() => ({ pid: 321, unref: () => undefined }))
    const catalog = createAppCatalog(
      baseOptions({
        findRunning,
        spawn,
        verifyTimeoutMs: 2_000,
        now: () => clock,
        wait: async (ms) => {
          clock += ms
        }
      })
    )

    const result = await catalog.open('Bloco de Notas')

    expect(result).toMatchObject({
      ok: true,
      verified: true,
      pid: 321,
      message: 'Abri o aplicativo Bloco de Notas.'
    })
    expect(findRunning).toHaveBeenCalledWith('notepad.exe')
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('não abre de novo quando a imagem já está rodando', async () => {
    const findRunning = vi.fn(async () => true)
    const spawn = vi.fn(() => ({ pid: 999, unref: () => undefined }))
    const catalog = createAppCatalog(baseOptions({ findRunning, spawn }))

    const result = await catalog.open('Bloco de Notas')

    expect(result).toMatchObject({
      ok: true,
      verified: true,
      alreadyRunning: true,
      message: 'O aplicativo Bloco de Notas já estava aberto.'
    })
    expect(findRunning).toHaveBeenCalledWith('notepad.exe')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('launcher vivo sem imagem própria conta como aberto (PID secundário)', async () => {
    let clock = 0
    const catalog = createAppCatalog(
      baseOptions({
        findRunning: async () => false,
        isProcessAlive: async () => true,
        verifyTimeoutMs: 500,
        now: () => clock,
        wait: async (ms) => {
          clock += ms
        }
      })
    )

    const result = await catalog.open('Bloco de Notas')

    expect(result).toMatchObject({
      ok: true,
      verified: false,
      pid: 4242,
      message: 'Abri o aplicativo Bloco de Notas.'
    })
  })

  it('sem imagem e sem PID vivo falha com frase amigável', async () => {
    let clock = 0
    const catalog = createAppCatalog(
      baseOptions({
        findRunning: async () => false,
        isProcessAlive: async () => false,
        verifyTimeoutMs: 500,
        now: () => clock,
        wait: async (ms) => {
          clock += ms
        }
      })
    )

    const result = await catalog.open('Bloco de Notas')

    expect(result).toMatchObject({ ok: false, reason: 'verify' })
    expect(result.ok === false && result.error).toMatch(
      /^Não consegui abrir o aplicativo Bloco de Notas:/
    )
  })

  it('AUMID abre sem verificação de imagem e devolve frase de sucesso', async () => {
    const findRunning = vi.fn(async () => false)
    const catalog = createAppCatalog(baseOptions({ findRunning }))
    await catalog.registerAumid('Calculadora UWP', 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App')

    const result = await catalog.open('Calculadora UWP')

    expect(result).toMatchObject({
      ok: true,
      verified: false,
      message: 'Abri o aplicativo Calculadora UWP.'
    })
    expect(findRunning).not.toHaveBeenCalled()
  })

  it('só o basename .exe seguro do alvo vai para o filtro do tasklist', () => {
    expect(imageNameFromTarget('C:\\Program Files\\App\\Insomnia.exe')).toBe('Insomnia.exe')
    expect(imageNameFromTarget('calc.exe')).toBe('calc.exe')
    expect(imageNameFromTarget('C:\\App\\iniciar.cmd')).toBeNull()
    expect(imageNameFromTarget('C:\\App\\app.exe" /F')).toBeNull()
    expect(imageNameFromTarget('C:\\App\\')).toBeNull()
  })
})
