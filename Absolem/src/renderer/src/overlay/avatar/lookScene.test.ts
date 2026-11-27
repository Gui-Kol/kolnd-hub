import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  Scene
} from 'three'
import { describe, expect, it } from 'vitest'
import { OUTLINE_NAME } from './outline'
import {
  HOLO_TONE_MAPPING,
  STORYBOOK_TONE_MAPPING,
  applyLookToScene,
  resolveToneMapping
} from './lookScene'

function lightsFixture(): Group {
  const group = new Group()
  group.add(new AmbientLight(0xffffff, 0.65))
  const directional = new DirectionalLight(0xffffff, 1)
  directional.castShadow = false
  group.add(directional)
  return group
}

function hasLight(scene: Scene, type: 'AmbientLight' | 'DirectionalLight'): boolean {
  let found = false
  scene.traverse((object) => {
    if (object.type === type) found = true
  })
  return found
}

describe('tone mapping por acabamento', () => {
  it('storybook usa ACESFilmicToneMapping; holo volta a NoToneMapping', () => {
    expect(resolveToneMapping('storybook')).toBe(STORYBOOK_TONE_MAPPING)
    expect(resolveToneMapping('holo')).toBe(NoToneMapping)
    expect(HOLO_TONE_MAPPING).toBe(NoToneMapping)
  })
})

describe('trocar acabamento ao vivo', () => {
  it('trocar storybook -> holo remove luzes e contorno e mantém o holoMaterial', () => {
    const scene = new Scene()
    const renderer = { toneMapping: NoToneMapping }
    const lights = lightsFixture()
    const holoMaterial = new MeshBasicMaterial()

    // Monta o acabamento ilustrado: luzes + tone mapping + contorno.
    applyLookToScene('storybook', { scene, renderer, lights, holoMaterial })
    expect(hasLight(scene, 'AmbientLight')).toBe(true)
    expect(hasLight(scene, 'DirectionalLight')).toBe(true)
    expect(renderer.toneMapping).toBe(STORYBOOK_TONE_MAPPING)

    // Contorno escuro sob uma malha (filho), como no acabamento ilustrado.
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), holoMaterial)
    const outline = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    outline.name = OUTLINE_NAME
    mesh.add(outline)
    scene.add(mesh)

    const holoBefore = holoMaterial

    // Trocar para holo ao vivo, sem recriar renderer/câmera/loop.
    const result = applyLookToScene('holo', { scene, renderer, lights, holoMaterial })

    expect(hasLight(scene, 'AmbientLight')).toBe(false)
    expect(hasLight(scene, 'DirectionalLight')).toBe(false)
    expect(renderer.toneMapping).toBe(NoToneMapping)
    // Nenhum contorno restante.
    let outlineCount = 0
    scene.traverse((object) => {
      if (object.name === OUTLINE_NAME) outlineCount += 1
    })
    expect(outlineCount).toBe(0)
    expect(result.outlinesRemoved).toBe(true)
    expect(result.lightsPresent).toBe(false)
    // Mantém o holoMaterial: mesmo objeto, intacto.
    expect(holoMaterial).toBe(holoBefore)
    expect(result.holoMaterialUnchanged).toBe(true)
    expect(mesh.material).toBe(holoMaterial)
  })
})
