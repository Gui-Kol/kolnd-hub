import { Group, Mesh, SphereGeometry, TorusGeometry } from 'three'
import type { CaterpillarOutfit } from '../caterpillar'
import type { PartBuild, PartContext } from './types'
import { createPartDispose } from './types'

export interface OutfitPartContext extends PartContext {
  /** Cabeça já posicionada; a roupa é ancorada nela. */
  head: Mesh
}

/**
 * Roupas procedurais. Cada roupa é um `Group` próprio para a cena remover e
 * reconstruir sem tocar no resto da malha. Nesta task só existe a geometria
 * herdada da versão holográfica; as roupas da recriação entram na task 17/18.
 */
export function buildOutfitPart(outfit: CaterpillarOutfit, ctx: OutfitPartContext): PartBuild {
  const group = new Group()
  const { radius, head, materialFor } = ctx

  if (outfit === 'scarf') {
    const ringGeometry = new TorusGeometry(radius * 1.25, radius * 0.22, 8, 20)
    const ring = new Mesh(ringGeometry, materialFor('outfit'))
    ring.position.set(head.position.x - radius * 0.85, head.position.y - radius * 0.45, 0)
    ring.rotation.y = Math.PI / 2
    ring.scale.set(1, 0.8, 1)
    group.add(ring)

    const tailGeometry = new SphereGeometry(radius * 0.3, 8, 6)
    for (let index = 0; index < 2; index += 1) {
      const tail = new Mesh(tailGeometry, materialFor('outfit'))
      tail.position.set(
        head.position.x - radius * 0.85,
        head.position.y - radius * (1.05 + index * 0.45),
        radius * (0.55 - index * 0.2)
      )
      tail.scale.set(0.8, 1.4, 0.5)
      group.add(tail)
    }
  } else if (outfit === 'collar') {
    for (let index = 0; index < 2; index += 1) {
      const collarGeometry = new TorusGeometry(radius * (1.3 + index * 0.14), radius * 0.12, 8, 20)
      const collar = new Mesh(collarGeometry, materialFor('outfit'))
      collar.position.set(
        head.position.x - radius * (0.9 + index * 0.16),
        head.position.y - radius * 0.5,
        0
      )
      collar.rotation.y = Math.PI / 2
      collar.rotation.x = index * 0.18
      group.add(collar)
    }
  } else if (outfit === 'visor') {
    const bandGeometry = new TorusGeometry(radius * 0.95, radius * 0.12, 6, 18, Math.PI)
    const band = new Mesh(bandGeometry, materialFor('outfit'))
    band.position.set(head.position.x + radius * 0.2, head.position.y + radius * 0.18, 0)
    band.rotation.set(Math.PI / 2, 0, Math.PI / 2)
    band.scale.set(1, 1, 0.55)
    group.add(band)

    const lensGeometry = new SphereGeometry(radius * 0.22, 8, 6)
    for (const side of [-1, 1]) {
      const lens = new Mesh(lensGeometry, materialFor('outfit'))
      lens.position.set(
        head.position.x + radius * 0.8,
        head.position.y + radius * 0.16,
        side * radius * 0.38
      )
      lens.scale.set(0.5, 1, 1)
      group.add(lens)
    }
  }

  group.name = `caterpillar-outfit-${outfit}`

  return {
    group,
    dispose: createPartDispose(group)
  }
}
