import { Mesh } from 'three'
import type { Group } from 'three'
import type { CaterpillarMaterialFactory, CaterpillarStyle } from '../caterpillar'
import type { CaterpillarPalette } from '../palettes'

/**
 * Contexto compartilhado pelas partes procedurais do personagem.
 *
 * O compositor resolve todas as opções uma única vez e entrega os valores já
 * normalizados: nenhuma parte precisa conhecer `CaterpillarOptions` nem reler
 * o tema. `palette` fica disponível para as tasks seguintes (cor por parte,
 * sem depender do material injetado); nesta task a geometria só usa
 * `materialFor`.
 */
export interface PartContext {
  radius: number
  materialFor: CaterpillarMaterialFactory
  palette: CaterpillarPalette
  seed: number
  minimal: boolean
  style: CaterpillarStyle
  /** Segmentos resolvidos do corpo (7-9, 5 no modo mínimo). */
  segments: number
  /** 0..1: deslocamento lateral/vertical da curva do corpo. */
  curvature: number
}

/** Contrato mínimo de uma parte: um grupo e um dispose idempotente. */
export interface PartBuild {
  group: Group
  dispose: () => void
}

/**
 * Libera as geometrias da parte uma única vez. Materiais não entram aqui: eles
 * pertencem à fábrica injetada (cena) ou ao compositor, que decide quando
 * descartá-los.
 */
export function createPartDispose(group: Group): () => void {
  let disposed = false

  return () => {
    if (disposed) return
    disposed = true

    const geometries = new Set<{ dispose: () => void }>()
    group.traverse((object) => {
      if (!(object instanceof Mesh)) return
      geometries.add(object.geometry as unknown as { dispose: () => void })
    })
    for (const geometry of geometries) geometry.dispose()
  }
}
