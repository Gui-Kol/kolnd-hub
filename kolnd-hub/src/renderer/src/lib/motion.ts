// lib/motion — padrão único de movimento acessível do Hub (tarefa 2.0/8.4).
//
// `useReducedMotion()` do framer-motion encapsula
// `matchMedia('(prefers-reduced-motion: reduce)')` e reage a mudanças em tempo
// real — é a via preferida (framer-motion já é dependência; zero deps novas).
//
// Regra do padrão:
//   • Animação DECORATIVA (entrada/stagger, spring, scale, slide, hover-lift)
//     vira fade puro de 200 ms quando reduce está ativo — ou some.
//   • Animação FUNCIONAL (spinner, barra de progresso, feedback de uma ação do
//     usuário) permanece; no máximo troca por transição curta.
//   • Com reduce DESLIGADO, tudo fica idêntico ao comportamento anterior —
//     os helpers só entram no lugar dos valores originais.
//
// Exemplo de uso:
//   const reduced = useReducedMotion()
//   <motion.div {...entranceProps(reduced, { y: 20, scale: 0.95 }, { duration: 0.4 })} />
//   <motion.div exit={exitProps(reduced, { y: 10, scale: 0.95 })} />
//   <motion.div whileTap={reduced ? undefined : { scale: 0.98 }} />

import { useReducedMotion } from 'framer-motion'
import type { Target, Transition } from 'framer-motion'

// Re-exporta o hook para que os componentes importem um único módulo.
export { useReducedMotion }

/** Fade puro de 200 ms — único movimento permitido com reduce ativo. */
export const fadeOnlyTransition: Transition = { duration: 0.2, ease: 'easeOut' }

export interface EntranceOptions {
  /** Deslocamento vertical inicial em px (ignorado com reduce). */
  y?: number
  /** Deslocamento horizontal inicial em px (ignorado com reduce). */
  x?: number
  /** Escala inicial (ignorada com reduce). */
  scale?: number
}

export interface EntranceProps {
  initial: Target
  animate: Target
  transition: Transition | undefined
}

/**
 * Props `initial`/`animate`/`transition` para entradas decorativas.
 * Com reduce ativo: opacity 0→1 em 200 ms — nenhum transform, nenhum delay
 * (o stagger deixa de fazer sentido e some). Com reduce desligado: o
 * `fallbackTransition` (a transição original da tela) é preservado intacto.
 */
export function entranceProps(
  reduced: boolean | null,
  from: EntranceOptions = {},
  fallbackTransition?: Transition
): EntranceProps {
  if (reduced) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: fadeOnlyTransition
    }
  }
  const initial: Target = { opacity: 0 }
  const animate: Target = { opacity: 1 }
  if (from.y !== undefined) {
    initial.y = from.y
    animate.y = 0
  }
  if (from.x !== undefined) {
    initial.x = from.x
    animate.x = 0
  }
  if (from.scale !== undefined) {
    initial.scale = from.scale
    animate.scale = 1
  }
  return { initial, animate, transition: fallbackTransition }
}

/**
 * Alvo `exit` para saídas decorativas.
 * Com reduce ativo: só opacity 0 (o `AnimatePresence` desmonta na mesma
 * duração — a `transition` do elemento deve ser `fadeOnlyTransition` nesse caso;
 * os helpers acima já fazem isso quando a mesma transição cobre enter+exit).
 */
export function exitProps(reduced: boolean | null, to: EntranceOptions = {}): Target {
  if (reduced) {
    return { opacity: 0 }
  }
  const exit: Target = { opacity: 0 }
  if (to.y !== undefined) {
    exit.y = to.y
  }
  if (to.x !== undefined) {
    exit.x = to.x
  }
  if (to.scale !== undefined) {
    exit.scale = to.scale
  }
  return exit
}
