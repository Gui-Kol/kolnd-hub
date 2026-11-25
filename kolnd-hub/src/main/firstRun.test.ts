import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))

import { getFlagPath, isFirstRun, markFirstRunComplete, resetFirstRun } from './firstRun'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kolnd-first-run-'))
  state.userData = root
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('firstRun — flag de primeira execução', () => {
  it('getFlagPath aponta para first-run-complete.flag no userData', () => {
    expect(getFlagPath()).toBe(join(root, 'first-run-complete.flag'))
  })

  it('sem flag → primeira execução; após marcar → não é mais', () => {
    expect(isFirstRun()).toBe(true)
    markFirstRunComplete()
    expect(existsSync(getFlagPath())).toBe(true)
    expect(isFirstRun()).toBe(false)
  })

  it('cria o diretório do userData quando ele não existe', () => {
    const nested = join(root, 'nao', 'existe')
    state.userData = nested
    expect(existsSync(nested)).toBe(false)

    markFirstRunComplete()
    expect(existsSync(join(nested, 'first-run-complete.flag'))).toBe(true)
  })

  it('resetFirstRun remove a flag e é idempotente', () => {
    markFirstRunComplete()
    resetFirstRun()
    expect(isFirstRun()).toBe(true)
    // Sem flag, o reset não deve lançar.
    expect(() => resetFirstRun()).not.toThrow()
  })
})
