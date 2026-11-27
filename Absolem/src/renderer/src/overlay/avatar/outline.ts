import { BackSide, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import type { ColorRepresentation, Object3D } from 'three'

/**
 * Contorno escuro de silhueta (task 19, T3).
 *
 * `createOutline(mesh, options)` clona a geometria do mesh, cria um filho
 * `Mesh` com `MeshBasicMaterial({ color, side: BackSide, depthWrite: true })`
 * e escala o filho uniformemente em 1.03-1.05 no eixo normal. O filho herda
 * as transformações do pai. NÃO adiciona geometria nova à cena original; só
 * clona a geometria do próprio mesh para o contorno. `depthWrite: false`
 * herdado do holograma NÃO vaza: o material do contorno é criado limpo com
 * `depthWrite: true`.
 *
 * `outlineStrength` (0 desliga; default 0.7; sem novo campo de tema; task 21
 * expõe): força 0 não cria contorno; >0 cria, ajustando a escala dentro da
 * faixa 1.03-1.05. `dispose` remove o filho, libera a geometria clonada e o
 * material; idempotente.
 */

/** Força padrão do contorno; task 21 expõe no tema. */
export const DEFAULT_OUTLINE_STRENGTH = 0.7

/** Escala mínima do contorno no eixo normal. */
export const OUTLINE_SCALE_MIN = 1.03

/** Escala máxima do contorno no eixo normal. */
export const OUTLINE_SCALE_MAX = 1.05

/** Cor padrão do contorno: escuro, não confunde com a paleta. */
export const OUTLINE_COLOR = '#0b1020'

/** Nome estável do nó de contorno. */
export const OUTLINE_NAME = 'caterpillar-outline'

/** Limiar (raio mundo) abaixo do qual a parte conta como "pequena". */
export const OUTLINE_SMALL_THRESHOLD = 0.05

/** Grupos de silhueta que recebem contorno. */
export const OUTLINE_PART_GROUPS = ['body', 'head', 'limbs', 'turban'] as const

/**
 * Nós que NUNCA recebem contorno (comparados por substring no nome):
 * listras finas, pálpebras, pupilas, olhos, nariz, narinas, boca, lábios,
 * língua, queixo, baforada, piteira, mangueira, brilho e o próprio contorno.
 */
export const OUTLINE_EXCLUDED_SUBSTRINGS: readonly string[] = [
  'pupil',
  'highlight',
  'eyelid',
  'sclera',
  'iris',
  'nose',
  'nostril',
  'mouth',
  'lip',
  'tongue',
  'jaw',
  'smoke',
  'pipe',
  'hose',
  'wrap',
  'knot-fold',
  'knot-highlight',
  'tassel',
  'stripe',
  'outline'
]

/** Papéis de material que nunca recebem contorno. */
export const OUTLINE_EXCLUDED_ROLES: readonly string[] = [
  'pupil',
  'mouth',
  'highlight',
  'sclera',
  'iris',
  'tongue',
  'smoke',
  'pipe',
  'hose'
]

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** Força normalizada 0..1; 0 desliga o contorno. */
export function clampOutlineStrength(value: number | undefined): number {
  return clamp01(value ?? DEFAULT_OUTLINE_STRENGTH)
}

/** Escala do contorno a partir da força, sempre em [1.03, 1.05]. */
export function outlineScaleFor(strength: number): number {
  const t = clamp01(strength)
  return OUTLINE_SCALE_MIN + (OUTLINE_SCALE_MAX - OUTLINE_SCALE_MIN) * t
}

/** `true` se o nó deve ser ignorado no contorno. */
export function isOutlineExcluded(object: Object3D): boolean {
  if (!(object instanceof Mesh)) return true
  // `InstancedMesh` não replica um filho simples por instância; fora do contorno.
  if ((object as Mesh & { isInstancedMesh?: boolean }).isInstancedMesh === true) return true
  // Nós invisíveis (ex.: antenas escondidas sob o turbante) não ganham contorno.
  if (object.visible === false) return true
  if (object.name === OUTLINE_NAME) return true
  const name = object.name.toLowerCase()
  for (const needle of OUTLINE_EXCLUDED_SUBSTRINGS) {
    if (name.includes(needle)) return true
  }
  const role = (object.userData?.materialRole as string | undefined)?.toLowerCase()
  if (role) {
    for (const excluded of OUTLINE_EXCLUDED_ROLES) {
      if (role === excluded.toLowerCase()) return true
    }
  }
  return false
}

export interface OutlineOptions {
  /** Cor do contorno (padrão `OUTLINE_COLOR`). */
  color?: ColorRepresentation
  /** `outlineStrength`; 0 não cria contorno; default 0.7. */
  outlineStrength?: number
  /** Nome do nó filho. */
  name?: string
}

export interface OutlineHandle {
  /** Filho de contorno adicionado ao mesh. */
  readonly mesh: Mesh
  /** Mesh de origem. */
  readonly source: Mesh
  /** `true` para partes pequenas (removido na degradação nível 2). */
  readonly small: boolean
  /** Remove o filho, libera geometria clonada + material; idempotente. */
  dispose: () => void
}

function meshWorldRadius(mesh: Mesh): number {
  mesh.geometry.computeBoundingSphere()
  const radius = mesh.geometry.boundingSphere?.radius ?? 0
  const scale = new Vector3()
  mesh.updateWorldMatrix(true, false)
  mesh.getWorldScale(scale)
  const maxScale = Math.max(scale.x, scale.y, scale.z) || 1
  return radius * maxScale
}

/**
 * Cria um contorno para `mesh`. Devolve `null` quando `outlineStrength` é 0
 * ou quando o mesh é excluído. O contorno é filho do mesh e acompanha
 * transformações sem trabalho extra no laço.
 */
export function createOutline(mesh: Mesh, options: OutlineOptions = {}): OutlineHandle | null {
  const strength = clampOutlineStrength(options.outlineStrength)
  if (strength <= 0) return null
  if (isOutlineExcluded(mesh)) return null

  const geometry = mesh.geometry.clone()
  const material = new MeshBasicMaterial({
    color: options.color ?? OUTLINE_COLOR,
    side: BackSide,
    depthWrite: true,
    transparent: false
  })
  // Garante que nada herdado do holograma (depthWrite:false) vaze.
  material.depthWrite = true
  material.depthTest = true

  const outline = new Mesh(geometry, material)
  outline.name = options.name ?? OUTLINE_NAME
  outline.scale.setScalar(outlineScaleFor(strength))
  outline.frustumCulled = mesh.frustumCulled
  // Contorno desenhado primeiro; a superfície por cima cobre o centro.
  outline.renderOrder = mesh.renderOrder - 1
  mesh.add(outline)

  const small = meshWorldRadius(mesh) < OUTLINE_SMALL_THRESHOLD

  let disposed = false
  return {
    mesh: outline,
    source: mesh,
    small,
    dispose(): void {
      if (disposed) return
      disposed = true
      outline.removeFromParent()
      geometry.dispose()
      material.dispose()
    }
  }
}

/**
 * Aplica contorno a todos os meshes não excluídos sob `root`. Devolve os
 * handles para controle de degradação e `dispose`. Não reprocessa contornos já
 * adicionados.
 */
export function addOutlines(root: Object3D, options: OutlineOptions = {}): OutlineHandle[] {
  const handles: OutlineHandle[] = []
  // Snapshot antes de adicionar filhos para não iterar sobre o que inserimos.
  const targets: Mesh[] = []
  root.traverse((object) => {
    if (object instanceof Mesh && !isOutlineExcluded(object)) targets.push(object)
  })
  for (const mesh of targets) {
    const handle = createOutline(mesh, options)
    if (handle) handles.push(handle)
  }
  return handles
}

/** Remove e libera todos os contornos sob `root`. Idempotente. */
export function removeOutlines(root: Object3D): void {
  const outlines: Mesh[] = []
  root.traverse((object) => {
    if (object instanceof Mesh && object.name === OUTLINE_NAME) outlines.push(object)
  })
  for (const outline of outlines) {
    outline.removeFromParent()
    outline.geometry.dispose()
    const material = outline.material
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
    else material.dispose()
  }
}
