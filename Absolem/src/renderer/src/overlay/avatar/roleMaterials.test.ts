import { MeshBasicMaterial, MeshPhongMaterial, MeshToonMaterial, NormalBlending } from 'three'
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

  it('storybook devolve MeshToonMaterial para body', () => {
    const factory = createRoleMaterialFactory({
      look: 'storybook',
      holo: holoFixture(),
      dark: darkFixture()
    })

    const body = factory.materialFor('body')
    expect(body).toBeInstanceOf(MeshToonMaterial)
    // MeshToonMaterial sem gradientMap cai em lambertiano e não vale.
    expect((body as MeshToonMaterial).gradientMap).not.toBeNull()

    // Papéis orgânicos também são toon com rampa.
    for (const role of [
      'belly',
      'head',
      'hand',
      'sleeve',
      'turban',
      'turbanStripe',
      'lip',
      'brow',
      'eyelid'
    ] as const) {
      const material = factory.materialFor(role)
      expect(material).toBeInstanceOf(MeshToonMaterial)
      expect((material as MeshToonMaterial).gradientMap).not.toBeNull()
    }

    // pupil/mouth não recebem luz; highlight é basic.
    expect(factory.materialFor('pupil')).toBeInstanceOf(MeshBasicMaterial)
    expect(factory.materialFor('mouth')).toBeInstanceOf(MeshBasicMaterial)
    expect(factory.materialFor('pupil')).not.toBeInstanceOf(MeshToonMaterial)

    factory.dispose()
  })

  it('pipe é Phong com shininess > 40', () => {
    const factory = createRoleMaterialFactory({
      look: 'storybook',
      holo: holoFixture(),
      dark: darkFixture()
    })

    for (const role of ['pipe', 'hose'] as const) {
      const material = factory.materialFor(role)
      expect(material).toBeInstanceOf(MeshPhongMaterial)
      expect((material as MeshPhongMaterial).shininess).toBeGreaterThan(40)
      const specular = (material as MeshPhongMaterial).specular
      // specular claro (leitura metálica).
      expect(specular.r + specular.g + specular.b).toBeGreaterThan(1.5)
    }

    factory.dispose()
  })

  it('highlight é Basic', () => {
    const factory = createRoleMaterialFactory({
      look: 'storybook',
      holo: holoFixture(),
      dark: darkFixture()
    })

    const highlight = factory.materialFor('highlight')
    expect(highlight).toBeInstanceOf(MeshBasicMaterial)
    expect(highlight).not.toBeInstanceOf(MeshToonMaterial)
    expect(highlight).not.toBeInstanceOf(MeshPhongMaterial)

    factory.dispose()
  })

  it('o cache devolve a mesma instância para o mesmo papel', () => {
    const factory = createRoleMaterialFactory({
      look: 'storybook',
      holo: holoFixture(),
      dark: darkFixture()
    })

    const first = factory.materialFor('body')
    expect(factory.materialFor('body')).toBe(first)
    expect(factory.materialFor('pipe')).toBe(factory.materialFor('pipe'))

    factory.dispose()
  })

  it('holo continua devolvendo o holoMaterial compartilhado', () => {
    const holo = holoFixture()
    const factory = createRoleMaterialFactory({ look: 'holo', holo, dark: darkFixture() })

    expect(factory.materialFor('body')).toBe(holo)
    expect(factory.materialFor('belly')).toBe(holo)
    expect(factory.materialFor('pipe')).toBe(holo)
    expect(factory.materialFor('highlight')).toBe(holo)
    expect(factory.materialFor('pupil')).not.toBe(holo)
    expect(factory.materialFor('mouth')).not.toBe(holo)
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
