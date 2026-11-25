import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProcessResult } from './powershell'

// O agent importa `electron` (via pawnio/paths) e o logger, mas os testes
// exercitam só funções puras — nada de UAC/tarefa/processo real.
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: vi.fn(() => 'C:\\userData') }
}))
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import {
  buildSensorsAgentCreateArgs,
  buildSensorsAgentDeleteArgs,
  buildSensorsAgentElevationCommand,
  buildSensorsAgentInstallScript,
  buildSensorsAgentRemoveScript,
  buildSensorsAgentScript,
  createSensorsAgentReader,
  hasLeftoverFpsArtifacts,
  interpretSensorsAgentQuery,
  missingAgentRegisters,
  parseSensorsLatest,
  readSensorsLatestFile,
  resetSensorsAgentForTests,
  resolveSensorsSinkDir,
  SENSORS_AGENT_STALE_MS,
  SENSORS_AGENT_TASK_NAME,
  sensorsAgentLatestPath,
  sensorsAgentRegisters,
  sensorsAgentStopPath,
  type SensorsAgentSample
} from './agent'
import { decodeSmnTemp } from './cpuPower'
import {
  MSR_AMD_PACKAGE_ENERGY_STATUS,
  MSR_AMD_RAPL_POWER_UNIT,
  MSR_INTEL_PACKAGE_ENERGY_STATUS,
  MSR_INTEL_PACKAGE_THERM_STATUS,
  MSR_INTEL_PERF_STATUS,
  MSR_INTEL_RAPL_POWER_UNIT,
  MSR_INTEL_TEMPERATURE_TARGET,
  MSR_INTEL_THERM_STATUS,
  SMN_AMD_SVI0_PLANE0_0C,
  SMN_AMD_SVI0_PLANE0_10,
  SMN_AMD_SVI0_TFN,
  SMN_THM_TCON_CUR_TMP
} from './registers'
import { resolvePowershellPath } from './systemPaths'

const tempRoots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'kolnd-sensors-agent-'))
  tempRoots.push(dir)
  return dir
}

afterAll(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

function processResult(partial: Partial<ProcessResult>): ProcessResult {
  return { stdout: '', stderr: '', code: 0, timedOut: false, ...partial }
}

const OPTIONS = {
  scriptPath: 'C:\\ProgramData\\Kolnd Hub\\sensors\\sensors-agent.ps1',
  sinkDir: 'C:\\ProgramData\\Kolnd Hub\\sensors'
}

const NOW = Date.parse('2026-11-18T12:00:00.000Z')

/** Corpo real do sink: MSR RAPL + Tctl `0x6DFB0000` (repouso nesta máquina). */
function realSink(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    timestamp: new Date(NOW).toISOString(),
    vendor: 'amd',
    deviceOpen: true,
    msr: [
      { index: String(MSR_AMD_RAPL_POWER_UNIT), value: String(0x000a1003) },
      { index: String(MSR_AMD_PACKAGE_ENERGY_STATUS), value: '123456789' }
    ],
    smn: [{ index: String(SMN_THM_TCON_CUR_TMP), value: String(0x6dfb0000) }],
    board: null,
    error: null,
    ...overrides
  }
}

/** Amostra já parseada do sink, para exercitar a comparação de registradores. */
function sinkSample(input: {
  vendor: 'amd' | 'intel' | 'other'
  msr?: Array<number | [number, bigint | null]>
  smn?: Array<number | [number, bigint | null]>
}): SensorsAgentSample {
  const entry = (item: number | [number, bigint | null]) =>
    Array.isArray(item) ? { index: item[0], value: item[1] } : { index: item, value: 1n }
  return {
    timestamp: new Date(NOW).toISOString(),
    capturedAtMs: NOW,
    vendor: input.vendor,
    deviceOpen: true,
    msr: (input.msr ?? []).map(entry),
    smn: (input.smn ?? []).map(entry),
    board: null
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetSensorsAgentForTests()
})

describe('resolveSensorsSinkDir', () => {
  it('usa %ProgramData%\\Kolnd Hub\\sensors por padrão', () => {
    expect(resolveSensorsSinkDir('C:\\ProgramData')).toBe('C:\\ProgramData\\Kolnd Hub\\sensors')
  })

  it('aceita KOLDND_HUB_SENSORS_DIR absoluto (E2E)', () => {
    expect(resolveSensorsSinkDir('C:\\ProgramData', 'C:\\temp\\sensors-e2e')).toBe(
      'C:\\temp\\sensors-e2e'
    )
  })

  it('ignora override inválido em vez de derrubar o app', () => {
    expect(resolveSensorsSinkDir('C:\\ProgramData', 'relativo\\sensors')).toBe(
      'C:\\ProgramData\\Kolnd Hub\\sensors'
    )
    expect(resolveSensorsSinkDir('C:\\ProgramData', 'C:\\temp\\"quoted"')).toBe(
      'C:\\ProgramData\\Kolnd Hub\\sensors'
    )
    expect(resolveSensorsSinkDir('C:\\ProgramData', null)).toBe(
      'C:\\ProgramData\\Kolnd Hub\\sensors'
    )
  })

  it('monta os caminhos do latest e do stop no mesmo diretório', () => {
    const dir = 'C:\\ProgramData\\Kolnd Hub\\sensors'
    expect(sensorsAgentLatestPath(dir)).toBe(`${dir}\\latest.json`)
    expect(sensorsAgentStopPath(dir)).toBe(`${dir}\\stop.flag`)
  })
})

describe('registradores do agente', () => {
  it('AMD lê unidade + energia (MSR) e Tctl + os três SMN do SVI2', () => {
    expect(sensorsAgentRegisters('amd')).toEqual({
      msr: [MSR_AMD_RAPL_POWER_UNIT, MSR_AMD_PACKAGE_ENERGY_STATUS],
      // Os DOIS candidatos do plano 0 entram na lista: quem escolhe é o decode.
      smn: [SMN_THM_TCON_CUR_TMP, SMN_AMD_SVI0_TFN, SMN_AMD_SVI0_PLANE0_0C, SMN_AMD_SVI0_PLANE0_10]
    })
  })

  it('Intel lê RAPL, os três MSR térmicos e a tensão (0x198), sem SMN', () => {
    const registers = sensorsAgentRegisters('intel')
    expect(registers.smn).toEqual([])
    expect(registers.msr).toHaveLength(6)
    expect(registers.msr).toContain(MSR_INTEL_PERF_STATUS)
  })

  it('vendor desconhecido não inventa leitura', () => {
    expect(sensorsAgentRegisters('other')).toEqual({ msr: [], smn: [] })
  })
})

describe('missingAgentRegisters (agente desatualizado)', () => {
  const AMD_MSR = [MSR_AMD_RAPL_POWER_UNIT, MSR_AMD_PACKAGE_ENERGY_STATUS]

  it('amostra ou vendor ausente não classifica como desatualizado', () => {
    expect(missingAgentRegisters(null, 'amd')).toEqual({ msr: [], smn: [] })
    expect(missingAgentRegisters(sinkSample({ vendor: 'amd', msr: AMD_MSR }), null)).toEqual({
      msr: [],
      smn: []
    })
  })

  it('sink antigo (só Tctl + RAPL) lista os SMN do SVI2 que faltam', () => {
    const missing = missingAgentRegisters(
      sinkSample({ vendor: 'amd', msr: AMD_MSR, smn: [SMN_THM_TCON_CUR_TMP] }),
      'amd'
    )
    expect(missing.msr).toEqual([])
    expect(missing.smn).toEqual([SMN_AMD_SVI0_TFN, SMN_AMD_SVI0_PLANE0_0C, SMN_AMD_SVI0_PLANE0_10])
  })

  it('sink completo não acusa falta — valor null conta como presente', () => {
    const missing = missingAgentRegisters(
      sinkSample({
        vendor: 'amd',
        msr: AMD_MSR,
        smn: [
          SMN_THM_TCON_CUR_TMP,
          SMN_AMD_SVI0_TFN,
          [SMN_AMD_SVI0_PLANE0_0C, null],
          SMN_AMD_SVI0_PLANE0_10
        ]
      }),
      'amd'
    )
    expect(missing).toEqual({ msr: [], smn: [] })
  })

  it('Intel não acusa falta de SMN (a lista esperada é vazia)', () => {
    const missing = missingAgentRegisters(
      sinkSample({
        vendor: 'intel',
        msr: [
          MSR_INTEL_RAPL_POWER_UNIT,
          MSR_INTEL_PACKAGE_ENERGY_STATUS,
          MSR_INTEL_TEMPERATURE_TARGET,
          MSR_INTEL_PACKAGE_THERM_STATUS,
          MSR_INTEL_THERM_STATUS,
          MSR_INTEL_PERF_STATUS
        ]
      }),
      'intel'
    )
    expect(missing).toEqual({ msr: [], smn: [] })
  })
})

describe('comandos do schtasks', () => {
  it('monta a ação com PowerShell oculto executando o script do agent', () => {
    const args = buildSensorsAgentCreateArgs(OPTIONS)
    const action = args[args.indexOf('/TR') + 1]
    expect(action).toContain(resolvePowershellPath())
    expect(action).toContain('-WindowStyle Hidden')
    // `\"` é o escape que o schtasks exige para caminhos com espaço.
    expect(action).toContain(`\\"${OPTIONS.scriptPath}\\"`)
  })

  it('cria a tarefa no logon com privilégio máximo', () => {
    expect(buildSensorsAgentCreateArgs(OPTIONS)).toEqual([
      '/Create',
      '/TN',
      SENSORS_AGENT_TASK_NAME,
      '/TR',
      expect.any(String),
      '/SC',
      'ONLOGON',
      '/RL',
      'HIGHEST',
      '/F'
    ])
  })

  it('remove a tarefa pelo nome fixo', () => {
    expect(buildSensorsAgentDeleteArgs()).toEqual(['/Delete', '/TN', 'KolndHubSensorsAgent', '/F'])
  })

  it('recusa caminhos com aspas/quebra de linha na ação (injeção de argumentos)', () => {
    expect(() => buildSensorsAgentCreateArgs({ ...OPTIONS, scriptPath: 'C:\\a"b.ps1' })).toThrow(
      /Caminho inválido/
    )
    expect(() => buildSensorsAgentCreateArgs({ ...OPTIONS, scriptPath: 'C:\\a\nb.ps1' })).toThrow(
      /Caminho inválido/
    )
    expect(() => buildSensorsAgentCreateArgs({ ...OPTIONS, scriptPath: 'relativo.ps1' })).toThrow(
      /Caminho inválido/
    )
  })
})

describe('scripts elevados', () => {
  it('instala: cria sink, libera leitura para Usuários e agenda + inicia', () => {
    const script = buildSensorsAgentInstallScript(OPTIONS)
    expect(script).toContain(
      "New-Item -ItemType Directory -Force -Path 'C:\\ProgramData\\Kolnd Hub\\sensors'"
    )
    expect(script).toContain("/grant '*S-1-5-32-545:(OI)(CI)RX'")
    expect(script).toContain(
      "Remove-Item -Force -ErrorAction SilentlyContinue 'C:\\ProgramData\\Kolnd Hub\\sensors\\stop.flag'"
    )
    expect(script).toContain("& schtasks.exe '/Create'")
    expect(script).toContain("'/SC' 'ONLOGON'")
    expect(script).toContain("'/RL' 'HIGHEST'")
    expect(script).toContain('& schtasks.exe /Run /TN')
  })

  it('estagia script + helper em ProgramData e agenda a cópia protegida', () => {
    const stagedDir = 'C:\\ProgramData\\Kolnd Hub\\sensors\\agent'
    const stagedScript = `${stagedDir}\\sensors-agent.ps1`
    const stagedHelper = `${stagedDir}\\KolndPawnIo.dll`
    const helperSource = 'C:\\Users\\dev\\AppData\\Roaming\\kolnd-hub\\hwmon\\KolndPawnIo.dll'
    const script = buildSensorsAgentInstallScript({
      ...OPTIONS,
      stagedDir,
      stagedScriptPath: stagedScript,
      helperSourcePath: helperSource,
      stagedHelperPath: stagedHelper
    })
    expect(script).toContain(
      `Copy-Item -LiteralPath '${helperSource}' -Destination '${stagedHelper}' -Force`
    )
    expect(script).toContain(
      `Copy-Item -LiteralPath '${OPTIONS.scriptPath}' -Destination '${stagedScript}' -Force`
    )
    // A pasta estagiada perde a herança: escrita só para Admins/SYSTEM.
    expect(script).toContain('/inheritance:r')
    expect(script).toContain("'*S-1-5-32-544:(OI)(CI)F'")
    expect(script).toContain("'*S-1-5-18:(OI)(CI)F'")
    expect(script).toContain("'*S-1-5-32-545:(OI)(CI)RX'")
    expect(script).toContain(`-File \\"${stagedScript}\\"`)
  })

  it('remoção grava stop, espera o loop sair, encerra e limpa os arquivos', () => {
    const script = buildSensorsAgentRemoveScript(OPTIONS.sinkDir)
    expect(script).toContain(
      "New-Item -ItemType File -Force -Path 'C:\\ProgramData\\Kolnd Hub\\sensors\\stop.flag'"
    )
    expect(script).toContain('Start-Sleep -Milliseconds 1500')
    expect(script).toContain('& schtasks.exe /End /TN')
    expect(script).toContain("& schtasks.exe '/Delete'")
    expect(script).toContain(
      "Remove-Item -Force -ErrorAction SilentlyContinue 'C:\\ProgramData\\Kolnd Hub\\sensors\\latest.json'"
    )
    expect(script).toContain(
      "Remove-Item -Recurse -Force -ErrorAction SilentlyContinue 'C:\\ProgramData\\Kolnd Hub\\sensors\\agent'"
    )
  })

  it('elevação pede UAC e espera o processo elevado', () => {
    const command = buildSensorsAgentElevationCommand('C:\\temp\\install.ps1')
    expect(command).toContain('-Verb RunAs -Wait -PassThru')
    expect(command).toContain('C:\\temp\\install.ps1')
  })
})

describe('script persistente do agent', () => {
  const input = {
    helperDllPath: 'C:\\Users\\dev\\AppData\\Roaming\\kolnd-hub\\hwmon\\KolndPawnIo.dll',
    pawnIoDllPath: 'C:\\Program Files\\PawnIO\\PawnIOLib.dll',
    modulePath: 'C:\\App\\resources\\pawnio\\AMDFamily17.bin',
    vendor: 'amd' as const,
    sinkPath: 'C:\\ProgramData\\Kolnd Hub\\sensors\\latest.json',
    stopPath: 'C:\\ProgramData\\Kolnd Hub\\sensors\\stop.flag',
    msr: [MSR_AMD_RAPL_POWER_UNIT, MSR_AMD_PACKAGE_ENERGY_STATUS],
    smn: [SMN_THM_TCON_CUR_TMP],
    intervalMs: 1000
  }

  it('carrega o helper, abre a PawnIOLib uma vez e chama RunAgent no loop de 1 Hz', () => {
    const script = buildSensorsAgentScript(input)
    expect(script).toContain('Add-Type -Path $helper')
    expect(script).toContain(
      "$helper = 'C:\\Users\\dev\\AppData\\Roaming\\kolnd-hub\\hwmon\\KolndPawnIo.dll'"
    )
    expect(script).toContain("$dll = 'C:\\Program Files\\PawnIO\\PawnIOLib.dll'")
    expect(script).toContain('[KolndPawnIo]::RunAgent($dll,')
    expect(script).toContain("'amd'")
    expect(script).toContain(`'${input.msr.join(',')}'`)
    expect(script).toContain(`'${input.smn.join(',')}'`)
    expect(script).toContain(', 1000)')
    expect(script).toContain(input.stopPath)
  })

  it('recusa caminhos inválidos do DLL/sink', () => {
    expect(() => buildSensorsAgentScript({ ...input, helperDllPath: 'relativo.dll' })).toThrow(
      /Caminho inválido/
    )
    expect(() => buildSensorsAgentScript({ ...input, pawnIoDllPath: 'C:\\a"b.dll' })).toThrow(
      /Caminho inválido/
    )
    expect(() => buildSensorsAgentScript({ ...input, sinkPath: 'C:\\a"b.json' })).toThrow(/Caminho/)
  })
})

describe('limpeza das sobras do FPS antigo', () => {
  const STAGED_OPTIONS = {
    ...OPTIONS,
    stagedDir: 'C:\\ProgramData\\Kolnd Hub\\sensors\\agent',
    stagedScriptPath: 'C:\\ProgramData\\Kolnd Hub\\sensors\\agent\\sensors-agent.ps1',
    helperSourcePath: 'C:\\Users\\dev\\AppData\\Roaming\\kolnd-hub\\hwmon\\KolndPawnIo.dll',
    stagedHelperPath: 'C:\\ProgramData\\Kolnd Hub\\sensors\\agent\\KolndPawnIo.dll'
  }
  const legacyDir = join(process.env.ProgramData ?? 'C:\\ProgramData', 'Kolnd Hub', 'fps')
  const stagedExe = join(OPTIONS.sinkDir, 'agent', 'KolndFpsEtw.exe')

  it('o instalador limpa tarefa, processo e diretório legado sem depender de coletor', () => {
    const script = buildSensorsAgentInstallScript(STAGED_OPTIONS)
    expect(script).toContain("& schtasks.exe /End /TN 'KolndHubFpsAgent' 2>$null | Out-Null")
    expect(script).toContain(
      "& schtasks.exe '/Delete' '/TN' 'KolndHubFpsAgent' '/F' 2>$null | Out-Null"
    )
    expect(script).toContain(`Get-CimInstance Win32_Process -Filter "Name='KolndFpsEtw.exe'"`)
    expect(script).toContain('Stop-Process -Id $_.ProcessId -Force')
    expect(script).toContain('Start-Sleep -Milliseconds 400')
    expect(script).toContain(
      `Remove-Item -Recurse -Force -ErrorAction SilentlyContinue '${legacyDir}'`
    )
    expect(script).toContain(`Remove-Item -Force -ErrorAction SilentlyContinue '${stagedExe}'`)
  })

  it('o removedor também limpa a tarefa legada, o processo e o diretório de FPS', () => {
    const script = buildSensorsAgentRemoveScript(OPTIONS.sinkDir)
    expect(script).toContain("& schtasks.exe /End /TN 'KolndHubFpsAgent'")
    expect(script).toContain("& schtasks.exe '/Delete' '/TN' 'KolndHubFpsAgent' '/F'")
    expect(script).toContain(`Get-CimInstance Win32_Process -Filter "Name='KolndFpsEtw.exe'"`)
    expect(script).toContain(
      `Remove-Item -Recurse -Force -ErrorAction SilentlyContinue '${legacyDir}'`
    )
    expect(script).toContain(`Remove-Item -Force -ErrorAction SilentlyContinue '${stagedExe}'`)
  })

  it('hasLeftoverFpsArtifacts detecta o diretório legado e a cópia estagiada', async () => {
    const dir = await tempDir()
    const programData = join(dir, 'ProgramData')
    const sinkDir = join(dir, 'sensors')

    expect(hasLeftoverFpsArtifacts(sinkDir, programData)).toBe(false)

    const legacy = join(programData, 'Kolnd Hub', 'fps')
    await fs.mkdir(legacy, { recursive: true })
    expect(hasLeftoverFpsArtifacts(sinkDir, programData)).toBe(true)

    await fs.rm(legacy, { recursive: true, force: true })
    const staged = join(sinkDir, 'agent')
    await fs.mkdir(staged, { recursive: true })
    await fs.writeFile(join(staged, 'KolndFpsEtw.exe'), 'resto')
    expect(hasLeftoverFpsArtifacts(sinkDir, programData)).toBe(true)
  })
})

describe('parseSensorsLatest', () => {
  it('aceita o corpo real e preserva Tctl bruto para o decode do cpuPower', () => {
    const parsed = parseSensorsLatest(realSink(), NOW + 500)
    expect(parsed.fresh).toBe(true)
    expect(parsed.deviceOpen).toBe(true)
    expect(parsed.sample?.vendor).toBe('amd')
    expect(parsed.sample?.board).toBeNull()
    expect(parsed.sample?.msr[0]).toEqual({
      index: MSR_AMD_RAPL_POWER_UNIT,
      value: BigInt(0x000a1003)
    })
    // O valor real `0x6DFB0000` vira ~60,9 °C (com o offset de −49).
    expect(decodeSmnTemp(parsed.sample?.smn[0]?.value ?? null)).toBeCloseTo(60.9, 1)
  })

  it('stale > 3 s (ou futuro absurdo) invalida a amostra', () => {
    expect(parseSensorsLatest(realSink(), NOW + SENSORS_AGENT_STALE_MS + 1).fresh).toBe(false)
    expect(parseSensorsLatest(realSink(), NOW - 6_000).fresh).toBe(false)
  })

  it('device fechado continua fresco, mas com o erro explicável', () => {
    const parsed = parseSensorsLatest(
      realSink({ deviceOpen: false, error: 'device|5|', msr: [], smn: [] }),
      NOW + 100
    )
    expect(parsed.fresh).toBe(true)
    expect(parsed.deviceOpen).toBe(false)
    expect(parsed.error).toBe('device|5|')
  })

  it('rejeita JSON sem timestamp válido e entradas malformadas', () => {
    expect(parseSensorsLatest(null, NOW).fresh).toBe(false)
    expect(parseSensorsLatest('texto', NOW).fresh).toBe(false)
    expect(parseSensorsLatest({ timestamp: 'ontem' }, NOW).fresh).toBe(false)
    expect(parseSensorsLatest({}, NOW).fresh).toBe(false)
  })
})

describe('readSensorsLatestFile', () => {
  it('lê o arquivo real e ignora BOM', async () => {
    const dir = await tempDir()
    const file = join(dir, 'latest.json')
    await fs.writeFile(file, '\uFEFF' + JSON.stringify(realSink()), 'utf8')
    const parsed = await readSensorsLatestFile(file, NOW + 200)
    expect(parsed.fresh).toBe(true)
    expect(parsed.sample?.smn[0].value).toBe(BigInt(0x6dfb0000))
  })

  it('arquivo ausente, vazio ou JSON inválido = stale', async () => {
    const dir = await tempDir()
    await expect(readSensorsLatestFile(join(dir, 'nao-existe.json'), NOW)).resolves.toMatchObject({
      fresh: false
    })
    const empty = join(dir, 'vazio.json')
    await fs.writeFile(empty, '', 'utf8')
    await expect(readSensorsLatestFile(empty, NOW)).resolves.toMatchObject({ fresh: false })
    const broken = join(dir, 'quebrado.json')
    await fs.writeFile(broken, '{quebrado', 'utf8')
    await expect(readSensorsLatestFile(broken, NOW)).resolves.toMatchObject({ fresh: false })
  })
})

describe('createSensorsAgentReader', () => {
  it('traduz o sink em valores alinhados com o pedido do cpuPower', async () => {
    const dir = await tempDir()
    const previous = process.env.KOLDND_HUB_SENSORS_DIR
    process.env.KOLDND_HUB_SENSORS_DIR = dir
    try {
      await fs.writeFile(
        join(dir, 'latest.json'),
        JSON.stringify(realSink({ timestamp: new Date().toISOString() })),
        'utf8'
      )
      const result = await createSensorsAgentReader().readBatch({
        msr: [MSR_AMD_RAPL_POWER_UNIT, MSR_AMD_PACKAGE_ENERGY_STATUS],
        smn: [SMN_THM_TCON_CUR_TMP]
      })
      expect(result.available).toBe(true)
      expect(result.msr).toEqual([BigInt(0x000a1003), 123456789n])
      expect(result.smn).toEqual([BigInt(0x6dfb0000)])
    } finally {
      if (previous === undefined) delete process.env.KOLDND_HUB_SENSORS_DIR
      else process.env.KOLDND_HUB_SENSORS_DIR = previous
    }
  })

  it('sink stale devolve available=false com motivo, sem valores inventados', async () => {
    const dir = await tempDir()
    const previous = process.env.KOLDND_HUB_SENSORS_DIR
    process.env.KOLDND_HUB_SENSORS_DIR = dir
    try {
      await fs.writeFile(
        join(dir, 'latest.json'),
        JSON.stringify(realSink({ timestamp: new Date(Date.now() - 60_000).toISOString() })),
        'utf8'
      )
      const result = await createSensorsAgentReader().readBatch({
        msr: [MSR_AMD_RAPL_POWER_UNIT],
        smn: [SMN_THM_TCON_CUR_TMP]
      })
      expect(result.available).toBe(false)
      expect(result.msr).toEqual([null])
      expect(result.smn).toEqual([null])
      expect(result.error).toContain('não está ativa')
    } finally {
      if (previous === undefined) delete process.env.KOLDND_HUB_SENSORS_DIR
      else process.env.KOLDND_HUB_SENSORS_DIR = previous
    }
  })
})

describe('interpretSensorsAgentQuery', () => {
  it('reconhece tarefa existente pelo nome', () => {
    expect(
      interpretSensorsAgentQuery(
        processResult({ stdout: 'TaskName: \\KolndHubSensorsAgent\r\nStatus: Ready' })
      )
    ).toBe(true)
  })

  it('reconhece ausência em pt-BR/en-US e não inventa em timeout', () => {
    expect(
      interpretSensorsAgentQuery(
        processResult({ code: 1, stderr: 'ERRO: não existe a tarefa especificada.' })
      )
    ).toBe(false)
    expect(
      interpretSensorsAgentQuery(processResult({ code: 1, stderr: 'cannot find the task' }))
    ).toBe(false)
    expect(interpretSensorsAgentQuery(processResult({ timedOut: true }))).toBeNull()
    expect(interpretSensorsAgentQuery(processResult({ code: 1, stderr: 'outro erro' }))).toBeNull()
  })
})
