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

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ReactNode, RefCallback } from 'react'
import { nearestInDirection } from '../lib/spatialNav'
import type { SpatialDirection } from '../lib/spatialNav'

export type { SpatialDirection }

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
}

const BigPictureFocusContext = createContext<BigPictureFocusContextValue | null>(null)

export function useBigPictureFocus(): BigPictureFocusContextValue {
  const ctx = useContext(BigPictureFocusContext)
  if (!ctx) {
    throw new Error('useBigPictureFocus deve ser usado dentro de <BigPictureFocusProvider>')
  }
  return ctx
}

export function BigPictureFocusProvider({
  children
}: {
  children: ReactNode
}): JSX.Element {
  const [focusedId, setFocusedIdState] = useState<string | null>(null)
  const focusedIdRef = useRef<string | null>(null)
  const scopeRef = useRef<string | null>(null)
  // id → nó (callback refs). A ordem de inserção reflete a ordem do mount.
  const nodesRef = useRef(new Map<string, HTMLElement>())

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

  const value = useMemo<BigPictureFocusContextValue>(
    () => ({
      focusedId,
      setFocusedId,
      registerFocusable,
      unregisterFocusable,
      moveFocus,
      activateFocused,
      setFocusScope,
      focusFirstMatching
    }),
    [
      focusedId,
      setFocusedId,
      registerFocusable,
      unregisterFocusable,
      moveFocus,
      activateFocused,
      setFocusScope,
      focusFirstMatching
    ]
  )

  return (
    <BigPictureFocusContext.Provider value={value}>{children}</BigPictureFocusContext.Provider>
  )
}

/**
 * Registra um elemento como focável (callback ref + foco via mouse/hover).
 * O visual de foco é idêntico para mouse e gamepad (`focused`).
 */
export function useFocusable(id: string): {
  ref: RefCallback<HTMLElement>
  focused: boolean
  focus: () => void
} {
  const { focusedId, setFocusedId, registerFocusable } =
    useBigPictureFocus()

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

  const focus = useCallback((): void => setFocusedId(id), [id, setFocusedId])

  return { ref, focused: focusedId === id, focus }
}
