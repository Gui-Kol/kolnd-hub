import { CatmullRomCurve3, ConeGeometry, Group, Mesh, SphereGeometry, TorusGeometry } from 'three'
import type { CaterpillarAccessory } from '../caterpillar'
import type { PartBuild, PartContext } from './types'
import { createPartDispose } from './types'

export interface AccessoriesPartContext extends PartContext {
  head: Mesh
  curve: CatmullRomCurve3
  antennae: Group[]
}

/**
 * Acessórios procedurais. O grupo externo (`caterpillar-accessories`) é estável
 * para o contrato de partes; cada acessório mantém o nome herdado
 * (`caterpillar-accessory-*`) para a cena remover e reconstruir sem tocar no
 * resto da malha.
 */
export function buildAccessoriesPart(
  accessories: CaterpillarAccessory[],
  ctx: AccessoriesPartContext
): PartBuild {
  const group = new Group()
  group.name = 'caterpillar-accessories'
  const { radius, head, materialFor, curve, antennae } = ctx

  if (accessories.includes('antenna_glow')) {
    const glowGroup = new Group()
    glowGroup.name = 'caterpillar-accessory-antenna_glow'
    const glowGeometry = new SphereGeometry(radius * 0.24, 8, 6)
    for (const antenna of antennae) {
      const side = antenna.name.includes('left') ? -1 : 1
      const glow = new Mesh(glowGeometry, materialFor('accessory'))
      glow.position.set(radius * 0.42, radius * 1.55, side * radius * 0.58)
      glow.scale.set(1, 1, 1)
      glowGroup.add(glow)
    }
    group.add(glowGroup)
  }

  if (accessories.includes('back_spikes')) {
    const spikeGroup = new Group()
    spikeGroup.name = 'caterpillar-accessory-back_spikes'
    const spikeGeometry = new ConeGeometry(radius * 0.16, radius * 0.62, 6)
    for (const t of [0.26, 0.48, 0.7]) {
      const point = curve.getPointAt(t)
      const spike = new Mesh(spikeGeometry, materialFor('accessory'))
      spike.position.set(point.x, point.y + radius * 0.92, point.z)
      spike.rotation.z = -0.12
      spikeGroup.add(spike)
    }
    group.add(spikeGroup)
  }

  if (accessories.includes('visor_hud')) {
    const visorGroup = new Group()
    visorGroup.name = 'caterpillar-accessory-visor_hud'
    const bandGeometry = new TorusGeometry(radius * 0.9, radius * 0.08, 6, 18, Math.PI)
    const band = new Mesh(bandGeometry, materialFor('accessory'))
    band.position.set(head.position.x + radius * 0.18, head.position.y + radius * 0.2, 0)
    band.rotation.set(Math.PI / 2, 0, Math.PI / 2)
    visorGroup.add(band)

    const lensGeometry = new SphereGeometry(radius * 0.18, 8, 6)
    for (const side of [-1, 1]) {
      const lens = new Mesh(lensGeometry, materialFor('accessory'))
      lens.position.set(
        head.position.x + radius * 0.82,
        head.position.y + radius * 0.18,
        side * radius * 0.36
      )
      lens.scale.set(0.45, 1, 1)
      visorGroup.add(lens)
    }
    group.add(visorGroup)
  }

  return {
    group,
    dispose: createPartDispose(group)
  }
}
