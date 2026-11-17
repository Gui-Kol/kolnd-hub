import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  buildFpsElevationCommand,
  buildFpsLauncherScript,
  parseFpsHelperLine,
  readFpsChunk,
  resolveFpsHelperPaths,
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
  it('coloca todos os artefatos em <userData>/fps', () => {
    const paths = resolveFpsHelperPaths('C:\\Users\\eu\\AppData\\Roaming\\kolnd-hub')
    expect(paths.dir).toContain('fps')
    expect(paths.exePath.endsWith('KolndFpsEtw.exe')).toBe(true)
    expect(paths.sourcePath.endsWith('KolndFpsEtw.cs')).toBe(true)
    expect(paths.outputPath.endsWith('fps.ndjson')).toBe(true)
    expect(paths.stopPath.endsWith('fps.stop')).toBe(true)
    expect(paths.heartbeatPath.endsWith('fps.heartbeat')).toBe(true)
  })
})

describe('buildFpsLauncherScript', () => {
  it('passa caminhos, heartbeat, limite e sessão fixa para o helper', () => {
    const paths = resolveFpsHelperPaths("C:\\Users\\O'Brien\\kolnd-hub")
    const script = buildFpsLauncherScript(paths)
    expect(script).toContain("O''Brien")
    expect(script).toContain('--heartbeat-timeout 20')
    expect(script).toContain('--minutes 240')
    expect(script).toContain("--session 'KolndHubFps'")
    expect(script).toContain('exit $LASTEXITCODE')
  })
})

describe('buildFpsElevationCommand', () => {
  it('separa Start-Process e exit para o exit não virar argumento do cmdlet', () => {
    const command = buildFpsElevationCommand('C:\\a\\fps helper.ps1')
    expect(command).toContain('-Verb RunAs | Out-Null; exit 0')
    expect(command).not.toMatch(/-PassThru\s+exit/)
    expect(command).toContain("$ErrorActionPreference = 'Stop'")
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
