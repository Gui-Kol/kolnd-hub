import * as os from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(os.tmpdir(), 'kolnd-hub-test') }
}))
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { parseWinRing0HelperOutput } from './winring0'

describe('parseWinRing0HelperOutput', () => {
  it('lê a resposta real do helper', () => {
    const raw = JSON.stringify({
      deviceOpen: true,
      msr: [
        { index: 3221291161, value: '18446744073709551615' },
        { index: 3221291163, value: '123456789' }
      ],
      pci: [{ bus: 0, device: 20, function: 0, offset: 96, value: '3735928559' }]
    })
    const parsed = parseWinRing0HelperOutput(raw)
    expect(parsed?.deviceOpen).toBe(true)
    expect(parsed?.msr).toEqual([
      { index: 3221291161, value: 18446744073709551615n },
      { index: 3221291163, value: 123456789n }
    ])
    expect(parsed?.pci).toEqual([
      { bus: 0, device: 20, function: 0, offset: 96, value: 3735928559 }
    ])
    expect(parsed?.error).toBeUndefined()
  })

  it('mantém precisão de 64 bits ao ler o MSR como string', () => {
    const parsed = parseWinRing0HelperOutput(
      '{"deviceOpen":true,"msr":[{"index":1,"value":"9007199254740993"}],"pci":[]}'
    )
    // Number perderia precisão; BigInt preserva o valor exato.
    expect(parsed?.msr[0].value).toBe(9007199254740993n)
  })

  it('aceita objeto único e campos nulos ([N/A] vira null)', () => {
    const raw = JSON.stringify({
      deviceOpen: false,
      msr: { index: 5, value: null },
      pci: { bus: 0, device: 1, function: 0, offset: 4, value: null }
    })
    const parsed = parseWinRing0HelperOutput(raw)
    expect(parsed?.msr).toEqual([{ index: 5, value: null }])
    expect(parsed?.pci).toEqual([{ bus: 0, device: 1, function: 0, offset: 4, value: null }])
  })

  it('propaga a mensagem de erro do helper', () => {
    const parsed = parseWinRing0HelperOutput(
      '{"deviceOpen":false,"msr":[],"pciWrites":[],"pci":[],"error":"acesso negado"}'
    )
    expect(parsed?.deviceOpen).toBe(false)
    expect(parsed?.error).toBe('acesso negado')
  })

  it('lê o resultado das escritas PCI (SMN: índice 0x60)', () => {
    const parsed = parseWinRing0HelperOutput(
      JSON.stringify({
        deviceOpen: true,
        msr: [],
        pciWrites: [{ bus: 0, device: 20, function: 0, offset: 96, ok: true }],
        pci: [{ bus: 0, device: 20, function: 0, offset: 100, value: '1234' }]
      })
    )
    expect(parsed?.pciWrites).toEqual([{ bus: 0, device: 20, function: 0, offset: 96, ok: true }])
    expect(parsed?.pci[0].value).toBe(1234)
  })

  it('tolera BOM/lixo e ignora entradas inválidas', () => {
    const parsed = parseWinRing0HelperOutput(
      '\uFEFFaviso\r\n{"deviceOpen":true,"msr":[{"index":"abc","value":1},{"index":7,"value":"x"}],"pci":[]}\r\nfim'
    )
    expect(parsed?.deviceOpen).toBe(true)
    expect(parsed?.msr).toEqual([{ index: 7, value: null }])
  })

  it('devolve null para saída inválida', () => {
    expect(parseWinRing0HelperOutput('')).toBeNull()
    expect(parseWinRing0HelperOutput(undefined)).toBeNull()
    expect(parseWinRing0HelperOutput('sem json')).toBeNull()
    expect(parseWinRing0HelperOutput('{quebrado')).toBeNull()
  })
})
