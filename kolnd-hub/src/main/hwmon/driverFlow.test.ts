import { beforeEach, describe, expect, it, vi } from 'vitest'
import { afterEach } from 'vitest'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  packaged: false,
  readFile: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
  existsSync: vi.fn(),
  hashDigest: '1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032',
  runPowerShellCommand: vi.fn(),
  currentPawnIoAssets: vi.fn(() => ({ installer: 'C:\\hub\\resources\\pawnio\\PawnIO_setup.exe' })),
  detectPawnIoInstallation: vi.fn(),
  describePawnIoError: vi.fn(),
  installSensorsAgent: vi.fn(),
  hasLeftoverFpsArtifacts: vi.fn((): boolean => false),
  missingAgentRegisters: vi.fn((): { msr: number[]; smn: number[] } => ({ msr: [], smn: [] })),
  readSensorsLatestFile: vi.fn(),
  sensorsAgentLatestPath: vi.fn(() => 'C:\\sink\\latest.json'),
  logWarn: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.packaged
    }
  }
}))
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>()
  return {
    ...actual,
    createHash: () => ({
      update: () => ({
        digest: () => mocks.hashDigest
      })
    })
  }
})
vi.mock('fs', () => ({
  promises: {
    readFile: mocks.readFile,
    stat: mocks.stat,
    writeFile: mocks.writeFile,
    mkdir: mocks.mkdir,
    unlink: mocks.unlink
  },
  existsSync: mocks.existsSync
}))
vi.mock('os', () => ({ tmpdir: () => 'C:\\tmp' }))
vi.mock('./agent', () => ({
  installSensorsAgent: mocks.installSensorsAgent,
  hasLeftoverFpsArtifacts: mocks.hasLeftoverFpsArtifacts,
  missingAgentRegisters: mocks.missingAgentRegisters,
  readSensorsLatestFile: mocks.readSensorsLatestFile,
  sensorsAgentLatestPath: mocks.sensorsAgentLatestPath
}))
vi.mock('./powershell', () => ({ runPowerShellCommand: mocks.runPowerShellCommand }))
vi.mock('./pawnio', () => ({
  currentPawnIoAssets: mocks.currentPawnIoAssets,
  describePawnIoError: mocks.describePawnIoError,
  detectPawnIoInstallation: mocks.detectPawnIoInstallation
}))
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: mocks.logWarn, error: vi.fn(), debug: vi.fn() }
}))

import {
  buildInstallScript,
  buildUninstallScript,
  bundledInstallerPath,
  classifyDriverState,
  explainInstallFailure,
  getDriverStatus,
  installDriver,
  isUacCancelled,
  PAWNIO_SETUP_SHA256,
  PAWNIO_SETUP_SIZE,
  readInstallFailure,
  resolveBundledInstaller,
  resolveInstalledLibrary,
  uninstallDriver,
  verifyDriverHash,
  verifyPawnIoInstaller
} from './driver'

const INSTALLER = join(process.cwd(), 'resources', 'pawnio', 'PawnIO_setup.exe')

function installation(overrides: Record<string, unknown> = {}) {
  return {
    dllPresent: false,
    registered: false,
    dllPath: 'C:\\Program Files\\PawnIO',
    ...overrides
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  mocks.packaged = false
  mocks.hashDigest = PAWNIO_SETUP_SHA256.toLowerCase()
  mocks.existsSync.mockReturnValue(false)
  mocks.readFile.mockResolvedValue(Buffer.from('setup'))
  mocks.stat.mockResolvedValue({ size: PAWNIO_SETUP_SIZE })
  mocks.writeFile.mockResolvedValue(undefined)
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.unlink.mockResolvedValue(undefined)
  mocks.detectPawnIoInstallation.mockResolvedValue(installation())
  mocks.currentPawnIoAssets.mockReturnValue({
    installer: 'C:\\hub\\resources\\pawnio\\PawnIO_setup.exe'
  })
  mocks.sensorsAgentLatestPath.mockReturnValue('C:\\sink\\latest.json')
  mocks.describePawnIoError.mockReturnValue(null)
  mocks.readSensorsLatestFile.mockResolvedValue({ fresh: false, deviceOpen: false })
  mocks.installSensorsAgent.mockResolvedValue({ ok: true })
  mocks.hasLeftoverFpsArtifacts.mockReturnValue(false)
  mocks.missingAgentRegisters.mockReturnValue({ msr: [], smn: [] })
  mocks.runPowerShellCommand.mockResolvedValue({
    stdout: '',
    stderr: '',
    code: 0,
    timedOut: false
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('caminhos e classificação', () => {
  it('resolve instalador embutido e DLL instalada', () => {
    expect(resolveBundledInstaller('C:\\r')).toBe(join('C:\\r', 'pawnio', 'PawnIO_setup.exe'))
    expect(resolveInstalledLibrary('C:\\PawnIO')).toBe(join('C:\\PawnIO', 'PawnIOLib.dll'))
    expect(bundledInstallerPath()).toBe(INSTALLER)

    mocks.packaged = true
    Object.defineProperty(process, 'resourcesPath', {
      value: 'C:\\installed\\resources',
      configurable: true
    })
    expect(bundledInstallerPath()).toBe(
      join('C:\\installed\\resources', 'pawnio', 'PawnIO_setup.exe')
    )
  })

  it('classifica ready/present/absent', () => {
    expect(
      classifyDriverState({ filePresent: false, serviceInstalled: false, deviceAccessible: true })
    ).toBe('ready')
    expect(
      classifyDriverState({ filePresent: true, serviceInstalled: false, deviceAccessible: false })
    ).toBe('present')
    expect(
      classifyDriverState({ filePresent: false, serviceInstalled: true, deviceAccessible: false })
    ).toBe('present')
    expect(
      classifyDriverState({ filePresent: false, serviceInstalled: false, deviceAccessible: false })
    ).toBe('absent')
  })
})

describe('verificação de hash/tamanho', () => {
  it('verifyDriverHash compara em minúsculas e tolera erro de leitura', async () => {
    mocks.readFile.mockResolvedValue(Buffer.from('setup'))
    await expect(verifyDriverHash('x')).resolves.toBe(true)
    await expect(verifyDriverHash('x', 'outro')).resolves.toBe(false)

    mocks.readFile.mockRejectedValue(new Error('EACCES'))
    await expect(verifyDriverHash('x')).resolves.toBe(false)
  })

  it('verifyPawnIoInstaller exige tamanho e hash', async () => {
    mocks.readFile.mockResolvedValue(Buffer.from('setup'))
    await expect(verifyPawnIoInstaller('x')).resolves.toBe(true)

    mocks.stat.mockResolvedValueOnce({ size: PAWNIO_SETUP_SIZE + 1 })
    await expect(verifyPawnIoInstaller('x')).resolves.toBe(false)

    mocks.stat.mockRejectedValueOnce(new Error('ENOENT'))
    await expect(verifyPawnIoInstaller('x')).resolves.toBe(false)
  })
})

describe('getDriverStatus', () => {
  it('ausente quando nada está instalado', async () => {
    const status = await getDriverStatus()
    expect(status).toMatchObject({
      state: 'absent',
      filePresent: false,
      serviceInstalled: false,
      deviceAccessible: false,
      outdated: false,
      installedPath: join('C:\\Program Files', 'PawnIO')
    })
    expect(status.error).toBeUndefined()
  })

  it('presente com DLL e serviço registrados', async () => {
    mocks.detectPawnIoInstallation.mockResolvedValue(
      installation({ dllPresent: true, registered: true, dllPath: 'D:\\PawnIO' })
    )
    const status = await getDriverStatus()
    expect(status.state).toBe('present')
    expect(status.installedPath).toBe('D:\\PawnIO')
  })

  it('pronto quando o sink está fresco e o device abriu', async () => {
    mocks.detectPawnIoInstallation.mockResolvedValue(installation({ dllPresent: true }))
    mocks.readSensorsLatestFile.mockResolvedValue({
      fresh: true,
      deviceOpen: true,
      sample: { vendor: 'amd', msr: {}, smn: {} }
    })

    const status = await getDriverStatus()
    expect(status.state).toBe('ready')
    expect(mocks.missingAgentRegisters).toHaveBeenCalledWith(
      { vendor: 'amd', msr: {}, smn: {} },
      'amd'
    )
    expect(status.outdated).toBe(false)
  })

  it('marca outdated quando faltam registradores do agente', async () => {
    mocks.detectPawnIoInstallation.mockResolvedValue(installation({ dllPresent: true }))
    mocks.readSensorsLatestFile.mockResolvedValue({
      fresh: true,
      deviceOpen: true,
      sample: { vendor: 'amd', msr: {}, smn: {} }
    })
    mocks.missingAgentRegisters.mockReturnValue({ msr: [1], smn: [] })

    await expect(getDriverStatus()).resolves.toMatchObject({ outdated: true })
  })

  it('sink stale expõe o detalhe do PawnIO ou o texto padrão', async () => {
    mocks.detectPawnIoInstallation.mockResolvedValue(installation({ dllPresent: true }))
    mocks.describePawnIoError.mockReturnValue('device negou acesso')
    await expect(getDriverStatus()).resolves.toMatchObject({ error: 'device negou acesso' })

    mocks.describePawnIoError.mockReturnValue(null)
    const status = await getDriverStatus()
    expect(status.error).toContain('leitura elevada não está ativa')
  })

  it('falha da detecção é logada e devolve absent', async () => {
    mocks.detectPawnIoInstallation.mockRejectedValue(new Error('registry quebrado'))
    await expect(getDriverStatus()).resolves.toMatchObject({ state: 'absent' })
    expect(mocks.logWarn).toHaveBeenCalled()
  })
})

describe('scripts e mensagens', () => {
  it('explica todas as etapas de falha', () => {
    expect(explainInstallFailure(null)).toContain('Não foi possível instalar')
    expect(explainInstallFailure({ stage: 'hash', code: 1 })).toContain('não confere com o hash')
    expect(explainInstallFailure({ stage: 'run', code: 1223 })).toContain('cancelada')
    expect(explainInstallFailure({ stage: 'run', code: 5 })).toContain('negou permissão')
    expect(explainInstallFailure({ stage: 'run', code: 1, detail: 'access is denied' })).toContain(
      'negou permissão'
    )
    expect(
      explainInstallFailure({ stage: 'run', code: 1, detail: 'newer installation found' })
    ).toContain('mais nova')
    expect(explainInstallFailure({ stage: 'run', code: 2, detail: 'x'.repeat(300) })).toContain('…')
    expect(explainInstallFailure({ stage: 'verify', code: 1 })).toContain(
      'não aparece como instalado'
    )
    expect(explainInstallFailure({ stage: 'unexpected', code: 1 })).toContain('antes de executar')
    expect(explainInstallFailure({ stage: 'desconhecida', code: 1 })).toContain(
      'Não foi possível instalar'
    )
  })

  it('monta os scripts com hash e aspas escapadas', () => {
    const install = buildInstallScript({
      setupPath: "C:\\O'Brien\\setup.exe",
      resultPath: 'C:\\tmp\\r.json'
    })
    expect(install).toContain("C:\\O''Brien\\setup.exe")
    expect(install).toContain(PAWNIO_SETUP_SHA256)
    expect(install).toContain('-install -silent')

    const uninstall = buildUninstallScript({
      setupPath: 'C:\\setup.exe',
      resultPath: 'C:\\tmp\\u.json'
    })
    expect(uninstall).toContain('-uninstall -silent')
  })

  it('detecta UAC cancelado em pt-BR/en', () => {
    expect(isUacCancelled('0x800704c7')).toBe(true)
    expect(isUacCancelled('código 1223')).toBe(true)
    expect(isUacCancelled('The operation was canceled by the user')).toBe(true)
    expect(isUacCancelled('cancelada pelo usuário')).toBe(true)
    expect(isUacCancelled('erro qualquer')).toBe(false)
  })

  it('readInstallFailure aceita BOM, normaliza campos e tolera lixo', async () => {
    mocks.readFile.mockResolvedValue('\uFEFF{"stage":"run","code":5,"detail":"x"}')
    await expect(readInstallFailure('r.json')).resolves.toEqual({
      stage: 'run',
      code: 5,
      detail: 'x'
    })

    mocks.readFile.mockResolvedValue('{"code":"5","stage":1}')
    await expect(readInstallFailure('r.json')).resolves.toEqual({
      stage: 'unknown',
      code: null,
      detail: undefined
    })

    mocks.readFile.mockResolvedValue('[]')
    await expect(readInstallFailure('r.json')).resolves.toBeNull()

    mocks.readFile.mockRejectedValue(new Error('ENOENT'))
    await expect(readInstallFailure('r.json')).resolves.toBeNull()
  })
})

describe('installDriver', () => {
  it('recusa fora do Windows', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    await expect(installDriver()).resolves.toMatchObject({ ok: false })
    await expect(uninstallDriver()).resolves.toMatchObject({ ok: false })
  })

  it('recusa quando o instalador embutido não existe', async () => {
    await expect(installDriver()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('não foi encontrado')
    })
  })

  it('recusa instalador com hash divergente', async () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.hashDigest = 'a'.repeat(64)
    await expect(installDriver()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('não confere com o hash')
    })
  })

  it('propaga cancelamento do UAC', async () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.runPowerShellCommand.mockResolvedValue({
      stdout: 'cancelado pelo usuário',
      stderr: '',
      code: 1,
      timedOut: false
    })
    await expect(installDriver()).resolves.toMatchObject({ ok: false, cancelled: true })
  })

  it('propaga timeout e falha do processo elevado', async () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.runPowerShellCommand.mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      code: null,
      timedOut: true
    })
    await expect(installDriver()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('demorou demais')
    })

    mocks.readFile.mockResolvedValue('{"stage":"run","code":5}')
    mocks.runPowerShellCommand.mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      code: 1,
      timedOut: false
    })
    await expect(installDriver()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('negou permissão')
    })
  })

  it('instala o PawnIO e o agente, terminando pronto', async () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.detectPawnIoInstallation
      .mockResolvedValueOnce(installation()) // inicial: ausente
      .mockResolvedValueOnce(installation({ dllPresent: true, registered: true })) // pós-instalação
      .mockResolvedValue(installation({ dllPresent: true, registered: true }))
    // Após instalar o agente, o sink fica pronto.
    mocks.readSensorsLatestFile.mockResolvedValue({
      fresh: true,
      deviceOpen: true,
      sample: { vendor: 'intel', msr: {}, smn: {} }
    })

    await expect(installDriver()).resolves.toMatchObject({ ok: true, state: 'ready' })
    expect(mocks.runPowerShellCommand).toHaveBeenCalled()
    expect(mocks.unlink).toHaveBeenCalled()
  })

  it('não pede UAC quando já está pronto e atualizado', async () => {
    mocks.detectPawnIoInstallation.mockResolvedValue(
      installation({ dllPresent: true, registered: true })
    )
    mocks.readSensorsLatestFile.mockResolvedValue({
      fresh: true,
      deviceOpen: true,
      sample: { vendor: 'intel', msr: {}, smn: {} }
    })

    await expect(installDriver()).resolves.toEqual({ ok: true, state: 'ready' })
    expect(mocks.runPowerShellCommand).not.toHaveBeenCalled()
    expect(mocks.installSensorsAgent).not.toHaveBeenCalled()
  })

  it('instala o agente quando o sink está desatualizado', async () => {
    mocks.detectPawnIoInstallation.mockResolvedValue(
      installation({ dllPresent: true, registered: true })
    )
    mocks.readSensorsLatestFile.mockResolvedValue({
      fresh: true,
      deviceOpen: true,
      sample: { vendor: 'amd', msr: {}, smn: {} }
    })
    mocks.missingAgentRegisters.mockReturnValue({ msr: [1], smn: [] })

    await expect(installDriver()).resolves.toMatchObject({ ok: true })
    expect(mocks.installSensorsAgent).toHaveBeenCalled()
  })

  it('propaga aviso não fatal do agente mesmo com os sensores ready', async () => {
    mocks.detectPawnIoInstallation.mockResolvedValue(
      installation({ dllPresent: true, registered: true })
    )
    mocks.readSensorsLatestFile.mockResolvedValue({
      fresh: true,
      deviceOpen: true,
      sample: { vendor: 'amd', msr: {}, smn: {} }
    })
    mocks.missingAgentRegisters.mockReturnValue({ msr: [1], smn: [] })
    mocks.installSensorsAgent.mockResolvedValue({
      ok: true,
      error: 'A leitura elevada foi instalada, mas o sink ainda não está fresco.'
    })

    await expect(installDriver()).resolves.toMatchObject({
      ok: true,
      state: 'ready',
      error: expect.stringContaining('ainda não está fresco')
    })
  })

  it('falha do agente vira resultado de erro', async () => {
    mocks.detectPawnIoInstallation.mockResolvedValue(
      installation({ dllPresent: true, registered: true })
    )
    mocks.readSensorsLatestFile.mockResolvedValue({ fresh: false, deviceOpen: false })
    mocks.installSensorsAgent.mockResolvedValue({
      ok: false,
      cancelled: true,
      error: 'UAC recusado'
    })

    await expect(installDriver()).resolves.toMatchObject({
      ok: false,
      cancelled: true,
      error: 'UAC recusado'
    })
  })

  it('avisa quando o agente instalou mas o sink ainda não iniciou', async () => {
    mocks.detectPawnIoInstallation
      .mockResolvedValueOnce(installation({ dllPresent: true, registered: true }))
      .mockResolvedValue(installation())
    mocks.readSensorsLatestFile.mockResolvedValue({ fresh: false, deviceOpen: false })

    const result = await installDriver()
    expect(result.ok).toBe(true)
    expect(result.error).toContain('ainda não iniciou')
  })
})

describe('uninstallDriver', () => {
  it('já ausente é sucesso idempotente', async () => {
    await expect(uninstallDriver()).resolves.toEqual({ ok: true, state: 'absent' })
  })

  it('recusa instalador inválido', async () => {
    mocks.detectPawnIoInstallation.mockResolvedValue(installation({ dllPresent: true }))
    mocks.existsSync.mockReturnValue(false)
    await expect(uninstallDriver()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('não confere')
    })
  })

  it('removido com sucesso', async () => {
    mocks.detectPawnIoInstallation
      .mockResolvedValueOnce(installation({ dllPresent: true, registered: true }))
      .mockResolvedValueOnce(installation())
    mocks.existsSync.mockReturnValue(true)

    await expect(uninstallDriver()).resolves.toEqual({ ok: true, state: 'absent' })
    expect(mocks.runPowerShellCommand).toHaveBeenCalled()
  })

  it('cancelamento do UAC é propagado', async () => {
    mocks.detectPawnIoInstallation.mockResolvedValue(installation({ dllPresent: true }))
    mocks.existsSync.mockReturnValue(true)
    mocks.runPowerShellCommand.mockResolvedValue({
      stdout: 'cancelled by the user',
      stderr: '',
      code: 1,
      timedOut: false
    })
    await expect(uninstallDriver()).resolves.toMatchObject({ ok: false, cancelled: true })
  })
})
