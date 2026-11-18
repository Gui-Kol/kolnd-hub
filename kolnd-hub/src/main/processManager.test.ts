import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { join } from 'path'
import {
  AUTO_RESTART_MAX_ATTEMPTS,
  AUTO_RESTART_WINDOW_MS,
  AUTO_RESTART_BACKOFF_MS,
  PERSIST_LOG_MAX_BYTES,
  STOP_GRACE_MS,
  STOP_FORCE_TIMEOUT_MS,
  KILL_ALL_DEADLINE_MS,
  TREE_KILL_TIMEOUT_MS,
  ProcessManager,
  pruneAttempts,
  shouldAutoRestart,
  autoRestartBackoffMs
} from './processManager'

const NOW = 1_700_000_000_000
const MIN = 60 * 1000

describe('pruneAttempts', () => {
  it('lista vazia → vazia', () => {
    expect(pruneAttempts([], NOW)).toEqual([])
  })

  it('mantém tentativas dentro da janela', () => {
    const dentro = [NOW - 9 * MIN, NOW - 1 * MIN, NOW]
    expect(pruneAttempts(dentro, NOW)).toEqual(dentro)
  })

  it('expira tentativas com mais de 10 minutos', () => {
    const antigas = [NOW - 11 * MIN, NOW - 10 * MIN - 1]
    const novas = [NOW - 10 * MIN + 1, NOW - 5 * MIN]
    expect(pruneAttempts([...antigas, ...novas], NOW)).toEqual(novas)
  })

  it('exatamente 10 minutos atrás já expirou (limite inferior exclusivo)', () => {
    expect(pruneAttempts([NOW - AUTO_RESTART_WINDOW_MS], NOW)).toEqual([])
  })

  it('descarta timestamps no futuro (defesa contra clock skew)', () => {
    expect(pruneAttempts([NOW + 1, NOW + MIN], NOW)).toEqual([])
  })

  it('mistura: mantém só as recentes e retorna em ordem de entrada', () => {
    expect(
      pruneAttempts([NOW - 20 * MIN, NOW - 3 * MIN, NOW - 30 * MIN, NOW - 1 * MIN], NOW)
    ).toEqual([NOW - 3 * MIN, NOW - 1 * MIN])
  })
})

describe('shouldAutoRestart', () => {
  it('0 tentativas na janela → true', () => {
    expect(shouldAutoRestart([], NOW)).toBe(true)
  })

  it('1 e 2 tentativas na janela → true', () => {
    expect(shouldAutoRestart([NOW - 1 * MIN], NOW)).toBe(true)
    expect(shouldAutoRestart([NOW - 1 * MIN, NOW - 2 * MIN], NOW)).toBe(true)
  })

  it('exatamente 3 tentativas na janela → false', () => {
    const tres = [NOW - 1 * MIN, NOW - 2 * MIN, NOW - 3 * MIN]
    expect(shouldAutoRestart(tres, NOW)).toBe(false)
    expect(tres.length).toBe(AUTO_RESTART_MAX_ATTEMPTS)
  })

  it('3 tentativas antigas (>10 min) não contam → true', () => {
    const antigas = [NOW - 11 * MIN, NOW - 15 * MIN, NOW - 60 * MIN]
    expect(shouldAutoRestart(antigas, NOW)).toBe(true)
  })

  it('2 recentes + 1 antiga (expirada) → true (2 contam)', () => {
    const mix = [NOW - 1 * MIN, NOW - 2 * MIN, NOW - 11 * MIN]
    expect(shouldAutoRestart(mix, NOW)).toBe(true)
  })

  it('3 recentes no limite da janela contam → false', () => {
    const tres = [NOW - 9 * MIN, NOW - 9.5 * MIN, NOW - 9.9 * MIN]
    expect(shouldAutoRestart(tres, NOW)).toBe(false)
  })

  it('limite 3 é o default; janela default é 10 min', () => {
    expect(AUTO_RESTART_MAX_ATTEMPTS).toBe(3)
    expect(AUTO_RESTART_WINDOW_MS).toBe(10 * 60 * 1000)
  })
})

describe('autoRestartBackoffMs', () => {
  it('ordem 1ª→2s, 2ª→5s, 3ª→10s', () => {
    expect(autoRestartBackoffMs(0)).toBe(2000)
    expect(autoRestartBackoffMs(1)).toBe(5000)
    expect(autoRestartBackoffMs(2)).toBe(10000)
  })

  it('além da 3ª tentativa, mantém 10s', () => {
    expect(autoRestartBackoffMs(3)).toBe(10000)
    expect(autoRestartBackoffMs(10)).toBe(10000)
  })

  it('tabela de backoff publicada é 2s/5s/10s', () => {
    expect([...AUTO_RESTART_BACKOFF_MS]).toEqual([2000, 5000, 10000])
  })

  it('índice inválido degrada para o primeiro backoff', () => {
    expect(autoRestartBackoffMs(-1)).toBe(2000)
    expect(autoRestartBackoffMs(NaN)).toBe(2000)
  })
})

// ── Log persistente por app (05-5.7) ─────────────────────────────────────────
// Mocks de spawn/fs para verificar o caminho de arquivo sem tocar no disco.

const fsState = vi.hoisted(() => ({
  /** Tamanho "atual" do arquivo de log — os testes mutam para simular rotação. */
  size: 0
}))

interface FakeStream {
  written: string
  write: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
}

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  statSync: vi.fn(() => ({ size: fsState.size })),
  // Simula o rename consumindo o arquivo (o stat seguinte não o vê mais).
  renameSync: vi.fn(() => {
    fsState.size = 0
  }),
  streams: [] as FakeStream[],
  createWriteStream: vi.fn(() => {
    const stream: FakeStream = {
      written: '',
      write: vi.fn((chunk: string) => {
        stream.written += chunk
        return true
      }),
      end: vi.fn(),
      on: vi.fn()
    }
    fsMock.streams.push(stream)
    return stream
  })
}))

vi.mock('fs', () => ({
  existsSync: fsMock.existsSync,
  mkdirSync: fsMock.mkdirSync,
  statSync: fsMock.statSync,
  renameSync: fsMock.renameSync,
  createWriteStream: fsMock.createWriteStream
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'C:\\fake-userdata') }
}))

vi.mock('./logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

const spawnMock = vi.hoisted(() => vi.fn())
const spawnSyncMock = vi.hoisted(() => vi.fn())
vi.mock('child_process', () => ({ spawn: spawnMock, spawnSync: spawnSyncMock }))

const treeKillMock = vi.hoisted(() => vi.fn())
vi.mock('tree-kill', () => ({ default: treeKillMock }))

interface FakeChild extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  pid: number
  exitCode: number | null
}

function makeFakeChild(pid = 4321): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.pid = pid
  // null = ainda vivo; o close do Node é quem preenche. A defesa de segunda
  // instância no launch() depende desse contrato.
  child.exitCode = null
  return child
}

const LOGS_DIR = join('C:', 'fake-logs')
const logPathFor = (appId: string): string => join(LOGS_DIR, `${appId}.log`)

function launchWithPref(persistLogs: boolean | undefined): {
  manager: ProcessManager
  child: FakeChild
} {
  const child = makeFakeChild()
  spawnMock.mockReturnValue(child)
  const manager = new ProcessManager({
    getAppPrefs: () => (persistLogs === undefined ? {} : { persistLogs }),
    logsDir: LOGS_DIR
  })
  const result = manager.launch('app-x', 'cmd /c echo oi', 'C:\\qualquer')
  expect(result.success).toBe(true)
  return { manager, child }
}

describe('log persistente por app (05-5.7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsState.size = 0
    fsMock.streams.length = 0
  })

  it('pref ligada → stdout/stderr gravados no arquivo com prefixo [iso]', () => {
    const { child } = launchWithPref(true)
    expect(fsMock.mkdirSync).toHaveBeenCalledWith(LOGS_DIR, { recursive: true })
    expect(fsMock.createWriteStream).toHaveBeenCalledWith(logPathFor('app-x'), { flags: 'a' })

    child.stdout.emit('data', Buffer.from('linha de saída\n'))
    child.stderr.emit('data', Buffer.from('falhou\n'))

    expect(fsMock.streams).toHaveLength(1)
    const written = fsMock.streams[0].written
    expect(written).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*\] linha de saída\n/)
    expect(written).toContain('[ERR] falhou\n')
    // Ring buffer em RAM continua funcionando normalmente
    expect(written.split('\n').filter(Boolean)).toHaveLength(2)
  })

  it('pref desligada (default) → nenhum stream criado', () => {
    const { manager, child } = launchWithPref(undefined)
    child.stdout.emit('data', Buffer.from('oi\n'))
    expect(fsMock.createWriteStream).not.toHaveBeenCalled()
    expect(manager.getLogs('app-x')).toContain('oi\n')
  })

  it('rotação: arquivo acima de 1 MB antes de escrever → rename para .log.1 e stream novo', () => {
    const { child } = launchWithPref(true)
    expect(fsMock.streams).toHaveLength(1)

    // Arquivo atual passou de 1 MB desde a abertura do stream
    fsState.size = PERSIST_LOG_MAX_BYTES + 1
    child.stdout.emit('data', Buffer.from('depois da rotação\n'))

    expect(fsMock.renameSync).toHaveBeenCalledWith(logPathFor('app-x'), `${logPathFor('app-x')}.1`)
    // Stream antigo fechado e um novo criado para continuar anexando
    expect(fsMock.streams).toHaveLength(2)
    expect(fsMock.streams[0].end).toHaveBeenCalled()
    expect(fsMock.streams[1].written).toContain('depois da rotação\n')
  })

  it('rotação na abertura: arquivo de sessão anterior > 1 MB é rotacionado antes do append', () => {
    fsState.size = PERSIST_LOG_MAX_BYTES + 1
    launchWithPref(true)
    expect(fsMock.renameSync).toHaveBeenCalledWith(logPathFor('app-x'), `${logPathFor('app-x')}.1`)
    expect(fsMock.createWriteStream).toHaveBeenCalledWith(logPathFor('app-x'), { flags: 'a' })
  })

  it('close escreve linha [exit code N], fecha o stream e para de gravar', () => {
    const { manager, child } = launchWithPref(true)
    child.stdout.emit('data', Buffer.from('rodando\n'))
    child.emit('close', 0)

    expect(fsMock.streams).toHaveLength(1)
    const written = fsMock.streams[0].written
    expect(written).toContain('rodando\n')
    expect(written).toMatch(/\[\d{4}-\d{2}-\d{2}T.*\] \[exit code 0\]\n$/)
    expect(fsMock.streams[0].end).toHaveBeenCalled()

    // Stream removido do map: chunks posteriores ao close são ignorados
    child.stdout.emit('data', Buffer.from('fantasma\n'))
    expect(fsMock.streams[0].written).not.toContain('fantasma')
    expect(manager.getStatus('app-x').status).toBe('stopped')
  })

  it('close com código ≠ 0 marca status error e ainda assim fecha o log', () => {
    const { manager, child } = launchWithPref(true)
    child.emit('close', 1)
    expect(manager.getStatus('app-x').status).toBe('error')
    expect(fsMock.streams[0].written).toMatch(/\[exit code 1\]\n$/)
    expect(fsMock.streams[0].end).toHaveBeenCalled()
  })
})

// ── Encerramento real de processos ───────────────────────────────────────────
// O callback do tree-kill confirma que o taskkill retornou, NÃO que o filho
// morreu. Estes testes prendem a espera no evento `close` do ChildProcess.

function makeManager(): ProcessManager {
  return new ProcessManager({ getAppPrefs: () => ({}), logsDir: LOGS_DIR })
}

function launchFake(manager: ProcessManager, child: FakeChild, appId = 'app-x'): void {
  spawnMock.mockReturnValueOnce(child)
  const result = manager.launch(appId, 'cmd /c echo oi', 'C:\\qualquer')
  expect(result.success).toBe(true)
}

describe('encerramento real de processos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    spawnMock.mockReset()
    spawnSyncMock.mockReset()
    treeKillMock.mockReset()
    // Simula o callback do tree-kill retornando ANTES da morte do filho (o
    // comportamento real do taskkill), sem emitir close.
    treeKillMock.mockImplementation((_pid: number, _signal: string, callback?: () => void) =>
      callback?.()
    )
    fsState.size = 0
    fsMock.streams.length = 0
  })

  it('stop() só resolve depois do close real — o callback do tree-kill não basta', async () => {
    const manager = makeManager()
    const child = makeFakeChild()
    launchFake(manager, child)

    const events: string[] = []
    manager.on('status-change', (appId, status) => events.push(`${appId}:${status}`))

    const stopPromise = manager.stop('app-x')
    let settled = false
    void stopPromise.then(() => {
      settled = true
    })

    // O mock do tree-kill já chamou o callback, mas o filho não emitiu close.
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(manager.getStatus('app-x').status).toBe('running')
    expect(events).toEqual([])

    child.emit('close', 1)
    await expect(stopPromise).resolves.toEqual({ success: true })
    expect(manager.getStatus('app-x').status).toBe('stopped')
    // Uma única transição final: o handler de close é o dono do evento.
    expect(events).toEqual(['app-x:stopped'])
  })

  it('stop() escala SIGTERM → SIGKILL quando o filho não morre no grace', async () => {
    vi.useFakeTimers()
    try {
      const manager = makeManager()
      const child = makeFakeChild()
      launchFake(manager, child)

      const stopPromise = manager.stop('app-x')
      await vi.advanceTimersByTimeAsync(STOP_GRACE_MS)

      expect(treeKillMock).toHaveBeenCalledWith(4321, 'SIGTERM', expect.any(Function))
      expect(treeKillMock).toHaveBeenCalledWith(4321, 'SIGKILL', expect.any(Function))

      child.emit('close', 1)
      await expect(stopPromise).resolves.toEqual({ success: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop() concorrente compartilha a operação e dispara um único SIGTERM', async () => {
    const manager = makeManager()
    const child = makeFakeChild()
    launchFake(manager, child)

    const first = manager.stop('app-x')
    const second = manager.stop('app-x')
    expect(second).toBe(first)
    expect(treeKillMock.mock.calls.filter((call) => call[1] === 'SIGTERM')).toHaveLength(1)

    child.emit('close', 1)
    await expect(first).resolves.toEqual({ success: true })
    await expect(second).resolves.toEqual({ success: true })
  })

  it('stop() devolve erro (sem alegar parada) quando o filho nunca sai', async () => {
    vi.useFakeTimers()
    try {
      const manager = makeManager()
      const child = makeFakeChild()
      launchFake(manager, child)

      const stopPromise = manager.stop('app-x')
      await vi.advanceTimersByTimeAsync(STOP_GRACE_MS + STOP_FORCE_TIMEOUT_MS + 10)

      const result = await stopPromise
      expect(result.success).toBe(false)
      expect(result.error).toContain('não confirmou a saída')
      // Nunca mentir que parou: o status continua running.
      expect(manager.getStatus('app-x').status).toBe('running')
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop() não trava quando o tree-kill nunca chama o callback', async () => {
    vi.useFakeTimers()
    try {
      const manager = makeManager()
      const child = makeFakeChild()
      launchFake(manager, child)
      // Simula taskkill/psTree pendurado: o callback do tree-kill nunca chega.
      treeKillMock.mockImplementation(() => {})

      const stopPromise = manager.stop('app-x')
      await vi.advanceTimersByTimeAsync(
        TREE_KILL_TIMEOUT_MS + STOP_GRACE_MS + TREE_KILL_TIMEOUT_MS + STOP_FORCE_TIMEOUT_MS + 10
      )

      // O deadline do tree-kill libera o SIGTERM, o grace escala para SIGKILL e
      // o deadline final devolve erro — sem promise pendurada.
      await expect(stopPromise).resolves.toMatchObject({ success: false })
      expect(treeKillMock).toHaveBeenCalledWith(4321, 'SIGTERM', expect.any(Function))
      expect(treeKillMock).toHaveBeenCalledWith(4321, 'SIGKILL', expect.any(Function))
      expect(manager.getStatus('app-x').status).toBe('running')
      // Nenhum timer do stop fica pendente segurando o event loop.
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop() aguarda a saída real quando o filho já estava saindo', async () => {
    const manager = makeManager()
    const child = makeFakeChild()
    launchFake(manager, child)
    // exitCode preenchido = processo já saiu, mas o close ainda não foi entregue.
    child.exitCode = 0

    let settled = false
    const stopPromise = manager.stop('app-x').then((result) => {
      settled = true
      return result
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)

    child.emit('close', 0)
    await expect(stopPromise).resolves.toEqual({ success: true })
  })

  it('killAll() usa SIGKILL e aguarda as saídas reais antes de resolver', async () => {
    const manager = makeManager()
    const child = makeFakeChild()
    launchFake(manager, child)

    const killPromise = manager.killAll()
    let settled = false
    void killPromise.then(() => {
      settled = true
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(settled).toBe(false)
    expect(treeKillMock).toHaveBeenCalledWith(4321, 'SIGKILL', expect.any(Function))

    child.emit('close', 1)
    await killPromise
    expect(manager.getStatus('app-x').status).toBe('stopped')
  })

  it('killAll() força os sobreviventes do deadline e nunca rejeita', async () => {
    vi.useFakeTimers()
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    try {
      const manager = makeManager()
      const child = makeFakeChild()
      launchFake(manager, child)

      const killPromise = manager.killAll()
      await vi.advanceTimersByTimeAsync(KILL_ALL_DEADLINE_MS + 10)
      await expect(killPromise).resolves.toBeUndefined()
      expect(spawnSyncMock).toHaveBeenCalledWith('taskkill', ['/pid', '4321', '/T', '/F'], {
        windowsHide: true
      })
    } finally {
      platformSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('killAllSync() mata a árvore via taskkill /T /F e marca stopped', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    try {
      const manager = makeManager()
      const child = makeFakeChild()
      launchFake(manager, child)
      const events: string[] = []
      manager.on('status-change', (appId, status) => events.push(`${appId}:${status}`))

      manager.killAllSync()

      expect(spawnSyncMock).toHaveBeenCalledWith('taskkill', ['/pid', '4321', '/T', '/F'], {
        windowsHide: true
      })
      expect(manager.getStatus('app-x').status).toBe('stopped')
      expect(events).toEqual(['app-x:stopped'])
    } finally {
      platformSpy.mockRestore()
    }
  })

  it('killAllSync() não lança quando o taskkill falha (caminho de crash)', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    try {
      spawnSyncMock.mockImplementation(() => {
        throw new Error('taskkill indisponível')
      })
      const manager = makeManager()
      const child = makeFakeChild()
      launchFake(manager, child)

      expect(() => manager.killAllSync()).not.toThrow()
      expect(manager.getStatus('app-x').status).toBe('stopped')
    } finally {
      platformSpy.mockRestore()
    }
  })

  it('launch() não cria segunda instância quando o filho anterior ainda está vivo', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    try {
      const manager = makeManager()
      const first = makeFakeChild()
      launchFake(manager, first)
      // 'error' marca status error sem close: o filho anterior segue vivo.
      first.emit('error', new Error('falha de spawn'))
      expect(manager.getStatus('app-x').status).toBe('error')
      expect(first.exitCode).toBeNull()

      const second = makeFakeChild(5555)
      spawnMock.mockReturnValueOnce(second)
      const result = manager.launch('app-x', 'cmd /c echo oi', 'C:\\qualquer')

      expect(result.success).toBe(true)
      expect(spawnMock).toHaveBeenCalledTimes(2)
      expect(spawnSyncMock).toHaveBeenCalledWith('taskkill', ['/pid', '4321', '/T', '/F'], {
        windowsHide: true
      })

      // O close atrasado do filho antigo não pode derrubar o status do novo.
      first.emit('close', 1)
      expect(manager.getStatus('app-x').status).toBe('running')
    } finally {
      platformSpy.mockRestore()
    }
  })
})
