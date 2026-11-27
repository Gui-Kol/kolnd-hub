import { MeshBasicMaterial, MeshPhongMaterial, MeshToonMaterial, NormalBlending } from 'three'
import type { Material, Texture } from 'three'
import { CATERPILLAR_MATERIAL_ROLES } from './caterpillar'
import type { CaterpillarMaterialRole } from './caterpillar'
import type { AvatarLook } from './looks'
import { normalizePalette } from './palettes'
import { createToonGradient } from './toonGradient'
import type { ToonGradient } from './toonGradient'

export interface RoleMaterialFactoryOptions {
  look: AvatarLook
  /** Paleta parcial (hex) ou `unknown`; normalizada sem lançar. */
  palette?: unknown
  /** Material de holograma compartilhado, dono é a cena. */
  holo: Material
  /** Material escuro de pupilas/boca, dono é a cena. */
  dark: Material
  /**
   * `gradientMap` da rampa toon de 4 níveis (task 19). Obrigatório no caminho
   * `storybook`: `MeshToonMaterial` sem `gradientMap` cai em lambertiano. Se
   * ausente, a fábrica cria a própria rampa e a libera no `dispose`.
   */
  gradientMap?: Texture | null
}

export interface RoleMaterialFactory {
  materialFor: (role: CaterpillarMaterialRole) => Material
  /** Atualiza a paleta e recolore materiais já criados sem recriar. */
  setPalette: (palette: unknown) => void
  /** Libera apenas os materiais criados por esta fábrica; idempotente. */
  dispose: () => void
}

function normalizeRole(role: string): CaterpillarMaterialRole {
  return (CATERPILLAR_MATERIAL_ROLES as readonly string[]).includes(role)
    ? (role as CaterpillarMaterialRole)
    : 'body'
}

/**
 * Papéis orgânicos no acabamento ilustrado: `MeshToonMaterial` com rampa toon
 * de 4 níveis (`gradientMap`), cor da paleta, sem blending aditivo.
 */
export const STORYBOOK_TOON_ROLES: readonly CaterpillarMaterialRole[] = [
  'body',
  'belly',
  'head',
  'hand',
  'sleeve',
  'turban',
  'turbanStripe',
  'lip',
  'brow',
  'eyelid'
]

/** Papéis que não recebem luz no acabamento ilustrado: `MeshBasicMaterial`. */
const UNLIT_BASIC_ROLES: readonly CaterpillarMaterialRole[] = ['pupil', 'mouth']

/** Mangueira e piteira: leitura metálica, `MeshPhongMaterial`. */
const METALLIC_PHONG_ROLES: readonly CaterpillarMaterialRole[] = ['pipe', 'hose']

/** Brilho de olho: `MeshBasicMaterial`, não recebe luz. */
const HIGHLIGHT_ROLES: readonly CaterpillarMaterialRole[] = ['highlight']

/** `shininess` alto da piteira/mangueira (leitura metálica; pedido: > 40). */
export const PIPE_SHININESS = 96

/** Cor especular clara da piteira/mangueira. */
export const PIPE_SPECULAR = '#f5f0e6'

const TOON_ROLE_SET = new Set<CaterpillarMaterialRole>(STORYBOOK_TOON_ROLES)
const UNLIT_BASIC_SET = new Set<CaterpillarMaterialRole>(UNLIT_BASIC_ROLES)
const METALLIC_PHONG_SET = new Set<CaterpillarMaterialRole>(METALLIC_PHONG_ROLES)
const HIGHLIGHT_SET = new Set<CaterpillarMaterialRole>(HIGHLIGHT_ROLES)

/**
 * Fábrica única de materiais por papel.
 *
 * `holo` reproduz o visual herdado: o mesmo material de holograma para tudo,
 * exceto pupilas e boca, que usam o material escuro. `storybook` cria, por
 * papel e em cache, `MeshToonMaterial` com `gradientMap` para papéis
 * orgânicos, `MeshBasicMaterial` escuro para `pupil`/`mouth`, `MeshBasicMaterial`
 * para `highlight`, `MeshPhongMaterial` com `shininess` alto e `specular`
 * claro para `pipe`/`hose`, e `MeshBasicMaterial` opaco para o restante. Um
 * material por papel, reutilizado entre meshes.
 *
 * A fábrica é dona apenas dos materiais que cria. `holo` e `dark` pertencem à
 * cena e nunca são descartados aqui. `gradientMap`, quando informado, é dono
 * da cena; só a rampa que a fábrica cria por conta própria é liberada aqui.
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
      setPalette: () => {},
      dispose: () => {}
    }
  }

  let palette = normalizePalette(options.palette)
  const materials = new Map<CaterpillarMaterialRole, Material>()

  // `MeshToonMaterial` sem `gradientMap` não vale: garante uma rampa toon de
  // 4 níveis. Se a cena não injeta, a fábrica cria a própria e a libera.
  let ownGradient: ToonGradient | null = null
  let gradientMap: Texture | null = options.gradientMap ?? null
  if (!gradientMap) {
    ownGradient = createToonGradient()
    gradientMap = ownGradient.texture
  }

  // `palette` recolorable at runtime via `setPalette`.

  let disposed = false

  return {
    materialFor: (role) => {
      const key = normalizeRole(role)
      const existing = materials.get(key)
      if (existing) return existing

      let material: Material
      if (TOON_ROLE_SET.has(key)) {
        material = new MeshToonMaterial({
          color: palette[key],
          gradientMap,
          blending: NormalBlending,
          depthWrite: true
        })
      } else if (UNLIT_BASIC_SET.has(key)) {
        material = new MeshBasicMaterial({
          color: palette[key],
          blending: NormalBlending,
          depthWrite: true
        })
      } else if (METALLIC_PHONG_SET.has(key)) {
        material = new MeshPhongMaterial({
          color: palette[key],
          shininess: PIPE_SHININESS,
          specular: PIPE_SPECULAR,
          blending: NormalBlending,
          depthWrite: true
        })
      } else if (HIGHLIGHT_SET.has(key)) {
        material = new MeshBasicMaterial({
          color: palette[key],
          blending: NormalBlending,
          depthWrite: true
        })
      } else {
        material = new MeshBasicMaterial({
          color: palette[key],
          blending: NormalBlending,
          depthWrite: true
        })
      }

      materials.set(key, material)
      return material
    },
    setPalette: (nextPalette: unknown) => {
      palette = normalizePalette(nextPalette)
      for (const [key, material] of materials) {
        // Atualiza cor dos materiais existentes sem recriar nem trocar malha.
        const colorable = material as Material & { color?: { set: (c: string) => void } }
        colorable.color?.set(palette[key])
      }
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      for (const material of materials.values()) material.dispose()
      materials.clear()
      if (ownGradient) {
        ownGradient.dispose()
        ownGradient = null
      }
    }
  }
}
