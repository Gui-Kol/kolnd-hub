import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { EventEmitter } from 'events'
import { app as electronApp } from 'electron'
import { listRunningProcesses } from './startupManager'

const { spawnMock, execFileSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  execFileSyncMock: vi.fn()
}))

const storeMock = vi.hoisted(() => ({
  getStoredGames: vi.fn(() => [] as StoredGame[]),
  setStoredGames: vi.fn((games: StoredGame[]) => ({ success: true }) as const)
}))

vi.mock('electron-store', () => ({
  default: class {
    constructor() {
      return {}
    }
  }
}))
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => join(tmpdir(), 'kolnd-games-test-userdata')),
    getFileIcon: vi
      .fn()
      .mockResolvedValue({ isEmpty: () => false, toPNG: () => Buffer.from('png') })
  },
  dialog: { showOpenDialog: vi.fn() },
  nativeImage: {
    createFromPath: vi.fn().mockReturnValue({ isEmpty: () => false }),
    createFromBuffer: vi.fn().mockReturnValue({ isEmpty: () => false })
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() }
}))
vi.mock('child_process', () => ({
  spawn: spawnMock,
  execFileSync: execFileSyncMock
}))
vi.mock('./store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./store')>()
  return {
    ...actual,
    getStoredGames: storeMock.getStoredGames,
    setStoredGames: storeMock.setStoredGames
  }
})
vi.mock('./startupManager', () => ({ listRunningProcesses: vi.fn() }))

const treeKillMock = vi.hoisted(() =>
  vi.fn((_pid: number, _sig: string, cb: (err?: Error) => void) => {
    process.nextTick(() => cb(undefined))
  })
)
vi.mock('tree-kill', () => ({ default: treeKillMock, __esModule: true }))

const electronMod = electronApp as unknown as {
  getPath: ReturnType<typeof vi.fn>
  getFileIcon: ReturnType<typeof vi.fn>
}
const mockedListRunningProcesses = listRunningProcesses as ReturnType<typeof vi.fn>

import {
  formatGameName,
  checkExePaths,
  findGameProcesses,
  runningGamesMap,
  addGame,
  addCustomGame,
  updateGame,
  removeGame,
  launchGame,
  stopGame
} from './games'
import type { StoredGame } from './store'

const mockedGetStoredGames = storeMock.getStoredGames
const mockedSetStoredGames = storeMock.setStoredGames

let userDataDir: string

beforeEach(() => {
  storeMock.getStoredGames.mockReset().mockReturnValue([])
  storeMock.setStoredGames.mockReset().mockReturnValue({ success: true })
  mockedListRunningProcesses.mockReset()
  spawnMock.mockReset()
  execFileSyncMock.mockReset()
  treeKillMock.mockClear()
  userDataDir = mkdtempSync(join(tmpdir(), 'kolnd-games-test-'))
  electronMod.getPath.mockReturnValue(userDataDir)
  electronMod.getFileIcon.mockResolvedValue({
    isEmpty: () => false,
    toPNG: () => Buffer.from('png')
  })
})

afterEach(() => {
  if (userDataDir && existsSync(userDataDir)) rmSync(userDataDir, { recursive: true, force: true })
})

const fakeSpawn = (): EventEmitter => {
  const proc = new EventEmitter() as unknown as EventEmitter & {
    pid: number
    stdout: { on: ReturnType<typeof vi.fn> }
    stderr: { on: ReturnType<typeof vi.fn> }
    on: ReturnType<typeof vi.fn>
    unref: ReturnType<typeof vi.fn>
    kill: ReturnType<typeof vi.fn>
  }
  proc.pid = 1
  proc.stdout = { on: vi.fn() }
  proc.stderr = { on: vi.fn() }
  proc.on = vi.fn((event: string, listener: () => void) => {
    if (event === 'spawn') setTimeout(listener, 0)
    return proc
  })
  proc.unref = vi.fn()
  proc.kill = vi.fn()
  spawnMock.mockReturnValue(proc)
  return proc as EventEmitter
}

const baseGame: StoredGame = {
  id: 'game-1',
  name: 'Jogo Um',
  exePath: 'C:\\Jogos\\Jogo Um\\jogo.exe',
  iconPath: null,
  origin: 'custom',
  addedAt: '2026-01-01T00:00:00.000Z'
}

// ── formatGameName (puro) ───────────────────────────────────────

describe('formatGameName', () => {
  it('nome simples e com espaços', () => {
    expect(formatGameName('dishonored')).toBe('Dishonored')
    expect(formatGameName('call of duty 4')).toBe('Call Of Duty 4')
  })

  it('preserva siglas conhecidas, algarismos e numerais romanos', () => {
    expect(formatGameName('gta vice city')).toBe('GTA Vice City')
    expect(formatGameName('fifa 23')).toBe('FIFA 23')
    expect(formatGameName('gta iv')).toBe('GTA IV')
    expect(formatGameName('half-life 2')).toBe('Half Life 2')
  })

  it('trata separadores . _ - e múltiplos espaços', () => {
    expect(formatGameName('unreal_tournament_win64-shipping')).toBe(
      'Unreal Tournament Win64 Shipping'
    )
    expect(formatGameName('mass  effect')).toBe('Mass Effect')
  })

  it('vazio → "Jogo sem nome"', () => {
    expect(formatGameName('')).toBe('Jogo sem nome')
    expect(formatGameName('___')).toBe('Jogo sem nome')
  })
})

// ── checkExePaths ───────────────────────────────────────────────

describe('checkExePaths', () => {
  let tmpFile: string

  beforeEach(() => {
    tmpFile = join(userDataDir, 'existe.exe')
    writeFileSync(tmpFile, 'x')
  })

  it('existeSync por caminho', () => {
    expect(checkExePaths([tmpFile, 'C:\\nao\\existe.exe'])).toEqual([true, false])
  })

  it('não-array → []; entradas não-string → false; limita a 500', () => {
    expect(checkExePaths(null as never)).toEqual([])
    expect(checkExePaths([tmpFile, 123 as never, ''])).toEqual([true, false, false])
    const many = Array.from({ length: 600 }, () => tmpFile)
    expect(checkExePaths(many)).toHaveLength(500)
  })
})

// ── findGameProcesses / runningGamesMap ─────────────────────────

describe('findGameProcesses', () => {
  it('casamento por nome do processo e por baseName do caminho', async () => {
    mockedListRunningProcesses.mockReturnValue([
      { name: 'jogo', id: 10, path: 'C:\\outro\\jogo.exe' },
      { name: 'outro', id: 20, path: 'C:\\Jogos\\Jogo Um\\jogo.exe' },
      { name: 'explorer', id: 30, path: 'C:\\Windows\\explorer.exe' }
    ])
    const procs = await findGameProcesses('C:\\Jogos\\Jogo Um\\jogo.exe')
    expect(procs.map((p) => p.id)).toEqual([10, 20])
  })

  it('exe sem base → []; falha na listagem → []', async () => {
    expect(await findGameProcesses('')).toEqual([])
    mockedListRunningProcesses.mockImplementation(() => {
      throw new Error('ps falhou')
    })
    expect(await findGameProcesses('C:\\x\\x.exe')).toEqual([])
  })
})

describe('runningGamesMap', () => {
  it('mapeia id → rodando para os ids da biblioteca', async () => {
    mockedGetStoredGames.mockReturnValue([baseGame])
    mockedListRunningProcesses.mockReturnValue([
      { name: 'jogo', id: 1, path: 'C:\\Jogos\\Jogo Um\\jogo.exe' }
    ])
    const res = await runningGamesMap(['game-1', 'desconhecido'])
    expect(res.ok).toBe(true)
    expect(res.running).toEqual({ 'game-1': true })
  })

  it('lista vazia → {ok:true, running:{}}; não-array → {ok:false}', async () => {
    expect(await runningGamesMap([])).toEqual({ ok: true, running: {} })
    expect(await runningGamesMap(null as never)).toEqual({ ok: false, running: {} })
  })
})

// ── addGame ─────────────────────────────────────────────────────

describe('addGame', () => {
  it('adiciona jogo válido com sucesso', () => {
    const res = addGame(baseGame)
    expect(res.success).toBe(true)
    expect(mockedSetStoredGames).toHaveBeenCalled()
  })

  it('dados inválidos → erro', () => {
    expect(addGame(null)).toEqual({ success: false, error: expect.stringContaining('inválidos') })
    expect(addGame({ id: 'x', name: 'x' })).toEqual({ success: false, error: expect.any(String) })
  })

  it('recusa id duplicado e exePath duplicado', () => {
    mockedGetStoredGames.mockReturnValue([baseGame])
    expect(addGame(baseGame)).toEqual({
      success: false,
      error: expect.stringContaining('identificador')
    })
    const outro = { ...baseGame, id: 'game-2', name: 'Outro' }
    expect(addGame(outro)).toEqual({ success: false, error: expect.stringContaining('executável') })
  })
})

// ── addCustomGame ───────────────────────────────────────────────

describe('addCustomGame (validações sem disco)', () => {
  it('recusa caminho inválido, não absoluto e não .exe', async () => {
    expect(await addCustomGame(null)).toEqual({
      success: false,
      error: 'Caminho do executável inválido.'
    })
    expect(await addCustomGame('relativo\\game.exe')).toEqual({
      success: false,
      error: 'Escolha um caminho absoluto para o executável.'
    })
    expect(await addCustomGame('C:\\Jogo\\jogo.txt')).toEqual({
      success: false,
      error: 'Escolha um arquivo .exe do jogo.'
    })
  })

  it('recusa arquivo inexistente (statSync lança)', async () => {
    const res = await addCustomGame('C:\\Inexistente\\game.exe')
    expect(res.success).toBe(false)
    expect(res.error).toContain('não encontrado')
  })

  it('fluxo feliz com ícone extraído', async () => {
    const exePath = join(userDataDir, 'Meu Jogo.exe')
    writeFileSync(exePath, 'x')
    mockedGetStoredGames.mockReturnValue([])
    const res = await addCustomGame(exePath)
    expect(res.success).toBe(true)
    const hash = createHash('sha1').update(exePath.toLowerCase()).digest('hex').slice(0, 10)
    expect(res.id).toBe(`custom-${hash}`)
    expect(res.name).toBe('Meu Jogo')
  })
})

// ── updateGame ──────────────────────────────────────────────────

describe('updateGame', () => {
  beforeEach(() => {
    mockedGetStoredGames.mockReturnValue([baseGame])
  })

  it('atualiza campos da whitelist', () => {
    const res = updateGame('game-1', { name: 'Novo Nome', origin: 'steam', steamAppId: 42 })
    expect(res.success).toBe(true)
    const saved = (mockedSetStoredGames.mock.calls.at(-1)?.[0] as unknown as StoredGame[]) ?? []
    expect(saved[0].name).toBe('Novo Nome')
    expect(saved[0].origin).toBe('steam')
    expect(saved[0].steamAppId).toBe(42)
  })

  it('id inválido / não encontrado / patch inválido → erro', () => {
    expect(updateGame('  ', { name: 'x' })).toEqual({
      success: false,
      error: expect.stringContaining('Identificador')
    })
    expect(updateGame('inexistente', { name: 'x' })).toEqual({
      success: false,
      error: expect.stringContaining('não encontrado')
    })
    expect(updateGame('game-1', null)).toEqual({ success: false, error: 'Alterações inválidas.' })
  })

  it('campos fora da whitelist são ignorados; nome vazio e origem inválida recusados', () => {
    const res = updateGame('game-1', { nome: 'qualquer', addedAt: '2020' } as never)
    expect(res.success).toBe(true)
    expect(updateGame('game-1', { name: '' })).toEqual({
      success: false,
      error: expect.stringContaining('vazio')
    })
    expect(updateGame('game-1', { origin: 'invalido' as never })).toEqual({
      success: false,
      error: expect.stringContaining('inválida')
    })
    expect(updateGame('game-1', { steamAppId: -1 })).toEqual({
      success: false,
      error: expect.stringContaining('steamAppId inválido')
    })
  })
})

// ── removeGame ──────────────────────────────────────────────────

describe('removeGame', () => {
  it('remove jogo existente e persiste', () => {
    mockedGetStoredGames.mockReturnValue([baseGame])
    const res = removeGame('game-1')
    expect(res.success).toBe(true)
    expect(
      ((mockedSetStoredGames.mock.calls.at(-1)?.[0] as unknown as StoredGame[]) ?? []).length
    ).toBe(0)
  })

  it('id inválido e não encontrado → erro', () => {
    expect(removeGame('')).toEqual({
      success: false,
      error: expect.stringContaining('Identificador')
    })
    mockedGetStoredGames.mockReturnValue([])
    expect(removeGame('game-1')).toEqual({
      success: false,
      error: expect.stringContaining('não encontrado')
    })
  })
})

// ── launchGame / stopGame ───────────────────────────────────────

describe('launchGame', () => {
  it('inválido / não encontrado → erro', async () => {
    expect(await launchGame('')).toEqual({
      ok: false,
      error: expect.stringContaining('Identificador')
    })
    expect(await launchGame('inexistente')).toEqual({
      ok: false,
      error: expect.stringContaining('não encontrado')
    })
  })

  it('exe não existe no disco → erro', async () => {
    mockedGetStoredGames.mockReturnValue([baseGame])
    const res = await launchGame('game-1')
    expect(res.ok).toBe(false)
    expect(res.error).toContain('Executável não encontrado')
  })

  it('já em execução → foca janela existente', async () => {
    const exePath = join(userDataDir, 'jogo.exe')
    writeFileSync(exePath, 'x')
    mockedGetStoredGames.mockReturnValue([{ ...baseGame, exePath }])
    mockedListRunningProcesses.mockReturnValue([{ name: 'jogo', id: 7, path: exePath }])
    execFileSyncMock.mockReturnValue('')
    const res = await launchGame('game-1')
    expect(res.ok).toBe(true)
    expect(res.focused).toBe(true)
  })

  it('spawn bem-sucedido → ok', async () => {
    const exePath = join(userDataDir, 'jogo2.exe')
    writeFileSync(exePath, 'x')
    mockedGetStoredGames.mockReturnValue([{ ...baseGame, id: 'game-2', exePath }])
    mockedListRunningProcesses.mockReturnValue([])
    fakeSpawn()
    const res = await launchGame('game-2')
    expect(res.ok).toBe(true)
    expect(spawnMock).toHaveBeenCalled()
  })
})

describe('stopGame', () => {
  it('não em execução → erro', async () => {
    mockedGetStoredGames.mockReturnValue([baseGame])
    mockedListRunningProcesses.mockReturnValue([])
    const res = await stopGame('game-1')
    expect(res.ok).toBe(false)
    expect(res.error).toContain('não está em execução')
  })

  it('mata os processos da árvore', async () => {
    const exePath = join(userDataDir, 'jogo.exe')
    mockedGetStoredGames.mockReturnValue([{ ...baseGame, exePath }])
    mockedListRunningProcesses.mockReturnValue([{ name: 'jogo', id: 9, path: exePath }])
    const res = await stopGame('game-1')
    expect(res.ok).toBe(true)
    expect(res.killed).toBe(1)
    expect(treeKillMock).toHaveBeenCalledWith(9, 'SIGKILL', expect.any(Function))
  })
})
