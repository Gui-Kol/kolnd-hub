import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  buildStageScript,
  FPS_AGENT_SCRIPT_VERSION,
  isPresentMonBinary,
  PRESENTMON_ARGS,
  PRESENTMON_FILE,
  PRESENTMON_LEGACY_SESSION_NAME,
  PRESENTMON_SESSION_NAME,
  PRESENTMON_SHA256,
  PRESENTMON_SIZE,
  PRESENTMON_VERSION,
  resolveBundledPresentMon,
  type PresentMonStageOptions
} from './engine'

const tempRoots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kolnd-fps-engine-'))
  tempRoots.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true })
})

const STAGE: PresentMonStageOptions = {
  sourceExe: 'C:\\Program Files\\Kolnd Hub\\resources\\fps\\PresentMon-2.6.0-x64.exe',
  captureDir: 'C:\\ProgramData\\Kolnd Hub\\capture',
  binDir: 'C:\\ProgramData\\Kolnd Hub\\capture\\bin',
  agentDir: 'C:\\ProgramData\\Kolnd Hub\\capture\\agent',
  stagedExe: 'C:\\ProgramData\\Kolnd Hub\\capture\\bin\\PresentMon-2.6.0-x64.exe',
  manifestPath: 'C:\\ProgramData\\Kolnd Hub\\capture\\manifest.json',
  generatedAt: '2026-11-26T12:00:00.000Z'
}

describe('pin do PresentMon', () => {
  it('mantém versão, arquivo, hash e tamanho medidos na T0', () => {
    expect(PRESENTMON_VERSION).toBe('2.6.0')
    expect(PRESENTMON_FILE).toBe('PresentMon-2.6.0-x64.exe')
    expect(PRESENTMON_SHA256).toBe(
      'B2A706BC6AD475749E3B7E3409263AA1E6906D45BDCF993F6DBC0F660188F1AF'
    )
    expect(PRESENTMON_SIZE).toBe(980_320)
  })

  it('usa sessão própria e nunca o nome padrão PresentMon', () => {
    expect(PRESENTMON_SESSION_NAME).toBe('KolndHubFpsCapture')
    expect(PRESENTMON_LEGACY_SESSION_NAME).toBe('KolndHubFps')
    expect(PRESENTMON_ARGS).toContain('--output_stdout')
    expect(PRESENTMON_ARGS).toContain('--v1_metrics')
    expect(PRESENTMON_ARGS).toContain('--no_console_stats')
    expect(PRESENTMON_ARGS).toContain('--stop_existing_session')
    expect(PRESENTMON_ARGS).not.toContain('PresentMon')
    expect(PRESENTMON_ARGS[PRESENTMON_ARGS.indexOf('--session_name') + 1]).toBe(
      PRESENTMON_SESSION_NAME
    )
  })

  it('resolve o exe embutido em <resources>/fps', () => {
    expect(resolveBundledPresentMon('C:\\Program Files\\Kolnd Hub\\resources')).toBe(
      'C:\\Program Files\\Kolnd Hub\\resources\\fps\\PresentMon-2.6.0-x64.exe'
    )
  })
})

describe('isPresentMonBinary', () => {
  it('só aceita arquivo comum com o tamanho pinado', () => {
    const dir = tempDir()
    const exact = join(dir, 'exact.exe')
    writeFileSync(exact, Buffer.alloc(PRESENTMON_SIZE))
    expect(isPresentMonBinary(exact)).toBe(true)

    const truncated = join(dir, 'truncated.exe')
    writeFileSync(truncated, Buffer.alloc(PRESENTMON_SIZE - 1))
    expect(isPresentMonBinary(truncated)).toBe(false)
    expect(isPresentMonBinary(join(dir, 'missing.exe'))).toBe(false)
  })
})

describe('buildStageScript', () => {
  it('aplica a ACL em todos os diretórios ANTES de copiar o motor', () => {
    const script = buildStageScript(STAGE)
    const copyIndex = script.indexOf('Copy-Item -LiteralPath')
    expect(copyIndex).toBeGreaterThan(0)

    for (const dir of [STAGE.captureDir, STAGE.binDir, STAGE.agentDir]) {
      const aclIndex = script.indexOf(`icacls.exe '${dir}'`)
      expect(aclIndex, `ACL de ${dir}`).toBeGreaterThan(0)
      expect(aclIndex, `ACL de ${dir} antes da cópia`).toBeLessThan(copyIndex)
    }
    expect(script).toContain('*S-1-5-32-545:(OI)(CI)RX')
    expect(script).toContain('/inheritance:r')
  })

  it('confere hash e tamanho do DESTINO e aborta apagando a cópia', () => {
    const script = buildStageScript(STAGE)
    expect(script).toContain(`.Length -ne ${PRESENTMON_SIZE}`)
    expect(script).toContain(`$hash -ne '${PRESENTMON_SHA256}'`)
    expect(script).toContain('Get-FileHash -Algorithm SHA256')
    // As duas falhas removem a cópia antes do `exit 1` (sem binário meio válido).
    const hashFailure = script.slice(script.indexOf(`$hash -ne '`))
    expect(hashFailure).toContain('Remove-Item -Force')
    expect(hashFailure).toContain('exit 1')
  })

  it('grava o manifesto com versão do motor e do script', () => {
    const script = buildStageScript(STAGE)
    expect(script).toContain('manifest.json')
    expect(script).toContain('"name":"PresentMon"')
    expect(script).toContain(`"version":"${PRESENTMON_VERSION}"`)
    expect(script).toContain(`"sha256":"${PRESENTMON_SHA256}"`)
    expect(script).toContain(`"scriptVersion":${FPS_AGENT_SCRIPT_VERSION}`)
    expect(script).toContain('2026-11-26T12:00:00.000Z')
    expect(script).toContain('UTF8Encoding($false)')
  })

  it('funciona com espaço/acento e escapa aspas simples no caminho', () => {
    const script = buildStageScript({
      ...STAGE,
      captureDir: "C:\\ProgramData\\Kolnd Hub\\capture do O'Brien",
      binDir: "C:\\ProgramData\\Kolnd Hub\\capture do O'Brien\\bin",
      agentDir: "C:\\ProgramData\\Kolnd Hub\\capture do O'Brien\\agent"
    })
    expect(script).toContain("'C:\\ProgramData\\Kolnd Hub\\capture do O''Brien'")
    expect(script).toContain("'C:\\ProgramData\\Kolnd Hub\\capture do O''Brien\\bin'")
  })

  it('rejeita caminho relativo ou com aspas (injeção no script elevado)', () => {
    expect(() => buildStageScript({ ...STAGE, captureDir: 'capture' })).toThrow(/inválido/i)
    expect(() => buildStageScript({ ...STAGE, binDir: 'C:\\x"y' })).toThrow(/inválido/i)
    expect(() => buildStageScript({ ...STAGE, generatedAt: 'ontem' })).toThrow(/Data/i)
  })
})
