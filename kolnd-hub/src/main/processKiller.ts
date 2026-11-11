import treeKill from 'tree-kill'
import { listRunningProcesses } from './startupManager'

/**
 * Extrai o nome do executável a partir do comando salvo nas configurações
 * (mesma lógica usada no renderer, ex.: `"C:\App\app.exe" --flag` → `app`).
 */
export function executableNameFromCommand(command: string): string {
  let token = command.trim()
  if (!token) return ''

  if (token.startsWith('"')) {
    const end = token.indexOf('"', 1)
    token = end === -1 ? token.slice(1) : token.slice(1, end)
  } else {
    token = token.split(/\s+/, 1)[0] ?? ''
  }

  const base = token.split(/[\\/]/).pop() ?? ''
  return base.replace(/\.(exe|cmd|bat|ps1|com)$/i, '').toLowerCase()
}

// Interpretadores e shells genéricos: matá-los por nome derrubaria processos
// inocentes do usuário, então esses comandos nunca são encerrados por nome.
const GENERIC_LAUNCHERS = new Set([
  'py',
  'python',
  'python3',
  'pythonw',
  'pyw',
  'node',
  'deno',
  'bun',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'cmd',
  'powershell',
  'pwsh',
  'wsl',
  'java',
  'javaw',
  'dotnet',
  'ruby',
  'perl',
  'php',
  'wscript',
  'cscript',
  'mshta',
  'explorer',
  'conhost'
])

export interface KillResult {
  success: boolean
  error?: string
  killed: number[]
}

/**
 * Encerra processos do sistema cujo nome (ou basename do caminho) corresponde
 * ao executável do comando. Usado quando o Hub detecta o programa rodando em
 * segundo plano, mas não foi ele quem iniciou o processo nesta sessão (ex.:
 * Hub reiniciado e o programa ficou órfão).
 */
export function killProcessesForCommand(command: string): Promise<KillResult> {
  const exe = executableNameFromCommand(command)
  if (!exe) {
    return Promise.resolve({
      success: false,
      error: 'Não foi possível identificar o executável do comando',
      killed: []
    })
  }

  if (GENERIC_LAUNCHERS.has(exe)) {
    return Promise.resolve({
      success: false,
      error: `"${exe}" é um interpretador/shell genérico — encerre o processo manualmente para não derrubar outros programas.`,
      killed: []
    })
  }

  let procs: ReturnType<typeof listRunningProcesses>
  try {
    procs = listRunningProcesses()
  } catch (err) {
    return Promise.resolve({
      success: false,
      error: `Não foi possível listar os processos: ${err instanceof Error ? err.message : String(err)}`,
      killed: []
    })
  }

  const matches = procs.filter((p) => {
    const name = (p.name ?? '').toLowerCase()
    if (name === exe) return true
    const base = (p.path ?? '')
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.(exe|cmd|bat|ps1|com)$/i, '')
      .toLowerCase()
    return Boolean(base && base === exe)
  })

  if (matches.length === 0) {
    return Promise.resolve({
      success: false,
      error: 'Processo não está em execução',
      killed: []
    })
  }

  return new Promise((resolveKill) => {
    let remaining = matches.length
    const killed: number[] = []
    let firstError: string | undefined

    for (const match of matches) {
      treeKill(match.id, 'SIGKILL', (err?: Error) => {
        if (err) {
          firstError = err.message
        } else {
          killed.push(match.id)
        }
        remaining -= 1
        if (remaining === 0) {
          if (killed.length > 0) {
            resolveKill({ success: true, killed })
          } else {
            resolveKill({
              success: false,
              error: firstError ?? 'Falha ao encerrar o processo',
              killed
            })
          }
        }
      })
    }
  })
}
