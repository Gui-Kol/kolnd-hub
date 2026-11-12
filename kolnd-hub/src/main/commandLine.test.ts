import { describe, it, expect } from 'vitest'
import { splitCommandLine, checkCommandLine } from './commandLine'

describe('splitCommandLine', () => {
  it('splits simple commands on whitespace', () => {
    expect(splitCommandLine('code.exe --flag value')).toEqual(['code.exe', '--flag', 'value'])
  })

  it('keeps quoted paths with spaces as one token', () => {
    expect(splitCommandLine('"C:\\Program Files\\App\\app.exe" --flag')).toEqual([
      'C:\\Program Files\\App\\app.exe',
      '--flag'
    ])
  })

  it('handles mixed quoted and unquoted args', () => {
    expect(splitCommandLine('tool.exe a "b c" d')).toEqual(['tool.exe', 'a', 'b c', 'd'])
  })

  it('supports single-quoted tokens', () => {
    expect(splitCommandLine("tool.exe 'a b' c")).toEqual(['tool.exe', 'a b', 'c'])
  })

  it('handles escaped double quotes inside double quotes', () => {
    expect(splitCommandLine('tool.exe "say \\"hi\\""')).toEqual(['tool.exe', 'say "hi"'])
  })

  it('keeps backslash as path separator (not an escape) outside quotes', () => {
    expect(splitCommandLine('C:\\Tools\\tool.exe /q')).toEqual(['C:\\Tools\\tool.exe', '/q'])
  })

  it('collapses repeated whitespace', () => {
    expect(splitCommandLine('  tool.exe    a\tb  ')).toEqual(['tool.exe', 'a', 'b'])
  })

  it('returns [] for an empty command', () => {
    expect(splitCommandLine('')).toEqual([])
    expect(splitCommandLine('   ')).toEqual([])
  })

  it('preserves empty quoted argument', () => {
    expect(splitCommandLine('tool.exe "" x')).toEqual(['tool.exe', '', 'x'])
  })
})

describe('checkCommandLine', () => {
  it('flags empty commands as errors', () => {
    expect(checkCommandLine('')).toEqual([{ level: 'error', message: 'Comando vazio' }])
  })

  it('accepts a normal command with no issues', () => {
    expect(checkCommandLine('"C:\\Program Files\\App\\app.exe" --flag 1')).toEqual([])
  })

  it('warns on unbalanced double quotes', () => {
    const issues = checkCommandLine('"C:\\App\\app.exe --flag')
    expect(issues.some((i) => i.message.includes('aspas'))).toBe(true)
  })
})
