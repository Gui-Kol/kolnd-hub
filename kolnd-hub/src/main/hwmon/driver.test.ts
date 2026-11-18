import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import * as os from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(os.tmpdir(), 'kolnd-hub-test') }
}))
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const pawnio = vi.hoisted(() => ({
  detect: vi.fn()
}))

const sensors = vi.hoisted(() => ({
  readLatest: vi.fn(),
  latestPath: vi.fn(() => 'C:\\ProgramData\\Kolnd Hub\\sensors\\latest.json'),
  install: vi.fn()
}))

vi.mock('./pawnio', () => ({
  currentPawnIoAssets: () => ({
    dir: 'C:\\App\\resources\\pawnio',
    installer: 'C:\\App\\resources\\pawnio\\PawnIO_setup.exe'
  }),
  detectPawnIoInstallation: pawnio.detect,
  // A pista de erro do sink é traduzida em driver; o mock devolve null para
  // exercitar a mensagem padrão de "leitura não ativa".
  describePawnIoError: () => null
}))

vi.mock('./agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./agent')>()
  return {
    ...actual,
    readSensorsLatestFile: sensors.readLatest,
    sensorsAgentLatestPath: sensors.latestPath,
    installSensorsAgent: sensors.install
  }
})

import {
  PAWNIO_SETUP_SHA256,
  PAWNIO_SETUP_SIZE,
  buildInstallScript,
  buildUninstallScript,
  classifyDriverState,
  explainInstallFailure,
  getDriverStatus,
  installDriver,
  isUacCancelled,
  readInstallFailure,
  resolveBundledInstaller,
  resolveInstalledLibrary,
  verifyDriverHash,
  verifyPawnIoInstaller
} from './driver'
import {
  MSR_AMD_PACKAGE_ENERGY_STATUS,
  MSR_AMD_RAPL_POWER_UNIT,
  SMN_AMD_SVI0_PLANE0_0C,
  SMN_AMD_SVI0_PLANE0_10,
  SMN_AMD_SVI0_TFN,
  SMN_THM_TCON_CUR_TMP
} from './registers'

const TEMP_DIRS: string[] = []

/** Sink stale (default): agente não está publicando leitura. */
const STALE_SINK = {
  fresh: false,
  deviceOpen: false,
  sample: null,
  capturedAtMs: null
}

/** Sink fresco com o device aberto e TODOS os registradores desta versão. */
const FRESH_SINK = {
  fresh: true,
  deviceOpen: true,
  sample: {
    timestamp: '2026-11-18T12:00:00.000Z',
    capturedAtMs: Date.parse('2026-11-18T12:00:00.000Z'),
    vendor: 'amd',
    deviceOpen: true,
    msr: [
      { index: MSR_AMD_RAPL_POWER_UNIT, value: 0x000a1003n },
      { index: MSR_AMD_PACKAGE_ENERGY_STATUS, value: 1n }
    ],
    // `value: null` conta como presente: leitura falhou, script está novo.
    smn: [
      { index: SMN_THM_TCON_CUR_TMP, value: 1n },
      { index: SMN_AMD_SVI0_TFN, value: 0n },
      { index: SMN_AMD_SVI0_PLANE0_0C, value: null },
      { index: SMN_AMD_SVI0_PLANE0_10, value: 1n }
    ],
    board: null
  },
  capturedAtMs: Date.parse('2026-11-18T12:00:00.000Z')
}

/** Agente antigo: sink fresco, mas só com Tctl/RAPL (sem os SMN do SVI2). */
const OUTDATED_SINK = {
  ...FRESH_SINK,
  sample: {
    ...FRESH_SINK.sample,
    smn: [{ index: SMN_THM_TCON_CUR_TMP, value: 1n }]
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  sensors.latestPath.mockReturnValue('C:\\ProgramData\\Kolnd Hub\\sensors\\latest.json')
  sensors.readLatest.mockResolvedValue(STALE_SINK)
  sensors.install.mockResolvedValue({ ok: true })
})

afterEach(async () => {
  await Promise.all(TEMP_DIRS.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(join(os.tmpdir(), 'kolnd-hub-test-'))
  TEMP_DIRS.push(dir)
  return dir
}

describe('caminhos do PawnIO', () => {
  it('aponta para o instalador embutido e para a DLL instalada', () => {
    expect(resolveBundledInstaller('C:\\App\\resources')).toBe(
      'C:\\App\\resources\\pawnio\\PawnIO_setup.exe'
    )
    expect(resolveInstalledLibrary('C:\\Program Files\\PawnIO')).toBe(
      'C:\\Program Files\\PawnIO\\PawnIOLib.dll'
    )
  })
})

describe('classifyDriverState', () => {
  it('ready quando o device abriu', () => {
    expect(
      classifyDriverState({ filePresent: false, serviceInstalled: false, deviceAccessible: true })
    ).toBe('ready')
  })

  it('present quando há DLL ou instalador registrado, mas o device não abriu', () => {
    expect(
      classifyDriverState({ filePresent: true, serviceInstalled: false, deviceAccessible: false })
    ).toBe('present')
    expect(
      classifyDriverState({ filePresent: false, serviceInstalled: true, deviceAccessible: false })
    ).toBe('present')
  })

  it('absent sem DLL, registro ou device', () => {
    expect(
      classifyDriverState({ filePresent: false, serviceInstalled: false, deviceAccessible: false })
    ).toBe('absent')
  })
})

describe('getDriverStatus', () => {
  it('ready quando o sink do agente elevado está fresco e o device abriu', async () => {
    pawnio.detect.mockResolvedValue({
      registered: true,
      installDir: 'C:\\Program Files\\PawnIO',
      dllPath: 'C:\\Program Files\\PawnIO\\PawnIOLib.dll',
      dllPresent: true
    })
    sensors.readLatest.mockResolvedValue(FRESH_SINK)

    const status = await getDriverStatus()
    expect(status).toEqual({
      state: 'ready',
      filePresent: true,
      serviceInstalled: true,
      deviceAccessible: true,
      outdated: false,
      sourcePath: 'C:\\App\\resources\\pawnio\\PawnIO_setup.exe',
      installedPath: 'C:\\Program Files\\PawnIO\\PawnIOLib.dll'
    })
    // A leitura é sempre do sink, nunca de uma sonda não elevada (erro 5).
    expect(sensors.readLatest).toHaveBeenCalledWith(
      'C:\\ProgramData\\Kolnd Hub\\sensors\\latest.json',
      expect.any(Number)
    )
  })

  it('marca outdated quando o sink está fresco mas sem os registradores novos', async () => {
    pawnio.detect.mockResolvedValue({
      registered: true,
      installDir: 'C:\\Program Files\\PawnIO',
      dllPath: 'C:\\Program Files\\PawnIO\\PawnIOLib.dll',
      dllPresent: true
    })
    sensors.readLatest.mockResolvedValue(OUTDATED_SINK)

    const status = await getDriverStatus()
    // A leitura está viva, então continua `ready`; `outdated` é o sinal de que
    // o script assado no agente não é o desta versão do Hub.
    expect(status.state).toBe('ready')
    expect(status.deviceAccessible).toBe(true)
    expect(status.outdated).toBe(true)
  })

  it('present com motivo quando o PawnIO existe mas o sink está stale', async () => {
    pawnio.detect.mockResolvedValue({
      registered: true,
      installDir: 'C:\\Program Files\\PawnIO',
      dllPath: 'C:\\Program Files\\PawnIO\\PawnIOLib.dll',
      dllPresent: true
    })
    sensors.readLatest.mockResolvedValue(STALE_SINK)

    const status = await getDriverStatus()
    expect(status.state).toBe('present')
    expect(status.filePresent).toBe(true)
    expect(status.serviceInstalled).toBe(true)
    expect(status.deviceAccessible).toBe(false)
    expect(status.error).toContain('leitura elevada não está ativa')
  })

  it('present quando o agente publica, mas não conseguiu abrir o device', async () => {
    pawnio.detect.mockResolvedValue({
      registered: true,
      installDir: 'C:\\Program Files\\PawnIO',
      dllPath: 'C:\\Program Files\\PawnIO\\PawnIOLib.dll',
      dllPresent: true
    })
    sensors.readLatest.mockResolvedValue({ ...FRESH_SINK, deviceOpen: false })

    const status = await getDriverStatus()
    expect(status.state).toBe('present')
    expect(status.deviceAccessible).toBe(false)
    expect(status.error).toBeTruthy()
  })

  it('present sem a DLL e sem tocar no sink (não gasta I/O à toa)', async () => {
    pawnio.detect.mockResolvedValue({
      registered: true,
      installDir: 'C:\\Program Files\\PawnIO',
      dllPath: 'C:\\Program Files\\PawnIO\\PawnIOLib.dll',
      dllPresent: false
    })

    const status = await getDriverStatus()
    expect(status.state).toBe('present')
    expect(status.filePresent).toBe(false)
    expect(status.serviceInstalled).toBe(true)
    expect(status.deviceAccessible).toBe(false)
    expect(sensors.readLatest).not.toHaveBeenCalled()
  })

  it('absent sem instalação e nunca lança quando a detecção falha', async () => {
    pawnio.detect.mockRejectedValue(new Error('reg.exe indisponível'))
    const status = await getDriverStatus()
    expect(status.state).toBe('absent')
    expect(status.deviceAccessible).toBe(false)
    expect(status.installedPath).toContain('PawnIO')
  })
})

describe('installDriver (PawnIO + agente na mesma ação)', () => {
  const INSTALLED_PAWNIO = {
    registered: true,
    installDir: 'C:\\Program Files\\PawnIO',
    dllPath: 'C:\\Program Files\\PawnIO\\PawnIOLib.dll',
    dllPresent: true
  }

  it('é idempotente: sink fresco não pede UAC nem re-instala o agente', async () => {
    pawnio.detect.mockResolvedValue(INSTALLED_PAWNIO)
    sensors.readLatest.mockResolvedValue(FRESH_SINK)

    await expect(installDriver()).resolves.toEqual({ ok: true, state: 'ready' })
    expect(sensors.install).not.toHaveBeenCalled()
  })

  it('re-instala o agente quando o sink está desatualizado (re-estágio + 1 UAC)', async () => {
    pawnio.detect.mockResolvedValue(INSTALLED_PAWNIO)
    // 1ª consulta: sink fresco, mas sem os registradores novos; depois do
    // re-estágio o agente publica o sink completo.
    sensors.readLatest.mockResolvedValueOnce(OUTDATED_SINK).mockResolvedValue(FRESH_SINK)

    await expect(installDriver()).resolves.toEqual({ ok: true, state: 'ready' })
    expect(sensors.install).toHaveBeenCalledTimes(1)
  })

  it('PawnIO presente e sinks stale: instala só o agente e devolve ready', async () => {
    pawnio.detect.mockResolvedValue(INSTALLED_PAWNIO)
    // 1ª consulta (antes): stale; 2ª (depois do agent): fresco.
    sensors.readLatest.mockResolvedValueOnce(STALE_SINK).mockResolvedValue(FRESH_SINK)

    const result = await installDriver()
    expect(sensors.install).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true, state: 'ready' })
  })

  it('propaga o cancelamento do UAC do agente sem mentir "pronto"', async () => {
    pawnio.detect.mockResolvedValue(INSTALLED_PAWNIO)
    sensors.readLatest.mockResolvedValue(STALE_SINK)
    sensors.install.mockResolvedValue({
      ok: false,
      cancelled: true,
      error: 'A permissão de administrador não foi concedida. Nada foi alterado.'
    })

    const result = await installDriver()
    expect(result.ok).toBe(false)
    expect(result.cancelled).toBe(true)
    expect(result.state).toBe('present')
    expect(result.error).toContain('permissão de administrador')
  })
})

describe('verificação do instalador embutido', () => {
  it('aceita o hash correto sem diferenciar maiúsculas/minúsculas', async () => {
    const dir = await tempDir()
    const file = join(dir, 'PawnIO_setup.exe')
    const content = Buffer.from('instalador de teste')
    await fs.writeFile(file, content)
    const expected = createHash('sha256').update(content).digest('hex')
    await expect(verifyDriverHash(file, expected.toUpperCase())).resolves.toBe(true)
    await expect(verifyDriverHash(file, expected.toLowerCase())).resolves.toBe(true)
  })

  it('recusa hash diferente e arquivo inexistente', async () => {
    const dir = await tempDir()
    const file = join(dir, 'PawnIO_setup.exe')
    await fs.writeFile(file, 'outro conteudo')
    await expect(verifyDriverHash(file, PAWNIO_SETUP_SHA256)).resolves.toBe(false)
    await expect(verifyDriverHash(join(dir, 'nao-existe.exe'))).resolves.toBe(false)
  })

  it('exige também o tamanho pinado', async () => {
    const dir = await tempDir()
    const file = join(dir, 'PawnIO_setup.exe')
    const content = Buffer.from('abc')
    await fs.writeFile(file, content)
    const expected = createHash('sha256').update(content).digest('hex')
    await expect(verifyPawnIoInstaller(file, expected, 3)).resolves.toBe(true)
    await expect(verifyPawnIoInstaller(file, expected, 4)).resolves.toBe(false)
    await expect(verifyPawnIoInstaller(join(dir, 'nao-existe.exe'))).resolves.toBe(false)
  })
})

describe('buildInstallScript', () => {
  it('inclui hash pinado, flags silenciosas, verificação de registro e etapas', () => {
    const script = buildInstallScript({
      setupPath: "C:\\Repo O'Brien\\resources\\pawnio\\PawnIO_setup.exe",
      resultPath: "C:\\Temp O'Brien\\pawnio-install.json"
    })
    expect(script).toContain(PAWNIO_SETUP_SHA256)
    // Flags descobertas no binário 2.2.0.0: -install -silent (sem UI).
    expect(script).toContain('& $setup -install -silent')
    expect(script).toContain("C:\\Repo O''Brien")
    expect(script).toContain("C:\\Temp O''Brien")
    expect(script).toContain('Get-FileHash -Algorithm SHA256 -LiteralPath $setup')
    expect(script).toContain('Uninstall\\PawnIO')
    // Cada etapa grava o código real: sem isso a UI só veria "código 1".
    expect(script).toContain("Save-Result 'hash' 1")
    expect(script).toContain("Save-Result 'run' $code")
    expect(script).toContain("Save-Result 'verify' 1")
    expect(script).toContain("Save-Result 'ok' 0")
    // ASCII puro: o script é lido pelo PowerShell 5.1 sem BOM de origem.
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7F]/.test(script)).toBe(false)
  })

  it('usa o tamanho pinado do instalador (mesma fonte do fetch-pawnio.ps1)', () => {
    expect(PAWNIO_SETUP_SIZE).toBe(3_410_960)
  })
})

describe('buildUninstallScript', () => {
  it('chama o desinstalador oficial em modo silencioso', () => {
    const script = buildUninstallScript({
      setupPath: 'C:\\App\\resources\\pawnio\\PawnIO_setup.exe',
      resultPath: 'C:\\Temp\\pawnio-uninstall.json'
    })
    expect(script).toContain('& $setup -uninstall -silent')
    expect(script).toContain("Save-Result 'run' $code")
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7F]/.test(script)).toBe(false)
  })
})

describe('explainInstallFailure', () => {
  it('explica hash divergente', () => {
    expect(explainInstallFailure({ stage: 'hash', code: 1 })).toContain('hash esperado')
  })

  it('reconhece permissão negada e cancelamento pelo instalador', () => {
    expect(explainInstallFailure({ stage: 'run', code: 5 })).toContain('negou permissão')
    expect(explainInstallFailure({ stage: 'run', code: 1223 })).toContain('cancelada')
  })

  it('explica erro genérico com o código real e o detalhe do instalador', () => {
    const message = explainInstallFailure({
      stage: 'run',
      code: 7,
      detail: 'Failed to install driver: 31'
    })
    expect(message).toContain('código 7')
    expect(message).toContain('Failed to install driver')
  })

  it('reconhece instalação mais nova já presente', () => {
    const message = explainInstallFailure({
      stage: 'run',
      code: 1,
      detail: 'A newer installation of PawnIO was found.'
    })
    expect(message).toContain('mais nova')
    expect(message).toContain('Desinstale')
  })

  it('explica registro ausente depois do instalador', () => {
    expect(explainInstallFailure({ stage: 'verify', code: 1 })).toContain(
      'não aparece como instalado'
    )
  })

  it('mantém mensagem honesta quando não há detalhe', () => {
    expect(explainInstallFailure(null)).toContain('Não foi possível instalar o PawnIO')
    expect(explainInstallFailure({ stage: 'unexpected', code: 1 })).toContain(
      'antes de executar o instalador'
    )
  })

  it('não culpa HVCI nem a lista de drivers vulneráveis (PawnIO é assinado)', () => {
    const messages = [
      explainInstallFailure(null),
      explainInstallFailure({ stage: 'hash', code: 1 }),
      explainInstallFailure({ stage: 'run', code: 5 }),
      explainInstallFailure({ stage: 'run', code: 1, detail: 'Failed to install driver: 50' }),
      explainInstallFailure({ stage: 'verify', code: 1 }),
      explainInstallFailure({ stage: 'unexpected', code: 1 })
    ]
    for (const message of messages) {
      expect(message).not.toMatch(/HVCI|Memória Integrity|lista de drivers vulner/i)
    }
  })
})

describe('readInstallFailure', () => {
  it('lê o JSON do script e ignora o BOM', async () => {
    const dir = await tempDir()
    const file = join(dir, 'result.json')
    await fs.writeFile(
      file,
      '\uFEFF' + JSON.stringify({ stage: 'run', code: 5, detail: 'erro' }),
      'utf8'
    )
    await expect(readInstallFailure(file)).resolves.toEqual({
      stage: 'run',
      code: 5,
      detail: 'erro'
    })
  })

  it('devolve null para arquivo ausente ou JSON inválido', async () => {
    const dir = await tempDir()
    await expect(readInstallFailure(join(dir, 'nao-existe.json'))).resolves.toBeNull()
    const file = join(dir, 'quebrado.json')
    await fs.writeFile(file, 'nao e json', 'utf8')
    await expect(readInstallFailure(file)).resolves.toBeNull()
  })
})

describe('isUacCancelled', () => {
  it('reconhece os textos de UAC recusado (usado também pelo FPS)', () => {
    expect(isUacCancelled('The operation was canceled by the user. (0x800704C7)')).toBe(true)
    expect(isUacCancelled('1223')).toBe(true)
    expect(isUacCancelled('cancelado pelo usuário')).toBe(true)
    expect(isUacCancelled('tudo certo')).toBe(false)
  })
})
