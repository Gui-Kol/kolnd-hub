import { describe, expect, it } from 'vitest'
import type { FpsPidSample, FpsSink } from '../../shared/fps'
import { displayProcessName, isIgnoredProcess, selectFpsTarget } from './target'

function sink(overrides: Partial<FpsSink> = {}): FpsSink {
  return {
    schema: 2,
    engine: { name: 'PresentMon', version: '2.6.0' },
    timestamp: new Date().toISOString(),
    foregroundPid: 100,
    foregroundName: 'game.exe',
    windowMs: 1000,
    pids: [{ pid: 100, name: 'game.exe', presents: 144, frametimeMs: 6.94 }],
    ...overrides
  }
}

function sample(overrides: Partial<FpsPidSample> = {}): FpsPidSample {
  return { pid: 100, name: 'game.exe', presents: 144, frametimeMs: 6.94, ...overrides }
}

describe('isIgnoredProcess / displayProcessName', () => {
  it('ignora Hub, Electron, Explorer, DWM e hosts do shell', () => {
    for (const name of [
      'electron.exe',
      'Kolnd Hub.exe',
      'explorer.exe',
      'dwm.exe',
      'SearchHost.exe',
      'StartMenuExperienceHost.exe',
      'ShellExperienceHost.exe',
      'TextInputHost.exe',
      'LockApp.exe'
    ]) {
      expect(isIgnoredProcess(name), name).toBe(true)
    }
    expect(isIgnoredProcess('game.exe')).toBe(false)
    expect(isIgnoredProcess(null)).toBe(false)
  })

  it('mostra o nome sem .exe e sem espaços', () => {
    expect(displayProcessName('  EldenRing.exe ')).toBe('EldenRing')
    expect(displayProcessName('electron')).toBe('electron')
    expect(displayProcessName('   ')).toBeNull()
    expect(displayProcessName(null)).toBeNull()
  })
})

describe('selectFpsTarget', () => {
  it('Hub em primeiro plano = self-focus (nunca o FPS do Hub)', () => {
    const reading = selectFpsTarget(sink({ foregroundPid: 4242, foregroundName: 'electron.exe' }), {
      selfPid: 4242
    })
    expect(reading).toEqual({
      state: 'no-target',
      fps: null,
      frametimeMs: null,
      processName: null,
      reason: 'self-focus'
    })
  })

  it('Explorer/DWM em foco = foreground-ignored', () => {
    expect(
      selectFpsTarget(sink({ foregroundPid: 10, foregroundName: 'explorer.exe' }), {
        selfPid: 4242
      }).reason
    ).toBe('foreground-ignored')
    expect(
      selectFpsTarget(sink({ foregroundPid: 10, foregroundName: 'dwm.exe' }), { selfPid: 4242 })
        .state
    ).toBe('no-target')
  })

  it('PID em foco com presents = live com fps/frametime/nome', () => {
    const reading = selectFpsTarget(sink(), { selfPid: 4242 })
    expect(reading).toEqual({
      state: 'live',
      fps: 144,
      frametimeMs: 6.94,
      processName: 'game'
    })
  })

  it('fallback só para o MESMO executável do app em foco', () => {
    const reading = selectFpsTarget(
      sink({
        foregroundPid: 100,
        foregroundName: 'chrome.exe',
        pids: [
          sample({ pid: 100, name: 'chrome.exe', presents: 0 }),
          sample({ pid: 101, name: 'chrome.exe', presents: 60, frametimeMs: 16.6 }),
          sample({ pid: 102, name: 'chrome.exe', presents: 90, frametimeMs: 11.1 })
        ]
      }),
      { selfPid: 4242 }
    )
    expect(reading.state).toBe('live')
    expect(reading.processName).toBe('chrome')
    // Escolhe o processo do mesmo app com mais presents.
    expect(reading.fps).toBe(90)
  })

  it('NUNCA mede outro app em segundo plano', () => {
    const reading = selectFpsTarget(
      sink({
        foregroundPid: 100,
        foregroundName: 'launcher.exe',
        pids: [sample({ pid: 999, name: 'jogo.exe', presents: 200 })]
      }),
      { selfPid: 4242 }
    )
    expect(reading.state).toBe('no-presents')
    expect(reading.fps).toBeNull()
    expect(reading.processName).toBeNull()
  })

  it('sem primeiro plano = no-target no-foreground', () => {
    const reading = selectFpsTarget(
      sink({ foregroundPid: null, foregroundName: null, pids: [sample()] }),
      { selfPid: 4242 }
    )
    expect(reading.state).toBe('no-target')
    expect(reading.reason).toBe('no-foreground')
  })

  it('amostra com frametime inválido não vira número', () => {
    const reading = selectFpsTarget(sink({ pids: [sample({ frametimeMs: 0 })] }), { selfPid: 4242 })
    expect(reading.state).toBe('no-presents')
    expect(reading.fps).toBeNull()
  })
})
