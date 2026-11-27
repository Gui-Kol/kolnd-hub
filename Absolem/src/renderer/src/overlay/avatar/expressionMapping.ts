/**
 * Mapeamento puro dos canais de expressão para os nós do rosto.
 *
 * Nenhum import de three: a cena passa objetos com `position`, `rotation` e
 * `scale` mutáveis, e o teste usa o mesmo formato em memória. Toda escrita é
 * absoluta em relação a uma pose base capturada no build, então aplicar o mesmo
 * frame duas vezes produz exatamente o mesmo resultado (nada acumula).
 *
 * Canais sem nó correspondente são ignorados: listas vazias ou `null` não
 * lançam, o que mantém a cena tolerante a looks que escondem partes.
 */

export interface RigVector {
  x: number
  y: number
  z: number
}

export interface RigNode {
  position: RigVector
  rotation: RigVector
  scale: RigVector
}

export interface ExpressionRig {
  lids: RigNode[]
  brows: RigNode[]
  pupils: RigNode[]
  mouthCorners: RigNode[]
  jaw: RigNode | null
  mouth: RigNode | null
  upperLip: RigNode | null
  body: RigNode | null
  turbanTassel: RigNode | null
}

export type ExpressionBasePose = ExpressionRig

export interface ExpressionChannels {
  /** 0..1: leitura final da pálpebra vinda do motor. */
  lidClosure: number
  /** 0..1: elevação da sobrancelha. */
  browRaise: number
  /** 0..1: franzido da sobrancelha. */
  browFurrow: number
  /** -1..1: desvio lateral do olhar. */
  lookAside: number
  /** 0..1: abertura da mandíbula (lip-sync). */
  mouthOpen: number
  /** 0..1: largura da boca (lip-sync). */
  mouthWidth: number
  /** 0..1: canto da boca para cima. */
  smile: number
  /** 0..1: amplitude da respiração. */
  breathe: number
  /** 0..1: balanço do pingente do turbante. */
  antennaLift: number
}

/** Curso total do pivô da pálpebra entre aberta e fechada. */
export const LID_CLOSURE_TRAVEL_RADIANS = Math.PI
/** Deslocamento vertical da sobrancelha em atenção. */
export const BROW_RAISE_LIFT = 0.035
/** Rotação oposta de cada sobrancelha no franzido. */
export const BROW_FURROW_ROTATION = 0.22
/** Desvio lateral e de profundidade da pupila. */
export const PUPIL_LOOK_X = 0.012
export const PUPIL_LOOK_Z = 0.006
/** Abertura máxima da mandíbula, em radianos. */
export const JAW_MAX_ROTATION = 1
/** Elevação do canto da boca no sorriso. */
export const MOUTH_CORNER_SMILE_LIFT = 0.022
/** Escala da boca no repouso e na largura máxima do lip-sync. */
export const MOUTH_WIDTH_MIN_SCALE = 0.9
export const MOUTH_WIDTH_MAX_SCALE = 1.2
/** Achatamento do lábio superior ao alargar a boca. */
export const UPPER_LIP_WIDTH_FLATTEN = 0.12
/** Expansão máxima do corpo na respiração. */
export const BODY_BREATHE_SCALE = 0.012
/** Balanço do pingente do turbante pelo canal `antennaLift`. */
export const TASSEL_SWING_RADIANS = 0.5

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function clampSigned(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(-1, value))
}

function copyNode(source: RigNode): RigNode {
  return {
    position: { x: source.position.x, y: source.position.y, z: source.position.z },
    rotation: { x: source.rotation.x, y: source.rotation.y, z: source.rotation.z },
    scale: { x: source.scale.x, y: source.scale.y, z: source.scale.z }
  }
}

/** Congela a pose base de um rig; chamado só no build/rebuild, nunca por frame. */
export function createExpressionBase(source: ExpressionRig): ExpressionBasePose {
  return {
    lids: source.lids.map(copyNode),
    brows: source.brows.map(copyNode),
    pupils: source.pupils.map(copyNode),
    mouthCorners: source.mouthCorners.map(copyNode),
    jaw: source.jaw ? copyNode(source.jaw) : null,
    mouth: source.mouth ? copyNode(source.mouth) : null,
    upperLip: source.upperLip ? copyNode(source.upperLip) : null,
    body: source.body ? copyNode(source.body) : null,
    turbanTassel: source.turbanTassel ? copyNode(source.turbanTassel) : null
  }
}

/**
 * Aplica o frame atual nos nós. A função não aloca arrays nem objetos: escreve
 * direto nos vetores existentes, sempre a partir de `base`.
 */
export function applyExpressionFrame(
  rig: ExpressionRig,
  base: ExpressionBasePose,
  channels: ExpressionChannels
): void {
  const lidClosure = clamp01(channels.lidClosure)
  const lidCount = Math.min(rig.lids.length, base.lids.length)
  for (let index = 0; index < lidCount; index += 1) {
    const node = rig.lids[index]
    const origin = base.lids[index]
    node.rotation.x = origin.rotation.x + lidClosure * LID_CLOSURE_TRAVEL_RADIANS
    node.rotation.y = origin.rotation.y
    node.rotation.z = origin.rotation.z
  }

  const raise = clamp01(channels.browRaise)
  const furrow = clamp01(channels.browFurrow)
  const browCount = Math.min(rig.brows.length, base.brows.length)
  for (let index = 0; index < browCount; index += 1) {
    const node = rig.brows[index]
    const origin = base.brows[index]
    const side = index === 0 ? 1 : -1
    node.position.x = origin.position.x
    node.position.y = origin.position.y + raise * BROW_RAISE_LIFT
    node.position.z = origin.position.z
    node.rotation.x = origin.rotation.x
    node.rotation.y = origin.rotation.y
    node.rotation.z = origin.rotation.z + side * furrow * BROW_FURROW_ROTATION
  }

  const lookAside = clampSigned(channels.lookAside)
  const pupilCount = Math.min(rig.pupils.length, base.pupils.length)
  for (let index = 0; index < pupilCount; index += 1) {
    const node = rig.pupils[index]
    const origin = base.pupils[index]
    node.position.x = origin.position.x + lookAside * PUPIL_LOOK_X
    node.position.y = origin.position.y
    node.position.z = origin.position.z + lookAside * PUPIL_LOOK_Z
  }

  if (rig.jaw && base.jaw) {
    rig.jaw.rotation.x = base.jaw.rotation.x + clamp01(channels.mouthOpen) * JAW_MAX_ROTATION
    rig.jaw.rotation.y = base.jaw.rotation.y
    rig.jaw.rotation.z = base.jaw.rotation.z
  }

  const smile = clamp01(channels.smile)
  const cornerCount = Math.min(rig.mouthCorners.length, base.mouthCorners.length)
  for (let index = 0; index < cornerCount; index += 1) {
    const node = rig.mouthCorners[index]
    const origin = base.mouthCorners[index]
    node.position.x = origin.position.x
    node.position.y = origin.position.y + smile * MOUTH_CORNER_SMILE_LIFT
    node.position.z = origin.position.z
  }

  const width = clamp01(channels.mouthWidth)
  if (rig.mouth && base.mouth) {
    rig.mouth.scale.x =
      MOUTH_WIDTH_MIN_SCALE + width * (MOUTH_WIDTH_MAX_SCALE - MOUTH_WIDTH_MIN_SCALE)
    rig.mouth.scale.y = base.mouth.scale.y
    rig.mouth.scale.z = base.mouth.scale.z
  }

  if (rig.upperLip && base.upperLip) {
    rig.upperLip.scale.x = base.upperLip.scale.x
    rig.upperLip.scale.y = base.upperLip.scale.y * (1 - width * UPPER_LIP_WIDTH_FLATTEN)
    rig.upperLip.scale.z = base.upperLip.scale.z
  }

  if (rig.body && base.body) {
    const breathe = clamp01(channels.breathe)
    const scale = 1 + breathe * BODY_BREATHE_SCALE
    rig.body.scale.x = base.body.scale.x * scale
    rig.body.scale.y = base.body.scale.y * scale
    rig.body.scale.z = base.body.scale.z * scale
  }

  if (rig.turbanTassel && base.turbanTassel) {
    const lift = clamp01(channels.antennaLift)
    rig.turbanTassel.rotation.x = base.turbanTassel.rotation.x
    rig.turbanTassel.rotation.y = base.turbanTassel.rotation.y
    rig.turbanTassel.rotation.z = base.turbanTassel.rotation.z + (lift - 0.5) * TASSEL_SWING_RADIANS
  }
}
