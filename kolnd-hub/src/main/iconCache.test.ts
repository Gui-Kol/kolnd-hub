import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, utimesSync, existsSync, statSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const storeMock = vi.hoisted(() => ({
  getStoredGames: vi.fn(() => [] as StoredGame[]),
  setStoredGames: vi.fn((_games: StoredGame[]) => ({ success: true }) as const)
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
    getPath: vi.fn(() => join(tmpdir(), 'kolnd-icon-cache-test-userdata')),
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
vi.mock('./store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./store')>()
  return {
    ...actual,
    getStoredGames: storeMock.getStoredGames,
    setStoredGames: storeMock.setStoredGames
  }
})

import { app as electronApp } from 'electron'
import {
  LruCache,
  ICON_CACHE_MAX,
  lookupIconDataUrl,
  storeIconDataUrl,
  invalidateIconCache,
  clearIconCache
} from './iconCache'
import { getGameIcon, extractIconPng, deleteCachedIcon } from './games/icons'
import type { StoredGame } from './store'

const electronMod = electronApp as unknown as {
  getPath: ReturnType<typeof vi.fn>
  getFileIcon: ReturnType<typeof vi.fn>
}
const mockedGetStoredGames = storeMock.getStoredGames

// mtime "redondo": round-trips exatos por utimesSync em NTFS/ext4, garantindo
// que a chave (mtimeMs/size) seja idêntica entre gravações forçadas.
const T0 = 1_000_000_000 // segundos desde a época

let userDataDir: string
let iconsDir: string

beforeEach(() => {
  clearIconCache()
  storeMock.getStoredGames.mockReset().mockReturnValue([])
  storeMock.setStoredGames.mockReset().mockReturnValue({ success: true })
  userDataDir = mkdtempSync(join(tmpdir(), 'kolnd-icon-cache-test-'))
  iconsDir = join(userDataDir, 'game-icons')
  electronMod.getPath.mockReturnValue(userDataDir)
  electronMod.getFileIcon.mockResolvedValue({
    isEmpty: () => false,
    toPNG: () => Buffer.from('png')
  })
})

afterEach(() => {
  clearIconCache()
  if (userDataDir && existsSync(userDataDir)) rmSync(userDataDir, { recursive: true, force: true })
})

const baseGame = (iconPath: string | null): StoredGame => ({
  id: 'game-1',
  name: 'Jogo Um',
  exePath: 'C:\\Jogos\\Jogo Um\\jogo.exe',
  iconPath,
  origin: 'custom',
  addedAt: '2026-01-01T00:00:00.000Z'
})

const dataUrlOf = (content: string): string =>
  `data:image/png;base64,${Buffer.from(content).toString('base64')}`

/** Grava o arquivo com mtime fixo T0 para a chave do cache ser determinística. */
const writeAtT0 = (filePath: string, content: string): void => {
  writeFileSync(filePath, content)
  utimesSync(filePath, T0, T0)
}

const mkdirIcons = (): void => {
  mkdirSync(iconsDir, { recursive: true })
}

// ── LruCache (unidade pura) ──────────────────────────────────────

describe('LruCache', () => {
  it('get/set/delete/clear e size', () => {
    const cache = new LruCache<string>(3)
    expect(cache.size).toBe(0)
    cache.set('a', 'A')
    cache.set('b', 'B')
    expect(cache.size).toBe(2)
    expect(cache.get('a')).toBe('A')
    expect(cache.delete('a')).toBe(true)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.delete('a')).toBe(false)
    cache.clear()
    expect(cache.size).toBe(0)
  })

  it('capacidade inválida lança RangeError', () => {
    expect(() => new LruCache<string>(0)).toThrow(RangeError)
    expect(() => new LruCache<string>(1.5)).toThrow(RangeError)
  })

  it('evicção LRU: o item menos recentemente usado sai ao encher', () => {
    const cache = new LruCache<string>(2)
    cache.set('a', 'A')
    cache.set('b', 'B')
    cache.get('a') // renova 'a' — 'b' passa a ser o mais velho
    cache.set('c', 'C')
    expect(cache.get('a')).toBe('A')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe('C')
  })

  it('set na mesma chave atualiza o valor sem duplicar', () => {
    const cache = new LruCache<string>(2)
    cache.set('a', 'A')
    cache.set('a', 'A2')
    expect(cache.size).toBe(1)
    expect(cache.get('a')).toBe('A2')
  })

  it('ICON_CACHE_MAX vale 100', () => {
    expect(ICON_CACHE_MAX).toBe(100)
  })
})

// ── lookup/store/invalidate (singleton, arquivos reais) ─────────

describe('iconCache: hit/miss por mtime e tamanho', () => {
  let iconFile: string

  beforeEach(() => {
    mkdirIcons()
    iconFile = join(iconsDir, 'game-1.png')
    writeAtT0(iconFile, 'AAAA')
  })

  it('hit: armazena e recupera a data URL', () => {
    const stat = statSync(iconFile)
    storeIconDataUrl(iconFile, stat, dataUrlOf('AAAA'))
    expect(lookupIconDataUrl(iconFile, stat)).toBe(dataUrlOf('AAAA'))
  })

  it('miss sem entrada armazenada → null', () => {
    const stat = statSync(iconFile)
    expect(lookupIconDataUrl(iconFile, stat)).toBeNull()
  })

  it('expira por tamanho: conteúdo maior invalida a entrada antiga', () => {
    const stat = statSync(iconFile)
    storeIconDataUrl(iconFile, stat, dataUrlOf('AAAA'))
    writeAtT0(iconFile, 'AAAAA') // mesmo mtime, tamanho diferente
    const novoStat = statSync(iconFile)
    expect(lookupIconDataUrl(iconFile, novoStat)).toBeNull()
    // A entrada antiga foi removida: nem com o stat original ela responde.
    expect(lookupIconDataUrl(iconFile, stat)).toBeNull()
  })

  it('expira por mtime: stat com mtime diferente invalida a entrada antiga', () => {
    const stat = statSync(iconFile)
    storeIconDataUrl(iconFile, stat, dataUrlOf('AAAA'))
    // Stat fabricado com mtime maior — nenhuma leitura de arquivo envolvida.
    const statMtimeMaior = { mtimeMs: stat.mtimeMs + 60_000, size: stat.size }
    expect(lookupIconDataUrl(iconFile, statMtimeMaior)).toBeNull()
    expect(lookupIconDataUrl(iconFile, stat)).toBeNull()
  })

  it('miss limpa apenas entradas do mesmo arquivo, preserva as demais', () => {
    const outro = join(iconsDir, 'game-2.png')
    writeAtT0(outro, 'XX')
    const statOutro = statSync(outro)
    storeIconDataUrl(outro, statOutro, dataUrlOf('XX'))

    const stat = statSync(iconFile)
    storeIconDataUrl(iconFile, stat, dataUrlOf('AAAA'))
    // Stat fabricado com mtime maior — miss → limpa entradas de iconFile.
    const statMtimeMaior = { mtimeMs: stat.mtimeMs + 1_000, size: stat.size }
    expect(lookupIconDataUrl(iconFile, statMtimeMaior)).toBeNull()
    expect(lookupIconDataUrl(outro, statOutro)).toBe(dataUrlOf('XX'))
  })
})

describe('invalidateIconCache / clearIconCache', () => {
  it('invalidação explícita remove as entradas do arquivo (qualquer mtime/tamanho)', () => {
    mkdirIcons()
    const iconFile = join(iconsDir, 'game-1.png')
    writeAtT0(iconFile, 'AAAA')
    const stat = statSync(iconFile)
    storeIconDataUrl(iconFile, stat, dataUrlOf('AAAA'))
    invalidateIconCache(iconFile)
    expect(lookupIconDataUrl(iconFile, stat)).toBeNull()
  })

  it('clearIconCache esvazia tudo', () => {
    mkdirIcons()
    const iconFile = join(iconsDir, 'game-1.png')
    writeAtT0(iconFile, 'AAAA')
    const stat = statSync(iconFile)
    storeIconDataUrl(iconFile, stat, dataUrlOf('AAAA'))
    clearIconCache()
    expect(lookupIconDataUrl(iconFile, stat)).toBeNull()
  })
})

// ── Integração com o caminho quente (games/icons.ts) ─────────────

describe('getGameIcon com cache', () => {
  let iconFile: string

  beforeEach(() => {
    mkdirIcons()
    iconFile = join(iconsDir, 'game-1.png')
    writeAtT0(iconFile, 'AAAA')
    mockedGetStoredGames.mockReturnValue([baseGame(iconFile)])
  })

  it('hit: segunda chamada devolve o valor cacheado mesmo com bytes diferentes no disco', () => {
    const primeira = getGameIcon('game-1')
    expect(primeira).toBe(dataUrlOf('AAAA'))
    // Reescreve o arquivo com bytes diferentes, mesmo tamanho e MESMO mtime.
    writeAtT0(iconFile, 'BBBB')
    const segunda = getGameIcon('game-1')
    expect(segunda).toBe(primeira)
  })

  it('miss: arquivo modificado (tamanho) → re-lê e serve o novo conteúdo', () => {
    expect(getGameIcon('game-1')).toBe(dataUrlOf('AAAA'))
    writeFileSync(iconFile, 'AAAA-MAIOR') // muda o tamanho
    expect(getGameIcon('game-1')).toBe(dataUrlOf('AAAA-MAIOR'))
  })

  it('miss: mtime mudou → re-lê e serve o novo conteúdo', () => {
    expect(getGameIcon('game-1')).toBe(dataUrlOf('AAAA'))
    writeAtT0(iconFile, 'BBBB')
    utimesSync(iconFile, T0 + 60, T0 + 60) // mesmo conteúdo-de-tamanho, mtime novo
    expect(getGameIcon('game-1')).toBe(dataUrlOf('BBBB'))
  })

  it('extractIconPng invalida a entrada: ícone restaurado aparece sem reiniciar', async () => {
    expect(getGameIcon('game-1')).toBe(dataUrlOf('AAAA'))
    electronMod.getFileIcon.mockResolvedValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('BBBB') // mesmo tamanho para provar que foi a invalidação
    })
    const exePath = join(userDataDir, 'jogo.exe')
    writeFileSync(exePath, 'x')
    const ok = await extractIconPng(exePath, iconFile)
    expect(ok).toBe(true)
    // Força o mtime de volta a T0: sem a invalidação, o cache serviria 'AAAA'.
    utimesSync(iconFile, T0, T0)
    expect(getGameIcon('game-1')).toBe(dataUrlOf('BBBB'))
  })

  it('deleteCachedIcon remove o arquivo e o cache: jogo sem ícone volta a null', () => {
    expect(getGameIcon('game-1')).toBe(dataUrlOf('AAAA'))
    deleteCachedIcon(baseGame(iconFile))
    expect(existsSync(iconFile)).toBe(false)
    expect(getGameIcon('game-1')).toBeNull()
  })
})
