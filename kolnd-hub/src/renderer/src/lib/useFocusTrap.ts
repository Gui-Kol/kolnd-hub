// Focus trap mínimo para os modais do Hub — prende o Tab/Shift+Tab dentro do
// painel, foca um elemento ao abrir e devolve o foco a quem abriu ao desmontar.
// Esc NÃO é tratado por padrão: cada modal reutiliza o handler de Esc existente
// (ou passa `onEscape`), porque a semântica de "quando fecha" varia por fase
// (ex.: desinstalação em andamento ignora Esc).
//
// Uso: `const trapRef = useFocusTrap({ ... })` e prenda `trapRef` no elemento
// do painel do modal. O callback-ref garante o hook mesmo quando o painel é
// montado condicionalmente dentro de um componente sempre montado — por isso
// ele retorna um ref em vez de receber um `RefObject`.
import { useCallback, useEffect, useRef, useState } from 'react'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

export interface UseFocusTrapOptions {
  /** Desliga o trap sem desmontar o componente (padrão: true). */
  active?: boolean
  /**
   * Muda a cada transição relevante do modal (ex.: fase confirm → running).
   * Quando o elemento focado sumiu (a fase desmontou os botões), refaz o foco
   * para o elemento com `[data-autofocus]` ou para o primeiro focável.
   */
  watch?: unknown
  /** Liga Esc ao trap — usado só onde o modal não tem handler próprio. */
  onEscape?: () => void
}

/**
 * Retorna o callback-ref que deve ser aplicado ao painel do modal.
 * @param options active/watch/onEscape — ver UseFocusTrapOptions.
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>({
  active = true,
  watch,
  onEscape
}: UseFocusTrapOptions = {}): (node: T | null) => void {
  const [panel, setPanel] = useState<T | null>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

  const refCallback = useCallback((node: T | null): void => {
    setPanel(node)
  }, [])

  // Devolve o foco a quem abriu o modal quando o painel desmonta. Declarado
  // ANTES do efeito de foco inicial: ele lê activeElement antes do foco ser
  // movido para dentro do modal (efeitos rodam na ordem de declaração).
  useEffect(() => {
    if (!panel) return
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    return (): void => {
      previouslyFocusedRef.current?.focus()
      previouslyFocusedRef.current = null
    }
  }, [panel])

  // Foco inicial: [data-autofocus] dentro do painel (ex.: Cancelar em modais
  // destrutivos); senão o primeiro focável — nunca o backdrop, que fica fora.
  useEffect(() => {
    if (!active || !panel) return
    // Se o foco já está dentro (re-render no meio da interação), não rouba.
    if (document.activeElement instanceof HTMLElement && panel.contains(document.activeElement)) {
      return
    }
    const preferred = panel.querySelector<HTMLElement>('[data-autofocus]')
    const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    const target = preferred ?? first
    if (target) {
      target.focus()
      return
    }
    // Painel sem focáveis: torna-o focável só para o foco não ficar perdido.
    if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1')
    panel.focus()
  }, [active, watch, panel])

  // Tab/Shift+Tab ciclam dentro do painel (captura, antes de qualquer handler).
  useEffect(() => {
    if (!active || !panel) return

    const getFocusable = (): HTMLElement[] =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el.tagName === 'INPUT' || el.tagName === 'SUMMARY'
      )

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const items = getFocusable()
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const inside = current !== null && panel.contains(current)
      if (event.shiftKey) {
        if (!inside || current === first) {
          event.preventDefault()
          last.focus()
        }
      } else if (!inside || current === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return (): void => document.removeEventListener('keydown', onKeyDown, true)
  }, [active, panel])

  // Esc opcional — só para modais sem handler próprio.
  useEffect(() => {
    if (!active || !onEscape) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onEscape()
    }
    document.addEventListener('keydown', onKeyDown)
    return (): void => document.removeEventListener('keydown', onKeyDown)
  }, [active, onEscape])

  return refCallback
}
