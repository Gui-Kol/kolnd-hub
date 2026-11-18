import { spawnSync } from 'child_process'

export interface DependencyCheckResult {
  pythonInstalled: boolean
  pythonVersion?: string
  pipInstalled: boolean
  allInstalled: boolean
}

function getPythonVersion(): string | undefined {
  const candidates = ['py', 'python', 'python3']
  for (const cmd of candidates) {
    try {
      const result = spawnSync(cmd, ['--version'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000
      })
      const output = (result.stdout || result.stderr || '').trim()
      if (output) {
        return output.replace(/^Python\s*/i, '').trim()
      }
    } catch {
      // tenta o próximo candidato
    }
  }
  return undefined
}

function isPipInstalled(): boolean {
  const candidates = ['py', 'python', 'python3']
  for (const cmd of candidates) {
    try {
      const result = spawnSync(cmd, ['-m', 'pip', '--version'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000
      })
      if (result.status === 0) {
        return true
      }
    } catch {
      // tenta o próximo candidato
    }
  }
  return false
}

/** Verifica todas as dependências do ecossistema Kolnd Hub. */
export async function checkDependencies(): Promise<DependencyCheckResult> {
  const pythonVersion = getPythonVersion()
  const pythonInstalled = Boolean(pythonVersion)
  const pipInstalled = isPipInstalled()

  const allInstalled = pythonInstalled && pipInstalled

  return {
    pythonInstalled,
    pythonVersion,
    pipInstalled,
    allInstalled
  }
}

/** Gera um relatório em texto das dependências faltantes. */
export function formatDependencyReport(result: DependencyCheckResult): string {
  const lines: string[] = []
  lines.push('=== Relatório de Dependências ===')
  lines.push(
    `Python: ${result.pythonInstalled ? `instalado (${result.pythonVersion ?? 'versão desconhecida'})` : 'NÃO instalado'}`
  )
  lines.push(`pip: ${result.pipInstalled ? 'disponível' : 'NÃO disponível'}`)
  return lines.join('\n')
}
