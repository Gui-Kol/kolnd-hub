import { Vector3 } from 'three'

/**
 * Enquadramento automático da câmera (task 22, T2/T3).
 *
 * O alvo é o centro do bounding box do personagem inteiro, não a origem do
 * `root`: o cachimbo e a cauda deixam o conjunto assimétrico, e enquadrar pela
 * origem cortaria uma das pontas. A distância é calculada a partir do FOV
 * vertical e do aspect para que os oito cantos do box caibam com margem, em
 * vez de manter uma posição de câmera fixa calibrada para a lagarta horizontal.
 *
 * O módulo é puro: não toca em DOM, cena, câmera nem em `Box3`; recebe só
 * números e devolve alvo/distância. Quem aplica em `camera.position`/`lookAt` é
 * `scene.ts`, uma vez no build e de novo a cada `resize` (sem recalcular box).
 */

/** Margem de segurança: o box ocupa até 92% da altura/largura úteis. */
export const FRAMING_MARGIN = 0.08

/**
 * Yaw do eixo de visão em direção ao lado do cachimbo (X positivo), em graus.
 * Dá volume ao rosto sem virar perfil: o olho esquerdo e a mangueira continuam
 * visíveis. Mantido dentro da faixa 12-18 graus pedida pela task.
 */
export const FRAMING_YAW_DEG = 15

export interface FramingBounds {
  min: Vector3
  max: Vector3
}

export interface FramingOptions {
  /** FOV vertical da câmera, em graus (o global da cena é 42). */
  fovDeg: number
  /** Fração de folga em relação ao quadro: 0.06 a 0.08. */
  margin?: number
  /** Yaw do eixo de visão; default `FRAMING_YAW_DEG`. */
  yawDeg?: number
}

export interface Framing {
  /** Centro do bounding box, em espaço da cena. */
  target: Vector3
  /** Distância da câmera ao alvo ao longo do eixo de visão. */
  distance: number
}

const UP = new Vector3(0, 1, 0)

function clampMargin(margin: number | undefined): number {
  if (typeof margin !== 'number' || !Number.isFinite(margin)) return FRAMING_MARGIN
  return Math.min(0.2, Math.max(0, margin))
}

/** Direção unitária do alvo para a câmera, com yaw em torno de Y. */
export function framingCameraOffset(yawDeg: number = FRAMING_YAW_DEG): Vector3 {
  const yaw = ((Number.isFinite(yawDeg) ? yawDeg : FRAMING_YAW_DEG) * Math.PI) / 180
  return new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).normalize()
}

/**
 * Calcula o centro do box e a menor distância que mantém os oito cantos dentro
 * do quadro com a margem pedida, para o aspect informado.
 *
 * Para cada canto, em espaço de câmera, a folga necessária é
 * `|eixo| / ((1 - margem) * tan(fov/2) * escalaDoEixo)`. A distância final é a
 * maior entre os cantos, então o lado mais apertado (altura ou largura) define
 * o enquadramento.
 */
export function computeFraming(
  bounds: FramingBounds,
  aspect: number,
  options: FramingOptions
): Framing {
  const target = new Vector3().addVectors(bounds.min, bounds.max).multiplyScalar(0.5)
  const safeAspect = typeof aspect === 'number' && aspect > 0 ? aspect : 1
  const fovDeg = Number.isFinite(options.fovDeg) ? options.fovDeg : 42
  const margin = clampMargin(options.margin)
  const yawDeg = Number.isFinite(options.yawDeg) ? (options.yawDeg as number) : FRAMING_YAW_DEG
  const offset = framingCameraOffset(yawDeg)

  // Base da câmera: `offset` aponta do alvo para a câmera; `forward` olha de
  // volta para o alvo.
  const forward = offset.clone().negate()
  const right = new Vector3().crossVectors(forward, UP).normalize()
  const up = new Vector3().crossVectors(right, forward).normalize()

  const tanVertical = Math.tan((fovDeg * Math.PI) / 180 / 2)
  const tanHorizontal = tanVertical * safeAspect
  const usable = Math.max(0.01, 1 - margin)
  const limitVertical = usable * tanVertical
  const limitHorizontal = usable * tanHorizontal

  let distance = 0
  const corner = new Vector3()
  for (let ix = 0; ix < 2; ix += 1) {
    for (let iy = 0; iy < 2; iy += 1) {
      for (let iz = 0; iz < 2; iz += 1) {
        corner.set(
          ix === 0 ? bounds.min.x : bounds.max.x,
          iy === 0 ? bounds.min.y : bounds.max.y,
          iz === 0 ? bounds.min.z : bounds.max.z
        )
        corner.sub(target)
        // Profundidade do canto em relação à câmera: d - dot(corner, offset).
        const along = corner.dot(offset)
        const horizontal = Math.abs(corner.dot(right))
        const vertical = Math.abs(corner.dot(up))
        distance = Math.max(
          distance,
          along + vertical / limitVertical,
          along + horizontal / limitHorizontal
        )
      }
    }
  }

  return { target, distance }
}
