import type { Group } from 'three'
import {
  EYELID_CLOSED_ROTATION,
  EYELID_IDLE_OPENNESS,
  EYELID_IDLE_ROTATION,
  EYELID_OPEN_ROTATION
} from './parts/head'

/**
 * Fechamento da pálpebra em repouso. A calota é uma casca esférica: a fração
 * de fechamento é o parâmetro da rotação, não a área visível coberta. O valor
 * abaixo é calibrado para cobrir cerca de 35% da área do olho em `idle`.
 */
export const IDLE_LID_CLOSURE =
  (EYELID_IDLE_ROTATION - EYELID_OPEN_ROTATION) / (EYELID_CLOSED_ROTATION - EYELID_OPEN_ROTATION)

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * Converte a abertura de expressão (1 = olho aberto) em fechamento da
 * pálpebra (0 = aberta, 1 = cobrindo o olho inteiro).
 *
 * Abaixo da abertura de repouso a pálpebra desce mais rápido; acima dela a
 * abertura total só acontece em `listening` (abertura 1). Piscar chega a 0 e
 * fecha por completo, como a curva de `expressions.ts` já entrega.
 */
export function lidClosureFromOpenness(openness: number): number {
  const value = clamp01(openness)
  if (value >= EYELID_IDLE_OPENNESS) {
    return ((1 - value) / (1 - EYELID_IDLE_OPENNESS)) * IDLE_LID_CLOSURE
  }
  return (
    IDLE_LID_CLOSURE +
    ((EYELID_IDLE_OPENNESS - value) / EYELID_IDLE_OPENNESS) * (1 - IDLE_LID_CLOSURE)
  )
}

/** Aplica o fechamento (0..1) em todas as pálpebras do rosto. */
export function applyEyelidClosure(lids: Group[], closure: number): void {
  const value = clamp01(closure)
  const rotation = EYELID_OPEN_ROTATION + value * (EYELID_CLOSED_ROTATION - EYELID_OPEN_ROTATION)
  for (const lid of lids) lid.rotation.x = rotation
}

/** Abertura máxima do queixo: separa os lábios em mais de 0.06 no raio padrão. */
export const MAX_JAW_ROTATION = 1

/** Escala horizontal da boca no repouso e na largura máxima do lip-sync. */
export const MOUTH_WIDTH_MIN_SCALE = 0.9
export const MOUTH_WIDTH_MAX_SCALE = 1.2

export interface MouthPoseTarget {
  jaw: Group
  mouth: Group
}

/**
 * Aplica a abertura e a largura da boca. O `jaw` gira o lábio inferior e a
 * língua; a escala X do grupo da boca move os dois cantos. Em `mouthOpen` 0 o
 * queixo fica na posição de repouso e os lábios se tocam.
 */
export function applyMouthPose(target: MouthPoseTarget, open: number, width: number): void {
  target.jaw.rotation.x = clamp01(open) * MAX_JAW_ROTATION
  target.mouth.scale.x =
    MOUTH_WIDTH_MIN_SCALE + clamp01(width) * (MOUTH_WIDTH_MAX_SCALE - MOUTH_WIDTH_MIN_SCALE)
}

export interface FacePoseTarget extends MouthPoseTarget {
  lids: Group[]
  antennae: Group[]
}

export interface FaceExpressionPose {
  eyeOpenness: number
  antennaLift: number
}

export interface FaceLipPose {
  mouthOpen: number
  mouthWidth: number
}

/**
 * Aplica o estado facial do laço da cena: pálpebras (não o olho inteiro),
 * antenas (lista pode estar vazia no look sob o turbante) e boca. Não mexe em
 * `eyeGroups` nem em `pupils`, que seguem disponíveis para a task 20.
 */
export function applyFacePose(
  target: FacePoseTarget,
  expression: FaceExpressionPose,
  lip: FaceLipPose
): void {
  applyEyelidClosure(target.lids, lidClosureFromOpenness(expression.eyeOpenness))
  for (let index = 0; index < target.antennae.length; index += 1) {
    const side = index === 0 ? 1 : -1
    target.antennae[index].rotation.z = side * (0.18 + expression.antennaLift * 0.32)
  }
  applyMouthPose(target, lip.mouthOpen, lip.mouthWidth)
}
