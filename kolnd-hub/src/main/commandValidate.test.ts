import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { validateCommandLine, expandEnvVars, MAX_COMMAND_INPUT } from './commandValidate'

const neverExists = (): boolean => false
const alwaysExists = (): boolean => true

describe('expandEnvVars', () => {
  it('expands known variables and keeps unknown ones literal', () => {
    expect(expandEnvVars('%BASE%\\app.exe', { BASE: 'C:\\Apps' })).toBe('C:\\Apps\\app.exe')
    expect(expandEnvVars('%NOPE%\\app.exe', {})).toBe('%NOPE%\\app.exe')
  })

  it('expands names containing parentheses (ProgramFiles(x86))', () => {
    expect(expandEnvVars('%ProgramFiles(x86)%\\app.exe', { 'ProgramFiles(x86)': 'C:\\PF86' })).toBe(
      'C:\\PF86\\app.exe'
    )
  })
})

describe('validateCommandLine — entrada do IPC', () => {
  it('rejects non-string input instead of throwing', () => {
    const issues = validateCommandLine(42)
    expect(issues).toEqual([{ level: 'error', message: 'Comando inválido: esperado texto' }])
  })

  it('rejects non-boolean useShell instead of throwing', () => {
    const issues = validateCommandLine('app.exe', 'sim')
    expect(issues).toEqual([
      { level: 'error', message: 'Parâmetro "useShell" inválido: esperado booleano' }
    ])
  })

  it('warns when the command exceeds the IPC size limit', () => {
    const issues = validateCommandLine('a'.repeat(MAX_COMMAND_INPUT + 1))
    expect(issues).toEqual([
      { level: 'warning', message: `Comando muito longo (> ${MAX_COMMAND_INPUT} caracteres)` }
    ])
  })

  it('flags empty commands as errors (via checkCommandLine)', () => {
    expect(validateCommandLine('   ')).toEqual([{ level: 'error', message: 'Comando vazio' }])
  })

  it('accepts a normal command with no issues', () => {
    expect(
      validateCommandLine('"C:\\Tools\\tool.exe" --flag', true, { exists: alwaysExists })
    ).toEqual([])
  })
})

describe('validateCommandLine — executável não encontrado', () => {
  it('reports an error for a missing unquoted absolute path (shell mode)', () => {
    const issues = validateCommandLine('C:\\Tools\\tool.exe --flag', true, {
      exists: neverExists
    })
    expect(issues).toEqual([
      { level: 'error', message: 'Executável não encontrado: C:\\Tools\\tool.exe' }
    ])
  })

  it('reports an error for a missing quoted absolute path with spaces (shell mode)', () => {
    const issues = validateCommandLine('"C:\\Program Files\\App\\app.exe" --flag', true, {
      exists: neverExists
    })
    expect(issues).toEqual([
      { level: 'error', message: 'Executável não encontrado: C:\\Program Files\\App\\app.exe' }
    ])
  })

  it('reports an error for a missing unquoted path with spaces in non-shell mode (spawn semantics)', () => {
    const issues = validateCommandLine('C:\\Program Files\\App\\app.exe --flag', false, {
      exists: neverExists
    })
    // useShell: false → argv[0] é exatamente "C:\\Program": genuinamente quebrado.
    expect(issues).toEqual([{ level: 'error', message: 'Executável não encontrado: C:\\Program' }])
  })

  it('does not report for an existing absolute path (non-shell mode)', () => {
    expect(
      validateCommandLine('"C:\\Tools\\tool.exe" --flag', false, { exists: alwaysExists })
    ).toEqual([])
  })

  it('does not report for a bare executable name resolved via PATH', () => {
    expect(validateCommandLine('tool.exe --flag', true, { exists: neverExists })).toEqual([])
  })

  it('does not report for a relative path', () => {
    expect(validateCommandLine('.\\tool.exe --flag', true, { exists: neverExists })).toEqual([])
  })

  it('does not report a doubtful unquoted shell token without executable extension', () => {
    // "C:\Program" pode ser prefixo de "C:\Program Files\..." — dúvida, silêncio.
    expect(
      validateCommandLine('C:\\Program Files\\App\\app.exe', true, {
        exists: neverExists
      })
    ).toEqual([])
  })

  it('reports quoted candidates without executable extension', () => {
    const issues = validateCommandLine('"C:\\Tools\\meutool" --flag', true, {
      exists: neverExists
    })
    expect(issues).toEqual([
      { level: 'error', message: 'Executável não encontrado: C:\\Tools\\meutool' }
    ])
  })

  it('expands %VAR% before the existence check', () => {
    const issues = validateCommandLine('"%MY_TOOLS%\\app.exe" --flag', true, {
      env: { MY_TOOLS: 'C:\\Meus Tools' },
      exists: (p) => p === 'C:\\Tools' // nunca o caminho expandido
    })
    expect(issues).toEqual([
      { level: 'error', message: 'Executável não encontrado: C:\\Meus Tools\\app.exe' }
    ])
  })

  it('stays silent when a variable cannot be expanded', () => {
    expect(
      validateCommandLine('"%MY_TOOLS%\\app.exe" --flag', true, { env: {}, exists: neverExists })
    ).toEqual([])
  })

  it('stays silent for shell commands with pipes/redirects (false positives forbidden)', () => {
    expect(
      validateCommandLine('"C:\\nope\\missing.exe" --flag | findstr ok', true, {
        exists: neverExists
      })
    ).toEqual([])
    expect(
      validateCommandLine('"C:\\nope\\missing.exe" > out.txt', true, { exists: neverExists })
    ).toEqual([])
    expect(
      validateCommandLine('"C:\\nope\\missing.exe" && echo ok', true, { exists: neverExists })
    ).toEqual([])
  })

  it('checks the filesystem for real by default (integration with existsSync)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'command-validate-'))
    try {
      const exe = join(dir, 'real.exe')
      writeFileSync(exe, '')
      expect(validateCommandLine(`"${exe}" --flag`, true, { env: {} })).toEqual([])
      const missing = join(dir, 'missing.exe')
      expect(validateCommandLine(`"${missing}" --flag`, true, { env: {} })).toEqual([
        { level: 'error', message: `Executável não encontrado: ${missing}` }
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('validateCommandLine — acumula checks de sanidade', () => {
  it('keeps the unbalanced-quotes warning alongside the exe check', () => {
    const issues = validateCommandLine('"C:\\Tools\\tool.exe --flag', true, {
      exists: alwaysExists
    })
    expect(issues.some((i) => i.level === 'warning' && i.message.includes('aspas'))).toBe(true)
  })
})
