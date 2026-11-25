import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  spawn: vi.fn(),
  treeKill: vi.fn(),
  isWingetAvailable: vi.fn(() => true),
  logInfo: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('child_process', () => ({ spawn: mocks.spawn }))
vi.mock('tree-kill', () => ({ default: mocks.treeKill, __esModule: true }))
vi.mock('./silentInstaller', () => ({ isWingetAvailable: mocks.isWingetAvailable }))
vi.mock('./logger', () => ({
  logger: { info: mocks.logInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

interface FakeProc extends EventEmitter {
  pid?: number
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

type Module = typeof import('./wingetUpdater')

let mod: Module
let children: FakeProc[]

function makeChild(pid: number): FakeProc {
  const proc = new EventEmitter() as FakeProc
  proc.pid = pid
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = vi.fn()
  return proc
}

function finish(proc: FakeProc, output: string, code: number | null = 0): void {
  if (output) proc.stdout.emit('data', Buffer.from(output))
  proc.emit('close', code)
}

/** Deixa a cadeia assíncrona do updater chegar ao próximo spawn. */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

const TABLE = [
  'Name    Id       Version   Available   Source',
  '----------------------------------------------',
  'App     A.B.App  1.0.0     2.0.0       winget',
  'Outro   C.D.App  3.0       4.0         winget',
  '16 upgrades available.'
].join('\n')

const JSON_UPGRADES = JSON.stringify([
  {
    PackageIdentifier: 'A.B.App',
    PackageName: 'App',
    Version: '1.0.0',
    AvailableVersion: '2.0.0'
  }
])

beforeEach(async () => {
  vi.resetModules()
  vi.useRealTimers()
  vi.clearAllMocks()
  mocks.handlers.clear()
  mocks.spawn.mockReset()
  mocks.treeKill.mockReset()
  mocks.isWingetAvailable.mockReturnValue(true)
  children = []
  // Cada spawn cria um filho controlável e o deixa disponível em `children`.
  mocks.spawn.mockImplementation(() => {
    const proc = makeChild(100 + children.length)
    children.push(proc)
    return proc
  })
  mod = await import('./wingetUpdater')
})

describe('listUpgradable — suporte a JSON', () => {
  it('detecta --output json na primeira chamada e cacheia para as próximas', async () => {
    const promise = mod.listUpgradable()
    finish(children[0], JSON_UPGRADES)
    await expect(promise).resolves.toEqual([
      { name: 'App', id: 'A.B.App', currentVersion: '1.0.0', availableVersion: '2.0.0' }
    ])

    const secondPromise = mod.listUpgradable()
    finish(children[1], '[]')
    await expect(secondPromise).resolves.toEqual([])

    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    expect(mocks.spawn.mock.calls[0][1]).toContain('--output')
  })

  it('JSON inválido depois do probe vira WingetParseError', async () => {
    const promise = mod.listUpgradable()
    finish(children[0], JSON_UPGRADES)
    await promise

    const secondPromise = mod.listUpgradable()
    finish(children[1], 'não é json')
    await expect(secondPromise).rejects.toBeInstanceOf(mod.WingetParseError)
  })

  it('probe sem JSON cai para a tabela posicional', async () => {
    const promise = mod.listUpgradable()
    finish(children[0], 'error: argument --output não reconhecido', 1)
    await tick()

    finish(children[1], TABLE)
    const items = await promise
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      name: 'App',
      id: 'A.B.App',
      currentVersion: '1.0.0',
      availableVersion: '2.0.0'
    })
  })

  it('tabela degenerada com --accept-* refaz sem as flags e cacheia a decisão', async () => {
    const promise = mod.listUpgradable()
    finish(children[0], 'sem json', 1)
    await tick()

    finish(children[1], 'Multiple installed packages found matching input criteria. Please refine.')
    await tick() // deixa o catch disparar o fallback

    finish(children[2], TABLE)
    await expect(promise).resolves.toHaveLength(2)

    expect(mocks.spawn.mock.calls[2][1]).toEqual(['upgrade'])
    expect(mocks.logInfo).toHaveBeenCalledWith(
      'winget',
      expect.stringContaining('tentando sem as flags')
    )

    // Cacheado: a próxima listagem usa direto `upgrade` (sem --accept-*).
    const next = mod.listUpgradable()
    finish(children[3], TABLE)
    await expect(next).resolves.toHaveLength(2)
    expect(mocks.spawn.mock.calls[3][1]).toEqual(['upgrade'])
  })

  it('fallback sem as flags também falhando propaga o erro de parse', async () => {
    const promise = mod.listUpgradable()
    finish(children[0], 'sem json', 1)
    await tick()

    finish(children[1], 'Multiple installed packages found')
    await tick()

    finish(children[2], 'continua ilegível')
    await expect(promise).rejects.toBeInstanceOf(mod.WingetParseError)
  })

  it('timeout do winget vira erro amigável', async () => {
    vi.useFakeTimers()
    const promise = mod.listUpgradable()
    const expectation = expect(promise).rejects.toThrow('demorou demais')
    await vi.advanceTimersByTimeAsync(180_000)
    await expectation
    expect(children[0].kill).toHaveBeenCalled()
  })
})

describe('upgradeOne', () => {
  it('sucesso junta stdout e stderr e devolve o log', async () => {
    const promise = mod.upgradeOne('A.B.App')
    children[0].stdout.emit('data', 'baixando\n')
    children[0].stderr.emit('data', 'aviso\n')
    children[0].emit('close', 0)

    await expect(promise).resolves.toEqual({
      ok: true,
      exitCode: 0,
      log: 'baixando\naviso'
    })
  })

  it('código diferente de zero → ok=false com o log', async () => {
    const promise = mod.upgradeOne('A.B.App')
    children[0].stdout.emit('data', 'falhou')
    children[0].emit('close', 5)
    await expect(promise).resolves.toEqual({ ok: false, exitCode: 5, log: 'falhou' })
  })

  it('erro do processo inclui a mensagem no log', async () => {
    const promise = mod.upgradeOne('A.B.App')
    children[0].stdout.emit('data', 'parcial')
    children[0].emit('error', new Error('EACCES'))
    await expect(promise).resolves.toEqual({
      ok: false,
      exitCode: null,
      log: 'parcial\nEACCES'
    })
  })

  it('erro antes de qualquer saída usa só a mensagem', async () => {
    const promise = mod.upgradeOne('A.B.App')
    children[0].emit('error', new Error('ENOENT'))
    await expect(promise).resolves.toMatchObject({ log: 'ENOENT' })
  })

  it('spawn lançando vira resultado de erro', async () => {
    mocks.spawn.mockImplementationOnce(() => {
      throw new Error('spawn falhou')
    })
    await expect(mod.upgradeOne('A.B.App')).resolves.toEqual({
      ok: false,
      exitCode: null,
      log: 'Error: spawn falhou'
    })
  })

  it('só uma atualização por vez', async () => {
    const first = mod.upgradeOne('A.B.App')
    await expect(mod.upgradeOne('C.D.App')).resolves.toEqual({
      ok: false,
      exitCode: null,
      log: 'Já existe uma atualização em andamento.'
    })
    children[0].emit('close', 0)
    await first
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
  })
})

describe('killUpgrade', () => {
  it('sem atualização em andamento → erro', () => {
    expect(mod.killUpgrade()).toEqual({
      ok: false,
      error: 'Nenhuma atualização em andamento.'
    })
  })

  it('mata a árvore com SIGTERM e escala para SIGKILL em caso de erro', () => {
    const pending = mod.upgradeOne('A.B.App')
    void pending

    mocks.treeKill.mockImplementationOnce(
      (_pid: number, _signal: string, cb: (err?: Error) => void) => cb(new Error('falhou'))
    )
    expect(mod.killUpgrade()).toEqual({ ok: true })
    expect(mocks.treeKill).toHaveBeenCalledWith(100, 'SIGTERM', expect.any(Function))
    expect(mocks.treeKill).toHaveBeenCalledWith(100, 'SIGKILL', expect.any(Function))

    children[0].emit('close', 0)
  })

  it('treeKill lançando vira erro', () => {
    const pending = mod.upgradeOne('A.B.App')
    void pending

    mocks.treeKill.mockImplementationOnce(() => {
      throw new Error('sem permissão')
    })
    expect(mod.killUpgrade()).toEqual({ ok: false, error: 'sem permissão' })
    children[0].emit('close', 0)
  })
})

describe('registerWingetIpc', () => {
  function call(channel: string, payload?: unknown): unknown {
    const handler = mocks.handlers.get(channel)
    if (!handler) throw new Error(`Handler ausente: ${channel}`)
    return payload === undefined ? handler({}) : handler({}, payload)
  }

  it('winget:list-upgrades informa quando o winget não existe', async () => {
    mod.registerWingetIpc()
    mocks.isWingetAvailable.mockReturnValue(false)
    await expect(call('winget:list-upgrades')).resolves.toMatchObject({
      ok: false,
      wingetMissing: true
    })
  })

  it('winget:list-upgrades devolve itens e erros de parse com rawLog', async () => {
    mod.registerWingetIpc()
    const list = call('winget:list-upgrades') as Promise<unknown>
    finish(children[0], JSON_UPGRADES)
    await expect(list).resolves.toMatchObject({ ok: true, items: [{ id: 'A.B.App' }] })

    const failing = call('winget:list-upgrades') as Promise<unknown>
    finish(children[1], 'saída estranha')
    await expect(failing).resolves.toMatchObject({
      ok: false,
      rawLog: 'saída estranha'
    })
  })

  it('winget:upgrade-one valida o id', async () => {
    mod.registerWingetIpc()
    for (const payload of [null, {}, { id: '' }, { id: '  ' }, { id: 'a\nb' }, { id: 5 }]) {
      await expect(call('winget:upgrade-one', payload)).resolves.toEqual({
        ok: false,
        exitCode: null,
        log: 'ID de pacote inválido.'
      })
    }
    await expect(call('winget:upgrade-one', { id: 'x'.repeat(263) })).resolves.toMatchObject({
      ok: false
    })
  })

  it('winget:upgrade-one avisa quando o winget não existe', async () => {
    mod.registerWingetIpc()
    mocks.isWingetAvailable.mockReturnValue(false)
    await expect(call('winget:upgrade-one', { id: 'A.B.App' })).resolves.toMatchObject({
      ok: false,
      exitCode: null,
      log: expect.stringContaining('winget')
    })
  })

  it('winget:upgrade-one atualiza um pacote válido', async () => {
    mod.registerWingetIpc()
    const promise = call('winget:upgrade-one', { id: ' A.B.App ' }) as Promise<unknown>
    children[0].stdout.emit('data', 'ok')
    children[0].emit('close', 0)
    await expect(promise).resolves.toEqual({ ok: true, exitCode: 0, log: 'ok' })
    expect(mocks.spawn).toHaveBeenCalledWith(
      'winget',
      expect.arrayContaining(['--id', 'A.B.App', '--exact']),
      expect.any(Object)
    )
  })

  it('winget:kill-upgrade reflete o cancelamento', () => {
    mod.registerWingetIpc()
    expect(call('winget:kill-upgrade')).toEqual({
      ok: false,
      error: 'Nenhuma atualização em andamento.'
    })
  })
})
