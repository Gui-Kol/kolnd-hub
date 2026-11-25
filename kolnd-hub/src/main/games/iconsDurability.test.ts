import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { StoredGame } from '../store'

const state = vi.hoisted(() => ({
  games: [] as StoredGame[],
  version: 0,
  userData: ''
}))

const electronMocks = vi.hoisted(() => ({
  getFileIcon: vi.fn(),
  createFromBuffer: vi.fn(),
  createFromPath: vi.fn(),
  showOpenDialog: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => state.userData,
    getFileIcon: electronMocks.getFileIcon
  },
  dialog: { showOpenDialog: electronMocks.showOpenDialog },
  nativeImage: {
    createFromBuffer: electronMocks.createFromBuffer,
    createFromPath: electronMocks.createFromPath
  }
}))

vi.mock('../store', () => ({
  getStoredGames: () => state.games,
  setStoredGames: (games: StoredGame[]) => {
    state.games = games
    return { success: true }
  },
  getGameCollections: () => [],
  setGameCollections: () => ({ success: true }),
  normalizeGame: (input: unknown) => {
    if (!input || typeof input !== 'object') return null
    const raw = input as Record<string, unknown>
    if (
      typeof raw.id !== 'string' ||
      !raw.id.trim() ||
      typeof raw.name !== 'string' ||
      !raw.name.trim() ||
      typeof raw.exePath !== 'string' ||
      !raw.exePath.trim()
    ) {
      return null
    }
    return { ...raw, id: raw.id.trim() } as StoredGame
  },
  normalizeGameCollections: (input: unknown, max: number) =>
    Array.isArray(input)
      ? input.filter((entry): entry is string => typeof entry === 'string').slice(0, max)
      : [],
  MAX_GAME_COLLECTIONS: 30,
  MAX_GAME_COLLECTION_TAGS: 8,
  getGameIconsVersion: () => state.version,
  setGameIconsVersion: (version: number) => {
    state.version = version
  }
}))

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import {
  getGameIcon,
  refreshGameIcons,
  reloadGameIcons,
  repairGameIconsIfNeeded,
  restoreExeIcon,
  setGameIcon
} from './icons'
import { addGame, removeGame, updateGame } from './store'
import { readIcon } from './iconVault'

let userDataDir: string
let exePath: string

function game(id: string): StoredGame {
  return {
    id,
    name: `Jogo ${id}`,
    exePath,
    iconPath: null,
    origin: 'custom',
    addedAt: '2026-01-01T00:00:00.000Z'
  }
}

const dataUrl = (buffer: Buffer, mime = 'png'): string =>
  `data:image/${mime};base64,${buffer.toString('base64')}`

const shaOf = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex')

beforeEach(() => {
  state.games = []
  state.version = 0
  userDataDir = mkdtempSync(join(tmpdir(), 'kolnd-icons-durability-'))
  state.userData = userDataDir
  exePath = join(userDataDir, 'jogo.exe')
  writeFileSync(exePath, 'exe falso')
  electronMocks.getFileIcon.mockResolvedValue({
    isEmpty: () => false,
    toPNG: () => Buffer.from('derived-png')
  })
  electronMocks.createFromBuffer.mockReturnValue({ isEmpty: () => false })
  electronMocks.createFromPath.mockReturnValue({ isEmpty: () => false })
})

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
})

describe('durabilidade do ícone manual', () => {
  it('rematerializa do cofre após apagar game-icons e sobrevive a 3 refreshes', async () => {
    state.games = [game('manual-1')]
    const png = Buffer.from('manual-bytes')
    const written = setGameIcon('manual-1', dataUrl(png))

    expect(written.success).toBe(true)
    expect(state.games[0]).toMatchObject({
      iconSha: shaOf(png),
      iconExt: '.png',
      iconOrigin: 'manual'
    })
    expect(updateGame('manual-1', { iconPath: written.iconPath })).toEqual({ success: true })

    rmSync(join(userDataDir, 'game-icons'), { recursive: true, force: true })
    expect(getGameIcon('manual-1')).toBe(dataUrl(png))

    for (let i = 0; i < 3; i += 1) await refreshGameIcons()
    expect(state.games[0].iconSha).toBe(shaOf(png))
    expect(state.games[0].iconOrigin).toBe('manual')
    expect(getGameIcon('manual-1')).toBe(dataUrl(png))
  })
})

describe('semeadura ao adicionar jogo (scanners/addCustomGame)', () => {
  it('nasce com iconSha/iconExt/derived quando iconPath é legível', () => {
    const iconsDir = join(userDataDir, 'game-icons')
    mkdirSync(iconsDir, { recursive: true })
    const iconPath = join(iconsDir, 'novo.png')
    writeFileSync(iconPath, 'novo-icone')

    const result = addGame({
      id: 'novo',
      name: 'Novo',
      exePath: join(userDataDir, 'novo.exe'),
      iconPath,
      origin: 'custom',
      addedAt: '2026-01-01T00:00:00.000Z'
    })

    expect(result).toEqual({ success: true })
    const sha = shaOf(Buffer.from('novo-icone'))
    expect(state.games[0]).toMatchObject({
      iconSha: sha,
      iconExt: '.png',
      iconOrigin: 'derived'
    })
    expect(readIcon(sha, '.png')?.toString()).toBe('novo-icone')
  })

  it('ícone ausente/ilegível não impede o addGame', () => {
    const missing = join(userDataDir, 'game-icons', 'sumiu.png')
    const result = addGame({
      id: 'sem-icone',
      name: 'Sem ícone',
      exePath: join(userDataDir, 'sem.exe'),
      iconPath: missing,
      origin: 'custom',
      addedAt: '2026-01-01T00:00:00.000Z'
    })

    expect(result).toEqual({ success: true })
    expect(state.games[0].iconSha).toBeUndefined()
    expect(state.games[0].iconExt).toBeUndefined()
  })
})

describe('durabilidade do ícone derivado', () => {
  it('restore grava no cofre e rematerializa após apagar game-icons', async () => {
    state.games = [game('derived-1')]
    const restored = await restoreExeIcon('derived-1', exePath)

    expect(restored.success).toBe(true)
    expect(state.games[0]).toMatchObject({
      iconSha: shaOf(Buffer.from('derived-png')),
      iconExt: '.png',
      iconOrigin: 'derived'
    })
    expect(updateGame('derived-1', { iconPath: restored.iconPath })).toEqual({ success: true })

    rmSync(join(userDataDir, 'game-icons'), { recursive: true, force: true })
    expect(getGameIcon('derived-1')).toBe(dataUrl(Buffer.from('derived-png')))
  })
})

describe('GC do cofre na remoção de jogo', () => {
  it('não apaga o blob enquanto outro jogo o referencia', () => {
    state.games = [game('c'), game('d')]
    const png = Buffer.from('shared-bytes')
    setGameIcon('c', dataUrl(png))
    setGameIcon('d', dataUrl(png))
    const sha = state.games[0].iconSha!

    expect(state.games[1].iconSha).toBe(sha)
    expect(removeGame('c')).toEqual({ success: true })
    expect(readIcon(sha, '.png')?.toString()).toBe('shared-bytes')

    expect(removeGame('d')).toEqual({ success: true })
    expect(readIcon(sha, '.png')).toBeNull()
  })
})

describe('semeadura independente da versão', () => {
  it('roda com versão já em 3, é idempotente e não toca em jogo com iconSha', async () => {
    state.version = 3
    state.games = [
      game('seed'),
      {
        ...game('com-sha'),
        iconSha: 'b'.repeat(64),
        iconExt: '.png',
        iconOrigin: 'manual'
      }
    ]
    const iconsDir = join(userDataDir, 'game-icons')
    mkdirSync(iconsDir, { recursive: true })
    const iconPath = join(iconsDir, 'seed.png')
    writeFileSync(iconPath, 'manual-antigo')
    state.games[0].iconPath = iconPath

    await expect(repairGameIconsIfNeeded()).resolves.toBe(1)
    const sha = shaOf(Buffer.from('manual-antigo'))
    expect(state.version).toBe(3)
    expect(state.games[0]).toMatchObject({
      iconSha: sha,
      iconExt: '.png',
      iconOrigin: 'manual'
    })
    expect(state.games[1].iconSha).toBe('b'.repeat(64))
    expect(readIcon(sha, '.png')?.toString()).toBe('manual-antigo')

    await expect(repairGameIconsIfNeeded()).resolves.toBe(0)
    expect(state.games[0].iconSha).toBe(sha)
    expect(existsSync(iconPath)).toBe(true)
  })

  it('reload registra ícone legível sem iconSha sem sobrescrever o arquivo', async () => {
    state.version = 3
    state.games = [game('reload-seed')]
    const iconsDir = join(userDataDir, 'game-icons')
    mkdirSync(iconsDir, { recursive: true })
    const iconPath = join(iconsDir, 'reload-seed.png')
    writeFileSync(iconPath, 'arquivo-original')
    state.games[0].iconPath = iconPath
    const before = readFileSync(iconPath)

    await reloadGameIcons()

    expect(state.games[0]).toMatchObject({
      iconSha: shaOf(Buffer.from('arquivo-original')),
      iconExt: '.png',
      iconOrigin: 'manual'
    })
    expect(readFileSync(iconPath)).toEqual(before)
  })
})
