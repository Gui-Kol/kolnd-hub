import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const state = vi.hoisted(() => ({
  userData: ''
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => state.userData
  }
}))

type FirstRunModule = typeof import('./firstRun')

let mod: FirstRunModule

beforeEach(async () => {
  vi.resetModules()
  state.userData = mkdtempSync(join(tmpdir(), 'absolem-first-run-'))
  mod = await import('./firstRun')
})

afterEach(() => {
  rmSync(state.userData, { recursive: true, force: true })
})

describe('first run', () => {
  it('grava o flag uma única vez e deixa de ser primeira execução', () => {
    expect(mod.isFirstRun()).toBe(true)

    mod.markFirstRunComplete()

    const flagPath = join(state.userData, 'first-run-complete.flag')
    expect(existsSync(flagPath)).toBe(true)
    expect(readFileSync(flagPath, 'utf8')).toBe('1')
    expect(mod.isFirstRun()).toBe(false)

    // Segunda gravação é idempotente e não reabre a primeira execução.
    mod.markFirstRunComplete()
    expect(mod.isFirstRun()).toBe(false)
  })
})
