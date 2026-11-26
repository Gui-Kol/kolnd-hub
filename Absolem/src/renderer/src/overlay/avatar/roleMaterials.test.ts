import { MeshBasicMaterial, NormalBlending } from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { CaterpillarMaterialRole } from './caterpillar'
import { createRoleMaterialFactory } from './roleMaterials'

function holoFixture(): MeshBasicMaterial {
  return new MeshBasicMaterial()
}

function darkFixture(): MeshBasicMaterial {
  return new MeshBasicMaterial()
}

describe('createRoleMaterialFactory', () => {
  it('holo devolve o mesmo material para body e belly', () => {
    const holo = holoFixture()
    const dark = darkFixture()
    const factory = createRoleMaterialFactory({ look: 'holo', holo, dark })

    expect(factory.materialFor('body')).toBe(holo)
    expect(factory.materialFor('belly')).toBe(holo)
    expect(factory.materialFor('head')).toBe(holo)
    expect(factory.materialFor('pupil')).toBe(dark)
    expect(factory.materialFor('mouth')).toBe(dark)
  })

  it('storybook devolve materiais distintos para body e belly', () => {
    const factory = createRoleMaterialFactory({
      look: 'storybook',
      palette: { body: '#112233', belly: '#445566' },
      holo: holoFixture(),
      dark: darkFixture()
    })

    const body = factory.materialFor('body') as MeshBasicMaterial
    const belly = factory.materialFor('belly') as MeshBasicMaterial

    expect(body).not.toBe(belly)
    expect(body.color.getHexString()).toBe('112233')
    expect(belly.color.getHexString()).toBe('445566')
    expect(body.depthWrite).toBe(true)
    expect(body.blending).toBe(NormalBlending)
  })

  it('dispose libera cada material uma unica vez e nao toca no holo', () => {
    const holo = holoFixture()
    const dark = darkFixture()
    const holoDispose = vi.spyOn(holo, 'dispose')
    const darkDispose = vi.spyOn(dark, 'dispose')
    const factory = createRoleMaterialFactory({ look: 'storybook', holo, dark })

    const body = factory.materialFor('body')
    const belly = factory.materialFor('belly')
    const bodyDispose = vi.spyOn(body, 'dispose')
    const bellyDispose = vi.spyOn(belly, 'dispose')

    factory.dispose()
    factory.dispose()

    expect(bodyDispose).toHaveBeenCalledTimes(1)
    expect(bellyDispose).toHaveBeenCalledTimes(1)
    expect(holoDispose).not.toHaveBeenCalled()
    expect(darkDispose).not.toHaveBeenCalled()
  })

  it('papeis desconhecidos caem no material de corpo', () => {
    const storybook = createRoleMaterialFactory({
      look: 'storybook',
      holo: holoFixture(),
      dark: darkFixture()
    })
    const body = storybook.materialFor('body')
    expect(storybook.materialFor('inexistente' as CaterpillarMaterialRole)).toBe(body)

    const holo = holoFixture()
    const holoFactory = createRoleMaterialFactory({
      look: 'holo',
      holo,
      dark: darkFixture()
    })
    expect(holoFactory.materialFor('inexistente' as CaterpillarMaterialRole)).toBe(holo)
  })
})
