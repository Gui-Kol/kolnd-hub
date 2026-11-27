import { BackSide, BoxGeometry, Mesh, MeshBasicMaterial, MeshToonMaterial } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { buildCaterpillar } from './caterpillar'
import {
  DEFAULT_OUTLINE_STRENGTH,
  OUTLINE_NAME,
  OUTLINE_SCALE_MAX,
  OUTLINE_SCALE_MIN,
  addOutlines,
  createOutline,
  isOutlineExcluded,
  removeOutlines
} from './outline'

function boxMesh(name = 'caterpillar-segment-0'): Mesh {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
  mesh.name = name
  return mesh
}

describe('contorno (outline)', () => {
  it('força 0 não cria contorno', () => {
    const mesh = boxMesh()
    expect(createOutline(mesh, { outlineStrength: 0 })).toBeNull()
    expect(mesh.children.filter((child) => child.name === OUTLINE_NAME)).toHaveLength(0)
    // addOutlines com força 0 não cria nada.
    expect(addOutlines(mesh, { outlineStrength: 0 })).toHaveLength(0)
  })

  it('contorno usa BackSide e depthWrite true', () => {
    const mesh = boxMesh()
    const handle = createOutline(mesh, { outlineStrength: DEFAULT_OUTLINE_STRENGTH })
    expect(handle).not.toBeNull()
    const outline = handle!.mesh
    const material = outline.material as MeshBasicMaterial

    expect(material.side).toBe(BackSide)
    expect(material.depthWrite).toBe(true)
    // Não herda depthWrite:false de um material holográfico de origem.
    const holoSource = new Mesh(new BoxGeometry(1, 1, 1), new MeshToonMaterial())
    ;(holoSource.material as MeshToonMaterial).depthWrite = false
    const holoOutline = createOutline(holoSource, { outlineStrength: 0.7 })!
    expect((holoOutline.mesh.material as MeshBasicMaterial).depthWrite).toBe(true)
    holoOutline.dispose()

    // Filho do mesh, com escala 1.03-1.05 no eixo normal.
    expect(outline.parent).toBe(mesh)
    expect(outline.name).toBe(OUTLINE_NAME)
    expect(outline.scale.x).toBeGreaterThanOrEqual(OUTLINE_SCALE_MIN)
    expect(outline.scale.x).toBeLessThanOrEqual(OUTLINE_SCALE_MAX)
    expect(outline.scale.x).toBeCloseTo(outline.scale.y, 6)
    expect(outline.scale.x).toBeCloseTo(outline.scale.z, 6)

    // Geometria clonada (não compartilha o buffer da origem), material próprio.
    expect(outline.geometry).not.toBe(mesh.geometry)
    expect(outline.geometry.attributes.position.count).toBe(mesh.geometry.attributes.position.count)

    handle!.dispose()
  })

  it('nós excluídos não recebem contorno', () => {
    const build = buildCaterpillar({ seed: 3 })
    try {
      build.root.updateMatrixWorld(true)
      const handles = addOutlines(build.root, { outlineStrength: 0.7 })
      const outlinedSources = new Set(handles.map((handle) => handle.source.name))

      // Exclusões explícitas da task.
      const excluded = [
        'caterpillar-pupil',
        'caterpillar-highlight',
        'caterpillar-eyelid-shell',
        'caterpillar-sclera',
        'caterpillar-iris',
        'caterpillar-nose',
        'caterpillar-nostril-left',
        'caterpillar-mouth-interior',
        'caterpillar-lip-upper',
        'caterpillar-pipe-hose',
        'caterpillar-pipe-mouthpiece',
        'caterpillar-pipe-smoke'
      ]
      for (const name of excluded) {
        expect(outlinedSources.has(name)).toBe(false)
        const node = build.root.getObjectByName(name)
        if (node) {
          expect(isOutlineExcluded(node)).toBe(true)
          expect(node.children.some((child) => child.name === OUTLINE_NAME)).toBe(false)
        }
      }

      // Liças finas do turbante nunca recebem contorno.
      build.root.traverse((object) => {
        if (object.name.includes('caterpillar-turban-wrap')) {
          expect(object.children.some((child) => child.name === OUTLINE_NAME)).toBe(false)
        }
      })

      // Baforada e cachimbo fora dos grupos de silhueta também não.
      const smoke = build.root.getObjectByName('caterpillar-pipe-smoke')
      expect(smoke?.children.some((child) => child.name === OUTLINE_NAME)).toBe(false)

      for (const handle of handles) handle.dispose()
    } finally {
      build.dispose()
    }
  })

  it('dispose do contorno é idempotente', () => {
    const mesh = boxMesh()
    const handle = createOutline(mesh, { outlineStrength: 0.7 })!
    const outline = handle.mesh
    const geometryDispose = vi.spyOn(outline.geometry, 'dispose')
    const materialDispose = vi.spyOn(outline.material as MeshBasicMaterial, 'dispose')

    handle.dispose()
    handle.dispose()

    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(mesh.children.filter((child) => child.name === OUTLINE_NAME)).toHaveLength(0)
  })

  it('removeOutlines limpa contornos sob a raiz', () => {
    const mesh = boxMesh()
    createOutline(mesh, { outlineStrength: 0.7 })
    expect(mesh.children.some((child) => child.name === OUTLINE_NAME)).toBe(true)
    removeOutlines(mesh)
    expect(mesh.children.some((child) => child.name === OUTLINE_NAME)).toBe(false)
    // Idempotente.
    expect(() => removeOutlines(mesh)).not.toThrow()
  })
})
