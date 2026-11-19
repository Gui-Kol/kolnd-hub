import { createHash } from 'crypto'
import { promises as fsp } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `appUpdates.ts` importa Electron e o logger no topo; os testes de
// `verifyFileDigest` só precisam do módulo carregado, não do app de verdade.
const mocks = vi.hoisted(() => ({
  getVersion: vi.fn(() => '1.4.0'),
  getPath: vi.fn(() => 'C:\\Temp')
}))

vi.mock('electron', () => ({
  app: {
    getVersion: mocks.getVersion,
    getPath: mocks.getPath,
    isPackaged: true
  }
}))
vi.mock('./logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('./ipc/lifecycle', () => ({ shutdownHub: vi.fn() }))

import { verifyFileDigest } from './appUpdates'

describe('verifyFileDigest', () => {
  let dir: string
  let filePath: string
  let digest: string

  beforeEach(async () => {
    dir = await fsp.mkdtemp(join(tmpdir(), 'kolnd-hub-updates-test-'))
    filePath = join(dir, 'setup.exe')
    // 1 MB: exercita o streaming sem deixar o teste lento.
    const content = Buffer.alloc(1024 * 1024, 7)
    await fsp.writeFile(filePath, content)
    digest = createHash('sha256').update(content).digest('hex')
  })

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true })
  })

  it('confere o SHA-256 do arquivo em disco', async () => {
    expect(await verifyFileDigest(filePath, digest)).toBe(true)
    // Aceita o formato do GitHub (`sha256:<hex>`) e maiúsculas.
    expect(await verifyFileDigest(filePath, `sha256:${digest.toUpperCase()}`)).toBe(true)
  })

  it('recusa quando o hash não confere (arquivo trocado)', async () => {
    expect(await verifyFileDigest(filePath, 'a'.repeat(64))).toBe(false)
  })

  it('devolve false sem lançar quando o arquivo não existe', async () => {
    await expect(verifyFileDigest(join(dir, 'nao-existe.exe'), digest)).resolves.toBe(false)
  })
})
