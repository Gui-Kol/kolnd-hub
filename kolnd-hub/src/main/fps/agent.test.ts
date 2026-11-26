import { mkdtempSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: vi.fn(() => 'C:\\userData') }
}))
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import {
  buildFpsAgentCreateArgs,
  buildFpsAgentDeleteArgs,
  buildFpsAgentElevationCommand,
  buildFpsAgentInstallScript,
  buildFpsAgentRemoveScript,
  buildFpsAgentScript,
  interpretFpsAgentQuery,
  isFpsManifestCurrent,
  isFpsSinkFresh,
  readFpsManifest,
  resetFpsAgentForTests,
  type FpsAgentManifest
} from './agent'
import { PRESENTMON_FILE, PRESENTMON_SHA256, PRESENTMON_SIZE, PRESENTMON_VERSION } from './engine'
import {
  captureAgentDir,
  captureBinDir,
  captureErrorPath,
  captureLatestPath,
  captureManifestPath,
  captureStagedScriptPath,
  captureStopPath,
  FPS_CAPTURE_TASK_NAME,
  FPS_SINK_STALE_MS,
  isSafeFpsPath,
  resolveCaptureDir,
  resolveFpsSinkDir,
  resolveHeartbeatPath
} from './paths'

const tempRoots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kolnd-fps-agent-'))
  tempRoots.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  vi.clearAllMocks()
  resetFpsAgentForTests()
})

const CAPTURE = 'C:\\ProgramData\\Kolnd Hub\\capture'
const STAGED_SCRIPT = captureStagedScriptPath(CAPTURE)

describe('paths', () => {
  it('usa o diretório novo capture (nunca o fps legado)', () => {
    expect(resolveCaptureDir('C:\\ProgramData')).toBe(CAPTURE)
    expect(resolveCaptureDir('C:\\ProgramData')).not.toMatch(/\\fps$/i)
    expect(captureLatestPath(CAPTURE)).toBe(`${CAPTURE}\\latest.json`)
    expect(captureStopPath(CAPTURE)).toBe(`${CAPTURE}\\stop.flag`)
    expect(captureManifestPath(CAPTURE)).toBe(`${CAPTURE}\\manifest.json`)
    expect(captureErrorPath(CAPTURE)).toBe(`${CAPTURE}\\agent-error.txt`)
    expect(captureBinDir(CAPTURE)).toBe(`${CAPTURE}\\bin`)
    expect(captureAgentDir(CAPTURE)).toBe(`${CAPTURE}\\agent`)
    expect(STAGED_SCRIPT).toBe(`${CAPTURE}\\agent\\fps-agent.ps1`)
  })

  it('heartbeat fica no userData do app (%APPDATA%\\kolnd-hub\\fps)', () => {
    expect(resolveHeartbeatPath('C:\\Users\\x\\AppData\\Roaming\\kolnd-hub')).toBe(
      'C:\\Users\\x\\AppData\\Roaming\\kolnd-hub\\fps\\heartbeat'
    )
  })

  it('override do sink só com KOLDND_HUB_TEST_USERDATA absoluto e válido', () => {
    expect(resolveFpsSinkDir('C:\\ProgramData', 'C:\\tmp\\kolnd-e2e\\userData')).toBe(
      'C:\\tmp\\kolnd-e2e\\userData\\fps-sink'
    )
    // Relativo, vazio ou com controle volta ao ProgramData real.
    expect(resolveFpsSinkDir('C:\\ProgramData', 'userData')).toBe(CAPTURE)
    expect(resolveFpsSinkDir('C:\\ProgramData', '')).toBe(CAPTURE)
    expect(resolveFpsSinkDir('C:\\ProgramData', 'C:\\x\nmalicioso')).toBe(CAPTURE)
    expect(isSafeFpsPath('C:\\x"y')).toBe(false)
  })
})

describe('tarefa agendada', () => {
  it('cria ONLOGON com HIGHEST e /F', () => {
    const args = buildFpsAgentCreateArgs({ scriptPath: STAGED_SCRIPT, captureDir: CAPTURE })
    expect(args.slice(0, 4)).toEqual(['/Create', '/TN', FPS_CAPTURE_TASK_NAME, '/TR'])
    expect(args).toContain('ONLOGON')
    expect(args).toContain('HIGHEST')
    expect(args[args.length - 1]).toBe('/F')
    expect(args[4]).toContain(STAGED_SCRIPT)
    expect(args[4]).toContain('-File')
    // A tarefa executa a cópia protegida, nunca o script-fonte no perfil.
    expect(args[4]).not.toContain('fps-agent-source.ps1')
  })

  it('remove com /Delete /F', () => {
    expect(buildFpsAgentDeleteArgs()).toEqual(['/Delete', '/TN', FPS_CAPTURE_TASK_NAME, '/F'])
  })

  it('interpreta a consulta (existe/não existe/indefinido)', () => {
    expect(
      interpretFpsAgentQuery({
        stdout: `TaskName: \\${FPS_CAPTURE_TASK_NAME}`,
        stderr: '',
        code: 0,
        timedOut: false
      })
    ).toBe(true)
    expect(
      interpretFpsAgentQuery({ stdout: 'outra coisa', stderr: '', code: 0, timedOut: false })
    ).toBeNull()
    expect(
      interpretFpsAgentQuery({
        stdout: '',
        stderr: 'ERROR: The system cannot find the file specified.',
        code: 1,
        timedOut: false
      })
    ).toBe(false)
    expect(
      interpretFpsAgentQuery({ stdout: '', stderr: '', code: null, timedOut: true })
    ).toBeNull()
  })
})

describe('buildFpsAgentScript (supervisor + tap C#)', () => {
  const script = buildFpsAgentScript({
    presentMonPath: `${CAPTURE}\\bin\\${PRESENTMON_FILE}`,
    latestPath: `${CAPTURE}\\latest.json`,
    heartbeatPath: 'C:\\Users\\x\\AppData\\Roaming\\kolnd-hub\\fps\\heartbeat',
    stopPath: `${CAPTURE}\\stop.flag`,
    errorPath: `${CAPTURE}\\agent-error.txt`
  })

  it('inicia o PresentMon com stdout, sessão própria e stop_existing_session', () => {
    expect(script).toContain('--v1_metrics')
    expect(script).toContain('--output_stdout')
    expect(script).toContain('--no_console_stats')
    expect(script).toContain(`--session_name ${'KolndHubFpsCapture'}`)
    expect(script).toContain('--stop_existing_session')
    expect(script).not.toContain('--output_file')
    expect(script).not.toContain('--timed')
  })

  it('para a sessão legada KolndHubFps antes de começar', () => {
    const legacyStop = script.indexOf("logman.exe stop 'KolndHubFps' -ets")
    const addType = script.indexOf('Add-Type')
    expect(legacyStop).toBeGreaterThan(-1)
    expect(legacyStop).toBeLessThan(addType)
    expect(script).toContain("logman.exe stop 'KolndHubFpsCapture' -ets")
  })

  it('usa P/Invoke de primeiro plano e não abre ETW próprio', () => {
    expect(script).toContain('GetForegroundWindow')
    expect(script).toContain('GetWindowThreadProcessId')
    expect(script).toContain('"schema\\":2')
    expect(script).toContain('latest') // escrita atômica via path + .tmp no C#
    expect(script).toContain('+ ".tmp"')
    expect(script).not.toContain('EnableTraceEx2')
    expect(script).not.toContain('StartTrace')
    expect(script).not.toContain('OpenTrace')
    expect(script).not.toContain('ProcessTrace')
  })

  it('respeita heartbeat e stop no C#', () => {
    expect(script).toContain('HeartbeatFresh')
    expect(script).toContain('File.Exists(stop)')
    expect(script).toContain('proc.Kill()')
  })

  it('passa a sessão ETW ao tap e a para no StopProc (sem sessão órfã)', () => {
    const runIndex = script.indexOf('[KolndFpsTap]::Run(')
    expect(runIndex).toBeGreaterThan(-1)
    expect(script.slice(runIndex, runIndex + 600)).toContain("'KolndHubFpsCapture'")
    // Matar o PresentMon não fecha a sessão no kernel: StopProc chama logman.
    expect(script).toContain('private static void StopSession()')
    expect(script).toContain('logman.exe')
    expect(script).toContain('if (killed) StopSession();')
  })

  it('rejeita caminho relativo e argumento com aspas', () => {
    expect(() =>
      buildFpsAgentScript({
        presentMonPath: 'bin\\PresentMon.exe',
        latestPath: `${CAPTURE}\\latest.json`,
        heartbeatPath: 'C:\\hb',
        stopPath: `${CAPTURE}\\stop.flag`,
        errorPath: `${CAPTURE}\\agent-error.txt`
      })
    ).toThrow(/inválido/i)
    expect(() =>
      buildFpsAgentScript({
        presentMonPath: `${CAPTURE}\\bin\\${PRESENTMON_FILE}`,
        args: '--session_name "x"',
        latestPath: `${CAPTURE}\\latest.json`,
        heartbeatPath: 'C:\\hb',
        stopPath: `${CAPTURE}\\stop.flag`,
        errorPath: `${CAPTURE}\\agent-error.txt`
      })
    ).toThrow(/Argumentos/i)
  })
})

describe('buildFpsAgentInstallScript', () => {
  const SCRIPT_HASH = 'A'.repeat(64)
  const install = buildFpsAgentInstallScript({
    captureDir: CAPTURE,
    sourceExe: 'C:\\Program Files\\Kolnd Hub\\resources\\fps\\PresentMon-2.6.0-x64.exe',
    sourceScriptPath: 'C:\\Users\\x\\AppData\\Roaming\\kolnd-hub\\fps\\fps-agent-source.ps1',
    scriptSha256: SCRIPT_HASH,
    generatedAt: '2026-11-26T12:00:00.000Z'
  })

  it('aplica ACL antes de copiar motor e script', () => {
    const firstCopy = install.indexOf('Copy-Item -LiteralPath')
    expect(firstCopy).toBeGreaterThan(0)
    for (const dir of [CAPTURE, `${CAPTURE}\\bin`, `${CAPTURE}\\agent`]) {
      const acl = install.indexOf(`icacls.exe '${dir}'`)
      expect(acl, `ACL de ${dir}`).toBeGreaterThan(-1)
      expect(acl, `ACL de ${dir}`).toBeLessThan(firstCopy)
    }
    // O hash do DESTINO cobre o motor e o script supervisor.
    expect(install).toContain(`$hash -ne '${PRESENTMON_SHA256}'`)
    expect(install).toContain(`$scriptHash -ne '${SCRIPT_HASH}'`)
    expect(install).toContain(`.Length -ne ${PRESENTMON_SIZE}`)
  })

  it('para a sessão legada, limpa sink/stop e cria + inicia a tarefa', () => {
    expect(install).toContain("logman.exe stop 'KolndHubFps' -ets")
    expect(install).toContain('latest.json')
    expect(install).toContain('stop.flag')
    expect(install).toContain('/Create')
    expect(install).toContain('ONLOGON')
    expect(install).toContain('/Run')
  })

  it('o comando de elevação do install cabe no limite do Windows (32k)', () => {
    // O install NÃO embute o C# (só o supervisor, que roda por -File da cópia
    // protegida); o base64 UTF-16LE precisa caber na linha de comando.
    const command = buildFpsAgentElevationCommand(install)
    expect(command.length).toBeLessThan(32_000)
  })

  it('rejeita hash fora do formato e caminho inválido', () => {
    expect(() =>
      buildFpsAgentInstallScript({
        captureDir: CAPTURE,
        sourceExe: 'C:\\a.exe',
        sourceScriptPath: 'C:\\b.ps1',
        scriptSha256: 'abc',
        generatedAt: '2026-11-26T12:00:00.000Z'
      })
    ).toThrow(/Hash/i)
    expect(() =>
      buildFpsAgentInstallScript({
        captureDir: 'capture',
        sourceExe: 'C:\\a.exe',
        sourceScriptPath: 'C:\\b.ps1',
        scriptSha256: SCRIPT_HASH,
        generatedAt: '2026-11-26T12:00:00.000Z'
      })
    ).toThrow(/inválido/i)
  })
})

describe('buildFpsAgentRemoveScript', () => {
  const remove = buildFpsAgentRemoveScript(CAPTURE)

  it('para o agente, remove a tarefa e limpa as sessões', () => {
    expect(remove).toContain('stop.flag')
    expect(remove).toContain('Start-Sleep')
    expect(remove).toContain('/End')
    expect(remove).toContain('/Delete')
    expect(remove).toContain("logman.exe stop 'KolndHubFpsCapture' -ets")
    expect(remove).toContain("logman.exe stop 'KolndHubFps' -ets")
    expect(remove).toContain(CAPTURE)
  })

  it('mata só o PresentMon da nossa sessão (nunca a captura do usuário)', () => {
    expect(remove).toContain(`-like '*KolndHubFpsCapture*'`)
    expect(remove).toContain(`Name='${PRESENTMON_FILE}'`)
    expect(remove).toContain('Stop-Process')
  })

  it('eleva por -EncodedCommand (UTF-16LE), nunca por .ps1 gravável', () => {
    const script = "Write-Output 'olá'\r\n$x = 1"
    const command = buildFpsAgentElevationCommand(script)
    expect(command).toContain('-Verb RunAs')
    expect(command).toContain('-Wait')
    expect(command).toContain('-EncodedCommand')
    // Nada do ARGUMENTO `-File` (o `-FilePath` do Start-Process é outro) nem
    // caminho `.ps1`/AppData no comando elevado.
    expect(command).not.toContain("'-File'")
    expect(command).not.toMatch(/\.ps1/i)
    expect(command).not.toContain('AppData')
    expect(command).not.toContain('fps-agent-install')

    const match = /-EncodedCommand','([A-Za-z0-9+/=]+)'/.exec(command)
    expect(match).not.toBeNull()
    expect(Buffer.from(match![1], 'base64').toString('utf16le')).toBe(script)
  })

  it('recusa script vazio na elevação', () => {
    expect(() => buildFpsAgentElevationCommand('   ')).toThrow(/inválido/i)
  })
})

describe('manifesto e freshness do sink', () => {
  const current: FpsAgentManifest = {
    schema: 1,
    engine: {
      name: 'PresentMon',
      version: PRESENTMON_VERSION,
      sha256: PRESENTMON_SHA256,
      size: PRESENTMON_SIZE
    },
    scriptVersion: 1,
    generatedAt: '2026-11-26T12:00:00.000Z'
  }

  it('aceita só o motor/script atuais', () => {
    expect(isFpsManifestCurrent(current)).toBe(true)
    expect(isFpsManifestCurrent(null)).toBe(false)
    expect(
      isFpsManifestCurrent({ ...current, engine: { ...current.engine, version: '2.5.0' } })
    ).toBe(false)
    expect(isFpsManifestCurrent({ ...current, engine: { ...current.engine, sha256: 'X' } })).toBe(
      false
    )
    expect(isFpsManifestCurrent({ ...current, scriptVersion: 99 })).toBe(false)
  })

  it('lê o manifest e descarta JSON inválido/tamanho absurdo', async () => {
    const dir = tempDir()
    const good = join(dir, 'manifest.json')
    writeFileSync(good, JSON.stringify(current), 'utf8')
    expect(await readFpsManifest(good)).toEqual(current)

    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{', 'utf8')
    expect(await readFpsManifest(bad)).toBeNull()

    const big = join(dir, 'big.json')
    writeFileSync(big, 'x'.repeat(65 * 1024), 'utf8')
    expect(await readFpsManifest(big)).toBeNull()
    expect(await readFpsManifest(join(dir, 'missing.json'))).toBeNull()
  })

  it('considera fresco só um timestamp dentro de 3 s', async () => {
    const dir = tempDir()
    const sink = join(dir, 'latest.json')
    const now = Date.parse('2026-11-26T12:00:00.000Z')
    writeFileSync(sink, JSON.stringify({ timestamp: new Date(now - 1000).toISOString() }), 'utf8')
    expect(await isFpsSinkFresh(sink, now)).toBe(true)

    writeFileSync(
      sink,
      JSON.stringify({ timestamp: new Date(now - FPS_SINK_STALE_MS - 1).toISOString() }),
      'utf8'
    )
    expect(await isFpsSinkFresh(sink, now)).toBe(false)

    writeFileSync(sink, '{"timestamp":"ontem"}', 'utf8')
    expect(await isFpsSinkFresh(sink, now)).toBe(false)
    expect(await isFpsSinkFresh(join(dir, 'missing.json'), now)).toBe(false)
  })

  it('limita o manifest a 64 KB', () => {
    // statSync é usado pelo readFpsManifest; o teto evita entrada gigante.
    const dir = tempDir()
    const big = join(dir, 'manifest.json')
    writeFileSync(big, 'x'.repeat(65 * 1024), 'utf8')
    expect(statSync(big).size).toBeGreaterThan(64 * 1024)
  })
})
