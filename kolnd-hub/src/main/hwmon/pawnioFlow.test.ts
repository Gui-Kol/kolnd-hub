import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  packaged: false,
  userData: 'C:\\ud',
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
  cpus: vi.fn(() => [{ model: 'AMD Ryzen 7 5800X' }]),
  runProcess: vi.fn(),
  runPowerShell: vi.fn(),
  resolvePowershellPath: vi.fn(() => 'C:\\ps.exe'),
  logWarn: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.packaged
    },
    getPath: () => mocks.userData
  }
}))
vi.mock('fs', () => ({
  promises: { readFile: mocks.readFile, writeFile: mocks.writeFile, mkdir: mocks.mkdir },
  existsSync: mocks.existsSync,
  statSync: mocks.statSync
}))
vi.mock('os', () => ({ cpus: mocks.cpus }))
vi.mock('./powershell', () => ({
  runProcess: mocks.runProcess,
  runPowerShell: mocks.runPowerShell
}))
vi.mock('./systemPaths', () => ({ resolvePowershellPath: mocks.resolvePowershellPath }))
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: mocks.logWarn, error: vi.fn(), debug: vi.fn() }
}))

type Module = typeof import('./pawnio')

let mod: Module

const HELPERS = join('C:\\ud', 'hwmon')
const HELPER_DLL = join(HELPERS, 'KolndPawnIo.dll')
const PAWNIO_DLL = join('C:\\Program Files', 'PawnIO', 'PawnIOLib.dll')

function procResult(overrides: Record<string, unknown> = {}) {
  return { stdout: '', stderr: '', code: 0, timedOut: false, ...overrides }
}

function helperJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    deviceOpen: true,
    module: 'AMDFamily17',
    msr: [{ index: 1, value: '10' }],
    smn: [{ index: 2, value: '20' }],
    ...overrides
  })
}

beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  mocks.packaged = false
  mocks.readFile.mockRejectedValue(new Error('ENOENT'))
  mocks.writeFile.mockResolvedValue(undefined)
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.existsSync.mockImplementation((path: string) => path === PAWNIO_DLL || path === HELPER_DLL)
  mocks.statSync.mockReturnValue({ mtimeMs: 1 })
  mocks.cpus.mockReturnValue([{ model: 'AMD Ryzen 7 5800X' }])
  mocks.runProcess.mockImplementation(async (file: string) =>
    file === 'reg.exe' ? procResult() : procResult({ stdout: helperJson() })
  )
  mocks.runPowerShell.mockResolvedValue(procResult())
  mod = await import('./pawnio')
})

describe('assets e vendor', () => {
  it('resolvePawnIoAssets/currentPawnIoAssets', () => {
    expect(mod.resolvePawnIoAssets('C:\\r')).toEqual({
      dir: join('C:\\r', 'pawnio'),
      installer: join('C:\\r', 'pawnio', 'PawnIO_setup.exe'),
      intelModule: join('C:\\r', 'pawnio', 'IntelMSR.bin'),
      amdModule: join('C:\\r', 'pawnio', 'AMDFamily17.bin'),
      license: join('C:\\r', 'pawnio', 'COPYING'),
      pins: join('C:\\r', 'pawnio', 'pins.json')
    })
    expect(mod.currentPawnIoAssets().dir).toBe(join(process.cwd(), 'resources', 'pawnio'))

    mocks.packaged = true
    Object.defineProperty(process, 'resourcesPath', {
      value: 'C:\\installed\\resources',
      configurable: true
    })
    expect(mod.currentPawnIoAssets().dir).toBe(join('C:\\installed\\resources', 'pawnio'))
  })

  it('detecta AMD/Intel/outros e módulos/sondas', () => {
    expect(mod.detectCpuVendor('AMD Ryzen')).toBe('amd')
    expect(mod.detectCpuVendor('Intel Core(TM) i7')).toBe('intel')
    expect(mod.detectCpuVendor('Xeon Gold')).toBe('intel')
    expect(mod.detectCpuVendor(null)).toBe('other')
    expect(mod.detectCpuVendor('  ')).toBe('other')
    expect(mod.moduleForVendor('amd')).toBe('AMDFamily17')
    expect(mod.moduleForVendor('intel')).toBe('IntelMSR')
    expect(mod.moduleForVendor('other')).toBeNull()
    expect(mod.probeRegisterForVendor('amd')).toBe(mod.PAWNIO_PROBE_AMD_MSR)
    expect(mod.probeRegisterForVendor('intel')).toBe(mod.PAWNIO_PROBE_INTEL_MSR)
    expect(mod.probeRegisterForVendor('other')).toBeNull()
  })

  it('parseRegString extrai InstallLocation', () => {
    const output = '    InstallLocation    REG_SZ    C:\\Program Files\\PawnIO\r\n'
    expect(mod.parseRegString(output, 'InstallLocation')).toBe('C:\\Program Files\\PawnIO')
    expect(mod.parseRegString(output, 'Outro')).toBeNull()
    expect(mod.parseRegString('x', 'InstallLocation')).toBeNull()
  })
})

describe('detectPawnIoInstallation', () => {
  it('não-Windows usa %ProgramFiles%\\PawnIO', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
    try {
      await expect(mod.detectPawnIoInstallation()).resolves.toMatchObject({
        registered: false,
        installDir: join('C:\\Program Files', 'PawnIO')
      })
      expect(mocks.runProcess).not.toHaveBeenCalled()
    } finally {
      if (original) Object.defineProperty(process, 'platform', original)
    }
  })

  it('lê o registro e cai para Program Files quando falha', async () => {
    mocks.runProcess.mockResolvedValueOnce(
      procResult({ stdout: '    InstallLocation    REG_SZ    D:\\PawnIO\r\n' })
    )
    await expect(mod.detectPawnIoInstallation()).resolves.toMatchObject({
      registered: true,
      installDir: 'D:\\PawnIO',
      dllPath: join('D:\\PawnIO', 'PawnIOLib.dll')
    })

    mocks.runProcess.mockResolvedValueOnce(procResult({ timedOut: true }))
    await expect(mod.detectPawnIoInstallation()).resolves.toMatchObject({ registered: false })

    mocks.runProcess.mockResolvedValueOnce(procResult({ code: 1 }))
    await expect(mod.detectPawnIoInstallation()).resolves.toMatchObject({ registered: false })
  })
})

describe('ensurePawnIoHelperAssets', () => {
  it('compila uma vez e reaproveita o cache', async () => {
    let dllExists = false
    mocks.existsSync.mockImplementation(
      (path: string) => path === PAWNIO_DLL || (dllExists && path === HELPER_DLL)
    )
    mocks.runPowerShell.mockImplementation(async () => {
      dllExists = true
      return procResult()
    })

    await expect(mod.ensurePawnIoHelperAssets()).resolves.toMatchObject({
      dllPath: HELPER_DLL
    })
    await mod.ensurePawnIoHelperAssets()
    expect(mocks.runPowerShell).toHaveBeenCalledTimes(1)
  })

  it('timeout e falha de compilação', async () => {
    mocks.existsSync.mockReturnValue(false)
    mocks.runPowerShell.mockResolvedValueOnce(procResult({ timedOut: true }))
    await expect(mod.ensurePawnIoHelperAssets()).rejects.toThrow('excedeu o tempo limite')

    mocks.runPowerShell.mockResolvedValueOnce(procResult({ stderr: 'erro C#', code: 1 }))
    await expect(mod.ensurePawnIoHelperAssets()).rejects.toThrow('erro C#')
  })
})

describe('readPawnIoBatch', () => {
  it('CPU desconhecida devolve erro sem DLL', async () => {
    mocks.cpus.mockReturnValue([{ model: 'CPU Genérica' }])
    await expect(mod.readPawnIoBatch({ msr: [1], smn: [2] })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('não foi reconhecida')
    })
  })

  it('PawnIO ausente devolve erro', async () => {
    mocks.existsSync.mockReturnValue(false)
    await expect(mod.readPawnIoBatch({ msr: [1] })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('PawnIO não está instalado')
    })
  })

  it('sucesso reordena e converte valores do pedido', async () => {
    mocks.runProcess.mockImplementation(async (file: string) =>
      file === 'reg.exe'
        ? procResult()
        : procResult({
            stdout: `ruído\n${helperJson({ msr: [{ index: 1, value: 5 }] })}`
          })
    )
    const result = await mod.readPawnIoBatch({ msr: [1, 3], smn: [2] })
    expect(result).toMatchObject({ ok: true, deviceOpen: true, module: 'AMDFamily17' })
    expect(result.msr).toEqual([
      { index: 1, value: 5n },
      { index: 3, value: null }
    ])
    expect(result.smn).toEqual([{ index: 2, value: 20n }])
  })

  it('Intel descarta SMN e sanitiza índices inválidos/duplicados', async () => {
    mocks.cpus.mockReturnValue([{ model: 'Intel Core i7' }])
    mocks.existsSync.mockImplementation(
      (path: string) => path === PAWNIO_DLL || path === HELPER_DLL
    )
    mocks.runProcess.mockResolvedValueOnce(procResult({ stdout: helperJson() }))

    const result = await mod.readPawnIoBatch({
      msr: [1, 1, -1, 1.5, 4_294_967_296, 2],
      smn: [9]
    })
    expect(result.smn).toEqual([])
    expect(result.msr.map((entry) => entry.index)).toEqual([1, 2])
  })

  it('timeout, saída inválida e erro do helper', async () => {
    mocks.runProcess.mockImplementation(async (file: string) =>
      file === 'reg.exe' ? procResult() : procResult({ timedOut: true })
    )
    await expect(mod.readPawnIoBatch({ msr: [1] })).resolves.toMatchObject({
      error: expect.stringContaining('tempo limite')
    })

    mocks.runProcess.mockImplementation(async (file: string) =>
      file === 'reg.exe' ? procResult() : procResult({ stdout: 'lixo', stderr: 'detalhe bruto' })
    )
    await expect(mod.readPawnIoBatch({ msr: [1] })).resolves.toMatchObject({
      error: expect.stringContaining('Não foi possível ler')
    })
    expect(mocks.logWarn).toHaveBeenCalled()

    mocks.runProcess.mockImplementation(async (file: string) =>
      file === 'reg.exe'
        ? procResult()
        : procResult({ stdout: helperJson({ deviceOpen: false, error: 'device|5|acesso negado' }) })
    )
    await expect(mod.readPawnIoBatch({ msr: [1] })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('device')
    })
  })

  it('exceção ao preparar o helper vira erro amigável', async () => {
    mocks.mkdir.mockRejectedValue(new Error('disco cheio'))
    await expect(mod.readPawnIoBatch({ msr: [1] })).resolves.toMatchObject({
      ok: false,
      error: 'O PawnIO não está disponível para leitura.'
    })
  })
})

describe('probePawnIo', () => {
  it('true só com leitura real', async () => {
    const probeRegister = mod.probeRegisterForVendor('amd') as number
    mocks.runProcess.mockResolvedValue(
      procResult({
        stdout: helperJson({ msr: [{ index: probeRegister, value: 5 }] })
      })
    )
    await expect(mod.probePawnIo()).resolves.toBe(true)

    mod.resetPawnIoForTests()
    mocks.cpus.mockReturnValue([{ model: 'Outro' }])
    await expect(mod.probePawnIo()).resolves.toBe(false)

    mod.resetPawnIoForTests()
    mocks.cpus.mockReturnValue([{ model: 'AMD Ryzen' }])
    mocks.runProcess.mockResolvedValue(procResult({ stdout: helperJson({ deviceOpen: false }) }))
    await expect(mod.probePawnIo()).resolves.toBe(false)
  })
})
