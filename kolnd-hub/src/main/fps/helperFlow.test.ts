import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  userData: 'C:\\ud',
  stat: vi.fn(),
  open: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
  writeFileSync: vi.fn(),
  runPowerShell: vi.fn(),
  runPowerShellCommand: vi.fn(),
  isUacCancelled: vi.fn((text: string) => /1223|cancelad/i.test(text)),
  logWarn: vi.fn(),
  logInfo: vi.fn()
}))

vi.mock('electron', () => ({ app: { getPath: () => mocks.userData } }))
vi.mock('fs', () => ({
  promises: {
    stat: mocks.stat,
    open: mocks.open,
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
    mkdir: mocks.mkdir,
    rm: mocks.rm
  },
  existsSync: mocks.existsSync,
  statSync: mocks.statSync,
  writeFileSync: mocks.writeFileSync
}))
vi.mock('../hwmon/driver', () => ({ isUacCancelled: mocks.isUacCancelled }))
vi.mock('../hwmon/powershell', () => ({
  runPowerShell: mocks.runPowerShell,
  runPowerShellCommand: mocks.runPowerShellCommand
}))
vi.mock('../logger', () => ({
  logger: { info: mocks.logInfo, warn: mocks.logWarn, error: vi.fn(), debug: vi.fn() }
}))

const STAGING = join('C:\\ud', 'fps')
const SOURCE = join(STAGING, 'KolndFpsEtw.cs')
const EXE = join(STAGING, 'KolndFpsEtw.exe')
const RUN = join(STAGING, 'run')
const STOP = join(RUN, 'fps.stop')
const HEARTBEAT = join(RUN, 'fps.heartbeat')
const PROTECTED = join('C:\\ProgramData', 'Kolnd Hub', 'fps')

type Module = typeof import('./helper')

let mod: Module

function processResult(overrides: Record<string, unknown> = {}) {
  return { stdout: '', stderr: '', code: 0, timedOut: false, ...overrides }
}

beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  mocks.userData = 'C:\\ud'
  mocks.stat.mockResolvedValue({ size: 100 })
  mocks.open.mockResolvedValue({
    read: vi.fn(async (buffer: Buffer, offset: number, length: number) => {
      buffer.write('linha\n', offset)
      return { bytesRead: Math.min(length, 6) }
    }),
    close: vi.fn(async () => undefined)
  })
  mocks.readFile.mockResolvedValue(Buffer.from('conteúdo'))
  mocks.writeFile.mockResolvedValue(undefined)
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.rm.mockResolvedValue(undefined)
  mocks.existsSync.mockReturnValue(true)
  mocks.statSync.mockReturnValue({ mtimeMs: 2 })
  mocks.runPowerShell.mockResolvedValue(processResult())
  mocks.runPowerShellCommand.mockResolvedValue(processResult())
  mocks.isUacCancelled.mockImplementation((text: string) => /1223|cancelad/i.test(text))
  mod = await import('./helper')
})

describe('resolvedores de caminho', () => {
  it('staging, run e protegidos derivam das bases', () => {
    expect(mod.resolveFpsStagingPaths('C:\\ud')).toEqual({
      dir: STAGING,
      sourcePath: SOURCE,
      stagingExePath: EXE
    })
    expect(mod.resolveFpsRunPaths('C:\\ud')).toEqual({
      runDir: RUN,
      stopPath: STOP,
      heartbeatPath: HEARTBEAT
    })
    expect(mod.resolveFpsProtectedPaths('C:\\ProgramData')).toEqual({
      root: PROTECTED,
      binDir: join(PROTECTED, 'bin'),
      runDir: join(PROTECTED, 'run'),
      exePath: join(PROTECTED, 'bin', 'KolndFpsEtw.exe')
    })
  })

  it('resolveFpsHelperPaths coloca o NDJSON no diretório protegido', () => {
    const paths = mod.resolveFpsHelperPaths('C:\\ud', 'C:\\ProgramData')
    expect(paths.outputPath).toBe(join(PROTECTED, 'run', 'fps.ndjson'))
    expect(paths.dir).toBe(STAGING)
  })
})

describe('takeCompleteLines / encodePowerShell / sha256File', () => {
  it('separa linhas completas preservando a parcial', () => {
    expect(mod.takeCompleteLines('a\r\nb\nparcial')).toEqual({ lines: ['a', 'b'], rest: 'parcial' })
    expect(mod.takeCompleteLines('')).toEqual({ lines: [], rest: '' })
  })

  it('encodePowerShell devolve UTF-16LE em base64', () => {
    expect(Buffer.from(mod.encodePowerShell('abc'), 'base64').toString('utf16le')).toBe('abc')
  })

  it('sha256File calcula o hash do conteúdo', async () => {
    const hash = await mod.sha256File('C:\\x.exe')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('readFpsChunk', () => {
  it('arquivo ausente ou sem bytes novos devolve vazio', async () => {
    mocks.stat.mockRejectedValueOnce(new Error('ENOENT'))
    await expect(mod.readFpsChunk('x', 10)).resolves.toEqual({
      text: '',
      offset: 10,
      truncated: false
    })

    mocks.stat.mockResolvedValueOnce({ size: 10 })
    await expect(mod.readFpsChunk('x', 10)).resolves.toEqual({
      text: '',
      offset: 10,
      truncated: false
    })
  })

  it('offset maior que o arquivo reinicia do zero', async () => {
    mocks.stat.mockResolvedValueOnce({ size: 6 })
    const chunk = await mod.readFpsChunk('x', 999)
    expect(chunk.offset).toBe(6)
  })

  it('lê os bytes novos e fecha o handle', async () => {
    const handle = {
      read: vi.fn(async (buffer: Buffer, offset: number, length: number) => {
        buffer.write('abc', offset)
        return { bytesRead: Math.min(length, 3) }
      }),
      close: vi.fn(async () => undefined)
    }
    mocks.open.mockResolvedValueOnce(handle)
    mocks.stat.mockResolvedValueOnce({ size: 3 })

    await expect(mod.readFpsChunk('x', 0)).resolves.toMatchObject({ text: 'abc', offset: 3 })
    expect(handle.close).toHaveBeenCalled()
  })

  it('arquivo grande descarta o começo até a primeira quebra de linha', async () => {
    mocks.stat.mockResolvedValueOnce({ size: 300 * 1024 })
    mocks.open.mockResolvedValueOnce({
      read: vi.fn(async (buffer: Buffer, offset: number) => {
        buffer.write('lixo\nlinha boa', offset)
        return { bytesRead: 14 }
      }),
      close: vi.fn(async () => undefined)
    })

    const chunk = await mod.readFpsChunk('x', 0)
    expect(chunk.truncated).toBe(true)
    expect(chunk.text).toBe('linha boa')
  })

  it('truncado sem newline devolve texto vazio; open falhando devolve vazio', async () => {
    mocks.stat.mockResolvedValueOnce({ size: 300 * 1024 })
    mocks.open.mockResolvedValueOnce({
      read: vi.fn(async (buffer: Buffer, offset: number) => {
        buffer.write('sem quebra', offset)
        return { bytesRead: 10 }
      }),
      close: vi.fn(async () => undefined)
    })
    await expect(mod.readFpsChunk('x', 0)).resolves.toMatchObject({ text: '', truncated: true })

    mocks.stat.mockResolvedValueOnce({ size: 10 })
    mocks.open.mockRejectedValueOnce(new Error('EACCES'))
    await expect(mod.readFpsChunk('x', 0)).resolves.toEqual({
      text: '',
      offset: 0,
      truncated: false
    })
  })
})

describe('ensureStagedHelper', () => {
  it('compila quando o .exe não existe e reaproveita depois', async () => {
    let exeExists = false
    mocks.existsSync.mockImplementation((path: string) => (path === EXE ? exeExists : true))
    mocks.runPowerShell.mockImplementation(async () => {
      exeExists = true
      return processResult()
    })
    await expect(mod.ensureStagedHelper()).resolves.toMatchObject({ stagingExePath: EXE })
    mocks.statSync.mockReturnValue({ mtimeMs: 1 })
    await expect(mod.ensureStagedHelper()).resolves.toMatchObject({ stagingExePath: EXE })
    expect(mocks.runPowerShell).toHaveBeenCalledTimes(1)
  })

  it('compilação com timeout e sem artefato falham', async () => {
    mocks.existsSync.mockReturnValue(false)
    mocks.runPowerShell.mockResolvedValueOnce(processResult({ timedOut: true }))
    await expect(mod.ensureStagedHelper()).rejects.toThrow('excedeu o tempo limite')

    mocks.runPowerShell.mockResolvedValueOnce(processResult({ stderr: 'erro C#', code: 1 }))
    await expect(mod.ensureStagedHelper()).rejects.toThrow('erro C#')
  })
})

describe('touchFpsHeartbeat / stops', () => {
  it('grava o batimento e tolera falha de disco', async () => {
    const paths = mod.resolveFpsHelperPaths('C:\\ud', 'C:\\ProgramData')
    await mod.touchFpsHeartbeat(paths)
    expect(mocks.writeFile).toHaveBeenCalledWith(HEARTBEAT, expect.any(String), 'utf8')

    mocks.writeFile.mockRejectedValueOnce(new Error('EACCES'))
    await expect(mod.touchFpsHeartbeat(paths)).resolves.toBeUndefined()
  })

  it('stop assíncrono e síncrono gravam o arquivo', async () => {
    await mod.requestFpsHelperStop('motivo')
    expect(mocks.writeFile).toHaveBeenCalledWith(
      mod.currentFpsHelperPaths().stopPath,
      'motivo',
      'utf8'
    )

    mocks.writeFile.mockRejectedValueOnce(new Error('EACCES'))
    await expect(mod.requestFpsHelperStop()).resolves.toBeUndefined()

    mod.requestFpsHelperStopSync()
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      mod.currentFpsHelperPaths().stopPath,
      'quit',
      'utf8'
    )

    mocks.writeFileSync.mockImplementationOnce(() => {
      throw new Error('EACCES')
    })
    expect(() => mod.requestFpsHelperStopSync()).not.toThrow()
  })
})

describe('startFpsHelper', () => {
  it('recusa fora do Windows', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
    await expect(mod.startFpsHelper()).resolves.toMatchObject({ ok: false })
    if (original) Object.defineProperty(process, 'platform', original)
  })

  it('sucesso limpa o stop, grava heartbeat e sobe elevado', async () => {
    await expect(mod.startFpsHelper()).resolves.toMatchObject({ ok: true })
    expect(mocks.rm).toHaveBeenCalledWith(RUN + '\\fps.stop', { force: true })
    expect(mocks.runPowerShellCommand).toHaveBeenCalled()
    expect(mocks.logInfo).toHaveBeenCalled()
  })

  it('UAC cancelado, timeout e código de erro', async () => {
    mocks.runPowerShellCommand.mockResolvedValueOnce(
      processResult({ stdout: 'cancelado pelo usuário', code: 1 })
    )
    await expect(mod.startFpsHelper()).resolves.toMatchObject({ ok: false, cancelled: true })

    mocks.runPowerShellCommand.mockResolvedValueOnce(processResult({ timedOut: true }))
    await expect(mod.startFpsHelper()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('demorou demais')
    })

    mocks.runPowerShellCommand.mockResolvedValueOnce(
      processResult({ code: 1, stderr: 'erro detalhado' })
    )
    await expect(mod.startFpsHelper()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('permissão de administrador')
    })
    expect(mocks.logWarn).toHaveBeenCalled()
  })

  it('falha no preparo do helper vira erro amigável', async () => {
    mocks.mkdir.mockRejectedValue(new Error('disco cheio'))
    await expect(mod.startFpsHelper()).resolves.toEqual({
      ok: false,
      error: 'Não foi possível preparar o helper de FPS. Tente novamente.'
    })
  })
})
