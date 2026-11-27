import { Vector3 } from 'three'

/**
 * Esqueleto de ancoragens do personagem, independente de geometria.
 *
 * Origem: (0, 0, 0) no centro do corpo (entre o quadril e o tórax).
 * Orientação: Y para cima, Z para a câmera (frente do personagem), X para a
 * direita de quem olha.
 *
 * As coordenadas são múltiplos do raio unitário `u`: `u = 1` equivale ao raio
 * do corpo (`PartContext.radius`). Nenhuma parte deve repetir esses números:
 * use `scaleSkeleton(radius)` para obter as âncoras em unidades de mundo.
 *
 * O corpo sentado cresce para cima a partir de `hips`; `head` fica acima de
 * `neck`; mãos ficam à frente do abdômen (`z > bellyCenter.z`). A cauda sai de
 * `hips` e termina em `tailTip`, enrolada para dentro.
 */
export const SKELETON = {
  tailTip: new Vector3(-1.62, -3.36, 0.22),
  hips: new Vector3(0, -3.55, 0),
  bellyCenter: new Vector3(0, -1.65, 0.55),
  chest: new Vector3(0, 0.65, 0.18),
  neck: new Vector3(0, 2.7, -0.28),
  shoulderLeft: new Vector3(-0.95, 1.55, 0.08),
  shoulderRight: new Vector3(0.95, 1.55, 0.08),
  head: new Vector3(0.45, 3.6, -0.28),
  handLeft: new Vector3(-1.15, -0.25, 1.25),
  handRight: new Vector3(1.15, -0.25, 1.25),
  footBackLeft: new Vector3(-1.05, -4.0, 0.35),
  footBackRight: new Vector3(1.05, -4.0, 0.35),
  footFrontLeft: new Vector3(-0.5, -4.0, 1.1),
  footFrontRight: new Vector3(0.5, -4.0, 1.1)
} as const

export type Skeleton = { -readonly [Key in keyof typeof SKELETON]: Vector3 }

/**
 * Devolve uma cópia do esqueleto escalada por `unit` (o raio do corpo). O
 * original nunca é mutado e cada âncora é um `Vector3` novo e independente.
 */
export function scaleSkeleton(unit: number): Skeleton {
  const factor = Number.isFinite(unit) && unit > 0 ? unit : 1
  const scaled = {} as Skeleton

  for (const key of Object.keys(SKELETON) as Array<keyof Skeleton>) {
    scaled[key] = SKELETON[key].clone().multiplyScalar(factor)
  }

  return scaled
}
