// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  buildDiagnosticsReport,
  exportDiagnosticsReport,
  limitDiagnosticErrors,
  type DiagnosticErrorEntry
} from '../../../shared/diagnostics'
import type { GeminiDiagnostics } from '../../../shared/gemini'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showSaveDialog: vi.fn() }
}))

const SECRET = 'chave-que-nao-pode-vazar-123'
const TRANSCRIPT = 'transcricao-privada-do-usuario'

function gemini(): GeminiDiagnostics {
  return {
    sdkPackage: '@google/genai',
    sdkVersion: '3.6.1',
    model: 'gemini-2.0-flash',
    promptVersion: '1.0.0',
    configured: true,
    lastError: null,
    usage: { today: 0, month: 0, cap: 2_000_000, percent: 0 }
  }
}

function report() {
  return buildDiagnosticsReport({
    app: { name: 'Absolem', version: '0.1.0', platform: 'win32' },
    runtime: { electron: '28.0.0', chromium: '120.0.0', node: '18.0.0' },
    liveModel: 'gemini-2.0-flash',
    gemini: gemini(),
    fps: 60,
    microphone: { state: 'off', consentGranted: false },
    memory: { total: 0, approxBytes: 0 },
    errors: [],
    now: new Date('2026-01-01T00:00:00.000Z')
  })
}

describe('diagnóstico', () => {
  it('não inclui chave', () => {
    const json = JSON.stringify(report())
    expect(json).not.toContain(SECRET)
    expect(json).not.toContain('apiKey')
    expect(json).not.toContain('"key"')
  })

  it('não inclui transcrição', () => {
    const json = JSON.stringify(report())
    expect(json).not.toContain(TRANSCRIPT)
    expect(json).not.toContain('transcript')
    expect(json).not.toContain('"turns"')
  })

  it('exporta JSON com versões', async () => {
    let writtenPath = ''
    let writtenData = ''
    const result = await exportDiagnosticsReport(report(), {
      showSaveDialog: async () => ({ canceled: false, filePath: 'C:/tmp/diag.json' }),
      writeFile: async (path, data) => {
        writtenPath = path
        writtenData = data
      }
    })

    expect(result).toEqual({ ok: true, canceled: false, filePath: 'C:/tmp/diag.json' })
    expect(writtenPath).toBe('C:/tmp/diag.json')
    const parsed = JSON.parse(writtenData) as {
      runtime: { electron: string; chromium: string; node: string }
      app: { version: string }
    }
    expect(parsed.runtime).toEqual({ electron: '28.0.0', chromium: '120.0.0', node: '18.0.0' })
    expect(parsed.app.version).toBe('0.1.0')
  })

  it('erros limitados a 5', () => {
    const errors: DiagnosticErrorEntry[] = Array.from({ length: 7 }, (_, index) => ({
      kind: 'auth',
      message: `erro ${index}`,
      at: index
    }))
    const limited = limitDiagnosticErrors(errors)
    expect(limited).toHaveLength(5)
    expect(limited[0]?.message).toBe('erro 2')
    expect(limited.at(-1)?.message).toBe('erro 6')
  })
})
