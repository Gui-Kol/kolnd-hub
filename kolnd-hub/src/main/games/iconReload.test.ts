import { describe, expect, it, vi } from 'vitest'
import type { StoredGame } from '../store'
import { refreshAllGameIcons, reloadMissingGameIcons } from './iconReload'

/** Jogo mínimo para os testes — só os campos usados pela varredura importam. */
function game(id: string): StoredGame {
  return {
    id,
    name: `Jogo ${id}`,
    exePath: `C:\\Jogos\\${id}\\jogo.exe`,
    iconPath: null,
    origin: 'custom',
    addedAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('reloadMissingGameIcons', () => {
  it('não extrai nada quando todos os ícones estão legíveis', async () => {
    const extract = vi.fn(async () => true)
    const result = await reloadMissingGameIcons({
      games: () => [game('a'), game('b')],
      iconOf: () => 'data:image/png;base64,AA==',
      targetOf: (g) => `icons/${g.id}.png`,
      exeOf: (g) => g.exePath,
      extract
    })

    expect(extract).not.toHaveBeenCalled()
    expect(result).toEqual({ checked: 2, reloaded: 0, failed: 0 })
  })

  it('re-extrai o ícone ilegível usando o exe e o destino do jogo', async () => {
    const extract = vi.fn(async () => true)
    const result = await reloadMissingGameIcons({
      games: () => [game('a')],
      iconOf: () => null,
      targetOf: (g) => `icons/${g.id}.png`,
      exeOf: (g) => g.exePath,
      extract
    })

    expect(extract).toHaveBeenCalledTimes(1)
    expect(extract).toHaveBeenCalledWith('C:\\Jogos\\a\\jogo.exe', 'icons/a.png')
    expect(result).toEqual({ checked: 1, reloaded: 1, failed: 0 })
  })

  it('conta como falha quando a extração não consegue gravar', async () => {
    const extract = vi.fn(async () => false)
    const result = await reloadMissingGameIcons({
      games: () => [game('a')],
      iconOf: () => null,
      targetOf: (g) => `icons/${g.id}.png`,
      exeOf: (g) => g.exePath,
      extract
    })

    expect(result).toEqual({ checked: 1, reloaded: 0, failed: 1 })
  })

  it('continua o laço quando a extração lança no primeiro jogo', async () => {
    const extract = vi.fn(async (exePath: string) => {
      if (exePath.includes('\\a\\')) throw new Error('exe sumiu')
      return true
    })
    const result = await reloadMissingGameIcons({
      games: () => [game('a'), game('b')],
      iconOf: () => null,
      targetOf: (g) => `icons/${g.id}.png`,
      exeOf: (g) => g.exePath,
      extract
    })

    expect(extract).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ checked: 2, reloaded: 1, failed: 1 })
  })

  it('devolve zeros com a biblioteca vazia', async () => {
    const extract = vi.fn(async () => true)
    const result = await reloadMissingGameIcons({
      games: () => [],
      iconOf: () => null,
      targetOf: () => 'icons/x.png',
      exeOf: () => 'C:\\x.exe',
      extract
    })

    expect(extract).not.toHaveBeenCalled()
    expect(result).toEqual({ checked: 0, reloaded: 0, failed: 0 })
  })

  it('resume legível, recarregado e falho na mesma passada', async () => {
    const extract = vi.fn(async (exePath: string) => !exePath.includes('\\c\\'))
    const result = await reloadMissingGameIcons({
      games: () => [game('a'), game('b'), game('c')],
      // 'a' está legível; 'b' é recarregado; 'c' falha.
      iconOf: (g) => (g.id === 'a' ? 'data:image/png;base64,AA==' : null),
      targetOf: (g) => `icons/${g.id}.png`,
      exeOf: (g) => g.exePath,
      extract
    })

    expect(extract).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ checked: 3, reloaded: 1, failed: 1 })
  })
})

describe('refreshAllGameIcons', () => {
  it('re-extrai TODOS os ícones e persiste uma única vez', async () => {
    const extract = vi.fn(async () => true)
    const persist = vi.fn((_games: StoredGame[]) => true)
    const cleanup = vi.fn()
    const result = await refreshAllGameIcons({
      games: () => [game('a'), game('b')],
      targetOf: (g) => `icons/${g.id}.png`,
      exeOf: (g) => g.exePath,
      extract,
      persist,
      cleanup
    })

    expect(extract).toHaveBeenCalledTimes(2)
    expect(persist).toHaveBeenCalledTimes(1)
    const saved = persist.mock.calls[0][0] as StoredGame[]
    expect(saved.map((g) => g.iconPath)).toEqual(['icons/a.png', 'icons/b.png'])
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ checked: 2, refreshed: 2, failed: 0 })
  })

  it('mantém o ícone antigo do jogo que falhou e persiste os demais', async () => {
    const extract = vi.fn(async (exePath: string) => !exePath.includes('\\b\\'))
    const persist = vi.fn((_games: StoredGame[]) => true)
    const cleanup = vi.fn()
    const result = await refreshAllGameIcons({
      games: () => [game('a'), game('b')],
      targetOf: (g) => `icons/${g.id}.png`,
      exeOf: (g) => g.exePath,
      extract,
      persist,
      cleanup
    })

    const saved = persist.mock.calls[0][0] as StoredGame[]
    expect(saved[0].iconPath).toBe('icons/a.png')
    expect(saved[1].iconPath).toBeNull()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ checked: 2, refreshed: 1, failed: 1 })
  })

  it('conta exceção da extração como falha e continua o laço', async () => {
    const extract = vi.fn(async (exePath: string) => {
      if (exePath.includes('\\a\\')) throw new Error('exe sumiu')
      return true
    })
    const result = await refreshAllGameIcons({
      games: () => [game('a'), game('b')],
      targetOf: (g) => `icons/${g.id}.png`,
      exeOf: (g) => g.exePath,
      extract,
      persist: () => true,
      cleanup: vi.fn()
    })

    expect(extract).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ checked: 2, refreshed: 1, failed: 1 })
  })

  it('persistência falhando = falha total e nenhum ícone antigo é apagado', async () => {
    const cleanup = vi.fn()
    const result = await refreshAllGameIcons({
      games: () => [game('a')],
      targetOf: (g) => `icons/${g.id}.png`,
      exeOf: (g) => g.exePath,
      extract: async () => true,
      persist: () => false,
      cleanup
    })

    expect(cleanup).not.toHaveBeenCalled()
    expect(result).toEqual({ checked: 1, refreshed: 0, failed: 1 })
  })

  it('persistência lançando também vira falha total, sem lançar', async () => {
    const cleanup = vi.fn()
    const result = await refreshAllGameIcons({
      games: () => [game('a')],
      targetOf: (g) => `icons/${g.id}.png`,
      exeOf: (g) => g.exePath,
      extract: async () => true,
      persist: () => {
        throw new Error('disco cheio')
      },
      cleanup
    })

    expect(cleanup).not.toHaveBeenCalled()
    expect(result).toEqual({ checked: 1, refreshed: 0, failed: 1 })
  })

  it('pula ícones manuais sem contá-los como falha', async () => {
    const extract = vi.fn(async () => true)
    const persist = vi.fn((_games: StoredGame[]) => true)
    const result = await refreshAllGameIcons({
      games: () => [{ ...game('a'), iconOrigin: 'manual' }, game('b')],
      targetOf: (g) => `icons/${g.id}.png`,
      exeOf: (g) => g.exePath,
      extract,
      isManual: (g) => g.iconOrigin === 'manual',
      persist,
      cleanup: vi.fn()
    })

    expect(extract).toHaveBeenCalledTimes(1)
    expect(extract).toHaveBeenCalledWith('C:\\Jogos\\b\\jogo.exe', 'icons/b.png')
    expect(result).toEqual({ checked: 2, refreshed: 1, failed: 0 })
    const saved = persist.mock.calls[0][0] as StoredGame[]
    expect(saved[0].iconOrigin).toBe('manual')
    expect(saved[0].iconPath).toBeNull()
  })

  it('meshcla metaOf no jogo persistido (identidade do cofre)', async () => {
    const sha = 'a'.repeat(64)
    const persist = vi.fn((_games: StoredGame[]) => true)
    await refreshAllGameIcons({
      games: () => [game('a')],
      targetOf: (g) => `icons/${g.id}.png`,
      exeOf: (g) => g.exePath,
      extract: async () => true,
      metaOf: () => ({ iconSha: sha, iconExt: '.png', iconOrigin: 'derived' }),
      persist,
      cleanup: vi.fn()
    })

    const saved = persist.mock.calls[0][0] as StoredGame[]
    expect(saved[0]).toMatchObject({
      iconPath: 'icons/a.png',
      iconSha: sha,
      iconExt: '.png',
      iconOrigin: 'derived'
    })
  })

  it('biblioteca só de manuais não extrai nem persiste', async () => {
    const extract = vi.fn(async () => true)
    const persist = vi.fn(() => true)
    const result = await refreshAllGameIcons({
      games: () => [{ ...game('a'), iconOrigin: 'manual' }],
      targetOf: (g) => `icons/${g.id}.png`,
      exeOf: (g) => g.exePath,
      extract,
      isManual: () => true,
      persist,
      cleanup: vi.fn()
    })

    expect(extract).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    expect(result).toEqual({ checked: 1, refreshed: 0, failed: 0 })
  })

  it('biblioteca vazia devolve zeros sem tocar no store', async () => {
    const persist = vi.fn(() => true)
    const cleanup = vi.fn()
    const result = await refreshAllGameIcons({
      games: () => [],
      targetOf: () => 'icons/x.png',
      exeOf: () => 'C:\\x.exe',
      extract: vi.fn(async () => true),
      persist,
      cleanup
    })

    expect(persist).not.toHaveBeenCalled()
    expect(cleanup).not.toHaveBeenCalled()
    expect(result).toEqual({ checked: 0, refreshed: 0, failed: 0 })
  })
})
