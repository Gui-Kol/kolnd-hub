import { describe, expect, it } from 'vitest'
import {
  displayProcessName,
  IGNORED_PROCESS_NAMES,
  isIgnoredProcess,
  selectFpsTarget
} from './target'
import type { FpsHelperSample } from './helper'

function sample(overrides: Partial<FpsHelperSample> = {}): FpsHelperSample {
  return {
    type: 'sample',
    ts: '2026-11-17T12:00:00.000Z',
    windowMs: 1000,
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
      }
    ],
    ...overrides
  }
}

describe('displayProcessName', () => {
  it('normaliza para nome com .exe e remove caminho', () => {
    expect(displayProcessName('game')).toBe('game.exe')
    expect(displayProcessName('GAME.EXE')).toBe('GAME.EXE')
    expect(displayProcessName('C:\\jogos\\game')).toBe('game.exe')
    expect(displayProcessName('/opt/game.exe')).toBe('game.exe')
  })

  it('descarta vazio, controle e nome absurdo', () => {
    expect(displayProcessName('')).toBeNull()
    expect(displayProcessName('a\u0000b')).toBeNull()
    expect(displayProcessName('x'.repeat(300))).toBeNull()
    expect(displayProcessName(null)).toBeNull()
  })
})

describe('isIgnoredProcess', () => {
  it('ignora cascas do sistema e o próprio Hub', () => {
    for (const name of IGNORED_PROCESS_NAMES) {
      expect(isIgnoredProcess(name)).toBe(true)
      expect(isIgnoredProcess(name.replace(/\.exe$/, ''))).toBe(true)
    }
    expect(isIgnoredProcess('EXPLORER.EXE')).toBe(true)
    expect(isIgnoredProcess('Kolnd Hub', ['Kolnd Hub.exe'])).toBe(true)
    expect(isIgnoredProcess('game.exe')).toBe(false)
  })

  it('sem nome é tratado como ignorado (não há como medir)', () => {
    expect(isIgnoredProcess(null)).toBe(true)
    expect(isIgnoredProcess('')).toBe(true)
  })
})

describe('selectFpsTarget', () => {
  it('escolhe o PID em primeiro plano com presents', () => {
    const result = selectFpsTarget(sample())
    expect(result.reason).toBeNull()
    expect(result.target).toEqual({
      pid: 1234,
      processName: 'game.exe',
      fps: 143.94,
      frametimeMs: 6.95
    })
  })

  it('sem janela em primeiro plano não há alvo', () => {
    expect(selectFpsTarget(sample({ foregroundPid: null, foregroundName: null }))).toEqual({
      target: null,
      reason: 'no-target'
    })
  })

  it('primeiro plano ignorado (Explorer/Hub/DWM) não vira alvo', () => {
    expect(
      selectFpsTarget(
        sample({
          foregroundPid: 500,
          foregroundName: 'explorer',
          pids: [
            { pid: 500, name: 'explorer', presents: 60, source: 'dxgi', fps: 60, frametimeMs: 16.6 }
          ]
        })
      )
    ).toEqual({ target: null, reason: 'no-target' })

    expect(
      selectFpsTarget(
        sample({
          foregroundPid: 600,
          foregroundName: 'Kolnd Hub',
          pids: [
            {
              pid: 600,
              name: 'Kolnd Hub',
              presents: 60,
              source: 'dxgi',
              fps: 60,
              frametimeMs: 16.6
            }
          ]
        }),
        ['Kolnd Hub.exe']
      )
    ).toEqual({ target: null, reason: 'no-target' })
  })

  it('primeiro plano sem presents na janela explica o "—"', () => {
    expect(
      selectFpsTarget(sample({ foregroundPid: 777, foregroundName: 'game', pids: [] }))
    ).toEqual({ target: null, reason: 'no-presents' })

    expect(
      selectFpsTarget(
        sample({
          pids: [{ pid: 1234, name: 'game', presents: 0, source: 'dxgi', fps: 0, frametimeMs: 0 }]
        })
      )
    ).toEqual({ target: null, reason: 'no-presents' })
  })

  it('usa o nome do primeiro plano quando o helper não resolveu o nome do PID', () => {
    const result = selectFpsTarget(
      sample({
        foregroundName: 'Game',
        pids: [{ pid: 1234, name: null, presents: 60, source: 'dxgk', fps: 60, frametimeMs: 16.7 }]
      })
    )
    expect(result.target?.processName).toBe('Game.exe')
  })

  it('multi-processo: cai no PID do mesmo executável que realmente apresenta (GPU)', () => {
    const result = selectFpsTarget(
      sample({
        foregroundPid: 100,
        foregroundName: 'msedge',
        pids: [
          { pid: 200, name: 'msedge', presents: 60, source: 'dxgi', fps: 59.9, frametimeMs: 16.7 },
          { pid: 300, name: 'outro', presents: 200, source: 'dxgi', fps: 200, frametimeMs: 5 }
        ]
      })
    )
    expect(result.reason).toBeNull()
    expect(result.target).toMatchObject({ pid: 200, processName: 'msedge.exe' })
  })
})
