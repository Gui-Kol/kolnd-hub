import * as os from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(os.tmpdir(), 'kolnd-hub-test') }
}))
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import {
  describeNvmlError,
  nvmlDllCandidates,
  parseNvmlHelperOutput,
  parseNvmlJobPayload,
  pickExistingDll,
  pickFanReading,
  type NvmlFanSample
} from './nvml'

describe('parseNvmlHelperOutput', () => {
  it('lê a resposta real do helper (zero-fan: 0 RPM é leitura válida)', () => {
    const raw =
      '{"ok":true,"initialized":true,"deviceCount":1,"fans":[{"rpm":0,"percent":0}],"error":null}'
    expect(parseNvmlHelperOutput(raw)).toEqual({
      ok: true,
      initialized: true,
      deviceCount: 1,
      fans: [{ rpm: 0, percent: 0 }],
      error: undefined
    })
  })

  it('mantém rpm null quando o driver não expõe a leitura', () => {
    const parsed = parseNvmlHelperOutput(
      '{"ok":true,"initialized":true,"deviceCount":1,"fans":[{"rpm":null,"percent":42}],"error":null}'
    )
    expect(parsed?.fans).toEqual([{ rpm: null, percent: 42 }])
  })

  it('tolera BOM e lixo antes/depois do JSON', () => {
    const raw =
      '\uFEFFaviso do PowerShell\r\n{"ok":false,"initialized":false,"deviceCount":0,"fans":[],"error":"library|126|C:/Windows/System32/nvml.dll"} fim\r\n'
    const parsed = parseNvmlHelperOutput(raw)
    expect(parsed?.ok).toBe(false)
    expect(parsed?.error).toBe('library|126|C:/Windows/System32/nvml.dll')
  })

  it('devolve null para saída vazia, sem JSON ou JSON inválido', () => {
    expect(parseNvmlHelperOutput(null)).toBeNull()
    expect(parseNvmlHelperOutput('')).toBeNull()
    expect(parseNvmlHelperOutput('   \r\n')).toBeNull()
    expect(parseNvmlHelperOutput('sem json nenhum')).toBeNull()
    expect(parseNvmlHelperOutput('{"ok":true,"fans":[')).toBeNull()
    expect(parseNvmlHelperOutput('[1,2,3]')).toBeNull()
  })

  it('descarta valores fora de faixa e clampa o percentual em 100', () => {
    const parsed = parseNvmlHelperOutput(
      '{"ok":true,"initialized":true,"deviceCount":1,"fans":[{"rpm":999999,"percent":140},{"rpm":-5,"percent":"x"}],"error":null}'
    )
    expect(parsed?.fans).toEqual([
      { rpm: null, percent: 100 },
      { rpm: null, percent: null }
    ])
  })

  it('aceita JSON vazio de fans sem inventar amostra', () => {
    const parsed = parseNvmlHelperOutput(
      '{"ok":true,"initialized":true,"deviceCount":1,"fans":[],"error":null}'
    )
    expect(parsed?.fans).toEqual([])
    expect(parsed?.deviceCount).toBe(1)
  })
})

describe('parseNvmlJobPayload (coletor persistente)', () => {
  it('paridade com o fixture real do helper (zero-fan: 0 RPM é válido)', () => {
    expect(parseNvmlJobPayload({ available: true, rpm: 0, percent: 0, fanCount: 1 })).toEqual({
      available: true,
      rpm: 0,
      percent: 0,
      fanCount: 1
    })
  })

  it('mantém rpm null quando o driver não expõe RPM (percentual continua)', () => {
    expect(parseNvmlJobPayload({ available: true, rpm: null, percent: 42, fanCount: 1 })).toEqual({
      available: true,
      rpm: null,
      percent: 42,
      fanCount: 1
    })
  })

  it('máquina sem NVML responde available:false sem inventar leitura', () => {
    expect(parseNvmlJobPayload({ available: false, rpm: 999, percent: 50, fanCount: 2 })).toEqual({
      available: false,
      rpm: null,
      percent: null,
      fanCount: 0
    })
  })

  it('descarta faixas inválidas e clampa o percentual em 100', () => {
    expect(
      parseNvmlJobPayload({ available: true, rpm: 999999, percent: 140, fanCount: '1' })
    ).toEqual({ available: true, rpm: null, percent: 100, fanCount: 1 })
  })

  it('payload que não é objeto devolve null', () => {
    expect(parseNvmlJobPayload(null)).toBeNull()
    expect(parseNvmlJobPayload('x')).toBeNull()
    expect(parseNvmlJobPayload([])).toBeNull()
  })
})

describe('pickFanReading', () => {
  it('prefere a ventoinha com RPM mesmo quando outra responde só o percentual', () => {
    const fans: NvmlFanSample[] = [
      { rpm: null, percent: 30 },
      { rpm: 1450, percent: 34 }
    ]
    expect(pickFanReading(fans)).toEqual({ rpm: 1450, percent: 34 })
  })

  it('0 RPM (modo zero-fan) não é confundido com ausência de leitura', () => {
    expect(
      pickFanReading([
        { rpm: null, percent: 0 },
        { rpm: 0, percent: 0 }
      ])
    ).toEqual({
      rpm: 0,
      percent: 0
    })
  })

  it('cai no percentual quando nenhuma ventoinha expõe RPM (driver antigo)', () => {
    expect(pickFanReading([{ rpm: null, percent: 55 }])).toEqual({ rpm: null, percent: 55 })
  })

  it('sem nenhuma leitura devolve null', () => {
    expect(pickFanReading([])).toBeNull()
    expect(pickFanReading([{ rpm: null, percent: null }])).toBeNull()
  })
})

describe('describeNvmlError', () => {
  it('explica a DLL ausente/ilegível', () => {
    expect(describeNvmlError('library|126|C:\\Windows\\System32\\nvml.dll')).toMatch(/nvml\.dll/)
  })

  it('distingue driver não carregado (9) de GPU sem suporte', () => {
    expect(describeNvmlError('init|9|')).toMatch(/driver da NVIDIA não está carregado/)
    expect(describeNvmlError('init|3|')).toMatch(/não inicializou/)
  })

  it('explica export ausente e GPU sem ventoinha', () => {
    expect(describeNvmlError('export|0|nvmlInit_v2')).toMatch(/driver antigo/)
    expect(describeNvmlError('fans|0|count')).toMatch(/ventoinhas/)
  })

  it('sem erro devolve null', () => {
    expect(describeNvmlError(undefined)).toBeNull()
    expect(describeNvmlError(null)).toBeNull()
    expect(describeNvmlError('')).toBeNull()
    expect(describeNvmlError('etapa-desconhecida|0|')).toBeNull()
  })
})

describe('descoberta da DLL', () => {
  it('procura em System32 e no NVSMI antigo, nessa ordem', () => {
    expect(nvmlDllCandidates('C:\\Windows', 'C:\\Program Files')).toEqual([
      join('C:\\Windows', 'System32', 'nvml.dll'),
      join('C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvml.dll')
    ])
  })

  it('sem nenhuma DLL (máquina sem NVIDIA) devolve null em vez de caminho inventado', () => {
    expect(
      pickExistingDll(nvmlDllCandidates('C:\\Windows', 'C:\\Program Files'), () => false)
    ).toBeNull()
  })

  it('usa a reserva do NVSMI quando a System32 não tem a DLL', () => {
    const fallback = join('C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvml.dll')
    const found = pickExistingDll(
      nvmlDllCandidates('C:\\Windows', 'C:\\Program Files'),
      (path) => path === fallback
    )
    expect(found).toBe(fallback)
  })
})
