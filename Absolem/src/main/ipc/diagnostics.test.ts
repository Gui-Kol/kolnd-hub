import { describe, expect, it, vi } from 'vitest'
import type { GeminiStatusInfo } from '../../shared/gemini'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { buildGeminiDiagnostics, type DiagnosticsSource } from './diagnostics'

const SECRET = 'chave-que-nao-pode-vazar-123'

function source(overrides: Partial<GeminiStatusInfo> = {}): DiagnosticsSource {
  const status: GeminiStatusInfo = {
    configured: true,
    model: 'gemini-2.0-flash',
    lastError: null,
    disabledReason: null,
    usage: { today: 120, month: 1_500, cap: 2_000_000, percent: 0 },
    ...overrides
  }
  return {
    status: () => status,
    getPromptVersion: () => '1.0.0'
  }
}

describe('diagnostics:gemini', () => {
  it('não inclui a chave', () => {
    const diagnostics = buildGeminiDiagnostics(source())

    expect(JSON.stringify(diagnostics)).not.toContain(SECRET)
    expect(Object.keys(diagnostics)).not.toContain('key')
    expect(Object.keys(diagnostics)).not.toContain('apiKey')
    expect(diagnostics.configured).toBe(true)
  })

  it('inclui tokens do dia/mês, teto e versões', () => {
    const diagnostics = buildGeminiDiagnostics(source())

    expect(diagnostics.usage).toEqual({
      today: 120,
      month: 1_500,
      cap: 2_000_000,
      percent: 0
    })
    expect(diagnostics.model).toBe('gemini-2.0-flash')
    expect(diagnostics.promptVersion).toBe('1.0.0')
    expect(diagnostics.sdkVersion).toBe('3.6.1')
    expect(diagnostics.sdkPackage).toBe('@google/genai')
  })

  it('sem erro recente retorna null', () => {
    const diagnostics = buildGeminiDiagnostics(source())
    expect(diagnostics.lastError).toBeNull()
  })

  it('último erro classificado aparece sem stack', () => {
    const diagnostics = buildGeminiDiagnostics(
      source({
        lastError: { kind: 'auth', message: 'Chave de API inválida, ausente ou sem permissão.' }
      })
    )

    expect(diagnostics.lastError).toEqual({
      kind: 'auth',
      message: 'Chave de API inválida, ausente ou sem permissão.'
    })
  })
})
