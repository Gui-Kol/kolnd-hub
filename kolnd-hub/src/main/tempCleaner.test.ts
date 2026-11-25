import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fsMock = vi.hoisted(() => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  rmdir: vi.fn()
}))
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))
const osMock = vi.hoisted(() => ({ tmpdir: vi.fn(() => 'C:\\tmp-root') }))

// fs.promises é 100% simulado: nenhum arquivo real é apagado.
vi.mock('fs', () => ({ promises: fsMock }))
vi.mock('os', () => ({ tmpdir: osMock.tmpdir }))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))

import { cleanTempFiles, registerTempCleanerIpc } from './tempCleaner'

const ROOT = 'C:\\tmp-root'
const WIN_TEMP = 'C:\\Windows\\Temp'
const DAY = 24 * 60 * 60 * 1000
const NOW = Date.now()
const OLD = NOW - 2 * DAY
const RECENT = NOW - 1000

type Kind = 'file' | 'dir' | 'link' | 'other'

function dirent(
  name: string,
  kind: Kind
): {
  name: string
  isDirectory: () => boolean
  isFile: () => boolean
  isSymbolicLink: () => boolean
} {
  return {
    name,
    isDirectory: () => kind === 'dir',
    isFile: () => kind === 'file',
    isSymbolicLink: () => kind === 'link'
  }
}

interface StatInfo {
  mtimeMs?: number
  ctimeMs?: number
  size?: number
  directory?: boolean
}

function errno(code: string): Error {
  return Object.assign(new Error(code), { code })
}

/** Configura stat/readdir a partir de mapas caminho → informação. */
function setup(options: {
  stats?: Record<string, StatInfo | string>
  listing?: Record<string, ReturnType<typeof dirent>[] | string>
}): void {
  const stats = options.stats ?? {}
  const listing = options.listing ?? {}

  fsMock.stat.mockImplementation(async (path: string) => {
    const info = stats[path]
    if (info === undefined) throw errno('ENOENT')
    if (typeof info === 'string') throw errno(info)
    return {
      isDirectory: () => info.directory ?? false,
      mtimeMs: info.mtimeMs ?? 0,
      ctimeMs: info.ctimeMs ?? 0,
      size: info.size ?? 0
    }
  })
  fsMock.readdir.mockImplementation((path: string) => {
    const value = listing[path]
    if (value === undefined) throw errno('ENOENT')
    if (typeof value === 'string') throw errno(value)
    return Promise.resolve(value)
  })
}

const originalEnv = { LOCALAPPDATA: process.env.LOCALAPPDATA, SystemRoot: process.env.SystemRoot }

beforeEach(() => {
  process.env.LOCALAPPDATA = 'C:\\Users\\u\\AppData\\Local'
  process.env.SystemRoot = 'C:\\Windows'
  fsMock.readdir.mockReset()
  fsMock.stat.mockReset()
  fsMock.unlink.mockReset()
  fsMock.rmdir.mockReset()
  osMock.tmpdir.mockReset().mockReturnValue('C:\\tmp-root')
  mocks.handlers.clear()
})

afterEach(() => {
  if (originalEnv.LOCALAPPDATA === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = originalEnv.LOCALAPPDATA
  if (originalEnv.SystemRoot === undefined) delete process.env.SystemRoot
  else process.env.SystemRoot = originalEnv.SystemRoot
})

describe('cleanTempFiles', () => {
  it('remove só arquivos antigos, conta bytes e limpa pastas vazias antigas', async () => {
    const oldFile = `${ROOT}\\old.txt`
    const recentFile = `${ROOT}\\new.txt`
    const oldDir = `${ROOT}\\old-dir`
    const nested = `${oldDir}\\nested.txt`
    const emptyDir = `${ROOT}\\empty-dir`

    setup({
      stats: {
        [ROOT]: { directory: true },
        [oldFile]: { mtimeMs: OLD, size: 100 },
        [recentFile]: { mtimeMs: RECENT, size: 999 },
        [oldDir]: { mtimeMs: OLD, directory: true },
        [emptyDir]: { mtimeMs: OLD, directory: true },
        [nested]: { ctimeMs: OLD, size: 50 },
        // `%LOCALAPPDATA%\Temp` não existe (ENOENT implícito);
        // `%SystemRoot%\Temp` está sem permissão.
        [WIN_TEMP]: 'EACCES'
      },
      listing: {
        [ROOT]: [
          dirent('old.txt', 'file'),
          dirent('new.txt', 'file'),
          dirent('old-dir', 'dir'),
          dirent('empty-dir', 'dir')
        ],
        [oldDir]: [dirent('nested.txt', 'file')],
        [emptyDir]: []
      }
    })
    fsMock.rmdir.mockImplementation((path: string) => {
      if (path === emptyDir) throw errno('ENOTEMPTY')
      return Promise.resolve()
    })

    const result = await cleanTempFiles()
    expect(result.ok).toBe(true)
    expect(result.filesRemoved).toBe(2)
    expect(result.bytesFreed).toBe(150)
    expect(result.paths).toEqual([ROOT])
    expect(result.skippedLocked).toBe(1) // %SystemRoot%\Temp com EACCES
    expect(fsMock.unlink).toHaveBeenCalledWith(oldFile)
    expect(fsMock.unlink).toHaveBeenCalledWith(nested)
    expect(fsMock.unlink).not.toHaveBeenCalledWith(recentFile)
    expect(fsMock.rmdir).toHaveBeenCalledWith(oldDir)
  })

  it('ignora symlinks, itens fora da raiz e tipos não arquivo', async () => {
    setup({
      stats: { [ROOT]: { directory: true } },
      listing: {
        [ROOT]: [dirent('link', 'link'), dirent('pipe', 'other'), dirent('..\\fora.txt', 'file')]
      }
    })

    const result = await cleanTempFiles()
    expect(result.ok).toBe(true)
    expect(result.filesRemoved).toBe(0)
    expect(fsMock.unlink).not.toHaveBeenCalled()
  })

  it('conta EPERM/EACCES/EBUSY como ignorados e demais falhas como erros', async () => {
    const locked = `${ROOT}\\locked.txt`
    const broken = `${ROOT}\\broken.txt`
    setup({
      stats: {
        [ROOT]: { directory: true },
        [locked]: { mtimeMs: OLD },
        [broken]: { mtimeMs: OLD }
      },
      listing: {
        [ROOT]: [
          dirent('locked.txt', 'file'),
          dirent('broken.txt', 'file'),
          dirent('missing.txt', 'file')
        ]
      }
    })
    fsMock.unlink.mockImplementation((path: string) => {
      if (path === locked) throw errno('EPERM')
      if (path === broken) throw errno('EIO')
      return Promise.resolve()
    })

    const result = await cleanTempFiles()
    expect(result.ok).toBe(true)
    expect(result.filesRemoved).toBe(0)
    expect(result.skippedLocked).toBe(1)
    // broken (EIO) + missing (ENOENT no stat) contam como erros.
    expect(result.errors).toBe(2)
  })

  it('falhas ao varrer subpastas não abortam e são contabilizadas', async () => {
    const lockedDir = `${ROOT}\\locked-dir`
    const emptyLocked = `${ROOT}\\empty-locked`
    const emptyBroken = `${ROOT}\\empty-broken`
    const statBroken = `${ROOT}\\stat-broken`
    const nonEmpty = `${ROOT}\\non-empty`
    setup({
      stats: {
        [ROOT]: { directory: true },
        [lockedDir]: { directory: true, mtimeMs: OLD },
        [emptyLocked]: { directory: true, mtimeMs: OLD },
        [emptyBroken]: { directory: true, mtimeMs: OLD },
        [statBroken]: { directory: true, mtimeMs: OLD },
        [nonEmpty]: { directory: true, mtimeMs: OLD }
      },
      listing: {
        [ROOT]: [
          dirent('locked-dir', 'dir'),
          dirent('empty-locked', 'dir'),
          dirent('empty-broken', 'dir'),
          dirent('stat-broken', 'dir'),
          dirent('non-empty', 'dir')
        ],
        [lockedDir]: 'EBUSY',
        [emptyLocked]: [],
        [emptyBroken]: [],
        [statBroken]: 'EIO',
        [nonEmpty]: []
      }
    })
    fsMock.rmdir.mockImplementation((path: string) => {
      if (path === emptyLocked) throw errno('EPERM')
      if (path === emptyBroken) throw errno('EIO')
      if (path === nonEmpty) throw errno('ENOTEMPTY')
      return Promise.resolve()
    })

    const result = await cleanTempFiles()
    expect(result.ok).toBe(true)
    expect(result.skippedLocked).toBe(2) // locked-dir (EBUSY) + empty-locked (EPERM)
    expect(result.errors).toBe(2) // stat-broken (readdir EIO) + empty-broken (rmdir EIO)
  })

  it('nenhuma raiz acessível → ok=false com mensagem amigável', async () => {
    setup({ stats: {} })
    const result = await cleanTempFiles()
    expect(result.ok).toBe(false)
    expect(result.filesRemoved).toBe(0)
    expect(result.error).toContain('Não foi possível acessar as pastas temporárias')
  })

  it('raiz que não é diretório é ignorada', async () => {
    setup({ stats: { [ROOT]: { directory: false } } })
    const result = await cleanTempFiles()
    expect(result.ok).toBe(false)
    expect(fsMock.readdir).not.toHaveBeenCalled()
  })

  it('raiz com stat travado conta como ignorada', async () => {
    setup({ stats: { [ROOT]: 'EBUSY' } })
    const result = await cleanTempFiles()
    expect(result.ok).toBe(false)
    expect(result.skippedLocked).toBe(1)
  })

  it('raiz com erro genérico no stat conta como erro (sem abortar as demais)', async () => {
    setup({
      stats: { [ROOT]: { directory: true }, [WIN_TEMP]: 'EIO' },
      listing: { [ROOT]: [] }
    })
    const result = await cleanTempFiles()
    expect(result.ok).toBe(true)
    expect(result.errors).toBe(1)
    expect(result.paths).toEqual([ROOT])
  })

  it('falha global (defesa final) devolve ok=false com mensagem amigável', async () => {
    osMock.tmpdir.mockImplementation(() => {
      throw new Error('os indisponível')
    })
    const result = await cleanTempFiles()
    expect(result.ok).toBe(false)
    expect(result.errors).toBe(1)
    expect(result.error).toContain('Não foi possível concluir a limpeza')
  })
})

describe('registerTempCleanerIpc', () => {
  it('registra system:clean-temp e devolve o relatório', async () => {
    registerTempCleanerIpc()
    setup({
      stats: { [ROOT]: { directory: true } },
      listing: { [ROOT]: [] }
    })

    const result = (await mocks.handlers.get('system:clean-temp')?.({})) as { ok: boolean }
    expect(result.ok).toBe(true)
  })
})
