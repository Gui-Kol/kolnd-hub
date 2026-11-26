import { describe, expect, it, vi } from 'vitest'
import {
  UNDO_WINDOW_MS,
  applyFileOps,
  planFileOps,
  undoFileOp,
  type FileOpsDeps,
  type FileOpsFs,
  type StatLike
} from './fileOps'

/**
 * Organização de arquivos (T6) em filesystem fake. Nenhum arquivo real é
 * movido/copiado/apagado e a Lixeira é um spy.
 */

const ROOT = 'C:\\Docs'
const JOURNAL = 'C:\\UserData\\file-ops'

function statFor(files: Map<string, string>, dirs: Set<string>): (path: string) => StatLike {
  return (path: string) => {
    const isDir = dirs.has(path)
    const isFile = files.has(path)
    if (!isDir && !isFile) throw new Error(`ENOENT: ${path}`)
    return {
      size: isFile ? Buffer.byteLength(files.get(path) as string, 'utf8') : 0,
      isFile: () => isFile,
      isDirectory: () => isDir,
      isSymbolicLink: () => false
    }
  }
}

function createFs(initialFiles: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initialFiles))
  const dirs = new Set<string>([ROOT, 'C:\\Segredo', JOURNAL])
  const stat = statFor(files, dirs)
  const trash = vi.fn(async (path: string) => {
    files.delete(path)
  })
  const unlink = vi.fn(async (path: string) => {
    files.delete(path)
  })
  const fs: FileOpsFs = {
    realpath: async (path) => {
      if (!files.has(path) && !dirs.has(path)) throw new Error(`ENOENT: ${path}`)
      return path
    },
    lstat: async (path) => stat(path),
    stat: async (path) => stat(path),
    exists: async (path) => files.has(path) || dirs.has(path),
    rename: async (from, to) => {
      const value = files.get(from)
      if (value === undefined) throw new Error(`ENOENT: ${from}`)
      files.delete(from)
      files.set(to, value)
    },
    copyFile: async (from, to) => {
      const value = files.get(from)
      if (value === undefined) throw new Error(`ENOENT: ${from}`)
      files.set(to, value)
    },
    readFile: async (path) => {
      const value = files.get(path)
      if (value === undefined) throw new Error(`ENOENT: ${path}`)
      return value
    },
    writeFile: async (path, data) => {
      files.set(path, data)
    },
    mkdir: async () => undefined,
    unlink
  }
  return { fs, files, dirs, trash, unlink }
}

function depsFor(harness: ReturnType<typeof createFs>, now = () => 1_000): FileOpsDeps {
  return {
    fs: harness.fs,
    roots: [ROOT],
    journalDir: JOURNAL,
    trashItem: harness.trash,
    now,
    uuid: () => '11111111-1111-1111-1111-111111111111'
  }
}

describe('organização de arquivos', () => {
  it('plano recusa sobrescrita', async () => {
    const harness = createFs({ 'C:\\Docs\\a.txt': 'novo', 'C:\\Docs\\b.txt': 'antigo' })

    await expect(
      planFileOps(depsFor(harness), {
        ops: [{ kind: 'move', from: 'C:\\Docs\\a.txt', to: 'C:\\Docs\\b.txt' }]
      })
    ).rejects.toThrow(/sobrescrever/)
    expect(harness.files.get('C:\\Docs\\b.txt')).toBe('antigo')
  })

  it('destino fora da raiz é recusado', async () => {
    const harness = createFs({ 'C:\\Docs\\a.txt': 'conteudo' })

    await expect(
      planFileOps(depsFor(harness), {
        ops: [{ kind: 'move', from: 'C:\\Docs\\a.txt', to: 'C:\\Segredo\\a.txt' }]
      })
    ).rejects.toThrow(/raízes permitidas/)
    expect(harness.files.has('C:\\Segredo\\a.txt')).toBe(false)
  })

  it('undo reverte move', async () => {
    const harness = createFs({ 'C:\\Docs\\a.txt': 'conteudo' })
    const deps = depsFor(harness)
    const plan = await planFileOps(deps, {
      ops: [{ kind: 'move', from: 'C:\\Docs\\a.txt', to: 'C:\\Docs\\c.txt' }]
    })

    const applied = await applyFileOps(deps, plan)
    expect(applied.ok).toBe(true)
    expect(harness.files.has('C:\\Docs\\a.txt')).toBe(false)
    expect(harness.files.has('C:\\Docs\\c.txt')).toBe(true)
    expect(harness.files.has(`${JOURNAL}\\${applied.id}.json`)).toBe(true)

    const undone = await undoFileOp(
      depsFor(harness, () => 2_000),
      applied.id
    )
    expect(undone).toEqual({ ok: true, id: applied.id, undone: 1 })
    expect(harness.files.get('C:\\Docs\\a.txt')).toBe('conteudo')
    expect(harness.files.has('C:\\Docs\\c.txt')).toBe(false)
    expect(harness.trash).not.toHaveBeenCalled()
  })

  it('undo após 24 h é recusado', async () => {
    const harness = createFs({ 'C:\\Docs\\a.txt': 'conteudo' })
    const deps = depsFor(harness, () => 0)
    const plan = await planFileOps(deps, {
      ops: [{ kind: 'move', from: 'C:\\Docs\\a.txt', to: 'C:\\Docs\\c.txt' }]
    })
    const applied = await applyFileOps(deps, plan)

    await expect(
      undoFileOp(
        depsFor(harness, () => UNDO_WINDOW_MS + 1),
        applied.id
      )
    ).rejects.toThrow(/24 h/)
    expect(harness.files.has('C:\\Docs\\c.txt')).toBe(true)
  })

  it('delete usa trashItem e nunca unlink', async () => {
    const harness = createFs({ 'C:\\Docs\\lixo.txt': 'conteudo' })
    const deps = depsFor(harness)
    const plan = await planFileOps(deps, {
      ops: [{ kind: 'delete', from: 'C:\\Docs\\lixo.txt' }]
    })

    const applied = await applyFileOps(deps, plan)

    expect(applied.ok).toBe(true)
    expect(harness.trash).toHaveBeenCalledWith('C:\\Docs\\lixo.txt')
    expect(harness.unlink).not.toHaveBeenCalled()
    expect(harness.files.has('C:\\Docs\\lixo.txt')).toBe(false)
  })
})
