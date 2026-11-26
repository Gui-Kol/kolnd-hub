import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PRIMARY_COLOR, defaultTheme, normalizeTheme } from '../shared/theme'
import { createThemeIO } from './theme-io'
import type { ThemeIOFs, ThemeIODialog } from './theme-io'

interface FakeFileSystem extends ThemeIOFs {
  readFile: ReturnType<typeof vi.fn>
  writeFile: ReturnType<typeof vi.fn>
  stat: ReturnType<typeof vi.fn>
}

function fakeFs(content: string, size = content.length): FakeFileSystem {
  return {
    stat: vi.fn(async () => ({ size })),
    readFile: vi.fn(async () => content),
    writeFile: vi.fn(async () => undefined)
  }
}

function fakeDialog(options: {
  canceled?: boolean
  filePath?: string
  filePaths?: string[]
}): ThemeIODialog {
  return {
    showSaveDialog: vi.fn(async () => ({
      canceled: options.canceled === true,
      filePath: options.filePath
    })),
    showOpenDialog: vi.fn(async () => ({
      canceled: options.canceled === true,
      filePaths: options.filePaths
    }))
  }
}

const EXPORT_WRAPPER = {
  app: 'absolem',
  kind: 'theme',
  version: 1,
  theme: {}
}

describe('export/import de tema', () => {
  it('import válido aplica', async () => {
    const rawTheme = normalizeTheme({ presetId: 'neon', primaryColor: '#22d3ee' })
    const fs = fakeFs(JSON.stringify({ ...EXPORT_WRAPPER, theme: rawTheme }))
    const applyTheme = vi.fn(() => ({ success: true }))
    const io = createThemeIO({
      fs,
      dialog: fakeDialog({ filePaths: ['C:\\tema.json'] }),
      getTheme: defaultTheme,
      applyTheme
    })

    const result = await io.importTheme()

    expect(result).toMatchObject({ ok: true, canceled: false, warnings: [] })
    if (!result.ok) return
    expect(result.theme).toEqual(rawTheme)
    expect(applyTheme).toHaveBeenCalledTimes(1)
    expect(applyTheme).toHaveBeenCalledWith(rawTheme)
  })

  it('import com cor inválida cai no default e avisa', async () => {
    const fs = fakeFs(
      JSON.stringify({
        ...EXPORT_WRAPPER,
        theme: { primaryColor: 'azul', effectColor: '#12' }
      })
    )
    const applyTheme = vi.fn(() => ({ success: true }))
    const io = createThemeIO({
      fs,
      dialog: fakeDialog({ filePaths: ['C:\\tema.json'] }),
      getTheme: defaultTheme,
      applyTheme
    })

    const result = await io.importTheme()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.theme?.primaryColor).toBe(DEFAULT_PRIMARY_COLOR)
    expect(result.warnings).toContain('Cor principal inválida; o padrão foi aplicado.')
    expect(result.warnings).toContain('Cor de efeitos inválida; o padrão foi aplicado.')
    expect(applyTheme).toHaveBeenCalledTimes(1)
  })

  it('arquivo maior que 64 KB é recusado', async () => {
    const fs = fakeFs('{}', 64 * 1024 + 1)
    const applyTheme = vi.fn(() => ({ success: true }))
    const io = createThemeIO({
      fs,
      dialog: fakeDialog({ filePaths: ['C:\\grande.json'] }),
      getTheme: defaultTheme,
      applyTheme
    })

    const result = await io.importTheme()

    expect(result).toMatchObject({ ok: false })
    if (result.ok) return
    expect(result.error).toContain('64 KB')
    expect(fs.readFile).not.toHaveBeenCalled()
    expect(applyTheme).not.toHaveBeenCalled()
  })

  it('export não inclui nada além de tema e metadados', async () => {
    const fs = fakeFs('')
    const io = createThemeIO({
      fs,
      dialog: fakeDialog({ filePath: 'C:\\saida.json' }),
      getTheme: () => normalizeTheme({ presetId: 'jade', primaryColor: '#10b981' })
    })

    const result = await io.exportTheme()

    expect(result).toMatchObject({ ok: true, canceled: false, filePath: 'C:\\saida.json' })
    expect(fs.writeFile).toHaveBeenCalledTimes(1)
    const [, text] = fs.writeFile.mock.calls[0] as [string, string, string]
    const parsed = JSON.parse(text) as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual(['app', 'kind', 'theme', 'version'])
    expect(parsed.app).toBe('absolem')
    expect(parsed.kind).toBe('theme')
    expect(parsed.version).toBe(1)
    expect(Object.keys(parsed.theme as Record<string, unknown>).sort()).toEqual(
      [
        'accessories',
        'effectColor',
        'glowIntensity',
        'outfit',
        'particleDensity',
        'presetId',
        'primaryColor',
        'reducedMotion',
        'scale',
        'style',
        'version'
      ].sort()
    )
    expect(JSON.stringify(parsed)).not.toMatch(/gemini|voice|apiKey|memory/i)
  })
})
