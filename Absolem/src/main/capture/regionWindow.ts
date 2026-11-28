import type { RegionSelection, ScreenRect } from '../../shared/screen'
import { normalizeRegionSelection } from '../../shared/screen'

/**
 * Seleção de região (task 07, T5).
 *
 * Uma `BrowserWindow` transparente, sempre no topo, por display, com fundo
 * escurecido desenhado pelo renderer (`RegionSelectApp`). Esta parte do main é
 * pura e injetável: recebe os displays e a fábrica de janelas, e resolve a
 * promessa com `{ displayId, rect }` em DIPs locais ou `null` no cancelamento.
 *
 * Regras:
 * - uma seleção por vez;
 * - a janela é destruída em TODOS os caminhos (confirmar, cancelar, erro de
 *   criação e fechamento externo);
 * - `resolveSelection` valida o payload do renderer com o normalizador
 *   compartilhado; área menor que 32x32 é rejeitada sem fechar a janela.
 */

export interface RegionDisplay {
  id: string
  bounds: ScreenRect
}

export interface RegionWindowLike {
  destroy: () => void
  isDestroyed?: () => boolean
}

export interface RegionSelectorDeps {
  getDisplays: () => RegionDisplay[]
  createWindow: (display: RegionDisplay) => RegionWindowLike
}

export interface RegionSelector {
  /** Abre uma janela por display e resolve com a seleção ou `null`. */
  select: () => Promise<RegionSelection | null>
  /** Entrega o resultado do renderer. `false` mantém a seleção aberta. */
  resolveSelection: (input: unknown) => boolean
  /** Cancela (Esc, fechamento da janela ou `capture:cancel`). */
  cancel: () => void
  isOpen: () => boolean
}

export function createRegionSelector(deps: RegionSelectorDeps): RegionSelector {
  let pending: {
    resolve: (value: RegionSelection | null) => void
    windows: RegionWindowLike[]
  } | null = null

  const destroyAll = (windows: RegionWindowLike[]): void => {
    for (const window of windows) {
      try {
        if (window.isDestroyed?.() === true) continue
        window.destroy()
      } catch {
        // Janela já em processo de fechamento.
      }
    }
    windows.length = 0
  }

  const settle = (value: RegionSelection | null): boolean => {
    const current = pending
    if (!current) return false
    pending = null
    destroyAll(current.windows)
    current.resolve(value)
    return true
  }

  return {
    select(): Promise<RegionSelection | null> {
      if (pending) {
        return Promise.reject(new Error('Já existe uma seleção de região em andamento.'))
      }
      let displays: RegionDisplay[]
      try {
        displays = deps.getDisplays()
      } catch {
        return Promise.resolve(null)
      }
      if (!Array.isArray(displays) || displays.length === 0) return Promise.resolve(null)

      return new Promise<RegionSelection | null>((resolve) => {
        const windows: RegionWindowLike[] = []
        pending = { resolve, windows }
        try {
          for (const display of displays) {
            windows.push(deps.createWindow(display))
          }
        } catch {
          // Falha ao criar uma janela: nenhuma seleção fica aberta.
          settle(null)
        }
      })
    },

    resolveSelection(input: unknown): boolean {
      const selection = normalizeRegionSelection(input)
      if (!selection) return false
      return settle(selection)
    },

    cancel(): void {
      settle(null)
    },

    isOpen(): boolean {
      return pending !== null
    }
  }
}
