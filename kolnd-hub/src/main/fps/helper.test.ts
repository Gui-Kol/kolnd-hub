import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  buildEnsureProtectedHelperScript,
  buildFpsHelperElevationCommand,
  buildFpsHelperStartScript,
  encodePowerShell,
  parseFpsHelperLine,
  readFpsChunk,
  resolveFpsHelperPaths,
  resolveFpsProtectedPaths,
  resolveFpsRunPaths,
  resolveFpsStagingPaths,
  sha256File,
  takeCompleteLines
} from './helper'

const tempRoots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'kolnd-fps-'))
  tempRoots.push(dir)
  return dir
}

afterAll(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('resolveFpsHelperPaths', () => {
  it('expõe staging/controle em userData e o NDJSON no diretório protegido', () => {
    const userData = 'C:\\Users\\eu\\AppData\\Roaming\\kolnd-hub'
    const paths = resolveFpsHelperPaths(userData, 'C:\\ProgramData')
    expect(paths.dir).toBe(join(userData, 'fps'))
    expect(paths.sourcePath.endsWith('KolndFpsEtw.cs')).toBe(true)
    expect(paths.stagingExePath.endsWith('KolndFpsEtw.exe')).toBe(true)
    expect(paths.runDir).toBe(join(userData, 'fps', 'run'))
    expect(paths.stopPath).toBe(join(userData, 'fps', 'run', 'fps.stop'))
    expect(paths.heartbeatPath).toBe(join(userData, 'fps', 'run', 'fps.heartbeat'))
    expect(paths.outputPath).toBe('C:\\ProgramData\\Kolnd Hub\\fps\\run\\fps.ndjson')
    // O helper elevado nunca escreve o NDJSON em userData.
    expect(paths.outputPath.toLowerCase()).not.toContain('appdata')
    expect(paths).not.toHaveProperty('exePath')
    expect(paths).not.toHaveProperty('launcherPath')
  })
})

describe('resolveFpsStagingPaths', () => {
  it('mantém compilação em <userData>/fps', () => {
    expect(resolveFpsStagingPaths('C:\\userData')).toEqual({
      dir: 'C:\\userData\\fps',
      sourcePath: 'C:\\userData\\fps\\KolndFpsEtw.cs',
      stagingExePath: 'C:\\userData\\fps\\KolndFpsEtw.exe'
    })
  })
})

describe('resolveFpsRunPaths', () => {
  it('deixa só stop/heartbeat em <userData>/fps/run (NDJSON é protegido)', () => {
    expect(resolveFpsRunPaths('C:\\userData')).toEqual({
      runDir: 'C:\\userData\\fps\\run',
      stopPath: 'C:\\userData\\fps\\run\\fps.stop',
      heartbeatPath: 'C:\\userData\\fps\\run\\fps.heartbeat'
    })
  })
})

describe('resolveFpsProtectedPaths', () => {
  it('aponta exe em bin e NDJSON em run sob %ProgramData%\\Kolnd Hub\\fps', () => {
    expect(resolveFpsProtectedPaths('C:\\ProgramData')).toEqual({
      root: 'C:\\ProgramData\\Kolnd Hub\\fps',
      binDir: 'C:\\ProgramData\\Kolnd Hub\\fps\\bin',
      runDir: 'C:\\ProgramData\\Kolnd Hub\\fps\\run',
      exePath: 'C:\\ProgramData\\Kolnd Hub\\fps\\bin\\KolndFpsEtw.exe'
    })
  })
})

describe('sha256File', () => {
  it('calcula o SHA-256 binário do arquivo', async () => {
    const dir = await tempDir()
    const file = join(dir, 'helper.exe')
    await fs.writeFile(file, 'abc', 'utf8')
    await expect(sha256File(file)).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('rejeita arquivo ausente', async () => {
    await expect(sha256File(join(tmpdir(), 'kolnd-nao-existe-helper.exe'))).rejects.toThrow()
  })
})

describe('encodePowerShell', () => {
  it('codifica o script em UTF-16LE/base64 (EncodedCommand)', () => {
    const script = "$ErrorActionPreference = 'Stop'"
    const encoded = encodePowerShell(script)
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe(script)
    // UTF-16LE: cada caractere ASCII vira 1 byte + nulo.
    expect(Buffer.from(encoded, 'base64').length).toBe(script.length * 2)
  })
})

describe('buildEnsureProtectedHelperScript', () => {
  const stagingExePath = 'C:\\Users\\eu\\AppData\\Roaming\\kolnd-hub\\fps\\KolndFpsEtw.exe'
  const protectedPaths = resolveFpsProtectedPaths('C:\\ProgramData')
  const sha = '0123456789abcdef'.repeat(4)

  function build(overrides: Record<string, unknown> = {}): string {
    return buildEnsureProtectedHelperScript({
      stagingExePath,
      expectedSha256: sha,
      protectedPaths,
      ...overrides
    })
  }

  it('cria root/bin/run, copia do staging e confere o hash do DESTINO', () => {
    const script = build()
    expect(script).toContain(
      "New-Item -ItemType Directory -Force -Path 'C:\\ProgramData\\Kolnd Hub\\fps'"
    )
    expect(script).toContain(
      "New-Item -ItemType Directory -Force -Path 'C:\\ProgramData\\Kolnd Hub\\fps\\bin'"
    )
    expect(script).toContain(
      "New-Item -ItemType Directory -Force -Path 'C:\\ProgramData\\Kolnd Hub\\fps\\run'"
    )
    expect(script).toContain(
      `Copy-Item -LiteralPath '${stagingExePath}' -Destination 'C:\\ProgramData\\Kolnd Hub\\fps\\bin\\KolndFpsEtw.exe' -Force`
    )
    expect(script).toContain(
      "Get-FileHash -LiteralPath 'C:\\ProgramData\\Kolnd Hub\\fps\\bin\\KolndFpsEtw.exe' -Algorithm SHA256"
    )
    expect(script).toContain(`if ($hash -ne '${sha}')`)
    expect(script).toContain(
      "Remove-Item -LiteralPath 'C:\\ProgramData\\Kolnd Hub\\fps\\bin\\KolndFpsEtw.exe' -Force"
    )
  })

  it('tranca a ACL por SID (SYSTEM/Admins F, Usuários RX) e checa o exit code', () => {
    const script = build()
    expect(script).toContain("& icacls.exe 'C:\\ProgramData\\Kolnd Hub\\fps' /inheritance:r")
    expect(script).toContain("'*S-1-5-18:(OI)(CI)F'")
    expect(script).toContain("'*S-1-5-32-544:(OI)(CI)F'")
    expect(script).toContain("'*S-1-5-32-545:(OI)(CI)RX'")
    expect(script).toContain('if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }')
  })

  it('cria os três diretórios, tranca a ACL ANTES da cópia e só hasheia depois', () => {
    const script = build()
    // A cópia precisa nascer em diretório sem escrita para o usuário: dirs (com
    // o `run` do NDJSON) e ACL primeiro, senão o binário herdaria escrita.
    const rootAt = script.indexOf("fps' | Out-Null")
    const binAt = script.indexOf("fps\\bin' | Out-Null")
    const runAt = script.indexOf("fps\\run' | Out-Null")
    const icaclsAt = script.indexOf('icacls.exe')
    const copyAt = script.indexOf('Copy-Item')
    const hashAt = script.indexOf('Get-FileHash')
    expect(rootAt).toBeGreaterThan(-1)
    expect(binAt).toBeGreaterThan(-1)
    expect(runAt).toBeGreaterThan(-1)
    expect(icaclsAt).toBeGreaterThan(-1)
    expect(copyAt).toBeGreaterThan(-1)
    expect(hashAt).toBeGreaterThan(-1)
    expect(rootAt).toBeLessThan(binAt)
    expect(binAt).toBeLessThan(runAt)
    expect(runAt).toBeLessThan(icaclsAt)
    expect(icaclsAt).toBeLessThan(copyAt)
    expect(copyAt).toBeLessThan(hashAt)
  })

  it('usa o staging apenas como origem do Copy-Item (nada de userData no destino)', () => {
    const script = build()
    const stagingLines = script
      .split('\r\n')
      .filter((line) => line.toLowerCase().includes('appdata'))
    expect(stagingLines).toHaveLength(1)
    expect(stagingLines[0].startsWith('Copy-Item -LiteralPath')).toBe(true)
    // Destino e ACL nunca apontam para o diretório gravável pelo usuário.
    expect(script).not.toContain("New-Item -ItemType Directory -Force -Path 'C:\\Users\\eu")
  })

  it('escapa aspa simples nos caminhos aspas simples via psQuote', () => {
    const script = build({ stagingExePath: "C:\\Users\\O'Brien\\fps\\KolndFpsEtw.exe" })
    expect(script).toContain("O''Brien")
  })

  it('rejeita hash fora de 64 hex minúsculos', () => {
    expect(() => build({ expectedSha256: 'abc' })).toThrow(/Hash SHA-256/)
    expect(() => build({ expectedSha256: 'A'.repeat(64) })).toThrow(/Hash SHA-256/)
    expect(() => build({ expectedSha256: `${'a'.repeat(63)}g` })).toThrow(/Hash SHA-256/)
  })

  it('rejeita caminho relativo, com aspas duplas ou caractere de controle', () => {
    expect(() => build({ stagingExePath: 'fps\\KolndFpsEtw.exe' })).toThrow(
      /Caminho do helper compilado inválido/
    )
    expect(() => build({ stagingExePath: 'C:\\a"b\\KolndFpsEtw.exe' })).toThrow(
      /Caminho do helper compilado inválido/
    )
    expect(() => build({ stagingExePath: 'C:\\a\nb\\KolndFpsEtw.exe' })).toThrow(
      /Caminho do helper compilado inválido/
    )
    expect(() => build({ protectedPaths: { ...protectedPaths, binDir: 'bin' } })).toThrow(
      /Caminho protegido do helper inválido/
    )
    expect(() =>
      build({ protectedPaths: { ...protectedPaths, root: 'C:\\ProgramData\\a"b' } })
    ).toThrow(/Caminho protegido do helper inválido/)
  })
})

describe('buildFpsHelperStartScript', () => {
  const userData = "C:\\Users\\O'Brien\\kolnd-hub"
  const paths = resolveFpsHelperPaths(userData, 'C:\\ProgramData')
  const protectedPaths = resolveFpsProtectedPaths('C:\\ProgramData')
  const sha = 'ab'.repeat(32)

  it('executa a cópia protegida e escreve o NDJSON sob %ProgramData%', () => {
    const script = buildFpsHelperStartScript({ paths, protectedPaths, expectedSha256: sha })
    expect(script).toContain(
      `Copy-Item -LiteralPath 'C:\\Users\\O''Brien\\kolnd-hub\\fps\\KolndFpsEtw.exe'`
    )
    expect(script).toContain(
      `& 'C:\\ProgramData\\Kolnd Hub\\fps\\bin\\KolndFpsEtw.exe' --out 'C:\\ProgramData\\Kolnd Hub\\fps\\run\\fps.ndjson'`
    )
    // stop/heartbeat são escritos pelo main NÃO elevado: continuam em userData.
    expect(script).toContain("--stop 'C:\\Users\\O''Brien\\kolnd-hub\\fps\\run\\fps.stop'")
    expect(script).toContain(
      "--heartbeat 'C:\\Users\\O''Brien\\kolnd-hub\\fps\\run\\fps.heartbeat'"
    )
    expect(script).toContain('--heartbeat-timeout 20')
    expect(script).toContain('--minutes 240')
    expect(script).toContain("--session 'KolndHubFps'")
    expect(script).toContain('if ($hash -ne')
    expect(script).toContain('/inheritance:r /grant:r')
    expect(script).toContain('exit $LASTEXITCODE')
    // O executável elevado nunca é o do diretório gravável.
    expect(script).not.toContain("& 'C:\\Users\\O''Brien")
    // O `--out` elevado nunca aponta para userData.
    expect(script).not.toContain("--out 'C:\\Users\\O''Brien")
  })

  it('apaga o NDJSON da execução anterior depois da cópia e antes do exe', () => {
    const script = buildFpsHelperStartScript({ paths, protectedPaths, expectedSha256: sha })
    const hashAt = script.indexOf('Get-FileHash')
    const removeAt = script.indexOf(
      "Remove-Item -Force -ErrorAction SilentlyContinue 'C:\\ProgramData\\Kolnd Hub\\fps\\run\\fps.ndjson'"
    )
    const execAt = script.indexOf("& 'C:\\ProgramData\\Kolnd Hub\\fps\\bin\\KolndFpsEtw.exe'")
    expect(hashAt).toBeGreaterThan(-1)
    expect(removeAt).toBeGreaterThan(-1)
    expect(execAt).toBeGreaterThan(-1)
    expect(removeAt).toBeGreaterThan(hashAt)
    expect(removeAt).toBeLessThan(execAt)
    // Nada de apagar em userData pelo script elevado.
    expect(script).not.toContain(
      "Remove-Item -Force -ErrorAction SilentlyContinue 'C:\\Users\\O''Brien"
    )
  })
})

describe('buildFpsHelperElevationCommand', () => {
  it('eleva por EncodedCommand, sem -File/.ps1, e não espera o helper', () => {
    const script = "$ErrorActionPreference = 'Stop'; exit 0"
    const command = buildFpsHelperElevationCommand(script)
    expect(command).toContain('-Verb RunAs | Out-Null')
    expect(command).not.toContain('-Wait')
    expect(command).toContain("'-EncodedCommand'")
    expect(command).not.toContain("'Bypass','-File'")
    expect(command).not.toContain('.ps1')
    expect(command).toContain("$ErrorActionPreference = 'Stop'")
    expect(command).toContain('exit 0')

    const encoded = command.match(/'(-EncodedCommand)','([A-Za-z0-9+/=]+)'/)?.[2] ?? ''
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe(script)
  })
})

describe('parseFpsHelperLine', () => {
  it('aceita ready', () => {
    expect(
      parseFpsHelperLine(
        '{"type":"ready","pid":42,"session":"KolndHubFps","dxgi":true,"dxgk":false}'
      )
    ).toEqual({
      type: 'ready',
      pid: 42,
      session: 'KolndHubFps',
      dxgi: true,
      dxgk: false
    })
  })

  it('aceita sample válido e descarta entradas fora das faixas', () => {
    const line = JSON.stringify({
      type: 'sample',
      ts: '2026-11-17T12:00:00.000Z',
      windowMs: 1000.4,
      foregroundPid: 1234,
      foregroundName: 'game',
      pids: [
        {
          pid: 1234,
          name: 'game',
          presents: 144,
          source: 'dxgi',
          fps: 143.94,
          frametimeMs: 6.95
        },
        { pid: 0, name: 'x', presents: 1, source: 'dxgi', fps: 1, frametimeMs: 1 },
        { pid: 99, name: 'y', presents: -1, source: 'dxgi', fps: 1, frametimeMs: 1 },
        { pid: 98, name: 'z', presents: 1, source: 'outro', fps: 1, frametimeMs: 1 },
        { pid: 97, name: 'w', presents: 1, source: 'dxgk', fps: 1, frametimeMs: 1 }
      ]
    })
    const parsed = parseFpsHelperLine(line)
    expect(parsed?.type).toBe('sample')
    if (parsed?.type !== 'sample') throw new Error('tipo inesperado')
    expect(parsed.windowMs).toBe(1000.4)
    expect(parsed.foregroundPid).toBe(1234)
    expect(parsed.pids).toHaveLength(2)
    expect(parsed.pids[0]).toMatchObject({ pid: 1234, source: 'dxgi', presents: 144 })
    expect(parsed.pids[1]).toMatchObject({ pid: 97, source: 'dxgk' })
  })

  it('aceita stopped e error', () => {
    expect(parseFpsHelperLine('{"type":"stopped","reason":"stop-file"}')).toEqual({
      type: 'stopped',
      reason: 'stop-file'
    })
    expect(
      parseFpsHelperLine(
        '{"type":"error","stage":"start-trace","code":5,"message":"acesso negado"}'
      )
    ).toEqual({
      type: 'error',
      stage: 'start-trace',
      code: 5,
      message: 'acesso negado'
    })
  })

  it('rejeita lixo, JSON inválido e contrato quebrado', () => {
    expect(parseFpsHelperLine('')).toBeNull()
    expect(parseFpsHelperLine('não é json')).toBeNull()
    expect(parseFpsHelperLine('[]')).toBeNull()
    expect(parseFpsHelperLine('{"type":"sample"}')).toBeNull()
    expect(parseFpsHelperLine('{"type":"sample","windowMs":10,"pids":[]}')).toBeNull()
    expect(parseFpsHelperLine('{"type":"desconhecido"}')).toBeNull()
    expect(parseFpsHelperLine('{"type":"error","message":""}')).toBeNull()
  })
})

describe('takeCompleteLines', () => {
  it('devolve só linhas completas e preserva a parcial', () => {
    expect(takeCompleteLines('a\nb\nparcial')).toEqual({ lines: ['a', 'b'], rest: 'parcial' })
    expect(takeCompleteLines('a\r\nb\r\n')).toEqual({ lines: ['a', 'b'], rest: '' })
    expect(takeCompleteLines('sem quebra')).toEqual({ lines: [], rest: 'sem quebra' })
  })
})

describe('readFpsChunk', () => {
  it('lê apenas bytes novos a partir do offset', async () => {
    const dir = await tempDir()
    const file = join(dir, 'out.ndjson')
    await fs.writeFile(file, 'linha1\n', 'utf8')

    const first = await readFpsChunk(file, 0)
    expect(first.text).toBe('linha1\n')
    expect(first.offset).toBe(7)
    expect(first.truncated).toBe(false)

    await fs.appendFile(file, 'linha2\n', 'utf8')
    const second = await readFpsChunk(file, first.offset)
    expect(second.text).toBe('linha2\n')
    expect(second.offset).toBe(14)
  })

  it('reseta o offset quando o arquivo diminui', async () => {
    const dir = await tempDir()
    const file = join(dir, 'out.ndjson')
    await fs.writeFile(file, 'linha\n', 'utf8')
    const chunk = await readFpsChunk(file, 999)
    expect(chunk.text).toBe('linha\n')
    expect(chunk.offset).toBe(6)
  })

  it('descarta o começo quando o backlog passa do teto', async () => {
    const dir = await tempDir()
    const file = join(dir, 'out.ndjson')
    await fs.writeFile(file, 'x'.repeat(300 * 1024) + '\nfinal\n', 'utf8')
    const chunk = await readFpsChunk(file, 0)
    expect(chunk.truncated).toBe(true)
    expect(chunk.text.startsWith('final')).toBe(true)
    expect(chunk.text.length).toBeLessThan(32)
    expect(chunk.offset).toBe((await fs.stat(file)).size)
  })

  it('arquivo ausente devolve vazio sem lançar', async () => {
    await expect(readFpsChunk(join(tmpdir(), 'nao-existe-kolnd.ndjson'), 3)).resolves.toEqual({
      text: '',
      offset: 3,
      truncated: false
    })
  })
})
