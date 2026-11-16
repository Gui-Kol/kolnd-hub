import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { join } from 'path'
import {
  AUTO_RESTART_MAX_ATTEMPTS,
  AUTO_RESTART_WINDOW_MS,
  AUTO_RESTART_BACKOFF_MS,
  PERSIST_LOG_MAX_BYTES,
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
vi.mock('child_process', () => ({ spawn: spawnMock }))

interface FakeChild extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  pid: number
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.pid = 4321
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
