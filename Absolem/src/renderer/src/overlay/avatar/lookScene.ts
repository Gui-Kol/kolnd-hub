import { ACESFilmicToneMapping, NoToneMapping, Scene } from 'three'
import type { Material, Object3D, ToneMapping } from 'three'
import type { AvatarLook } from './looks'
import { removeOutlines } from './outline'
import { shouldCreateStorybookLights } from './toonGradient'

/**
 * Troca de acabamento ao vivo (task 19, T4) sem recriar renderer/câmera/loop.
 *
 * `renderer.toneMapping` só muda no look `storybook`
 * (`ACESFilmicToneMapping`); volta a `NoToneMapping` ao trocar para `holo`.
 * O holograma (`holoMaterial`, `AdditiveBlending`, `depthWrite:false`, `uNoise`,
 * scanlines) NÃO é tocado aqui: nada o recria ou reconfigura. No `holo` nenhuma
 * luz é adicionada; contorno e luzes são removidos ao sair do `storybook`.
 */

/** Tone mapping do acabamento ilustrado. */
export const STORYBOOK_TONE_MAPPING = ACESFilmicToneMapping

/** Tone mapping herdado / holograma: sem mapeamento. */
export const HOLO_TONE_MAPPING = NoToneMapping

/** Decisão pura de `renderer.toneMapping` por acabamento. */
export function resolveToneMapping(look: AvatarLook | string): ToneMapping {
  return look === 'storybook' ? STORYBOOK_TONE_MAPPING : HOLO_TONE_MAPPING
}

/** Mutável mínimo de renderer para teste em Node (sem WebGL). */
export interface ToneMappingTarget {
  toneMapping: ToneMapping
}

export interface ApplyLookToSceneOptions {
  scene: Scene
  renderer: ToneMappingTarget
  /** Grupo de luzes do acabamento ilustrado (`AmbientLight` + `DirectionalLight`). */
  lights: Object3D
  /** Material de holograma; preservado intacto, nunca recriado aqui. */
  holoMaterial: Material
}

export interface ApplyLookToSceneResult {
  toneMapping: ToneMapping
  /** `true` se as luzes do acabamento ilustrado estão na cena. */
  lightsPresent: boolean
  /** `true` quando o contorno foi removido da cena. */
  outlinesRemoved: boolean
  /** `true`: o `holoMaterial` é o mesmo objeto, intacto. */
  holoMaterialUnchanged: boolean
}

/**
 * Aplica o acabamento à cena de forma testável em Node. Não recria renderer,
 * câmera, loop, `holoMaterial`; só ajusta `toneMapping`, luzes e contorno.
 * A reconstrução de materiais por papel fica com a cena.
 */
export function applyLookToScene(
  look: AvatarLook,
  options: ApplyLookToSceneOptions
): ApplyLookToSceneResult {
  const { scene, renderer, lights } = options
  const holoBefore = options.holoMaterial

  renderer.toneMapping = resolveToneMapping(look)

  const addLights = shouldCreateStorybookLights(look)
  if (addLights) {
    if (lights.parent !== scene) scene.add(lights)
  } else {
    lights.removeFromParent()
  }

  // Contorno só no acabamento ilustrado; removido ao sair. A cena re-aplica
  // contorno para `storybook` após reconstruir a malha.
  removeOutlines(scene)

  return {
    toneMapping: renderer.toneMapping,
    lightsPresent: addLights,
    outlinesRemoved: true,
    holoMaterialUnchanged: options.holoMaterial === holoBefore
  }
}
