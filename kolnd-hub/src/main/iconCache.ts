import { Stats } from 'fs'
import { resolve } from 'path'

/** Capacidade fixa do cache LRU de ícones (entradas, não bytes). */
export const ICON_CACHE_MAX = 100

/**
 * Cache LRU minimalista em memória: Map com reinserção no fim a cada acesso,
 * fazendo a cabeça do Map ser sempre o item menos recentemente usado.
 */
export class LruCache<V> {
  private readonly entries = new Map<string, V>()

  constructor(private readonly maxSize: number = ICON_CACHE_MAX) {
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      throw new RangeError('LruCache: a capacidade deve ser um inteiro >= 1.')
    }
  }

  get size(): number {
    return this.entries.size
  }

  get(key: string): V | undefined {
    const value = this.entries.get(key)
    if (value === undefined) return undefined
    // Renova a recência reinserindo no fim do Map.
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  set(key: string, value: V): void {
    this.entries.delete(key)
    this.entries.set(key, value)
    while (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
  }

  delete(key: string): boolean {
    return this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }

  keys(): IterableIterator<string> {
    return this.entries.keys()
  }
}

/** Instância única do processo principal — os ícones valem para todos os jogos. */
const dataUrlCache = new LruCache<string>(ICON_CACHE_MAX)

/** Chave do cache: caminho resolvido + assinatura do conteúdo (mtime/tamanho). */
function keyFor(filePath: string, stat: Pick<Stats, 'mtimeMs' | 'size'>): string {
  return `${resolve(filePath)}:${stat.mtimeMs}:${stat.size}`
}

/**
 * Remove todas as entradas conhecidas de um arquivo (qualquer mtime/tamanho).
 * Usada após escritas/remoções de ícone — nunca lança.
 */
export function invalidateIconCache(filePath: string): void {
  try {
    const prefix = `${resolve(filePath)}:`
    for (const key of [...dataUrlCache.keys()]) {
      if (key.startsWith(prefix)) dataUrlCache.delete(key)
    }
  } catch {
    // Caminho inválido — nada a invalidar.
  }
}

/** Esvazia o cache inteiro (ex.: diagnósticos/testes). */
export function clearIconCache(): void {
  dataUrlCache.clear()
}

/**
 * Busca a data URL do arquivo no cache usando um `stat` já obtido pelo chamador.
 * Na miss, remove as entradas antigas do mesmo arquivo (mtime/tamanho mudou),
 * para que não fiquem mortas ocupando espaço.
 */
export function lookupIconDataUrl(
  filePath: string,
  stat: Pick<Stats, 'mtimeMs' | 'size'>
): string | null {
  const key = keyFor(filePath, stat)
  const hit = dataUrlCache.get(key)
  if (hit !== undefined) return hit
  invalidateIconCache(filePath)
  return null
}

/** Grava a data URL no cache sob a assinatura (mtime/tamanho) atual do arquivo. */
export function storeIconDataUrl(
  filePath: string,
  stat: Pick<Stats, 'mtimeMs' | 'size'>,
  dataUrl: string
): void {
  dataUrlCache.set(keyFor(filePath, stat), dataUrl)
}
