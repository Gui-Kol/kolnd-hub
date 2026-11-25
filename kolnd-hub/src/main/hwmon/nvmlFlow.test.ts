import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  userData: 'C:\\ud',
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
  runProcess: vi.fn(),
  runPowerShell: vi.fn(),
  resolvePowershellPath: vi.fn(() => 'C:\\ps.exe'),
  windowsRoot: vi.fn(() => 'C:\\Windows'),
  logWarn: vi.fn(),
  logInfo: vi.fn()
}))

vi.mock('electron', () => ({ app: { getPath: () => mocks.userData } }))
vi.mock('fs', () => ({
  promises: { readFile: mocks.readFile, writeFile: mocks.writeFile, mkdir: mocks.mkdir },
  existsSync: mocks.existsSync,
  statSync: mocks.statSync
}))
vi.mock('./powershell', () => ({
  runProcess: mocks.runProcess,
  runPowerShell: mocks.runPowerShell
}))
vi.mock('./systemPaths', () => ({
  resolvePowershellPath: mocks.resolvePowershellPath,
  windowsRoot: mocks.windowsRoot
}))
vi.mock('../logger', () => ({
  logger: { info: mocks.logInfo, warn: mocks.logWarn, error: vi.fn(), debug: vi.fn() }
}))

import {
  nvmlDllCandidates,
  pickExistingDll,
  probeNvml,
  readNvmlFan,
  resolveNvmlDllPath,
  resetNvmlForTests
} from './nvml'

const DLL = join('C:\\Windows', 'System32', 'nvml.dll')
const HELPERS = join('C:\\ud', 'hwmon')

function okProcess(stdout: string): void {
  mocks.runProcess.mockResolvedValue({ stdout, stderr: '', code: 0, timedOut: false })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetNvmlForTests()
  mocks.readFile.mockRejectedValue(new Error('ENOENT'))
  mocks.writeFile.mockResolvedValue(undefined)
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.runPowerShell.mockResolvedValue({ stdout: '', stderr: '', code: 0, timedOut: false })
  mocks.statSync.mockReturnValue({ mtimeMs: 1 })
  mocks.existsSync.mockImplementation((path: string) => path === DLL)
})

describe('descoberta da DLL (fluxo)', () => {
  it('candidatos e escolha do primeiro existente', () => {
    expect(nvmlDllCandidates('C:\\Windows', 'C:\\Program Files')).toEqual([
      join('C:\\Windows', 'System32', 'nvml.dll'),
      join('C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvml.dll')
    ])
    expect(pickExistingDll(['a', 'b'], (path) => path === 'b')).toBe('b')
    expect(pickExistingDll(['a'], () => false)).toBeNull()
  })

  it('resolveNvmlDllPath usa ProgramFiles do ambiente', () => {
    process.env.ProgramFiles = 'C:\\PF'
    mocks.existsSync.mockImplementation(
      (path: string) => path === join('C:\\PF', 'NVIDIA Corporation', 'NVSMI', 'nvml.dll')
    )
    expect(resolveNvmlDllPath()).toBe(join('C:\\PF', 'NVIDIA Corporation', 'NVSMI', 'nvml.dll'))
    delete process.env.ProgramFiles
  })

  it('fora do Windows ou sem DLL devolve null', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    await expect(readNvmlFan()).resolves.toBeNull()
    platform.mockRestore()

    mocks.existsSync.mockReturnValue(false)
    await expect(readNvmlFan()).resolves.toBeNull()
    expect(mocks.logWarn).toHaveBeenCalledWith(
      'hwmon',
      expect.stringContaining('nvml.dll não encontrada')
    )
  })
})

describe('readNvmlFan — compilação do helper', () => {
  it('compila uma vez e reaproveita o assembly em cache', async () => {
    // DLL do helper nasce falsa e passa a existir depois da compilação.
    let helperDllExists = false
    mocks.existsSync.mockImplementation(
      (path: string) => path === DLL || (helperDllExists && path === join(HELPERS, 'KolndNvml.dll'))
    )
    mocks.runPowerShell.mockImplementation(async () => {
      helperDllExists = true
      return { stdout: '', stderr: '', code: 0, timedOut: false }
    })
    okProcess(JSON.stringify({ ok: true, fans: [{ rpm: 800, percent: 40 }] }))

    await expect(readNvmlFan()).resolves.toEqual({ rpm: 800, percent: 40 })
    await expect(readNvmlFan()).resolves.toEqual({ rpm: 800, percent: 40 })
    expect(mocks.runPowerShell).toHaveBeenCalledTimes(1)
    expect(mocks.mkdir).toHaveBeenCalledWith(HELPERS, { recursive: true })
  })

  it('não reescreve os fontes quando o conteúdo é igual', async () => {
    const written = new Map<string, string>()
    mocks.writeFile.mockImplementation(async (path: string, content: string) => {
      written.set(path, content)
    })
    mocks.existsSync.mockImplementation(
      (path: string) => path === DLL || path === join(HELPERS, 'KolndNvml.dll')
    )
    okProcess(JSON.stringify({ ok: true, fans: [{ rpm: 1 }] }))

    await readNvmlFan()
    expect(written.size).toBeGreaterThan(0)

    resetNvmlForTests()
    mocks.writeFile.mockClear()
    mocks.readFile.mockImplementation(async (path: string) => {
      const content = written.get(path)
      if (content === undefined) throw new Error('ENOENT')
      return content
    })
    await readNvmlFan()

    // Conteúdo idêntico ao gravado → nenhuma reescrita.
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('timeout na compilação devolve null com aviso', async () => {
    mocks.runPowerShell.mockResolvedValue({ stdout: '', stderr: '', code: null, timedOut: true })
    await expect(readNvmlFan()).resolves.toBeNull()
    expect(mocks.logWarn).toHaveBeenCalledWith(
      'hwmon',
      expect.stringContaining('helper NVML indisponível')
    )
  })

  it('falha de compilação inclui o stderr', async () => {
    mocks.existsSync.mockImplementation((path: string) => path === DLL)
    mocks.runPowerShell.mockResolvedValue({
      stdout: '',
      stderr: 'erro de C#',
      code: 1,
      timedOut: false
    })
    await expect(readNvmlFan()).resolves.toBeNull()
    expect(mocks.logWarn).toHaveBeenCalledWith('hwmon', expect.stringContaining('erro de C#'))
  })
})

describe('readNvmlFan — respostas do helper', () => {
  function withCompiledAssets(): void {
    mocks.existsSync.mockImplementation(
      (path: string) => path === DLL || path === join(HELPERS, 'KolndNvml.dll')
    )
    mocks.statSync.mockReturnValue({ mtimeMs: 1 })
  }

  it('timeout da leitura, saída inválida e erro do helper', async () => {
    withCompiledAssets()

    mocks.runProcess.mockResolvedValue({ stdout: '', stderr: '', code: null, timedOut: true })
    await expect(readNvmlFan()).resolves.toBeNull()

    resetNvmlForTests()
    withCompiledAssets()
    mocks.runProcess.mockResolvedValue({ stdout: 'lixo', stderr: 'stderr bruto', code: 0 })
    await expect(readNvmlFan()).resolves.toBeNull()
    expect(mocks.logWarn).toHaveBeenLastCalledWith('hwmon', expect.stringContaining('stderr bruto'))

    resetNvmlForTests()
    withCompiledAssets()
    okProcess(JSON.stringify({ ok: false, error: 'fans|1|sem fans' }))
    await expect(readNvmlFan()).resolves.toBeNull()
  })

  it('sem ventoinhas legíveis devolve null', async () => {
    withCompiledAssets()
    okProcess(JSON.stringify({ ok: true, fans: [] }))
    await expect(readNvmlFan()).resolves.toBeNull()
    expect(mocks.logWarn).toHaveBeenCalledWith(
      'hwmon',
      'NVML respondeu sem nenhuma ventoinha legível'
    )
  })

  it('driver antigo: RPM null é leitura válida e loga uma única vez', async () => {
    withCompiledAssets()
    okProcess(JSON.stringify({ ok: true, fans: [{ percent: 35 }] }))

    await expect(readNvmlFan()).resolves.toEqual({ rpm: null, percent: 35 })
    expect(mocks.logInfo).toHaveBeenCalledWith('hwmon', expect.stringContaining('não expõe RPM'))

    // Dentro do retryAfter, nem tenta de novo.
    await expect(readNvmlFan()).resolves.toBeNull()
    expect(mocks.logInfo).toHaveBeenCalledTimes(1)
  })

  it('runProcess lançando vira null', async () => {
    withCompiledAssets()
    mocks.runProcess.mockRejectedValue(new Error('boom'))
    await expect(readNvmlFan()).resolves.toBeNull()
    expect(mocks.logWarn).toHaveBeenCalledWith('hwmon', expect.stringContaining('boom'))
  })

  it('probeNvml só é true com RPM real', async () => {
    withCompiledAssets()
    okProcess(JSON.stringify({ ok: true, fans: [{ rpm: 0, percent: 0 }] }))
    await expect(probeNvml()).resolves.toBe(true)

    resetNvmlForTests()
    withCompiledAssets()
    okProcess(JSON.stringify({ ok: true, fans: [{ percent: 20 }] }))
    await expect(probeNvml()).resolves.toBe(false)
  })
})
