import { describe, expect, it } from 'vitest'
import {
  MAX_ENCODED_COMMAND_CHARS,
  batchShortcutPaths,
  buildShortcutResolveScript,
  encodePowerShell
} from './shortcutResolve'

/**
 * Helper puro do resolver (task 29): precisamos provar que os caminhos reais
 * entram no script (e não em `$args`, que ficava vazio) e que o
 * `-EncodedCommand` é base64 UTF-16LE decodificável de volta.
 */

function embeddedPaths(script: string): string[] {
  const match = /FromBase64String\('([^']+)'\)/.exec(script)
  if (!match) throw new Error('base64 dos caminhos ausente no script')
  return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')) as string[]
}

describe('resolver de atalhos', () => {
  it('embute os caminhos como JSON e não usa $args', () => {
    const paths = ['C:\\Menu A\\Bloco de Notas.lnk', 'C:\\MenuB\\Paint.lnk']
    const script = buildShortcutResolveScript(paths)

    expect(script).not.toContain('$args')
    expect(script).toContain('ConvertFrom-Json')
    expect(script).toContain('CreateShortcut')
    expect(embeddedPaths(script)).toEqual(paths)
  })

  it('preserva aspas, acentos e caracteres especiais no caminho', () => {
    const paths = [
      'C:\\Menu\\d\'Ávila "teste".lnk',
      'C:\\Menu\\Café $vars & [colchetes].lnk',
      'C:\\Menu\\日本語.lnk'
    ]
    const script = buildShortcutResolveScript(paths)

    // O JSON não vaza para dentro do script: só o base64 aparece entre aspas.
    expect(script).not.toContain("d'Ávila")
    expect(embeddedPaths(script)).toEqual(paths)
  })

  it('lista vazia gera JSON vazio', () => {
    const script = buildShortcutResolveScript([])
    expect(embeddedPaths(script)).toEqual([])
  })

  it('encodePowerShell devolve base64 UTF-16LE (ida e volta)', () => {
    const script = buildShortcutResolveScript(['C:\\A.lnk'])
    const encoded = encodePowerShell(script)

    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe(script)
    // UTF-16LE de ASCII tem byte nulo intercalado (prova do encoding correto).
    expect(Buffer.from(encoded, 'base64').length).toBe(Buffer.byteLength(script, 'utf16le'))
  })

  it('lotes cabem no limite da linha de comando e preservam os caminhos', () => {
    // 104 atalhos, como no Menu Iniciar medido: um único -EncodedCommand passa
    // dos 32k caracteres e falha antes de chegar ao PowerShell.
    const paths = Array.from(
      { length: 104 },
      (_, index) =>
        `C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Accessories\\System Tools\\Aplicativo ${index}.lnk`
    )

    const batches = batchShortcutPaths(paths)

    expect(batches.length).toBeGreaterThan(1)
    expect(batches.flat()).toEqual(paths)
    for (const batch of batches) {
      const encoded = encodePowerShell(buildShortcutResolveScript(batch))
      expect(encoded.length).toBeLessThanOrEqual(MAX_ENCODED_COMMAND_CHARS)
      expect(batch.length).toBeGreaterThan(0)
    }
  })

  it('respeita um limite menor informado e mantém lista vazia', () => {
    const paths = ['C:\\A.lnk', 'C:\\B.lnk', 'C:\\C.lnk']
    const onePerBatch = batchShortcutPaths(paths, 200)
    expect(onePerBatch.flat()).toEqual(paths)
    expect(onePerBatch.every((batch) => batch.length === 1)).toBe(true)
    expect(batchShortcutPaths([])).toEqual([])
  })
})
