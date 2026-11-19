import { describe, expect, it, vi } from 'vitest'
import type { StoredGame } from '../store'
import { reloadMissingGameIcons } from './iconReload'

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
