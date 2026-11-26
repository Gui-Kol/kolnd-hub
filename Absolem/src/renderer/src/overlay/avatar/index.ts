/**
 * Ponto de entrada do avatar holográfico.
 *
 * Este módulo (e tudo o que ele importa, incluindo `three`) só pode ser
 * carregado por `import()` dinâmico a partir da rota `#overlay`; a janela
 * principal nunca paga o custo desse chunk.
 */
import { createAvatarScene } from './scene'
import type { AvatarHandle, AvatarMetrics, AvatarSceneOptions } from './scene'

export type { AvatarHandle, AvatarMetrics, AvatarSceneOptions }

/**
 * Monta a cena no canvas do overlay e centraliza o fallback visual: se o
 * backend WebGL falhar, a classe `overlay-avatar--fallback` troca o canvas pela
 * silhueta estática em CSS, mantendo a mesma área e os mesmos `pointer-events`.
 */
export function mountAvatar(
  canvas: HTMLCanvasElement,
  options: AvatarSceneOptions = {}
): AvatarHandle {
  const host = canvas.parentElement
  return createAvatarScene(canvas, {
    ...options,
    onFallback: (reason) => {
      host?.classList.add('overlay-avatar--fallback')
      options.onFallback?.(reason)
    }
  })
}
