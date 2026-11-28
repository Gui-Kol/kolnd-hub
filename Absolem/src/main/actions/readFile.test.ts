import { describe, expect, it, vi } from 'vitest'
import { READ_MAX_BYTES, readTextFile, type ReadFileFs } from './readFile'

/**
 * Leitura (T5) com `fs` fake: nenhum arquivo real do usuário é acessado.
 */

const ROOTS = ['C:\\Users\\Ana\\Documents']

function createFs(options: {
  resolved?: string
  content?: Buffer
  size?: number
  notFile?: boolean
}): ReadFileFs {
  return {
    realpath: vi.fn(async () => options.resolved ?? 'C:\\Users\\Ana\\Documents\\nota.md'),
    stat: vi.fn(async () => ({
      size: options.size ?? options.content?.length ?? 0,
      isFile: () => options.notFile !== true
    })),
    readPrefix: vi.fn(async () => options.content ?? Buffer.from('conteudo'))
  }
}

describe('leitura de arquivo', () => {
  it('caminho fora da raiz é recusado', async () => {
    const fs = createFs({ resolved: 'C:\\Users\\Ana\\Desktop\\segredo.md' })

    await expect(
      readTextFile({ fs, roots: ROOTS }, { path: 'C:\\Users\\Ana\\Desktop\\segredo.md' })
    ).rejects.toThrow(/raízes permitidas/)
    expect(fs.readPrefix).not.toHaveBeenCalled()
  })

  it('UNC é recusado antes de tocar no disco', async () => {
    const fs = createFs({})

    await expect(
      readTextFile({ fs, roots: ROOTS }, { path: '\\\\servidor\\share\\nota.md' })
    ).rejects.toThrow(/UNC/)
    expect(fs.realpath).not.toHaveBeenCalled()
    expect(fs.stat).not.toHaveBeenCalled()
  })

  it('binário (byte nulo) é recusado', async () => {
    const fs = createFs({ content: Buffer.from([0x61, 0x00, 0x62]) })

    await expect(
      readTextFile({ fs, roots: ROOTS }, { path: 'C:\\Users\\Ana\\Documents\\nota.md' })
    ).rejects.toThrow(/binário/)
  })

  it('1,5 MB trunca em 1 MB', async () => {
    const content = Buffer.alloc(1_500_000, 0x61)
    const fs = createFs({ content, size: content.length })

    const result = await readTextFile(
      { fs, roots: ROOTS },
      { path: 'C:\\Users\\Ana\\Documents\\grande.log' }
    )

    expect(result.truncated).toBe(true)
    expect(result.bytes).toBe(READ_MAX_BYTES)
    expect(Buffer.byteLength(result.text, 'utf8')).toBe(READ_MAX_BYTES)
  })

  it('symlink para fora da raiz é recusado', async () => {
    const fs = createFs({ resolved: 'C:\\Users\\Ana\\Segredo\\credenciais.md' })

    await expect(
      readTextFile({ fs, roots: ROOTS }, { path: 'C:\\Users\\Ana\\Documents\\link.md' })
    ).rejects.toThrow(/raízes permitidas/)
  })
})
