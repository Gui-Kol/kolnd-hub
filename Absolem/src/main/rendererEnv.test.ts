import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ENV_KEY = 'ELECTRON_RENDERER_URL'
const DEV_URL = 'http://localhost:5173'

// `app.isPackaged` mutável: cada teste reimporta o módulo para exercitar o
// efeito colateral de sanitização no import.
const state = vi.hoisted(() => ({ isPackaged: true }))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.isPackaged
    }
  }
}))

beforeEach(() => {
  vi.resetModules()
  delete process.env[ENV_KEY]
})

afterEach(() => {
  delete process.env[ENV_KEY]
})

describe('sanitizeRendererUrlEnv', () => {
  it('empacotado apaga ELECTRON_RENDERER_URL mesmo com URL definida', async () => {
    state.isPackaged = true
    process.env[ENV_KEY] = DEV_URL

    await import('./rendererEnv')

    expect(process.env[ENV_KEY]).toBeUndefined()
  })

  it('não empacotado preserva ELECTRON_RENDERER_URL (dev continua valendo)', async () => {
    state.isPackaged = false
    process.env[ENV_KEY] = DEV_URL

    await import('./rendererEnv')

    expect(process.env[ENV_KEY]).toBe(DEV_URL)
  })

  it('sem URL definida não quebra', async () => {
    state.isPackaged = true

    await expect(import('./rendererEnv')).resolves.toBeDefined()

    expect(process.env[ENV_KEY]).toBeUndefined()
  })

  it('função pura: só apaga quando isPackaged é true', async () => {
    state.isPackaged = false
    const { sanitizeRendererUrlEnv } = await import('./rendererEnv')

    const packagedEnv: NodeJS.ProcessEnv = { [ENV_KEY]: DEV_URL }
    sanitizeRendererUrlEnv(packagedEnv, true)
    expect(packagedEnv[ENV_KEY]).toBeUndefined()

    const devEnv: NodeJS.ProcessEnv = { [ENV_KEY]: DEV_URL }
    sanitizeRendererUrlEnv(devEnv, false)
    expect(devEnv[ENV_KEY]).toBe(DEV_URL)
  })
})
