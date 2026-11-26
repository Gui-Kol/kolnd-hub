import { describe, expect, it, vi } from 'vitest'
import { searchFiles, type SearchDirent, type SearchFs } from './search'

/**
 * Pesquisa (T4) em árvore fake: nenhum arquivo real é lido/varrido.
 */

function file(name: string): SearchDirent {
  return {
    name,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false
  }
}

function dir(name: string): SearchDirent {
  return {
    name,
    isFile: () => false,
    isDirectory: () => true,
    isSymbolicLink: () => false
  }
}

function createFs(tree: Record<string, SearchDirent[]>) {
  const readdir = vi.fn(async (path: string) => {
    const entries = tree[path]
    if (!entries) throw new Error('ENOENT')
    return entries
  })
  return { fs: { readdir } as SearchFs, readdir }
}

describe('pesquisa de arquivos', () => {
  it('respeita a profundidade máxima 6', async () => {
    const tree: Record<string, SearchDirent[]> = {}
    let current = 'C:\\Docs'
    for (let depth = 0; depth <= 7; depth += 1) {
      tree[current] = [file(`alvo-d${depth}.txt`)]
      if (depth < 7) {
        tree[current].push(dir(`d${depth + 1}`))
        current = `${current}\\d${depth + 1}`
      }
    }
    const { fs } = createFs(tree)

    const result = await searchFiles({ fs, allowedRoots: ['C:\\Docs'] }, { query: 'alvo' })

    expect(result.timedOut).toBe(false)
    expect(result.results.map((item) => item.name)).toContain('alvo-d6.txt')
    expect(result.results.map((item) => item.name)).not.toContain('alvo-d7.txt')
    expect(result.results.every((item) => item.depth <= 6)).toBe(true)
  })

  it('não entra em AppData nem em node_modules', async () => {
    const tree: Record<string, SearchDirent[]> = {
      'C:\\Users\\Ana': [dir('AppData'), dir('node_modules'), file('alvo.txt')],
      'C:\\Users\\Ana\\AppData': [file('alvo-escondido.txt')],
      'C:\\Users\\Ana\\node_modules': [file('alvo-pacote.txt')]
    }
    const { fs, readdir } = createFs(tree)

    const result = await searchFiles({ fs, allowedRoots: ['C:\\Users\\Ana'] }, { query: 'alvo' })

    expect(result.results.map((item) => item.path)).toEqual(['C:\\Users\\Ana\\alvo.txt'])
    expect(readdir).not.toHaveBeenCalledWith('C:\\Users\\Ana\\AppData', expect.anything())
    expect(readdir).not.toHaveBeenCalledWith('C:\\Users\\Ana\\node_modules', expect.anything())
  })

  it('timeout aborta e devolve parciais', async () => {
    const tree: Record<string, SearchDirent[]> = {
      'C:\\Docs': [file('alvo-1.txt'), file('alvo-2.txt')]
    }
    const { fs } = createFs(tree)
    let call = 0
    const now = () => {
      const value = call === 3 ? 20_000 : 0
      call += 1
      return value
    }

    const result = await searchFiles(
      { fs, allowedRoots: ['C:\\Docs'], now, timeoutMs: 10_000 },
      { query: 'alvo' }
    )

    expect(result.timedOut).toBe(true)
    expect(result.results).toHaveLength(1)
  })

  it('limita a 200 resultados e marca truncado', async () => {
    const files = Array.from({ length: 250 }, (_unused, index) => file(`alvo-${index}.txt`))
    const { fs } = createFs({ 'C:\\Docs': files })

    const result = await searchFiles(
      { fs, allowedRoots: ['C:\\Docs'] },
      { query: 'alvo', maxResults: 500 }
    )

    expect(result.results).toHaveLength(200)
    expect(result.truncated).toBe(true)
  })
})
