import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const { execFileSyncMock, findKloudGamesExeMock, electronMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  findKloudGamesExeMock: vi.fn(),
  electronMock: {
    isPackaged: false,
    exePath: 'C:\\fake\\Kolnd Hub.exe'
  }
}))

vi.mock('child_process', () => ({ execFileSync: execFileSyncMock }))
vi.mock('./kloudGames', () => ({ findKloudGamesExe: findKloudGamesExeMock }))
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electronMock.isPackaged
    },
    getPath: (name: string) => (name === 'exe' ? electronMock.exePath : 'C:\\fake')
  }
}))

import {
  parseUninstallEntries,
  parseScQueryOutput,
  getKloudGamesServiceStatus,
  findKloudGamesUninstallEntry,
  findHubUninstallEntry,
  findHubUninstaller,
  combineKloudGamesDetection,
  classifyKloudGamesPartial,
  detectKloudGames,
  mapMsiexecExitCode
} from './uninstallDetection'
import type {
  KloudGamesPartialKind,
  MsiexecExitCodeKind,
  UninstallEntry
} from './uninstallDetection'

// ===== Fixtures de registro (forma real de Get-ItemProperty | ConvertTo-Json -Compress) =====

const KLOUD_GUID = '{512A3D1B-BE16-401B-A0D1-59BBA3942FB8}'
const KLOUD_MSI_UNINSTALL_STRING = `MsiExec.exe /I${KLOUD_GUID}`

const KLOUD_ENTRY = {
  DisplayName: 'Kloud Games',
  DisplayVersion: '1.4.2',
  Publisher: 'LizardByte',
  InstallLocation: 'C:\\Program Files\\KLOUD_GAMES\\',
  UninstallString: KLOUD_MSI_UNINSTALL_STRING
}

const HUB_ENTRY = {
  DisplayName: 'Kolnd Hub',
  DisplayVersion: '1.4.0',
  Publisher: 'Kolnd',
  InstallLocation: 'C:\\Users\\Teste\\AppData\\Local\\Programs\\Kolnd Hub',
  UninstallString:
    '"C:\\Users\\Teste\\AppData\\Local\\Programs\\Kolnd Hub\\Uninstall Kolnd Hub.exe"'
}

const OTHER_ENTRY = {
  DisplayName: '7-Zip 24.09 (x64)',
  DisplayVersion: '24.09',
  Publisher: 'Igor Pavlov',
  InstallLocation: 'C:\\Program Files\\7-Zip\\',
  UninstallString: '"C:\\Program Files\\7-Zip\\Uninstall.exe"'
}

// ===== Fixtures de `sc query KLOUD_GAMESsvc` =====

const SC_RUNNING = [
  'SERVICE_NAME: KLOUD_GAMESsvc',
  '        TYPE               : 10  WIN32_OWN_PROCESS',
  '        STATE              : 4  RUNNING',
  '                                (STOPPABLE, NOT_PAUSABLE, ACCEPTS_SHUTDOWN)',
  '        WIN32_EXIT_CODE    : 0  (0x0)'
].join('\r\n')

const SC_STOPPED = [
  'SERVICE_NAME: KLOUD_GAMESsvc',
  '        TYPE               : 10  WIN32_OWN_PROCESS',
  '        STATE              : 1  STOPPED',
  '        WIN32_EXIT_CODE    : 0  (0x0)'
].join('\r\n')

function sc1060Error(): Error & { stdout: string } {
  const err = new Error('Command failed: sc query KLOUD_GAMESsvc') as Error & { stdout: string }
  err.stdout =
    '[SC] OpenService FALHOU 1060:\n\nO servico especificado nao existe como um servico instalado.'
  return err
}

type StubService = 'running' | 'stopped' | 'missing'

/** Roteia o mock de execFileSync: powershell (por hive) e `sc query`. */
function stubEnvironment({
  hklm = '',
  wow64 = '',
  hkcu = '',
  service = 'missing'
}: { hklm?: string; wow64?: string; hkcu?: string; service?: StubService } = {}): void {
  execFileSyncMock.mockImplementation(((cmd: string, args?: string[]) => {
    if (cmd === 'sc') {
      if (service === 'running') return SC_RUNNING
      if (service === 'stopped') return SC_STOPPED
      throw sc1060Error()
    }
    const command = String(args?.[2] ?? '')
    if (command.includes('WOW6432Node')) return wow64
    if (command.includes('HKLM')) return hklm
    if (command.includes('HKCU')) return hkcu
    return ''
  }) as never)
}

beforeEach(() => {
  execFileSyncMock.mockReset()
  findKloudGamesExeMock.mockReset()
  electronMock.isPackaged = false
  electronMock.exePath = 'C:\\fake\\Kolnd Hub.exe'
  // Default: nem exe, nem registro, nem serviço (máquina sem o Kloud Games).
  findKloudGamesExeMock.mockReturnValue(null)
  stubEnvironment()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseUninstallEntries', () => {
  it('aceita array com várias entradas e filtra só Kloud Games/Kolnd Hub', () => {
    const json = JSON.stringify([KLOUD_ENTRY, OTHER_ENTRY, HUB_ENTRY])
    const entries = parseUninstallEntries(json)
    expect(entries.map((e) => e.displayName)).toEqual(['Kloud Games', 'Kolnd Hub'])
  })

  it('aceita objeto único (não-array) quando só há uma entrada', () => {
    const entries = parseUninstallEntries(JSON.stringify(KLOUD_ENTRY))
    expect(entries).toHaveLength(1)
    expect(entries[0].displayName).toBe('Kloud Games')
    expect(entries[0].productCode).toBe(KLOUD_GUID)
  })

  it('devolve [] para saída vazia, JSON truncado e lixo (sem lançar)', () => {
    expect(parseUninstallEntries('')).toEqual([])
    expect(parseUninstallEntries('   ')).toEqual([])
    expect(parseUninstallEntries('{"DisplayName":')).toEqual([])
    expect(parseUninstallEntries('isto não é json')).toEqual([])
    expect(parseUninstallEntries('null')).toEqual([])
    expect(parseUninstallEntries('123')).toEqual([])
    expect(parseUninstallEntries('"uma string"')).toEqual([])
  })

  it('remove aspas externas do UninstallString (NSIS) e devolve productCode null', () => {
    const entries = parseUninstallEntries(JSON.stringify(HUB_ENTRY))
    expect(entries).toHaveLength(1)
    expect(entries[0].uninstallString).toBe(
      'C:\\Users\\Teste\\AppData\\Local\\Programs\\Kolnd Hub\\Uninstall Kolnd Hub.exe'
    )
    expect(entries[0].productCode).toBeNull()
    expect(entries[0].scope).toBe('unknown')
  })

  it('extrai o {GUID} de UninstallStrings de msiexec (case-insensitive)', () => {
    const variants = [
      `MsiExec.exe /I${KLOUD_GUID}`,
      `msiexec.exe /x "${KLOUD_GUID}" /qn /norestart`,
      `MSIEXEC /X${KLOUD_GUID}`,
      `MsiExec.exe /I{512a3d1b-be16-401b-a0d1-59bba3942fb8}`
    ]
    for (const uninstallString of variants) {
      const json = JSON.stringify({ ...KLOUD_ENTRY, UninstallString: uninstallString })
      const entries = parseUninstallEntries(json)
      expect(entries).toHaveLength(1)
      expect(entries[0].productCode).toBe(KLOUD_GUID)
    }
  })

  it('ignora {GUID} de uninstallStrings que não são do msiexec', () => {
    const json = JSON.stringify({
      ...KLOUD_ENTRY,
      UninstallString: '"C:\\Program Files\\KLOUD_GAMES\\uninstall.exe" /S'
    })
    expect(parseUninstallEntries(json)[0].productCode).toBeNull()
  })

  it('descarta entradas sem DisplayName, sem match ou sem UninstallString', () => {
    const noName = { UninstallString: KLOUD_MSI_UNINSTALL_STRING }
    const noMatch = { ...OTHER_ENTRY }
    const noUninstall = { DisplayName: 'Kloud Games', DisplayVersion: '1.0.0' }
    expect(parseUninstallEntries(JSON.stringify([noName, noMatch, noUninstall]))).toEqual([])
  })

  it('preserva DisplayVersion, InstallLocation e Publisher', () => {
    const entries = parseUninstallEntries(JSON.stringify(KLOUD_ENTRY))
    expect(entries[0].displayVersion).toBe('1.4.2')
    expect(entries[0].installLocation).toBe('C:\\Program Files\\KLOUD_GAMES\\')
    expect(entries[0].publisher).toBe('LizardByte')
  })

  it('casa "Kloud Games", "KLOUD_GAMES", "Kloud-Games" e "KLOUDGAMES" como Kloud Games', () => {
    for (const name of ['Kloud Games', 'KLOUD_GAMES', 'Kloud-Games', 'KLOUDGAMES']) {
      const json = JSON.stringify({ ...KLOUD_ENTRY, DisplayName: name })
      expect(parseUninstallEntries(json)).toHaveLength(1)
    }
  })

  it('casa "Kolnd Hub" exatamente (com/sem caixa) e não aceita sufixos', () => {
    for (const name of ['Kolnd Hub', 'KOLND HUB', 'kolnd hub']) {
      const json = JSON.stringify({ ...HUB_ENTRY, DisplayName: name })
      expect(parseUninstallEntries(json)).toHaveLength(1)
    }
    for (const name of ['Kolnd Hub 1.4.0', 'Kolnd Hub Launcher']) {
      const json = JSON.stringify({ ...HUB_ENTRY, DisplayName: name })
      expect(parseUninstallEntries(json)).toEqual([])
    }
  })
})

describe('parseScQueryOutput', () => {
  it('reconhece serviço rodando', () => {
    expect(parseScQueryOutput(SC_RUNNING)).toBe('running')
  })

  it('reconhece serviço parado', () => {
    expect(parseScQueryOutput(SC_STOPPED)).toBe('stopped')
  })

  it('reconhece 1060 (serviço inexistente)', () => {
    expect(parseScQueryOutput('[SC] OpenService FAILED 1060:')).toBe('missing')
    expect(parseScQueryOutput('[SC] OpenService FALHOU 1060:\nO serviço ...')).toBe('missing')
  })

  it('saída vazia é tratada como falha total → missing', () => {
    expect(parseScQueryOutput('')).toBe('missing')
    expect(parseScQueryOutput('   \r\n')).toBe('missing')
  })
})

describe('getKloudGamesServiceStatus', () => {
  it('devolve running quando o sc reporta RUNNING', () => {
    stubEnvironment({ service: 'running' })
    expect(getKloudGamesServiceStatus()).toBe('running')
  })

  it('devolve stopped quando o sc reporta STOPPED', () => {
    stubEnvironment({ service: 'stopped' })
    expect(getKloudGamesServiceStatus()).toBe('stopped')
  })

  it('devolve missing quando o sc sai com 1060', () => {
    stubEnvironment({ service: 'missing' })
    expect(getKloudGamesServiceStatus()).toBe('missing')
  })

  it('devolve missing em falha total (sem saída útil)', () => {
    execFileSyncMock.mockImplementation((() => {
      throw new Error('spawn sc ENOENT')
    }) as never)
    expect(getKloudGamesServiceStatus()).toBe('missing')
  })
})

describe('findKloudGamesUninstallEntry', () => {
  it('encontra a entrada do MSI no HKLM e devolve productCode', () => {
    stubEnvironment({ hklm: JSON.stringify([KLOUD_ENTRY]) })
    const entry = findKloudGamesUninstallEntry()
    expect(entry).not.toBeNull()
    expect(entry?.productCode).toBe(KLOUD_GUID)
    expect(entry?.scope).toBe('machine')
    expect(entry?.displayName).toBe('Kloud Games')
  })

  it('encontra no WOW6432Node quando o HKLM principal está vazio', () => {
    stubEnvironment({ wow64: JSON.stringify([KLOUD_ENTRY]) })
    const entry = findKloudGamesUninstallEntry()
    expect(entry?.productCode).toBe(KLOUD_GUID)
    expect(entry?.scope).toBe('machine')
  })

  it('encontra no HKCU com scope user', () => {
    stubEnvironment({ hkcu: JSON.stringify([KLOUD_ENTRY]) })
    const entry = findKloudGamesUninstallEntry()
    expect(entry?.productCode).toBe(KLOUD_GUID)
    expect(entry?.scope).toBe('user')
  })

  it('marca scope both quando o mesmo produto aparece em HKLM e HKCU', () => {
    stubEnvironment({
      hklm: JSON.stringify([KLOUD_ENTRY]),
      hkcu: JSON.stringify([KLOUD_ENTRY])
    })
    expect(findKloudGamesUninstallEntry()?.scope).toBe('both')
  })

  it('prefere a entrada com InstallLocation KLOUD_GAMES', () => {
    const withoutLocation = {
      DisplayName: 'Kloud Games',
      DisplayVersion: '1.4.2',
      UninstallString: 'MsiExec.exe /I{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}'
    }
    const withLocation = {
      DisplayName: 'Kloud Games',
      DisplayVersion: '1.4.2',
      InstallLocation: 'C:\\Program Files\\KLOUD_GAMES\\',
      UninstallString: 'MsiExec.exe /I{BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB}'
    }
    stubEnvironment({ hklm: JSON.stringify([withoutLocation, withLocation]) })
    expect(findKloudGamesUninstallEntry()?.productCode).toBe(
      '{BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB}'
    )
  })

  it('prefere entrada com GUID a entrada sem GUID', () => {
    const withoutGuid = {
      DisplayName: 'Kloud Games',
      UninstallString: '"C:\\Program Files\\KLOUD_GAMES\\uninstall.exe"'
    }
    const withGuid = {
      DisplayName: 'Kloud Games',
      UninstallString: 'MsiExec.exe /I{CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC}'
    }
    stubEnvironment({ hklm: JSON.stringify([withoutGuid, withGuid]) })
    expect(findKloudGamesUninstallEntry()?.productCode).toBe(
      '{CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC}'
    )
  })

  it('sem nenhuma pista, devolve a primeira entrada', () => {
    const first = {
      DisplayName: 'Kloud Games',
      DisplayVersion: '1.0.0',
      UninstallString: 'C:\\primeiro.exe /S'
    }
    const second = {
      DisplayName: 'Kloud Games',
      DisplayVersion: '2.0.0',
      UninstallString: 'C:\\segundo.exe /S'
    }
    stubEnvironment({ hklm: JSON.stringify([first, second]) })
    expect(findKloudGamesUninstallEntry()?.uninstallString).toBe('C:\\primeiro.exe /S')
  })

  it('devolve null (sem lançar) quando o PowerShell falha em todas as hives', () => {
    execFileSyncMock.mockImplementation((() => {
      throw new Error('powershell não encontrado')
    }) as never)
    expect(findKloudGamesUninstallEntry()).toBeNull()
  })

  it('devolve null quando o JSON está inválido em todas as hives', () => {
    stubEnvironment({ hklm: '{{{', wow64: '!!!', hkcu: '[' })
    expect(findKloudGamesUninstallEntry()).toBeNull()
  })

  it('não devolve entradas de outros programas (ex.: Kolnd Hub)', () => {
    stubEnvironment({ hklm: JSON.stringify([HUB_ENTRY]), hkcu: JSON.stringify([OTHER_ENTRY]) })
    expect(findKloudGamesUninstallEntry()).toBeNull()
  })
})

describe('findHubUninstallEntry', () => {
  it('prioriza o HKCU (NSIS per-user) sobre o HKLM', () => {
    const hklmHub = { ...HUB_ENTRY, DisplayVersion: '1.3.0' }
    const hkcuHub = { ...HUB_ENTRY, DisplayVersion: '1.4.0' }
    stubEnvironment({ hklm: JSON.stringify([hklmHub]), hkcu: JSON.stringify([hkcuHub]) })
    expect(findHubUninstallEntry()?.displayVersion).toBe('1.4.0')
  })

  it('remove as aspas externas do UninstallString do NSIS', () => {
    stubEnvironment({ hkcu: JSON.stringify([HUB_ENTRY]) })
    const entry = findHubUninstallEntry()
    expect(entry?.uninstallString).toBe(
      'C:\\Users\\Teste\\AppData\\Local\\Programs\\Kolnd Hub\\Uninstall Kolnd Hub.exe'
    )
    expect(entry?.productCode).toBeNull()
  })

  it('marca scope both quando aparece em HKCU e HKLM com a mesma versão', () => {
    stubEnvironment({
      hklm: JSON.stringify([HUB_ENTRY]),
      hkcu: JSON.stringify([HUB_ENTRY])
    })
    expect(findHubUninstallEntry()?.scope).toBe('both')
  })

  it('devolve null quando não há entrada do Hub', () => {
    stubEnvironment({ hklm: JSON.stringify([KLOUD_ENTRY]) })
    expect(findHubUninstallEntry()).toBeNull()
  })
})

describe('findHubUninstaller', () => {
  let root: string | null = null

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = null
    electronMock.isPackaged = false
    electronMock.exePath = 'C:\\fake\\Kolnd Hub.exe'
  })

  const setupInstallDir = (): string => {
    root = mkdtempSync(join(tmpdir(), 'kolnd-hub-uninstall-test-'))
    electronMock.isPackaged = true
    electronMock.exePath = join(root, 'Kolnd Hub.exe')
    return root
  }

  it('em dev (app.isPackaged = false) devolve available: false', () => {
    electronMock.isPackaged = false
    expect(findHubUninstaller()).toEqual({
      available: false,
      uninstallerPath: null,
      source: null,
      entry: null
    })
  })

  it('packaged: caminho padrão ao lado do Kolnd Hub.exe existe → source default-path', () => {
    const dir = setupInstallDir()
    const uninstaller = join(dir, 'Uninstall Kolnd Hub.exe')
    writeFileSync(uninstaller, 'fake-nsis-uninstaller')
    const detection = findHubUninstaller()
    expect(detection.available).toBe(true)
    expect(detection.source).toBe('default-path')
    expect(detection.uninstallerPath).toBe(uninstaller)
    expect(detection.entry).toBeNull()
  })

  it('packaged: sem caminho padrão, cai para o registro se o UninstallString aponta para exe existente', () => {
    const dir = setupInstallDir()
    mkdirSync(join(dir, 'registered'))
    const registeredUninstaller = join(dir, 'registered', 'KolndHubUninstall.exe')
    writeFileSync(registeredUninstaller, 'fake-nsis-uninstaller')
    stubEnvironment({
      hkcu: JSON.stringify([
        { ...HUB_ENTRY, UninstallString: `"${registeredUninstaller}"`, InstallLocation: undefined }
      ])
    })
    const detection = findHubUninstaller()
    expect(detection.available).toBe(true)
    expect(detection.source).toBe('registry')
    expect(detection.uninstallerPath).toBe(registeredUninstaller)
    expect(detection.entry?.displayName).toBe('Kolnd Hub')
  })

  it('packaged: sem caminho padrão e sem registro válido → available: false', () => {
    setupInstallDir()
    stubEnvironment({
      hkcu: JSON.stringify([
        { ...HUB_ENTRY, UninstallString: '"C:\\nao\\existe\\Uninstall Kolnd Hub.exe"' }
      ])
    })
    const detection = findHubUninstaller()
    expect(detection.available).toBe(false)
    expect(detection.source).toBeNull()
    expect(detection.uninstallerPath).toBeNull()
  })
})

describe('detectKloudGames', () => {
  it('installed quando exe e registro estão presentes (serviço rodando)', () => {
    findKloudGamesExeMock.mockReturnValue('C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe')
    stubEnvironment({ hklm: JSON.stringify([KLOUD_ENTRY]), service: 'running' })
    const detection = detectKloudGames()
    expect(detection.status).toBe('installed')
    expect(detection.exePath).toBe('C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe')
    expect(detection.service).toBe('running')
    expect(detection.entry?.productCode).toBe(KLOUD_GUID)
  })

  it('partial quando só o exe existe (registro vazio, sem serviço) → exe órfão', () => {
    findKloudGamesExeMock.mockReturnValue('C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe')
    stubEnvironment()
    expect(detectKloudGames().status).toBe('partial')
  })

  it('partial quando só o registro existe (sem exe) → registro órfão', () => {
    stubEnvironment({ hklm: JSON.stringify([KLOUD_ENTRY]) })
    const detection = detectKloudGames()
    expect(detection.status).toBe('partial')
    expect(detection.exePath).toBeNull()
    expect(detection.entry?.productCode).toBe(KLOUD_GUID)
  })

  it('partial quando só o serviço existe → serviço órfão', () => {
    stubEnvironment({ service: 'stopped' })
    const detection = detectKloudGames()
    expect(detection.status).toBe('partial')
    expect(detection.service).toBe('stopped')
  })

  it('missing quando não há exe, registro nem serviço', () => {
    stubEnvironment()
    expect(detectKloudGames()).toEqual({
      status: 'missing',
      exePath: null,
      service: 'missing',
      entry: null
    })
  })

  it('installed mesmo com o serviço ausente (registro + exe; laudo fica na T3)', () => {
    findKloudGamesExeMock.mockReturnValue('C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe')
    stubEnvironment({ hklm: JSON.stringify([KLOUD_ENTRY]), service: 'missing' })
    const detection = detectKloudGames()
    expect(detection.status).toBe('installed')
    expect(detection.service).toBe('missing')
  })

  it('não lança quando findKloudGamesExe explode', () => {
    findKloudGamesExeMock.mockImplementation(() => {
      throw new Error('boom')
    })
    stubEnvironment()
    expect(detectKloudGames().status).toBe('missing')
  })
})

describe('combineKloudGamesDetection', () => {
  const entry = {
    productCode: KLOUD_GUID,
    uninstallString: KLOUD_MSI_UNINSTALL_STRING,
    displayName: 'Kloud Games',
    scope: 'machine' as const
  }
  const exe = 'C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe'

  it.each([
    [exe, entry, 'running', 'installed'],
    [exe, entry, 'stopped', 'installed'],
    [exe, null, 'missing', 'partial'],
    [null, entry, 'missing', 'partial'],
    [null, null, 'running', 'partial'],
    [null, null, 'stopped', 'partial'],
    [null, null, 'missing', 'missing']
  ] as Array<[string | null, UninstallEntry | null, 'running' | 'stopped' | 'missing', string]>)(
    'exe=%s entry=%s service=%s → %s',
    (exePath, regEntry, service, expected) => {
      expect(combineKloudGamesDetection(exePath, regEntry, service).status).toBe(expected)
    }
  )
})

describe('mapMsiexecExitCode', () => {
  const CASES: Array<[number | null, MsiexecExitCodeKind]> = [
    [0, 'success'],
    [3010, 'needs-reboot'],
    [1641, 'needs-reboot'],
    [1602, 'cancelled'],
    [1605, 'already-absent'],
    [1612, 'already-absent'],
    [1618, 'other-install'],
    [1500, 'other-install'],
    [1625, 'policy-blocked'],
    [1603, 'fatal'],
    [1604, 'fatal'],
    [1609, 'fatal'],
    [1619, 'fatal'],
    [1638, 'newer-version'],
    [1223, 'uac-denied'],
    [9999, 'unknown'],
    [-1, 'unknown'],
    [null, 'unknown']
  ]

  it.each(CASES)('código %s → kind %s', (code, kind) => {
    expect(mapMsiexecExitCode(code).kind).toBe(kind)
  })

  it('toda mensagem é não-vazia e em pt-BR', () => {
    for (const [code] of CASES) {
      const { message } = mapMsiexecExitCode(code)
      expect(message.length).toBeGreaterThan(0)
    }
  })

  it('1605 avisa que o Kloud Games já não constava como instalado', () => {
    expect(mapMsiexecExitCode(1605).message).toContain('já não constava como instalado')
  })

  it('1223 (UAC negado) avisa que nada foi removido', () => {
    expect(mapMsiexecExitCode(1223).message).toContain('UAC')
    expect(mapMsiexecExitCode(1223).message).toContain('Nada foi removido')
  })

  it('3010/1641 são sucesso com reinício necessário (não erro fatal)', () => {
    expect(mapMsiexecExitCode(3010).kind).toBe('needs-reboot')
    expect(mapMsiexecExitCode(1641).kind).toBe('needs-reboot')
    expect(mapMsiexecExitCode(3010).message).toBe('Reinicie o PC para concluir a remoção.')
  })

  it('código desconhecido/null menciona os logs', () => {
    expect(mapMsiexecExitCode(7777).message).toContain('logs')
    expect(mapMsiexecExitCode(null).message).toContain('logs')
  })

  it('mensagens pt-BR exatas exigidas pela matriz da T6', () => {
    const EXACT: Array<[number | null, string]> = [
      [1223, 'Você recusou a permissão (UAC). Nada foi removido.'],
      [1618, 'Outra instalação do Windows está em andamento. Aguarde e tente de novo (ou reinicie o PC).'],
      [1500, 'Outra instalação do Windows está em andamento. Aguarde e tente de novo (ou reinicie o PC).'],
      [1603, 'O Windows não conseguiu desinstalar (código 1603). Reinicie o PC e tente de novo; se persistir, use Configurações → Aplicativos.'],
      [1625, 'Esta máquina bloqueia desinstalações por política de grupo. Fale com o administrador.'],
      [3010, 'Reinicie o PC para concluir a remoção.'],
      [1641, 'Reinicie o PC para concluir a remoção.'],
      [1605, 'O Kloud Games já não constava como instalado — nada foi removido.'],
      [1612, 'O Kloud Games já não constava como instalado — nada foi removido.'],
      [1638, 'Já existe uma versão mais nova do Kloud Games instalada; nada foi removido.'],
      [1602, 'Cancelado por você.']
    ]
    for (const [code, message] of EXACT) {
      expect(mapMsiexecExitCode(code).message).toBe(message)
    }
  })
})

describe('classifyKloudGamesPartial — fixtures de órfãos (exe/registro/serviço)', () => {
  const entry = {
    productCode: KLOUD_GUID,
    uninstallString: KLOUD_MSI_UNINSTALL_STRING,
    displayName: 'Kloud Games',
    scope: 'machine' as const
  }
  const exe = 'C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe'

  it.each([
    ['installed', exe, entry, 'stopped', null],
    ['missing', null, null, 'missing', null],
    ['exe órfão: exe sem registro e sem serviço', exe, null, 'missing', 'exe-orphan'],
    ['exe órfão: exe sem registro com serviço', exe, null, 'stopped', 'exe-orphan'],
    ['registro órfão: registro sem exe', null, entry, 'missing', 'registry-orphan'],
    ['registro órfão: registro sem exe com serviço', null, entry, 'running', 'registry-orphan'],
    ['serviço órfão: só o serviço rodando', null, null, 'running', 'service-orphan'],
    ['serviço órfão: só o serviço parado', null, null, 'stopped', 'service-orphan']
  ] as Array<
    [
      string,
      string | null,
      UninstallEntry | null,
      'running' | 'stopped' | 'missing',
      KloudGamesPartialKind | null
    ]
  >)(
    '%s',
    (_name, exePath, regEntry, service, expected) => {
      const status: 'installed' | 'partial' | 'missing' =
        !exePath && !regEntry && service === 'missing'
          ? 'missing'
          : exePath && regEntry
            ? 'installed'
            : 'partial'
      expect(
        classifyKloudGamesPartial({ status, exePath, entry: regEntry, service })
      ).toBe(expected)
    }
  )

  it('detectKloudGames com exe-órfão mocado → partial com classification exe-orphan', () => {
    findKloudGamesExeMock.mockReturnValue(exe)
    stubEnvironment({ service: 'missing' })
    const detection = detectKloudGames()
    expect(detection.status).toBe('partial')
    expect(classifyKloudGamesPartial(detection)).toBe('exe-orphan')
  })

  it('detectKloudGames com registro-órfão mocado → partial com classification registry-orphan', () => {
    stubEnvironment({ hklm: JSON.stringify([KLOUD_ENTRY]) })
    const detection = detectKloudGames()
    expect(detection.status).toBe('partial')
    expect(classifyKloudGamesPartial(detection)).toBe('registry-orphan')
  })

  it('detectKloudGames com serviço-órfão mocado → partial com classification service-orphan', () => {
    stubEnvironment({ service: 'stopped' })
    const detection = detectKloudGames()
    expect(detection.status).toBe('partial')
    expect(classifyKloudGamesPartial(detection)).toBe('service-orphan')
  })
})
