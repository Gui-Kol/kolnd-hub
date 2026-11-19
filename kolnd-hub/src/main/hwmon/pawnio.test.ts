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
  PAWNIO_PROBE_AMD_MSR,
  PAWNIO_PROBE_INTEL_MSR,
  describePawnIoError,
  detectCpuVendor,
  moduleForVendor,
  parsePawnIoHelperOutput,
  parseRegString,
  probeRegisterForVendor,
  resolvePawnIoAssets
} from './pawnio'

describe('parsePawnIoHelperOutput', () => {
  it('lê o JSON compacto do helper (valores como string para não perder precisão)', () => {
    const raw =
      '{"deviceOpen":true,"module":"IntelMSR","msr":[{"index":1530,"value":"1234567890123"}],"smn":[],"error":null}'
    const parsed = parsePawnIoHelperOutput(raw)
    expect(parsed).not.toBeNull()
    expect(parsed?.deviceOpen).toBe(true)
    expect(parsed?.module).toBe('IntelMSR')
    expect(parsed?.msr).toEqual([{ index: 1530, value: 1234567890123n }])
    expect(parsed?.smn).toEqual([])
    expect(parsed?.error).toBeUndefined()
  })

  it('aceita objeto único em vez de array (ConvertTo-Json com 1 item)', () => {
    const raw =
      '{"deviceOpen":true,"module":"AMDFamily17","msr":{"index":3221291673,"value":262152},"smn":{"index":366592,"value":"4294967295"}}'
    const parsed = parsePawnIoHelperOutput(raw)
    expect(parsed?.module).toBe('AMDFamily17')
    expect(parsed?.msr).toEqual([{ index: 3221291673, value: 262152n }])
    expect(parsed?.smn).toEqual([{ index: 366592, value: 4294967295n }])
  })

  it('mantém entradas sem valor como null em vez de descartá-las', () => {
    const parsed = parsePawnIoHelperOutput(
      '{"deviceOpen":true,"module":"IntelMSR","msr":[{"index":1530,"value":null},{"index":1553,"value":"7"}],"smn":[]}'
    )
    expect(parsed?.msr).toEqual([
      { index: 1530, value: null },
      { index: 1553, value: 7n }
    ])
  })

  it('tolera BOM, lixo antes/depois do JSON e módulo desconhecido', () => {
    const raw =
      '\uFEFFaviso do PowerShell\r\n{"deviceOpen":false,"module":"OutroModulo","msr":[],"smn":[],"error":"device|2|"} fim\r\n'
    const parsed = parsePawnIoHelperOutput(raw)
    expect(parsed?.deviceOpen).toBe(false)
    expect(parsed?.module).toBeNull()
    expect(parsed?.error).toBe('device|2|')
  })

  it('devolve null para saída vazia ou inválida, sem lançar', () => {
    expect(parsePawnIoHelperOutput('')).toBeNull()
    expect(parsePawnIoHelperOutput(null)).toBeNull()
    expect(parsePawnIoHelperOutput(undefined)).toBeNull()
    expect(parsePawnIoHelperOutput('sem json')).toBeNull()
    expect(parsePawnIoHelperOutput('{quebrado')).toBeNull()
    expect(parsePawnIoHelperOutput('[1,2,3]')).toBeNull()
  })
})

describe('detectCpuVendor', () => {
  it('reconhece AMD pelas marcas comerciais que aparecem no brand string', () => {
    expect(detectCpuVendor('AMD Ryzen 7 5700X 8-Core Processor')).toBe('amd')
    expect(detectCpuVendor('AMD EPYC 7543 32-Core Processor')).toBe('amd')
    expect(detectCpuVendor('AMD Athlon 3000G')).toBe('amd')
  })

  it('reconhece Intel pelas marcas comerciais que aparecem no brand string', () => {
    expect(detectCpuVendor('12th Gen Intel(R) Core(TM) i7-12700K')).toBe('intel')
    expect(detectCpuVendor('Intel(R) Xeon(R) W-2295 CPU @ 3.00GHz')).toBe('intel')
    expect(detectCpuVendor('Intel(R) Celeron(R) N5105 @ 2.00GHz')).toBe('intel')
  })

  it('não inventa fabricante quando o modelo é vazio/desconhecido', () => {
    expect(detectCpuVendor('')).toBe('other')
    expect(detectCpuVendor(null)).toBe('other')
    expect(detectCpuVendor(undefined)).toBe('other')
    expect(detectCpuVendor('QEMU Virtual CPU version 2.5+')).toBe('other')
  })
})

describe('módulo e registro por vendor', () => {
  it('escolhe o módulo oficial do vendor', () => {
    expect(moduleForVendor('amd')).toBe('AMDFamily17')
    expect(moduleForVendor('intel')).toBe('IntelMSR')
    expect(moduleForVendor('other')).toBeNull()
  })

  it('sonda um registro real de cada vendor', () => {
    expect(probeRegisterForVendor('amd')).toBe(PAWNIO_PROBE_AMD_MSR)
    expect(probeRegisterForVendor('intel')).toBe(PAWNIO_PROBE_INTEL_MSR)
    expect(probeRegisterForVendor('other')).toBeNull()
  })
})

describe('describePawnIoError', () => {
  it('explica device ausente', () => {
    const message = describePawnIoError('device|2|')
    expect(message).toContain('device')
    expect(message).toContain('PawnIO')
  })

  it('explica módulo rejeitado (STATUS_NOT_SUPPORTED e ERROR_NOT_SUPPORTED)', () => {
    for (const code of [50, -1073741637, 0xc00000bb]) {
      const message = describePawnIoError(`module|${code}|amd`)
      expect(message).toContain('rejeitou esta CPU')
    }
  })

  it('diferencia falha genérica de módulo de rejeição de CPU', () => {
    expect(describePawnIoError('module|5|intel')).toContain('Reinstale o PawnIO')
  })

  it('explica função desconhecida no módulo', () => {
    expect(describePawnIoError('execute|1|ioctl_read_smn')).toContain('não implementa a leitura')
    expect(describePawnIoError('execute|50|leitura')).toContain('não implementa a leitura')
  })

  it('não culpa HVCI nem lista de drivers vulneráveis (o PawnIO é assinado)', () => {
    const messages = [
      'library|126|',
      'export|0|pawnio_open_win32',
      'version|0|',
      'device|2|',
      'module|50|amd',
      'execute|1|x',
      'vendor|0|other',
      'helper|0|boom',
      'timeout|0|'
    ].map((raw) => describePawnIoError(raw) ?? '')
    for (const message of messages) {
      expect(message).not.toMatch(/HVCI|Memória Integrity|vulner/i)
      expect(message.length).toBeGreaterThan(0)
    }
  })

  it('devolve null quando não há erro', () => {
    expect(describePawnIoError(undefined)).toBeNull()
    expect(describePawnIoError(null)).toBeNull()
    expect(describePawnIoError('')).toBeNull()
  })
})

describe('resolvePawnIoAssets', () => {
  it('monta os caminhos embutidos em resources/pawnio', () => {
    const assets = resolvePawnIoAssets('C:\\App\\resources')
    expect(assets).toEqual({
      dir: 'C:\\App\\resources\\pawnio',
      installer: 'C:\\App\\resources\\pawnio\\PawnIO_setup.exe',
      intelModule: 'C:\\App\\resources\\pawnio\\IntelMSR.bin',
      amdModule: 'C:\\App\\resources\\pawnio\\AMDFamily17.bin',
      license: 'C:\\App\\resources\\pawnio\\COPYING',
      pins: 'C:\\App\\resources\\pawnio\\pins.json'
    })
  })
})

describe('parseRegString', () => {
  it('lê o InstallLocation do `reg query` (REG_SZ e REG_EXPAND_SZ)', () => {
    const output =
      '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PawnIO\r\n    InstallLocation    REG_SZ    C:\\Program Files\\PawnIO\r\n\r\n'
    expect(parseRegString(output, 'InstallLocation')).toBe('C:\\Program Files\\PawnIO')

    const expanded = '    InstallLocation    REG_EXPAND_SZ    "C:\\Program Files\\PawnIO"\r\n'
    expect(parseRegString(expanded, 'InstallLocation')).toBe('C:\\Program Files\\PawnIO')
  })

  it('devolve null quando o valor não existe ou está vazio', () => {
    expect(parseRegString('    Outro    REG_SZ    C:\\x\r\n', 'InstallLocation')).toBeNull()
    expect(parseRegString('    InstallLocation    REG_SZ    \r\n', 'InstallLocation')).toBeNull()
  })
})
