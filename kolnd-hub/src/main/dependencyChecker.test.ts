import { beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }))

vi.mock('child_process', () => ({ spawnSync: spawnSyncMock }))

import { checkDependencies, formatDependencyReport } from './dependencyChecker'

/** Simula o spawnSync por comando: o primeiro candidato que responder vence. */
function respond(
  responses: Record<string, { stdout?: string; stderr?: string; status?: number } | 'throw'>
): void {
  spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
    const key = `${cmd} ${args.join(' ')}`
    const response = responses[key] ?? 'throw'
    if (response === 'throw') throw new Error(`spawn falhou: ${key}`)
    return {
      stdout: response.stdout ?? '',
      stderr: response.stderr ?? '',
      status: response.status ?? 0
    }
  })
}

beforeEach(() => {
  spawnSyncMock.mockReset()
})

describe('checkDependencies — Python', () => {
  it('usa o primeiro candidato que responde e limpa o prefixo "Python"', async () => {
    respond({
      'py --version': 'throw',
      'python --version': { stdout: 'Python 3.12.4\n' },
      'python -m pip --version': { status: 0 }
    })
    const result = await checkDependencies()
    expect(result.pythonInstalled).toBe(true)
    expect(result.pythonVersion).toBe('3.12.4')
    expect(result.pipInstalled).toBe(true)
    expect(result.allInstalled).toBe(true)
  })

  it('usa stderr quando o stdout está vazio', async () => {
    respond({
      'py --version': { stderr: 'Python 3.11.9' },
      'py -m pip --version': { status: 1 },
      'python -m pip --version': { status: 0 }
    })
    const result = await checkDependencies()
    expect(result.pythonVersion).toBe('3.11.9')
    // pip achado só no segundo candidato.
    expect(result.pipInstalled).toBe(true)
  })

  it('sem saída em nenhum candidato → Python não instalado e pip indisponível', async () => {
    respond({
      'py --version': { stdout: '   ' },
      'python --version': { stderr: '' },
      'python3 --version': { stdout: '' }
    })
    const result = await checkDependencies()
    expect(result).toEqual({
      pythonInstalled: false,
      pythonVersion: undefined,
      pipInstalled: false,
      allInstalled: false
    })
  })

  it('Python instalado sem pip → allInstalled=false', async () => {
    respond({
      'py --version': { stdout: 'Python 3.13.0' },
      'py -m pip --version': { status: 2 }
    })
    const result = await checkDependencies()
    expect(result.pythonInstalled).toBe(true)
    expect(result.pipInstalled).toBe(false)
    expect(result.allInstalled).toBe(false)
  })
})

describe('formatDependencyReport', () => {
  it('relata tudo instalado com versão', () => {
    const report = formatDependencyReport({
      pythonInstalled: true,
      pythonVersion: '3.12.4',
      pipInstalled: true,
      allInstalled: true
    })
    expect(report).toContain('=== Relatório de Dependências ===')
    expect(report).toContain('Python: instalado (3.12.4)')
    expect(report).toContain('pip: disponível')
  })

  it('relata versão desconhecida e dependências ausentes', () => {
    const report = formatDependencyReport({
      pythonInstalled: true,
      pipInstalled: false,
      allInstalled: false
    })
    expect(report).toContain('Python: instalado (versão desconhecida)')
    expect(report).toContain('pip: NÃO disponível')

    const missing = formatDependencyReport({
      pythonInstalled: false,
      pipInstalled: false,
      allInstalled: false
    })
    expect(missing).toContain('Python: NÃO instalado')
  })
})
