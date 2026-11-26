import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { FPS_SINK_STALE_MS, type FpsSink } from '../../shared/fps'
import { parseFpsSink, readFpsSinkFile } from './reader'

const tempRoots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kolnd-fps-reader-'))
  tempRoots.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true })
})

const NOW = Date.parse('2026-11-26T12:00:00.000Z')

function sink(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 2,
    engine: { name: 'PresentMon', version: '2.6.0' },
    timestamp: new Date(NOW).toISOString(),
    foregroundPid: 4242,
    foregroundName: 'game.exe',
    windowMs: 1000,
    pids: [{ pid: 4242, name: 'game.exe', presents: 144, frametimeMs: 6.94 }],
    ...overrides
  }
}

describe('parseFpsSink', () => {
  it('aceita o sink vivo e tipa os PIDs', () => {
    const parsed = parseFpsSink(sink(), NOW + 100)
    expect(parsed.fresh).toBe(true)
    expect(parsed.stale).toBe(false)
    expect(parsed.sink).toEqual({
      schema: 2,
      engine: { name: 'PresentMon', version: '2.6.0' },
      timestamp: new Date(NOW).toISOString(),
      foregroundPid: 4242,
      foregroundName: 'game.exe',
      windowMs: 1000,
      pids: [{ pid: 4242, name: 'game.exe', presents: 144, frametimeMs: 6.94 }]
    } satisfies FpsSink)
  })

  it('timestamp velho = stale (não devolve sink)', () => {
    const parsed = parseFpsSink(
      sink({ timestamp: new Date(NOW - FPS_SINK_STALE_MS - 1).toISOString() }),
      NOW
    )
    expect(parsed).toEqual({ fresh: false, stale: true, sink: null })
  })

  it('timestamp muito no futuro (clock errado) é inválido', () => {
    const parsed = parseFpsSink(sink({ timestamp: new Date(NOW + 6_000).toISOString() }), NOW)
    expect(parsed).toEqual({ fresh: false, stale: false, sink: null })
  })

  it('exige schema 2, motor PresentMon, janela e pids válidos', () => {
    expect(parseFpsSink(sink({ schema: 1 }), NOW)).toEqual({
      fresh: false,
      stale: false,
      sink: null
    })
    expect(parseFpsSink(sink({ engine: { name: 'Outro', version: '1.0.0' } }), NOW)).toEqual({
      fresh: false,
      stale: false,
      sink: null
    })
    expect(parseFpsSink(sink({ windowMs: 0 }), NOW)).toEqual({
      fresh: false,
      stale: false,
      sink: null
    })
    expect(parseFpsSink(sink({ pids: 'x' }), NOW)).toEqual({
      fresh: false,
      stale: false,
      sink: null
    })
    expect(parseFpsSink(null, NOW)).toEqual({ fresh: false, stale: false, sink: null })
  })

  it('descarta amostras inválidas e aceita lista vazia', () => {
    const parsed = parseFpsSink(
      sink({
        pids: [
          { pid: 0, name: 'x.exe', presents: 10, frametimeMs: 10 },
          { pid: 10, name: '', presents: 10, frametimeMs: 10 },
          { pid: 10, name: 'ok.exe', presents: -1, frametimeMs: 10 },
          { pid: 10, name: 'ok.exe', presents: 10, frametimeMs: 5000 },
          { pid: 20, name: 'ok.exe', presents: 60, frametimeMs: 16.6 }
        ]
      }),
      NOW
    )
    expect(parsed.fresh).toBe(true)
    expect(parsed.sink?.pids).toEqual([
      { pid: 20, name: 'ok.exe', presents: 60, frametimeMs: 16.6 }
    ])

    const empty = parseFpsSink(sink({ pids: [], foregroundPid: null, foregroundName: null }), NOW)
    expect(empty.fresh).toBe(true)
    expect(empty.sink?.pids).toEqual([])
    expect(empty.sink?.foregroundPid).toBeNull()
  })

  it('limita a 64 PIDs', () => {
    const pids = Array.from({ length: 90 }, (_, index) => ({
      pid: index + 1,
      name: 'p.exe',
      presents: 60,
      frametimeMs: 16
    }))
    const parsed = parseFpsSink(sink({ pids }), NOW)
    expect(parsed.sink?.pids).toHaveLength(64)
  })
})

describe('readFpsSinkFile', () => {
  it('lê o arquivo, remove BOM e valida tamanho', async () => {
    const dir = tempDir()
    const path = join(dir, 'latest.json')
    writeFileSync(path, `\uFEFF${JSON.stringify(sink())}`, 'utf8')
    const parsed = await readFpsSinkFile(path, NOW + 100)
    expect(parsed.fresh).toBe(true)

    const big = join(dir, 'big.json')
    writeFileSync(big, 'x'.repeat(70 * 1024), 'utf8')
    expect(await readFpsSinkFile(big, NOW)).toEqual({ fresh: false, stale: false, sink: null })
    expect(await readFpsSinkFile(join(dir, 'missing.json'), NOW)).toEqual({
      fresh: false,
      stale: false,
      sink: null
    })
  })
})
