import { desktopCapturer } from 'electron'
import type { CaptureSource } from '../../shared/screen'

/**
 * Listagem de fontes de captura (task 07, T1).
 *
 * `desktopCapturer.getSources` roda apenas no main e devolve thumbnails. Aqui
 * só o thumbnail pequeno (320x180) é pedido, suficiente para a UI escolher a
 * tela/janela; a captura em resolução cheia acontece no renderer via
 * `getUserMedia` (T2) ou no fallback por thumbnail (grabService).
 *
 * Regras:
 * - fontes sem nome são descartadas;
 * - telas são ordenadas por `displayId` (numérico quando possível);
 * - `fetchWindowIcons` fica sempre `false`: nenhum ícone é necessário e o
 *   custo de extração é evitado.
 */

export const SOURCE_THUMBNAIL_SIZE = { width: 320, height: 180 } as const

/**
 * Captura de tela não usa thumbnail: pedir `0x0` evita gerar e reter as
 * miniaturas nativas de cada monitor (task 04).
 */
export const SCREEN_THUMBNAIL_SIZE = { width: 0, height: 0 } as const

export interface DesktopSourceLike {
  id?: unknown
  name?: unknown
  display_id?: unknown
}

export interface GetSourcesOptions {
  types: Array<'screen' | 'window'>
  thumbnailSize: { width: number; height: number }
  fetchWindowIcons: boolean
}

export interface CaptureSourcesDeps {
  getSources: (options: GetSourcesOptions) => Promise<DesktopSourceLike[]>
}

function defaultDeps(): CaptureSourcesDeps {
  return {
    getSources: (options) => desktopCapturer.getSources(options) as Promise<DesktopSourceLike[]>
  }
}

function toSource(raw: DesktopSourceLike, kind: CaptureSource['kind']): CaptureSource | null {
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!id || !name) return null
  const source: CaptureSource = { id, name, kind }
  if (kind === 'screen' && typeof raw.display_id === 'string' && raw.display_id.trim()) {
    source.displayId = raw.display_id.trim()
  }
  return source
}

function compareScreens(a: CaptureSource, b: CaptureSource): number {
  const left = Number(a.displayId)
  const right = Number(b.displayId)
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right
  return (a.displayId ?? '').localeCompare(b.displayId ?? '')
}

/** Fontes normalizadas (telas e janelas) numa única chamada ao desktopCapturer. */
export async function listSources(
  deps: CaptureSourcesDeps = defaultDeps()
): Promise<CaptureSource[]> {
  const raw = await deps.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { ...SOURCE_THUMBNAIL_SIZE },
    fetchWindowIcons: false
  })
  const sources: CaptureSource[] = []
  for (const source of Array.isArray(raw) ? raw : []) {
    const id = typeof source.id === 'string' ? source.id : ''
    const byId: CaptureSource['kind'] | null = id.startsWith('screen:')
      ? 'screen'
      : id.startsWith('window:')
        ? 'window'
        : null
    const kind: CaptureSource['kind'] =
      byId ??
      (typeof source.display_id === 'string' && source.display_id.trim() ? 'screen' : 'window')
    const normalized = toSource(source, kind)
    if (normalized) sources.push(normalized)
  }
  return sources
}

export function createScreenSourceCache(options: ScreenSourceCacheOptions): ScreenSourceCache {
  const ttlMs =
    typeof options.ttlMs === 'number' && options.ttlMs >= 0
      ? options.ttlMs
      : SCREEN_SOURCE_CACHE_TTL_MS
  const now = options.now ?? (() => Date.now())
  let cached: { at: number; key: string; screens: CaptureSource[] } | null = null
  let inFlight: Promise<CaptureSource[]> | null = null
  let lastWasCached = false

  const displayKey = (): string => {
    try {
      return options.getDisplayKey?.() ?? ''
    } catch {
      return ''
    }
  }

  return {
    list(): Promise<CaptureSource[]> {
      const key = displayKey()
      const at = now()
      if (cached && cached.key === key && at - cached.at < ttlMs) {
        lastWasCached = true
        return Promise.resolve(cached.screens)
      }
      if (inFlight) {
        lastWasCached = false
        return inFlight
      }
      lastWasCached = false
      const request = options.getScreens().then(
        (screens) => {
          cached = { at: now(), key, screens }
          return screens
        },
        (err: unknown) => {
          cached = null
          throw err
        }
      )
      inFlight = request.finally(() => {
        inFlight = null
      })
      return inFlight
    },
    invalidate(): void {
      cached = null
    },
    isCached: () => lastWasCached
  }
}

/** Telas ordenadas por `displayId`, sem thumbnails nem janelas. */
export async function listScreens(
  deps: CaptureSourcesDeps = defaultDeps()
): Promise<CaptureSource[]> {
  const raw = await deps.getSources({
    types: ['screen'],
    thumbnailSize: { ...SCREEN_THUMBNAIL_SIZE },
    fetchWindowIcons: false
  })
  const sources: CaptureSource[] = []
  for (const source of Array.isArray(raw) ? raw : []) {
    const id = typeof source.id === 'string' ? source.id : ''
    if (
      !id.startsWith('screen:') &&
      !(typeof source.display_id === 'string' && source.display_id)
    ) {
      continue
    }
    const normalized = toSource(source, 'screen')
    if (normalized) sources.push(normalized)
  }
  return sources.sort(compareScreens)
}

/** Janelas na ordem devolvida pelo sistema, sem fontes sem nome. */
export async function listWindows(
  deps: CaptureSourcesDeps = defaultDeps()
): Promise<CaptureSource[]> {
  const sources = await listSources(deps)
  return sources.filter((source) => source.kind === 'window')
}

export interface ScreenSourceCacheOptions {
  /** Listagem crua das telas (tipicamente `listScreens`). */
  getScreens: () => Promise<CaptureSource[]>
  /**
   * Assinatura do conjunto atual de monitores. Quando muda (monitor conectado,
   * removido ou outro conjunto), o cache é descartado mesmo dentro do TTL.
   */
  getDisplayKey?: () => string
  now?: () => number
  /** Reuso máximo da listagem; padrão 15 s. */
  ttlMs?: number
}

export interface ScreenSourceCache {
  list: () => Promise<CaptureSource[]>
  invalidate: () => void
  /** Somente para teste/observação: houve cache hit na última chamada? */
  isCached: () => boolean
}

export const SCREEN_SOURCE_CACHE_TTL_MS = 15_000
