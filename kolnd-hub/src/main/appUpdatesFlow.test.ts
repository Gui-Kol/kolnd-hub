import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  packaged: true,
  version: '1.0.0',
  temp: '',
  httpQueue: [] as HttpSpec[],
  children: [] as EventEmitter[],
  logWarn: vi.fn()
}))

interface HttpSpec {
  status?: number
  body?: string | Buffer
  location?: string
  headers?: Record<string, string>
  error?: Error
  hold?: boolean
}

const httpsMock = vi.hoisted(() => ({ get: vi.fn() }))
const execFileMock = vi.hoisted(() => ({ execFile: vi.fn() }))
const spawnMock = vi.hoisted(() => ({ spawn: vi.fn() }))
const lifecycleMock = vi.hoisted(() => ({ shutdownHub: vi.fn() }))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.packaged
    },
    getVersion: () => state.version,
    getPath: () => state.temp
  }
}))
vi.mock('https', () => ({ get: httpsMock.get }))
vi.mock('child_process', () => ({ execFile: execFileMock.execFile, spawn: spawnMock.spawn }))
vi.mock('./ipc/lifecycle', () => ({ shutdownHub: lifecycleMock.shutdownHub }))
vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: state.logWarn, error: vi.fn(), debug: vi.fn() }
}))

type Module = typeof import('./appUpdates')

let mod: Module
let root: string
const held: Array<{ res: PassThrough }> = []

function releasePayload(bytes: Buffer, overrides: Record<string, unknown> = {}): string {
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  const assetOverrides = (overrides.asset ?? {}) as Record<string, unknown>
  const releaseOverrides = (overrides.release ?? {}) as Record<string, unknown>
  return JSON.stringify({
    id: 77,
    tag_name: 'v9.9.9',
    name: 'Kolnd Hub 9.9.9',
    html_url: 'https://github.com/Gui-Kol/kolnd-hub/releases/tag/v9.9.9',
    published_at: '2026-01-01T00:00:00Z',
    body: 'notas',
    assets: [
      {
        name: "Kolnd's: Hub?Setup.exe",
        size: bytes.length,
        browser_download_url:
          'https://github.com/Gui-Kol/kolnd-hub/releases/download/v9.9.9/setup.exe',
        digest,
        ...assetOverrides
      }
    ],
    ...releaseOverrides
  })
}

function setupHttp(queue: HttpSpec[]): void {
  state.httpQueue = queue
  httpsMock.get.mockImplementation(
    (_url: string, _options: unknown, cb: (res: unknown) => void) => {
      const spec = state.httpQueue.shift() ?? { status: 500, body: 'sem resposta' }
      const req = new EventEmitter() as EventEmitter & { destroy: (err?: Error) => void }
      req.destroy = (err?: Error): void => {
        if (err) req.emit('error', err)
      }
      ;(req as unknown as { setTimeout: () => void }).setTimeout = (): void => {}
      queueMicrotask(() => {
        const res = new PassThrough() as PassThrough & {
          statusCode?: number
          headers: Record<string, string>
        }
        res.statusCode = spec.status ?? 200
        res.headers = {
          ...(spec.location ? { location: spec.location } : {}),
          ...(spec.headers ?? {})
        }
        cb(res)
        if (spec.hold) {
          held.push({ res })
          return
        }
        if (spec.error) {
          res.emit('error', spec.error)
          return
        }
        res.end(spec.body ?? '')
      })
      return req
    }
  )
}

function setupSignature(status = 'NotSigned', fail = false): void {
  execFileMock.execFile.mockImplementation(
    (
      _file: string,
      _args: string[],
      _options: unknown,
      cb: (err: Error | null, stdout?: string) => void
    ) => {
      process.nextTick(() => {
        if (fail) cb(new Error('powershell falhou'))
        else cb(null, JSON.stringify({ Status: status, Subject: null }))
      })
    }
  )
}

function setupSpawn(emitSpawn = true): void {
  spawnMock.spawn.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> }
    child.unref = vi.fn()
    state.children.push(child)
    if (emitSpawn) process.nextTick(() => child.emit('spawn'))
    return child
  })
}

const ctx = {
  getMainWindow: () => null
} as unknown as import('./ipc/lifecycle').IpcContext

beforeEach(async () => {
  vi.resetModules()
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  delete process.env.KOLDND_HUB_TEST_USERDATA
  delete process.env.KOLND_HUB_FORCE_UPDATE
  state.packaged = true
  state.version = '1.0.0'
  state.children = []
  state.httpQueue = []
  held.length = 0
  root = await mkdtemp(join(tmpdir(), 'kolnd-updates-flow-'))
  state.temp = root
  setupSignature()
  setupSpawn()
  mod = await import('./appUpdates')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('checkForUpdate / fetchLatestRelease', () => {
  it('KOLDND_HUB_TEST_USERDATA desliga a consulta de rede', async () => {
    process.env.KOLDND_HUB_TEST_USERDATA = '1'
    await expect(mod.checkForUpdate()).resolves.toEqual({
      ok: true,
      release: null,
      updateAvailable: false,
      canAutoInstall: false
    })
    expect(httpsMock.get).not.toHaveBeenCalled()
  })

  it('release mais nova, instalador e digest → updateAvailable/canAutoInstall', async () => {
    const bytes = Buffer.from('setup')
    setupHttp([{ body: releasePayload(bytes) }])
    const result = await mod.checkForUpdate()
    expect(result.ok).toBe(true)
    expect(result.updateAvailable).toBe(true)
    expect(result.canAutoInstall).toBe(true)
    expect(result.release).toMatchObject({ id: 77, tag: 'v9.9.9' })
  })

  it('404 → nenhuma release e nenhum banner', async () => {
    setupHttp([{ status: 404 }])
    await expect(mod.fetchLatestRelease()).resolves.toBeNull()
    setupHttp([{ status: 404 }])
    await expect(mod.checkForUpdate()).resolves.toMatchObject({
      ok: true,
      release: null,
      updateAvailable: false
    })
  })

  it('tag fora do SemVer não vira atualização e é logada', async () => {
    setupHttp([
      { body: releasePayload(Buffer.from('x'), { release: { tag_name: 'versao-nova' } }) }
    ])
    const result = await mod.checkForUpdate()
    expect(result.updateAvailable).toBe(false)
  })

  it('KOLND_HUB_FORCE_UPDATE força o banner', async () => {
    process.env.KOLND_HUB_FORCE_UPDATE = '1'
    setupHttp([{ body: releasePayload(Buffer.from('x'), { release: { tag_name: 'v0.0.1' } }) }])
    await expect(mod.checkForUpdate()).resolves.toMatchObject({ updateAvailable: true })
  })

  it('HTTP inesperado, JSON inválido e release sem instalador viram resultado seguro', async () => {
    setupHttp([{ status: 500, body: 'erro' }])
    await expect(mod.checkForUpdate()).resolves.toMatchObject({
      ok: false,
      error: 'Não foi possível verificar atualizações.'
    })

    setupHttp([{ body: '{quebrado' }])
    await expect(mod.checkForUpdate()).resolves.toMatchObject({ ok: false })

    setupHttp([{ body: releasePayload(Buffer.from('x'), { release: { assets: [] } }) }])
    await expect(mod.checkForUpdate()).resolves.toMatchObject({ canAutoInstall: false })
  })

  it('erro de rede é silencioso e não derruba o app', async () => {
    setupHttp([{ error: new Error('ECONNRESET') }])
    await expect(mod.checkForUpdate()).resolves.toMatchObject({ ok: false })
  })
})

describe('cancelUpdate', () => {
  it('sem instalação em andamento não cancela nada', () => {
    expect(mod.cancelUpdate()).toEqual({ ok: false, cancelled: false })
  })
})

describe('installUpdate — validações', () => {
  it('recusa releaseId inválido', async () => {
    for (const id of ['77', 0, -1, 1.5, null]) {
      await expect(mod.installUpdate(ctx, id)).resolves.toEqual({
        ok: false,
        error: 'Release inválida para atualização.'
      })
    }
  })

  it('recusa quando o app não está empacotado', async () => {
    state.packaged = false
    await expect(mod.installUpdate(ctx, 77)).resolves.toEqual({
      ok: false,
      error: 'A atualização automática só funciona no app instalado. Use a página do release.'
    })
  })

  it('release sumiu, sem instalador e sem digest → erros específicos', async () => {
    setupHttp([{ status: 404 }])
    await expect(mod.installUpdate(ctx, 77)).resolves.toEqual({
      ok: false,
      error: 'A release não está mais disponível no GitHub.'
    })

    setupHttp([{ body: releasePayload(Buffer.from('x'), { release: { assets: [] } }) }])
    await expect(mod.installUpdate(ctx, 77)).resolves.toMatchObject({
      error: 'A release não tem um instalador .exe anexado.'
    })

    setupHttp([{ body: releasePayload(Buffer.from('x'), { asset: { digest: null } }) }])
    const noDigest = await mod.installUpdate(ctx, 77)
    expect(noDigest.ok).toBe(false)
    expect(noDigest.error).toContain('hash SHA-256')
  })

  it('falha de rede vira erro amigável', async () => {
    setupHttp([{ error: new Error('sem rede') }])
    await expect(mod.installUpdate(ctx, 77)).resolves.toEqual({ ok: false, error: 'sem rede' })
    expect(state.logWarn).toHaveBeenCalled()
  })

  it('cancelamento durante a consulta ao GitHub devolve cancelled', async () => {
    setupHttp([{ body: '', hold: true }])
    const promise = mod.installUpdate(ctx, 77)
    await vi.waitFor(() => expect(held).toHaveLength(1))

    expect(mod.cancelUpdate()).toEqual({ ok: true, cancelled: true })
    held[0].res.end(releasePayload(Buffer.from('x')))

    await expect(promise).resolves.toMatchObject({ ok: false, cancelled: true })
  })
})

describe('installUpdate — download e execução', () => {
  it('baixa, confere SHA-256/assinatura, abre o instalador e encerra o Hub', async () => {
    const bytes = Buffer.from('conteúdo do instalador')
    const send = vi.fn()
    const windowCtx = {
      getMainWindow: () => ({ isDestroyed: () => false, webContents: { send } })
    } as unknown as import('./ipc/lifecycle').IpcContext

    vi.useFakeTimers()
    setupHttp([
      { body: releasePayload(bytes) },
      { body: bytes, headers: { 'content-length': String(bytes.length) } }
    ])

    const result = await mod.installUpdate(windowCtx, 77)
    expect(result).toEqual({ ok: true, action: 'installer' })

    const files = await fsp.readdir(join(root, 'kolnd-hub-updates'))
    expect(files).toHaveLength(1)
    expect(send).toHaveBeenCalledWith('update:progress', expect.objectContaining({ percent: 100 }))
    expect(spawnMock.spawn).toHaveBeenCalledWith(join(root, 'kolnd-hub-updates', files[0]), [], {
      detached: true,
      stdio: 'ignore'
    })

    expect(lifecycleMock.shutdownHub).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1500)
    expect(lifecycleMock.shutdownHub).toHaveBeenCalledWith(windowCtx)
  })

  it('assinatura recusada apaga o arquivo e cancela', async () => {
    setupSignature('HashMismatch')
    const bytes = Buffer.from('x')
    setupHttp([{ body: releasePayload(bytes) }, { body: bytes }])

    const result = await mod.installUpdate(ctx, 77)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('assinatura digital inválida')
    await expect(fsp.readdir(join(root, 'kolnd-hub-updates'))).resolves.toEqual([])
  })

  it('falha ao consultar a assinatura recusa por segurança', async () => {
    setupSignature('Valid', true)
    const bytes = Buffer.from('x')
    setupHttp([{ body: releasePayload(bytes) }, { body: bytes }])
    await expect(mod.installUpdate(ctx, 77)).resolves.toMatchObject({ ok: false })
  })

  it('hash do download não confere → download abortado', async () => {
    const bytes = Buffer.from('outro conteúdo')
    const published = Buffer.from('conteúdo publicado')
    setupHttp([
      { body: releasePayload(published, { asset: { size: bytes.length } }) },
      { body: bytes }
    ])

    const result = await mod.installUpdate(ctx, 77)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('SHA-256 publicado')
  })

  it('tamanho menor que o publicado → download incompleto', async () => {
    const bytes = Buffer.from('curto')
    setupHttp([
      { body: releasePayload(Buffer.from('mais longo'), { asset: { size: bytes.length + 10 } }) },
      { body: bytes }
    ])
    await expect(mod.installUpdate(ctx, 77)).resolves.toMatchObject({
      error: expect.stringContaining('incompleto')
    })
  })

  it('redirecionamento permitido é seguido até o download', async () => {
    const bytes = Buffer.from('via cdn')
    setupHttp([
      { body: releasePayload(bytes) },
      {
        status: 302,
        location: 'https://objects.githubusercontent.com/arquivo/installer.exe'
      },
      { body: bytes }
    ])
    await expect(mod.installUpdate(ctx, 77)).resolves.toEqual({ ok: true, action: 'installer' })
  })

  it('redirecionamento fora do GitHub é bloqueado', async () => {
    setupHttp([
      { body: releasePayload(Buffer.from('x')) },
      { status: 302, location: 'https://evil.example.com/installer.exe' }
    ])
    await expect(mod.installUpdate(ctx, 77)).resolves.toMatchObject({
      error: 'O download saiu do GitHub e foi bloqueado.'
    })
  })

  it('excesso de redirecionamentos é interrompido', async () => {
    const redirects: HttpSpec[] = [{ body: releasePayload(Buffer.from('x')) }]
    for (let index = 0; index < 6; index += 1) {
      redirects.push({
        status: 302,
        location: 'https://objects.githubusercontent.com/arquivo/installer.exe'
      })
    }
    setupHttp(redirects)
    await expect(mod.installUpdate(ctx, 77)).resolves.toMatchObject({
      error: 'Muitos redirecionamentos ao baixar o instalador.'
    })
  })

  it('HTTP diferente de 200 no download vira erro', async () => {
    setupHttp([{ body: releasePayload(Buffer.from('x')) }, { status: 500 }])
    await expect(mod.installUpdate(ctx, 77)).resolves.toMatchObject({
      error: 'GitHub respondeu HTTP 500 ao baixar o instalador.'
    })
  })

  it('cancelamento durante o download devolve cancelled', async () => {
    const bytes = Buffer.from('x'.repeat(100))
    setupHttp([{ body: releasePayload(bytes) }, { body: '', hold: true }])

    const promise = mod.installUpdate(ctx, 77)
    await vi.waitFor(() => expect(held).toHaveLength(1))
    expect(mod.cancelUpdate()).toEqual({ ok: true, cancelled: true })
    held[0].res.destroy(new Error('cancelado'))

    await expect(promise).resolves.toMatchObject({ ok: false, cancelled: true })
  })

  it('já existe uma atualização em andamento', async () => {
    const bytes = Buffer.from('x')
    setupHttp([{ body: releasePayload(bytes) }, { body: bytes }])
    setupSpawn(false)

    const first = mod.installUpdate(ctx, 77)
    await vi.waitFor(() => expect(state.children).toHaveLength(1))
    await expect(mod.installUpdate(ctx, 77)).resolves.toEqual({
      ok: false,
      error: 'Uma atualização já está em andamento.'
    })

    state.children[0].emit('spawn')
    await expect(first).resolves.toEqual({ ok: true, action: 'installer' })
  })
})
