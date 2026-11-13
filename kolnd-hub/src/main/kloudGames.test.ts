// Suíte do kloudGames (05-5.5): escrita de estado só quando o estado muda,
// tasklist assíncrono com cache TTL (~2 s) e tolerância a falhas. Nada aqui
// toca Program Files nem spawna processos de verdade: o cwd é redirecionado
// para uma pasta temporária e o tasklist fica no mock.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const mockPaths = vi.hoisted(() => ({ baseDir: 'C:\\fake-kg-base' }))

const { execFileAsyncMock, writeFileSyncMock } = vi.hoisted(() => ({
  execFileAsyncMock: vi.fn(),
  writeFileSyncMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return false
    },
    getPath: () => join(mockPaths.baseDir, 'userData')
  }
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  // `promisify(execFile)` devolve o implementation `util.promisify.custom`;
  // sem o símbolo custom, promisify exigiria callback e os testes travariam.
  const execFile = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: execFileAsyncMock
  })
  return { ...actual, execFile, execFileSync: vi.fn(), spawn: vi.fn() }
})

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  writeFileSyncMock.mockImplementation(actual.writeFileSync)
  return { ...actual, writeFileSync: writeFileSyncMock }
})

const actualFs = await vi.importActual<typeof import('fs')>('fs')

import {
  getKloudGamesStatePath,
  getKloudGamesStatus,
  invalidateKloudGamesRunningCache,
  isKloudGamesRunning,
  refreshKloudGamesPaths
} from './kloudGames'

const TASKLIST_NO_TASKS = 'INFO: No tasks are running with the specified criteria.'
const TASKLIST_WITH_TASK = '"KLOUD_GAMES.exe","1234","Console","1","50.000 K"'

function stateDir(): string {
  return join(mockPaths.baseDir, 'resources', 'programs', 'kloud-games')
}

const savedEnv = { ...process.env }

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'kg-test-'))
  mockPaths.baseDir = dir
  vi.spyOn(process, 'cwd').mockReturnValue(dir)
  // Sandbox das pastas de Program Files (evita depender do que está instalado de verdade).
  process.env.ProgramFiles = join(dir, 'pf')
  process.env['ProgramFiles(x86)'] = join(dir, 'pf86')
  process.env.ProgramW6432 = join(dir, 'pf64')
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-13T12:00:00.000Z'))
  execFileAsyncMock.mockReset()
  writeFileSyncMock.mockClear()
  writeFileSyncMock.mockImplementation(actualFs.writeFileSync)
  invalidateKloudGamesRunningCache()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  process.env = { ...savedEnv }
  rmSync(mockPaths.baseDir, { recursive: true, force: true })
})

afterAll(() => {
  vi.restoreAllMocks()
})

describe('refreshKloudGamesPaths — escrita só quando o estado muda', () => {
  it('estado idêntico: segunda chamada não escreve no disco', async () => {
    refreshKloudGamesPaths()
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1) // primeira gravação (criação)

    writeFileSyncMock.mockClear()
    refreshKloudGamesPaths()
    refreshKloudGamesPaths()
    expect(writeFileSyncMock).not.toHaveBeenCalled()
  })

  it('estado idêntico via status: chamadas seguidas não reescrevem', async () => {
    await getKloudGamesStatus()
    writeFileSyncMock.mockClear()
    await getKloudGamesStatus()
    expect(writeFileSyncMock).not.toHaveBeenCalled()
  })

  it('estado alterado (exe detectado): escreve de novo', () => {
    refreshKloudGamesPaths()
    writeFileSyncMock.mockClear()

    mkdirSync(stateDir(), { recursive: true })
    actualFs.writeFileSync(join(stateDir(), 'KLOUD_GAMES.exe'), 'fake-exe')

    const { exePath } = refreshKloudGamesPaths()
    expect(exePath).toBe(join(stateDir(), 'KLOUD_GAMES.exe'))
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1)
  })
})

describe('isKloudGamesRunning — cache TTL + tasklist assíncrono', () => {
  it('5 chamadas em < 2 s → tasklist spawnado exatamente 1 vez', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: TASKLIST_WITH_TASK, stderr: '' })

    for (let i = 0; i < 5; i += 1) {
      expect(await isKloudGamesRunning()).toBe(true)
    }
    expect(execFileAsyncMock).toHaveBeenCalledTimes(1)
  })

  it('TTL expira (~2 s) → spawna de novo', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: TASKLIST_NO_TASKS, stderr: '' })

    expect(await isKloudGamesRunning()).toBe(false)
    vi.setSystemTime(new Date('2026-11-13T12:00:01.500Z')) // +1,5 s — ainda no TTL
    expect(await isKloudGamesRunning()).toBe(false)
    expect(execFileAsyncMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-11-13T12:00:02.100Z')) // +2,1 s — TTL expirou
    expect(await isKloudGamesRunning()).toBe(false)
    expect(execFileAsyncMock).toHaveBeenCalledTimes(2)
  })

  it('falha do tasklist → running: false e a falha também fica cacheada', async () => {
    execFileAsyncMock.mockRejectedValue(new Error('tasklist indisponível'))

    for (let i = 0; i < 5; i += 1) {
      expect(await isKloudGamesRunning()).toBe(false)
    }
    expect(execFileAsyncMock).toHaveBeenCalledTimes(1)
  })

  it('invalidateKloudGamesRunningCache força novo spawn dentro do TTL', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: TASKLIST_WITH_TASK, stderr: '' })

    expect(await isKloudGamesRunning()).toBe(true)
    invalidateKloudGamesRunningCache()
    expect(await isKloudGamesRunning()).toBe(true)
    expect(execFileAsyncMock).toHaveBeenCalledTimes(2)
  })
})

describe('getKloudGamesStatus — contrato IPC preservado', () => {
  it('devolve installed/exePath/msiPath/dir/running', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: TASKLIST_NO_TASKS, stderr: '' })

    const status = await getKloudGamesStatus()
    expect(status).toEqual({
      installed: false,
      exePath: null,
      msiPath: null,
      dir: stateDir(),
      running: false
    })
  })

  it('getKloudGamesStatePath continua dentro da pasta do Hub (05-5.5)', () => {
    expect(getKloudGamesStatePath()).toBe(join(stateDir(), 'kloud-games.paths.json'))
  })
})
