/**
 * Ponto de entrada do avatar.
 *
 * A bola procedural roda em Canvas2D, sem `three`. Este módulo continua sendo
 * carregado por `import()` dinâmico apenas na rota `#overlay` e no preview da
 * aba Aparência; a janela principal não paga o custo do chunk.
 */
import { createAvatarBall } from './ball'
import type { AvatarHandle, AvatarMetrics, AvatarSceneOptions } from './ball'

export type { AvatarHandle, AvatarMetrics, AvatarSceneOptions }

/**
 * Monta a bola no canvas do overlay e centraliza o fallback visual: se o
 * Canvas2D falhar, a classe `overlay-avatar--fallback` troca o canvas pelo
 * desenho estático em SVG, mantendo a mesma área e os mesmos `pointer-events`.
 */
export function mountAvatar(
  canvas: HTMLCanvasElement,
  options: AvatarSceneOptions = {}
): AvatarHandle {
  const host = canvas.parentElement
  return createAvatarBall(canvas, {
    ...options,
    onFallback: (reason) => {
      host?.classList.add('overlay-avatar--fallback')
      options.onFallback?.(reason)
    }
  })
}
