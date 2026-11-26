import { MeshBasicMaterial, NormalBlending } from 'three'
import type { Material } from 'three'
import { CATERPILLAR_MATERIAL_ROLES } from './caterpillar'
import type { CaterpillarMaterialRole } from './caterpillar'
import type { AvatarLook } from './looks'
import { normalizePalette } from './palettes'

export interface RoleMaterialFactoryOptions {
  look: AvatarLook
  /** Paleta parcial (hex) ou `unknown`; normalizada sem lançar. */
  palette?: unknown
  /** Material de holograma compartilhado, dono é a cena. */
  holo: Material
  /** Material escuro de pupilas/boca, dono é a cena. */
  dark: Material
}

export interface RoleMaterialFactory {
  materialFor: (role: CaterpillarMaterialRole) => Material
  /** Libera apenas os materiais criados por esta fábrica; idempotente. */
  dispose: () => void
}

function normalizeRole(role: string): CaterpillarMaterialRole {
  return (CATERPILLAR_MATERIAL_ROLES as readonly string[]).includes(role)
    ? (role as CaterpillarMaterialRole)
    : 'body'
}

/**
 * Fábrica única de materiais por papel.
 *
 * `holo` reproduz o visual herdado: o mesmo material de holograma para tudo,
 * exceto pupilas e boca, que usam o material escuro. `storybook` cria um
 * `MeshBasicMaterial` opaco por papel (cor plana, sem blending aditivo,
 * `depthWrite: true`); a iluminação de verdade é a task 19.
 *
 * A fábrica é dona apenas dos materiais que cria. `holo` e `dark` pertencem à
 * cena e nunca são descartados aqui.
 */
export function createRoleMaterialFactory(
  options: RoleMaterialFactoryOptions
): RoleMaterialFactory {
  if (options.look === 'holo') {
    return {
      materialFor: (role) => {
        const key = normalizeRole(role)
        return key === 'pupil' || key === 'mouth' ? options.dark : options.holo
      },
      dispose: () => {}
    }
  }

  const palette = normalizePalette(options.palette)
  const materials = new Map<CaterpillarMaterialRole, MeshBasicMaterial>()
  let disposed = false

  return {
    materialFor: (role) => {
      const key = normalizeRole(role)
      const existing = materials.get(key)
      if (existing) return existing

      const material = new MeshBasicMaterial({
        color: palette[key],
        blending: NormalBlending,
        depthWrite: true
      })
      materials.set(key, material)
      return material
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      for (const material of materials.values()) material.dispose()
      materials.clear()
    }
  }
}
