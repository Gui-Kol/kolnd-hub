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

/** Telas ordenadas por `displayId`. */
export async function listScreens(
  deps: CaptureSourcesDeps = defaultDeps()
): Promise<CaptureSource[]> {
  const sources = await listSources(deps)
  return sources.filter((source) => source.kind === 'screen').sort(compareScreens)
}

/** Janelas na ordem devolvida pelo sistema, sem fontes sem nome. */
export async function listWindows(
  deps: CaptureSourcesDeps = defaultDeps()
): Promise<CaptureSource[]> {
  const sources = await listSources(deps)
  return sources.filter((source) => source.kind === 'window')
}
