// Contexto de foco do Big Picture — registro declarativo de elementos
// focáveis (id → nó) e navegação espacial por direção.
//
// - Cada tela registra seus focáveis via `useFocusable(id)` (callback ref).
// - `moveFocus(dir)` aplica `nearestInDirection` sobre os rects correntes
//   (computados apenas na pressão da direção — nunca por frame).
// - Um `focusScope` (prefixo de id) confina a navegação a ids com aquele
//   prefixo — usado pelos overlays (ex.: `exit:`), mantendo o fundo inerte.
// - Mouse continua 100% operável: onMouseEnter/onFocus chamam `focus(id)` e
//   o visual de foco é idêntico ao do gamepad.
//
// Contrato do anel de foco do Big Picture (gates 13.2/13.17): ~4 px sobre
// --focus-ring — estendido para uso 10-foot/TV e consistente entre gamepad,
// teclado e mouse. A regra global de `:focus-visible` (index.css, 2 px) segue
// como base; os componentes do BP somam `BP_FOCUS_RING` no focus-visible e o
// mesmo anel de 4 px quando `focused` (gamepad/hover) está ativo.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefCallback } from 'react'
import { nearestInDirection } from '../lib/spatialNav'
import type { SpatialDirection } from '../lib/spatialNav'

/**
 * Anel de foco estendido do Big Picture (~4 px sobre --focus-ring, gate
 * 13.2/13.17) — alto contraste e idêntico para gamepad, teclado e mouse.
 * Use junto a `focus:outline-none` nos interativos do BP e replique com
 * `ring-4 ring-[var(--focus-ring)]` quando o estado vier de `focused`
 * (useFocusable), não de :focus-visible.
 */
export const BP_FOCUS_RING = 'focus-visible:ring-4 focus-visible:ring-[var(--focus-ring)]'

/** Idêntico a BP_FOCUS_RING aplicado a um estado `focused` do useFocusable. */
export const BP_FOCUSED_RING = 'ring-4 ring-[var(--focus-ring)]'

export type { SpatialDirection }

/** Descreve um focável para anúncio de leitor de tela (formato curto pt-BR). */
export type FocusDescriber = () => string | null

export interface BigPictureFocusContextValue {
  /** Id do focável atualmente com foco (mouse ou controle). */
  focusedId: string | null
  setFocusedId: (id: string | null) => void
  registerFocusable: (id: string, node: HTMLElement | null) => void
  unregisterFocusable: (id: string) => void
  /** Move o foco na direção. Retorna true se o foco mudou de fato. */
  moveFocus: (dir: SpatialDirection) => boolean
  /** Ativa o elemento focado (click no nó registrado). */
  activateFocused: () => void
  /** Confina a navegação/ativação a ids com este prefixo. `null` remove o limite. */
  setFocusScope: (scope: string | null) => void
  /** Foca o primeiro focável registrado com o prefixo. Retorna true se focou. */
  focusFirstMatching: (prefix: string) => boolean
  /** Registra (ou remove, com `null`) o descritor de anúncio de um id. */
  registerDescribe: (id: string, describe: FocusDescriber | null) => void
  /** Fala atual do id (chamada na mudança de foco) ou `null` se sem descritor/erro. */
  describeId: (id: string) => string | null
}

const BigPictureFocusContext = createContext<BigPictureFocusContextValue | null>(null)

export function useBigPictureFocus(): BigPictureFocusContextValue {
  const ctx = useContext(BigPictureFocusContext)
  if (!ctx) {
    throw new Error('useBigPictureFocus deve ser usado dentro de <BigPictureFocusProvider>')
  }
  return ctx
}

export function BigPictureFocusProvider({ children }: { children: ReactNode }): JSX.Element {
  const [focusedId, setFocusedIdState] = useState<string | null>(null)
  const focusedIdRef = useRef<string | null>(null)
  const scopeRef = useRef<string | null>(null)
  // id → nó (callback refs). A ordem de inserção reflete a ordem do mount.
  const nodesRef = useRef(new Map<string, HTMLElement>())
  // id → descritor de anúncio (useFocusable passa o segundo argumento).
  // Closures sobre estado vivo do componente — re-registradas a cada render.
  const describersRef = useRef(new Map<string, FocusDescriber>())

  const setFocusedId = useCallback((id: string | null): void => {
    focusedIdRef.current = id
    setFocusedIdState(id)
  }, [])

  const registerFocusable = useCallback((id: string, node: HTMLElement | null): void => {
    if (node) {
      nodesRef.current.set(id, node)
    } else {
      nodesRef.current.delete(id)
      // Se o nó que sumiu detinha o foco, limpa o estado.
      if (focusedIdRef.current === id) {
        focusedIdRef.current = null
        setFocusedIdState(null)
      }
    }
  }, [])

  const unregisterFocusable = useCallback((id: string): void => {
    nodesRef.current.delete(id)
    if (focusedIdRef.current === id) {
      focusedIdRef.current = null
      setFocusedIdState(null)
    }
  }, [])

  const setFocusScope = useCallback((scope: string | null): void => {
    scopeRef.current = scope
  }, [])

  const visibleEntries = useCallback((scope: string | null): [string, HTMLElement][] => {
    const entries: [string, HTMLElement][] = []
    for (const [id, node] of nodesRef.current) {
      // Nós desconectados do DOM (ex.: seção trocada) são pulados.
      if (!node.isConnected) continue
      if (scope && !id.startsWith(scope)) continue
      entries.push([id, node])
    }
    return entries
  }, [])

  const moveFocus = useCallback(
    (dir: SpatialDirection): boolean => {
      const scope = scopeRef.current
      const entries = visibleEntries(scope)
      if (entries.length === 0) return false

      const currentId = focusedIdRef.current
      const currentInScope = currentId !== null && (!scope || currentId.startsWith(scope))
      const fromNode = currentInScope ? nodesRef.current.get(currentId) : undefined
      const fromRect = fromNode?.getBoundingClientRect()

      if (!fromRect) {
        // Nada focado (ou fora do escopo): foca o primeiro visível.
        const first = entries[0]
        if (first) {
          setFocusedId(first[0])
          return true
        }
        return false
      }

      const candidates = entries
        .filter(([id]) => id !== currentId)
        .map(([id, node]) => ({ id, rect: node.getBoundingClientRect() }))

      const next = nearestInDirection(fromRect, candidates, dir)
      if (next) {
        setFocusedId(next)
        return true
      }
      return false
    },
    [visibleEntries, setFocusedId]
  )

  const activateFocused = useCallback((): void => {
    const scope = scopeRef.current
    const id = focusedIdRef.current
    if (!id) return
    if (scope && !id.startsWith(scope)) return
    nodesRef.current.get(id)?.click()
  }, [])

  const focusFirstMatching = useCallback(
    (prefix: string): boolean => {
      const entries = visibleEntries(prefix)
      const first = entries[0]
      if (!first) return false
      setFocusedId(first[0])
      return true
    },
    [visibleEntries, setFocusedId]
  )

  const registerDescribe = useCallback((id: string, describe: FocusDescriber | null): void => {
    if (describe) {
      describersRef.current.set(id, describe)
    } else {
      describersRef.current.delete(id)
    }
  }, [])

  const describeId = useCallback((id: string): string | null => {
    const describe = describersRef.current.get(id)
    if (!describe) return null
    // Um descritor que lança (ex.: lista trocada no meio do render) não pode
    // derrubar a navegação — nesse caso, simplesmente não fala nada.
    try {
      return describe()
    } catch {
      return null
    }
  }, [])

  const value = useMemo<BigPictureFocusContextValue>(
    () => ({
      focusedId,
      setFocusedId,
      registerFocusable,
      unregisterFocusable,
      moveFocus,
      activateFocused,
      setFocusScope,
      focusFirstMatching,
      registerDescribe,
      describeId
    }),
    [
      focusedId,
      setFocusedId,
      registerFocusable,
      unregisterFocusable,
      moveFocus,
      activateFocused,
      setFocusScope,
      focusFirstMatching,
      registerDescribe,
      describeId
    ]
  )

  return <BigPictureFocusContext.Provider value={value}>{children}</BigPictureFocusContext.Provider>
}

/**
 * Registra um elemento como focável (callback ref + foco via mouse/hover).
 * O visual de foco é idêntico para mouse e gamepad (`focused`).
 *
 * `describe` (opcional) alimenta o anúncio de leitor de tela quando este
 * elemento ganha foco — ver lib/useAnnouncer. É chamado no momento da mudança
 * de foco, então pode ler estado vivo do componente (lista, índice, total).
 */
export function useFocusable(
  id: string,
  describe?: FocusDescriber
): {
  ref: RefCallback<HTMLElement>
  focused: boolean
  focus: () => void
} {
  const { focusedId, setFocusedId, registerFocusable, registerDescribe } = useBigPictureFocus()

  // A callback ref é a única fonte da verdade: React chama com o nó no mount
  // e com `null` no unmount (remova a entrada do mapa). NÃO use um efeito
  // "reserva" para desregistrar — no StrictMode (dev) o cleanup do useEffect
  // roda DEPOIS do re-attach da ref, deletando o nó do mapa enquanto ele
  // continua montado: o gamepad toca o som mas nenhuma ação encontra o nó.
  const ref = useCallback<RefCallback<HTMLElement>>(
    (node) => {
      registerFocusable(id, node)
    },
    [id, registerFocusable]
  )

  // Descritor re-registrado a cada render (on purpose): a closure passa a
  // enxergar o estado vivo mais recente (ex.: lista de jogos e índice).
  // Efeito sem array de dependências + cleanup que remove — nunca fica
  // descritor obsoleto no mapa.
  useEffect(() => {
    if (!describe) return undefined
    registerDescribe(id, describe)
    return (): void => {
      registerDescribe(id, null)
    }
  })

  const focus = useCallback((): void => setFocusedId(id), [id, setFocusedId])

  return { ref, focused: focusedId === id, focus }
}
