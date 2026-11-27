import { DataTexture, NearestFilter, RGBAFormat, UnsignedByteType } from 'three'
import type { AvatarLook } from './looks'

/**
 * Rampa toon de 4 níveis para `MeshToonMaterial.gradientMap`.
 *
 * `DataTexture` nativo do three (sem asset externo): 4 pixels RGBA em escala
 * de cinza, `UnsignedByteType`, `NearestFilter` nos dois filtros e
 * `generateMipmaps = false`, para a rampa não borrar. `needsUpdate = true`
 * garante o upload inicial. Sem `gradientMap` o `MeshToonMaterial` cai em
 * lambertiano e perde o acabamento ilustrado; aqui a rampa é obrigatória.
 */
export const TOON_GRADIENT_LEVELS = 4

/** Tons da rampa, do mais sombreado ao totalmente iluminado (0..255). */
export const TOON_GRADIENT_STEPS: readonly number[] = [64, 128, 192, 255]

export interface ToonGradient {
  /** `DataTexture` pronta para `MeshToonMaterial.gradientMap`. */
  readonly texture: DataTexture
  /** Libera a textura no GPU; idempotente, não lança em chamadas repetidas. */
  dispose: () => void
}

export function createToonGradient(): ToonGradient {
  const data = new Uint8Array(TOON_GRADIENT_LEVELS * 4)
  for (let level = 0; level < TOON_GRADIENT_LEVELS; level += 1) {
    const value = TOON_GRADIENT_STEPS[level] ?? 255
    data[level * 4] = value
    data[level * 4 + 1] = value
    data[level * 4 + 2] = value
    data[level * 4 + 3] = 255
  }

  const texture = new DataTexture(data, TOON_GRADIENT_LEVELS, 1, RGBAFormat, UnsignedByteType)
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true

  let disposed = false
  return {
    texture,
    dispose(): void {
      if (disposed) return
      disposed = true
      texture.dispose()
    }
  }
}

/**
 * Decisão pura da iluminação (testável sem `Scene`/WebGL): luzes só no look
 * `storybook`. No look `holo` nenhuma luz é adicionada; o holograma continua
 * com blending aditivo sem depender de iluminação.
 */
export function shouldCreateStorybookLights(look: AvatarLook | string): boolean {
  return look === 'storybook'
}

/** Intensidade da luz ambiente no acabamento ilustrado. */
export const STORYBOOK_AMBIENT_INTENSITY = 0.65

/** Intensidade da luz direcional no acabamento ilustrado. */
export const STORYBOOK_DIRECTIONAL_INTENSITY = 1.0

/**
 * Posição da `DirectionalLight` no acabamento ilustrado: esquerda, acima e à
 * frente do personagem (como na referência). `castShadow = false`, sem
 * sombras projetadas. A cena usa `scene.add(light)`; `target` fica na origem.
 */
export const STORYBOOK_DIRECTIONAL_POSITION: readonly [number, number, number] = [-1.2, 1.6, 1.8]
