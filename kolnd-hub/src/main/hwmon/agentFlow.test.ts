import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  stat: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  cpus: vi.fn(() => [{ model: 'AMD Ryzen 7' }]),
  detectCpuVendor: vi.fn(() => 'amd' as const),
  moduleForVendor: vi.fn(() => 'AMDMSR' as const),
  detectPawnIoInstallation: vi.fn(),
  ensurePawnIoHelperAssets: vi.fn(),
  currentPawnIoAssets: vi.fn(),
  runPowerShellCommand: vi.fn(),
  runProcess: vi.fn(),
  resolvePowershellPath: vi.fn(() => 'C:\\ps.exe'),
  logWarn: vi.fn(),
  logInfo: vi.fn()
}))

vi.mock('fs', () => ({
  promises: { stat: mocks.stat, readFile: mocks.readFile, writeFile: mocks.writeFile }
}))
vi.mock('os', () => ({ cpus: mocks.cpus }))
vi.mock('./pawnio', () => ({
  detectCpuVendor: mocks.detectCpuVendor,
  moduleForVendor: mocks.moduleForVendor,
  detectPawnIoInstallation: mocks.detectPawnIoInstallation,
  ensurePawnIoHelperAssets: mocks.ensurePawnIoHelperAssets,
  currentPawnIoAssets: mocks.currentPawnIoAssets
}))
vi.mock('./powershell', () => ({
  runPowerShellCommand: mocks.runPowerShellCommand,
  runProcess: mocks.runProcess
}))
vi.mock('./systemPaths', () => ({ resolvePowershellPath: mocks.resolvePowershellPath }))
vi.mock('../logger', () => ({
  logger: { info: mocks.logInfo, warn: mocks.logWarn, error: vi.fn(), debug: vi.fn() }
}))

import {
  createSensorsAgentReader,
  installSensorsAgent,
  isSensorsAgentActive,
  isSensorsAgentInstalled,
  readSensorsLatestFile,
  removeSensorsAgent,
  resetSensorsAgentForTests
} from './agent'

const SINK = join('C:\\ProgramData', 'Kolnd Hub', 'sensors')
const LATEST = join(SINK, 'latest.json')

function latest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    vendor: 'amd',
    deviceOpen: true,
    msr: [{ index: 1, value: '10' }],
    smn: [{ index: 2, value: '20' }],
    ...overrides
  })
}

function processResult(overrides: Record<string, unknown> = {}) {
  return { stdout: '', stderr: '', code: 0, timedOut: false, ...overrides }
}

function assets() {
  return {
    dir: 'C:\\agent',
    dllPath: 'C:\\agent\\KolndPawnIo.dll',
    installer: 'C:\\hub\\pawnio\\setup.exe',
    intelModule: 'C:\\intel.bin',
    amdModule: 'C:\\amd.bin'
  }
}

/** Conteúdo do último `fs.writeFile` cujo caminho termina com `name`. */
function writtenFile(name: string): string {
  const call = mocks.writeFile.mock.calls.find(([path]) => String(path).endsWith(name))
  if (!call) throw new Error(`arquivo ${name} não foi escrito`)
  return String(call[1])
}

beforeEach(() => {
  vi.resetAllMocks()
  resetSensorsAgentForTests()
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  mocks.cpus.mockReturnValue([{ model: 'AMD Ryzen 7' }])
  mocks.detectCpuVendor.mockReturnValue('amd')
  mocks.moduleForVendor.mockReturnValue('AMDMSR')
  mocks.detectPawnIoInstallation.mockResolvedValue({ dllPresent: true, dllPath: 'C:\\PawnIO' })
  mocks.ensurePawnIoHelperAssets.mockResolvedValue(assets())
  mocks.currentPawnIoAssets.mockReturnValue(assets())
  mocks.writeFile.mockResolvedValue(undefined)
  mocks.stat.mockResolvedValue({ isFile: () => true, size: 100 })
  mocks.readFile.mockResolvedValue(latest())
  mocks.runPowerShellCommand.mockResolvedValue(processResult())
  mocks.runProcess.mockResolvedValue(processResult({ stdout: 'TaskName: KolndHubSensorsAgent' }))
})

describe('readSensorsLatestFile', () => {
  it('arquivo inválido/grande/ilegível é stale', async () => {
    mocks.stat.mockResolvedValueOnce({ isFile: () => false, size: 1 })
    await expect(readSensorsLatestFile(LATEST, Date.now())).resolves.toMatchObject({
      fresh: false,
      sample: null
    })

    mocks.stat.mockResolvedValueOnce({ isFile: () => true, size: 0 })
    await expect(readSensorsLatestFile(LATEST, Date.now())).resolves.toMatchObject({
      fresh: false
    })

    mocks.stat.mockResolvedValueOnce({ isFile: () => true, size: 100 * 1024 })
    await expect(readSensorsLatestFile(LATEST, Date.now())).resolves.toMatchObject({
      fresh: false
    })

    mocks.stat.mockRejectedValueOnce(new Error('ENOENT'))
    await expect(readSensorsLatestFile(LATEST, Date.now())).resolves.toMatchObject({
      fresh: false
    })
  })

  it('lê JSON com BOM e valida frescor', async () => {
    mocks.readFile.mockResolvedValue('\uFEFF' + latest())
    const parsed = await readSensorsLatestFile(LATEST, Date.now())
    expect(parsed.fresh).toBe(true)
    expect(parsed.sample?.msr[0]).toEqual({ index: 1, value: 10n })

    mocks.readFile.mockResolvedValue('não é json')
    await expect(readSensorsLatestFile(LATEST, Date.now())).resolves.toMatchObject({
      fresh: false
    })

    mocks.readFile.mockResolvedValue(
      latest({ timestamp: new Date(Date.now() - 10_000).toISOString() })
    )
    await expect(readSensorsLatestFile(LATEST, Date.now())).resolves.toMatchObject({
      fresh: false
    })
  })
})

describe('createSensorsAgentReader', () => {
  it('sink stale devolve indisponível com todas as posições nulas', async () => {
    mocks.stat.mockRejectedValue(new Error('ENOENT'))
    const reader = createSensorsAgentReader()
    await expect(reader.readBatch({ msr: [1, 2], smn: [3] })).resolves.toEqual({
      available: false,
      msr: [null, null],
      smn: [null],
      error: 'A leitura elevada dos sensores não está ativa.'
    })
  })

  it('device fechado usa o erro do sink (ou o texto padrão)', async () => {
    mocks.readFile.mockResolvedValue(latest({ deviceOpen: false, error: 'acesso negado' }))
    const reader = createSensorsAgentReader()
    await expect(reader.readBatch({ msr: [1], smn: [] })).resolves.toMatchObject({
      available: false,
      error: 'acesso negado'
    })

    mocks.readFile.mockResolvedValue(latest({ deviceOpen: false }))
    await expect(reader.readBatch({ msr: [], smn: [] })).resolves.toMatchObject({
      error: expect.stringContaining('não conseguiu abrir')
    })
  })

  it('alinhado com o pedido quando o device está aberto', async () => {
    mocks.readFile.mockResolvedValue(latest())
    const reader = createSensorsAgentReader()
    await expect(reader.readBatch({ msr: [1, 99], smn: [2] })).resolves.toEqual({
      available: true,
      msr: [10n, null],
      smn: [20n],
      error: undefined
    })
  })
})

describe('isSensorsAgentActive / isSensorsAgentInstalled', () => {
  it('active exige fresco e device aberto', async () => {
    await expect(isSensorsAgentActive()).resolves.toBe(true)
    mocks.readFile.mockResolvedValue(latest({ deviceOpen: false }))
    await expect(isSensorsAgentActive()).resolves.toBe(false)
  })

  it('não-Windows devolve false sem consultar schtasks', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    await expect(isSensorsAgentInstalled()).resolves.toBe(false)
    expect(mocks.runProcess).not.toHaveBeenCalled()
  })

  it('consulta schtasks no Windows', async () => {
    mocks.runProcess.mockResolvedValue(
      processResult({ stdout: 'Nome da tarefa: KolndHubSensorsAgent' })
    )
    await isSensorsAgentInstalled()
    expect(mocks.runProcess).toHaveBeenCalledWith(
      join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'schtasks.exe'),
      ['/Query', '/TN', 'KolndHubSensorsAgent', '/FO', 'LIST'],
      null,
      8000
    )
  })
})

describe('installSensorsAgent', () => {
  it('recusa fora do Windows', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    await expect(installSensorsAgent()).resolves.toMatchObject({ ok: false })
  })

  it('recusa CPU desconhecida e PawnIO ausente', async () => {
    mocks.detectCpuVendor.mockReturnValue(null as never)
    mocks.moduleForVendor.mockReturnValue(null as never)
    await expect(installSensorsAgent()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('não foi reconhecida')
    })

    mocks.detectCpuVendor.mockReturnValue('amd')
    mocks.moduleForVendor.mockReturnValue('AMDMSR')
    mocks.detectPawnIoInstallation.mockResolvedValue({ dllPresent: false })
    await expect(installSensorsAgent()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('PawnIO não está instalado')
    })
  })

  it('recusa duas operações simultâneas', async () => {
    let release!: (value: unknown) => void
    mocks.ensurePawnIoHelperAssets.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const first = installSensorsAgent()
    await expect(installSensorsAgent()).resolves.toEqual({
      ok: false,
      error: 'Já existe uma operação em andamento.'
    })

    release(assets())
    mocks.readFile.mockResolvedValue(latest())
    await expect(first).resolves.toMatchObject({ ok: true })
  })

  it('propaga UAC cancelado, timeout e código de erro', async () => {
    mocks.runPowerShellCommand.mockResolvedValueOnce(
      processResult({ stdout: 'cancelado pelo usuário', code: 1 })
    )
    await expect(installSensorsAgent()).resolves.toMatchObject({ ok: false, cancelled: true })

    mocks.runPowerShellCommand.mockResolvedValueOnce(processResult({ timedOut: true }))
    await expect(installSensorsAgent()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('demorou demais')
    })

    mocks.runPowerShellCommand.mockResolvedValueOnce(
      processResult({ code: 1, stderr: 'falha no agendamento' })
    )
    await expect(installSensorsAgent()).resolves.toMatchObject({
      ok: false,
      error: 'Não foi possível agendar a leitura elevada dos sensores.'
    })
    expect(mocks.logWarn).toHaveBeenCalled()
  })

  it('sucesso quando o sink fica fresco', async () => {
    await expect(installSensorsAgent()).resolves.toEqual({ ok: true })
    expect(mocks.writeFile).toHaveBeenCalled()
    expect(mocks.logInfo).toHaveBeenCalled()
  })

  it('caminho feliz gera scripts com a limpeza incondicional das sobras antigas', async () => {
    await expect(installSensorsAgent()).resolves.toEqual({ ok: true })
    const agentScript = writtenFile('sensors-agent.ps1')
    const installScript = writtenFile('sensors-agent-install.ps1')

    // O script persistente só cuida dos sensores; as sobras do FPS antigo saem
    // no instalador elevado, sem depender de o coletor existir nesta versão.
    expect(agentScript).not.toContain('KolndFpsEtw.exe')
    expect(installScript).toContain("'/TN' 'KolndHubFpsAgent'")
    expect(installScript).toContain(
      `Get-CimInstance Win32_Process -Filter "Name='KolndFpsEtw.exe'"`
    )
    expect(installScript).toContain('Kolnd Hub\\fps')
    expect(installScript).toContain('& schtasks.exe /Run /TN')
  })

  it('avisa quando a tarefa foi instalada mas o sink não respondeu', async () => {
    vi.useFakeTimers()
    mocks.stat.mockRejectedValue(new Error('ENOENT'))
    try {
      const promise = installSensorsAgent()
      await vi.advanceTimersByTimeAsync(6_000)
      await expect(promise).resolves.toMatchObject({
        ok: true,
        error: expect.stringContaining('ainda não está fresco')
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('exceção inesperada vira erro amigável', async () => {
    mocks.ensurePawnIoHelperAssets.mockRejectedValue(new Error('disco'))
    await expect(installSensorsAgent()).resolves.toEqual({
      ok: false,
      error: 'Não foi possível ativar a leitura elevada dos sensores.'
    })
  })
})

describe('removeSensorsAgent', () => {
  it('recusa fora do Windows', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    await expect(removeSensorsAgent()).resolves.toMatchObject({ ok: false })
  })

  it('sucesso remove a tarefa e loga', async () => {
    await expect(removeSensorsAgent()).resolves.toEqual({ ok: true })
    expect(mocks.runPowerShellCommand).toHaveBeenCalled()
    expect(mocks.logInfo).toHaveBeenCalled()
  })

  it('cancelamento, timeout/código e exceção', async () => {
    mocks.runPowerShellCommand.mockResolvedValueOnce(processResult({ stdout: '1223', code: 1 }))
    await expect(removeSensorsAgent()).resolves.toMatchObject({ ok: false, cancelled: true })

    mocks.runPowerShellCommand.mockResolvedValueOnce(processResult({ timedOut: true }))
    await expect(removeSensorsAgent()).resolves.toMatchObject({ ok: false })

    mocks.ensurePawnIoHelperAssets.mockRejectedValueOnce(new Error('sem disco'))
    await expect(removeSensorsAgent()).resolves.toEqual({
      ok: false,
      error: 'Não foi possível remover a leitura elevada dos sensores.'
    })
  })

  it('recusa operação simultânea', async () => {
    let release!: (value: unknown) => void
    mocks.ensurePawnIoHelperAssets.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const first = removeSensorsAgent()
    await expect(removeSensorsAgent()).resolves.toEqual({
      ok: false,
      error: 'Já existe uma operação em andamento.'
    })
    release(assets())
    await expect(first).resolves.toEqual({ ok: true })
  })
})
