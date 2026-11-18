import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { ProcessResult } from '../hwmon/powershell'

// O agent importa `electron` (IPC/paths) e o helper (compilação do C#), mas os
// testes exercitam só funções puras — nada de UAC/rede/processo real.
vi.mock('electron', () => ({
  app: { once: vi.fn(), getPath: vi.fn(() => 'C:\\userData') },
  ipcMain: { handle: vi.fn() }
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
  buildFpsAgentTaskAction,
  FPS_AUTO_STALE_MS,
  interpretFpsAgentQuery,
  parseFpsAutoLatest,
  readFpsAutoLatestFile,
  resolveFpsSinkDir
} from './agent'

const tempRoots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'kolnd-fps-agent-'))
  tempRoots.push(dir)
  return dir
}

afterAll(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

function processResult(partial: Partial<ProcessResult>): ProcessResult {
  return { stdout: '', stderr: '', code: 0, timedOut: false, ...partial }
}

const SHA = '0123456789abcdef'.repeat(4)

const OPTIONS = {
  exePath: 'C:\\ProgramData\\Kolnd Hub\\fps\\bin\\KolndFpsEtw.exe',
  sinkDir: 'C:\\ProgramData\\Kolnd Hub\\fps'
}

const INSTALL_OPTIONS = {
  stagingExePath: 'C:\\Users\\eu\\AppData\\Roaming\\kolnd-hub\\fps\\KolndFpsEtw.exe',
  sha256: SHA,
  protectedPaths: {
    root: 'C:\\ProgramData\\Kolnd Hub\\fps',
    binDir: 'C:\\ProgramData\\Kolnd Hub\\fps\\bin',
    exePath: OPTIONS.exePath
  },
  sinkDir: OPTIONS.sinkDir
}

describe('resolveFpsSinkDir', () => {
  it('usa %ProgramData%\\Kolnd Hub\\fps por padrão', () => {
    expect(resolveFpsSinkDir('C:\\ProgramData')).toBe('C:\\ProgramData\\Kolnd Hub\\fps')
  })

  it('aceita KOLDND_HUB_FPS_DIR absoluto (E2E)', () => {
    expect(resolveFpsSinkDir('C:\\ProgramData', 'C:\\temp\\fps-e2e')).toBe('C:\\temp\\fps-e2e')
  })

  it('ignora override inválido em vez de derrubar o app', () => {
    expect(resolveFpsSinkDir('C:\\ProgramData', 'relativo\\fps')).toBe(
      'C:\\ProgramData\\Kolnd Hub\\fps'
    )
    expect(resolveFpsSinkDir('C:\\ProgramData', 'C:\\temp\\"quoted"')).toBe(
      'C:\\ProgramData\\Kolnd Hub\\fps'
    )
    expect(resolveFpsSinkDir('C:\\ProgramData', null)).toBe('C:\\ProgramData\\Kolnd Hub\\fps')
  })
})

describe('comandos do schtasks', () => {
  it('monta a ação do agent em modo --sink com sessão fixa', () => {
    expect(buildFpsAgentTaskAction(OPTIONS)).toBe(
      '"C:\\ProgramData\\Kolnd Hub\\fps\\bin\\KolndFpsEtw.exe" --sink "C:\\ProgramData\\Kolnd Hub\\fps" --minutes 0 --session KolndHubFps'
    )
  })

  it('a tarefa aponta para ProgramData, nunca para o diretório do usuário', () => {
    const action = buildFpsAgentTaskAction(OPTIONS)
    expect(action).toContain('C:\\ProgramData\\Kolnd Hub\\fps\\bin\\')
    expect(action.toLowerCase()).not.toContain('appdata')
    expect(action).not.toContain('Users')
  })

  it('cria a tarefa no logon com privilégio máximo', () => {
    const args = buildFpsAgentCreateArgs(OPTIONS)
    expect(args).toEqual([
      '/Create',
      '/TN',
      'KolndHubFpsAgent',
      '/TR',
      buildFpsAgentTaskAction(OPTIONS),
      '/SC',
      'ONLOGON',
      '/RL',
      'HIGHEST',
      '/F'
    ])
  })

  it('remove a tarefa pelo nome fixo', () => {
    expect(buildFpsAgentDeleteArgs()).toEqual(['/Delete', '/TN', 'KolndHubFpsAgent', '/F'])
  })

  it('recusa caminhos com aspas/quebra de linha na ação (injeção de argumentos)', () => {
    expect(() =>
      buildFpsAgentTaskAction({ exePath: 'C:\\a"b.exe', sinkDir: OPTIONS.sinkDir })
    ).toThrow(/Caminho inválido/)
    expect(() =>
      buildFpsAgentTaskAction({ exePath: OPTIONS.exePath, sinkDir: 'C:\\a\nb' })
    ).toThrow(/Caminho inválido/)
    expect(() => buildFpsAgentTaskAction({ ...OPTIONS, exePath: 'relativo.exe' })).toThrow(
      /Caminho inválido/
    )
  })
})

describe('scripts elevados', () => {
  it('instala: encerra a antiga, copia com hash/ACL e agenda schtasks no exe protegido', () => {
    const script = buildFpsAgentInstallScript(INSTALL_OPTIONS)
    expect(script).toContain("& schtasks.exe /End /TN 'KolndHubFpsAgent'")
    // Cópia + integridade + ACL (script-base de T1).
    expect(script).toContain(
      `Copy-Item -LiteralPath '${INSTALL_OPTIONS.stagingExePath}' -Destination '${OPTIONS.exePath}'`
    )
    expect(script).toContain(`if ($hash -ne '${SHA}')`)
    expect(script).toContain('/inheritance:r /grant:r')
    expect(script).toContain("'*S-1-5-32-545:(OI)(CI)RX'")
    // Sink e tarefa.
    expect(script).toContain(
      "New-Item -ItemType Directory -Force -Path 'C:\\ProgramData\\Kolnd Hub\\fps'"
    )
    expect(script).toContain(
      "& icacls.exe 'C:\\ProgramData\\Kolnd Hub\\fps' /grant '*S-1-5-32-545:(OI)(CI)RX'"
    )
    expect(script).toContain("& schtasks.exe '/Create'")
    expect(script).toContain("'/SC' 'ONLOGON'")
    expect(script).toContain("'/RL' 'HIGHEST'")
    expect(script).toContain(`'"${OPTIONS.exePath}" --sink`)
    // O caminho gravável aparece só como origem do Copy-Item.
    const stagingLines = script.split('\r\n').filter((line) => line.includes('AppData'))
    expect(stagingLines).toHaveLength(1)
    expect(stagingLines[0].startsWith('Copy-Item -LiteralPath')).toBe(true)
    expect(script).toContain('if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }')
  })

  it('recusa staging inválido ou hash fora do contrato no install', () => {
    expect(() =>
      buildFpsAgentInstallScript({ ...INSTALL_OPTIONS, stagingExePath: 'relativo.exe' })
    ).toThrow(/Caminho do helper compilado inválido/)
    expect(() => buildFpsAgentInstallScript({ ...INSTALL_OPTIONS, sha256: 'abc' })).toThrow(
      /Hash SHA-256/
    )
    expect(() => buildFpsAgentInstallScript({ ...INSTALL_OPTIONS, sinkDir: 'relativo' })).toThrow(
      /Diretório do agent inválido/
    )
  })

  it('remove: encerra a instância, apaga a tarefa e a amostra', () => {
    const script = buildFpsAgentRemoveScript(OPTIONS.sinkDir)
    expect(script).toContain("& schtasks.exe /End /TN 'KolndHubFpsAgent'")
    expect(script).toContain("& schtasks.exe '/Delete' '/TN' 'KolndHubFpsAgent' '/F'")
    expect(script).toContain(
      "Remove-Item -Force -ErrorAction SilentlyContinue 'C:\\ProgramData\\Kolnd Hub\\fps\\latest.json'"
    )
  })

  it('eleva por EncodedCommand (sem -File/.ps1) e propaga o código', () => {
    const script = "$ErrorActionPreference = 'Stop'; exit 0"
    const command = buildFpsAgentElevationCommand(script)
    expect(command).toContain('-Verb RunAs -Wait -PassThru')
    expect(command).toContain("'-EncodedCommand'")
    expect(command).not.toContain("'Bypass','-File'")
    expect(command).not.toContain('.ps1')
    expect(command).toContain('exit $p.ExitCode')

    const encoded = command.match(/'(-EncodedCommand)','([A-Za-z0-9+/=]+)'/)?.[2] ?? ''
    expect(encoded.length).toBeGreaterThan(0)
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe(script)
  })
})

describe('interpretFpsAgentQuery', () => {
  it('reconhece a tarefa existente e a ausente', () => {
    expect(
      interpretFpsAgentQuery(
        processResult({ stdout: 'Folder: \\\r\nHostName: PC\r\nTaskName: \\KolndHubFpsAgent' })
      )
    ).toBe(true)
    expect(
      interpretFpsAgentQuery(
        processResult({
          code: 1,
          stderr: 'ERRO: O sistema não pode encontrar o arquivo especificado.'
        })
      )
    ).toBe(false)
  })

  it('não inventa estado com timeout ou erro desconhecido', () => {
    expect(interpretFpsAgentQuery(processResult({ timedOut: true, code: null }))).toBeNull()
    expect(interpretFpsAgentQuery(processResult({ code: 5, stderr: 'Acesso negado.' }))).toBeNull()
  })
})

describe('parseFpsAutoLatest', () => {
  const now = Date.parse('2026-11-17T12:00:00.000Z')
  const valid = {
    pid: 4242,
    name: 'game.exe',
    fps: 60,
    frametimeMs: 16.7,
    timestamp: '2026-11-17T11:59:59.000Z'
  }

  it('aceita amostra fresca e devolve o alvo', () => {
    expect(parseFpsAutoLatest(valid, now)).toEqual({
      fresh: true,
      sample: {
        pid: 4242,
        name: 'game.exe',
        fps: 60,
        frametimeMs: 16.7,
        timestamp: '2026-11-17T11:59:59.000Z'
      },
      capturedAtMs: now - 1000
    })
  })

  it('marca stale acima de 3 s e rejeita timestamp inválido', () => {
    const old = { ...valid, timestamp: '2026-11-17T11:59:56.000Z' }
    expect(parseFpsAutoLatest(old, now)).toEqual({ fresh: false, sample: null, capturedAtMs: null })
    expect(parseFpsAutoLatest({ ...valid, timestamp: 'agora' }, now)).toEqual({
      fresh: false,
      sample: null,
      capturedAtMs: null
    })
    // Limite exato ainda é fresco.
    expect(
      parseFpsAutoLatest(
        { ...valid, timestamp: new Date(now - FPS_AUTO_STALE_MS).toISOString() },
        now
      ).fresh
    ).toBe(true)
  })

  it('arquivo fresco sem alvo continua fresco (desktop) mas sem número', () => {
    expect(
      parseFpsAutoLatest({ ...valid, pid: null, name: null, fps: null, frametimeMs: null }, now)
    ).toEqual({ fresh: true, sample: null, capturedAtMs: now - 1000 })
  })

  it('ignora processos-casca (Explorer/DWM/Hub) e campos fora do contrato', () => {
    expect(parseFpsAutoLatest({ ...valid, name: 'explorer.exe' }, now)).toEqual({
      fresh: true,
      sample: null,
      capturedAtMs: now - 1000
    })
    expect(parseFpsAutoLatest({ ...valid, fps: Number.NaN }, now).sample).toBeNull()
    expect(parseFpsAutoLatest({ ...valid, frametimeMs: -1 }, now).sample).toBeNull()
    expect(parseFpsAutoLatest({ ...valid, pid: 0 }, now).sample).toBeNull()
    expect(parseFpsAutoLatest(null, now)).toEqual({
      fresh: false,
      sample: null,
      capturedAtMs: null
    })
  })
})

describe('readFpsAutoLatestFile', () => {
  it('lê e valida o JSON do disco; ausente = stale', async () => {
    const dir = await tempDir()
    const path = join(dir, 'latest.json')
    const now = Date.parse('2026-11-17T12:00:00.000Z')
    await fs.writeFile(
      path,
      JSON.stringify({
        pid: 99,
        name: 'game.exe',
        fps: 144.2,
        frametimeMs: 6.93,
        timestamp: '2026-11-17T11:59:59.500Z'
      }),
      'utf8'
    )
    expect((await readFpsAutoLatestFile(path, now)).sample?.fps).toBe(144.2)
    expect((await readFpsAutoLatestFile(join(dir, 'nada.json'), now)).fresh).toBe(false)

    await fs.writeFile(path, '{quebrado', 'utf8')
    expect((await readFpsAutoLatestFile(path, now)).fresh).toBe(false)
  })
})
