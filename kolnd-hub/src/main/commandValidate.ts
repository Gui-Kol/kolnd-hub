import { existsSync } from 'fs'
import { ipcMain } from 'electron'
import { checkCommandLine, splitCommandLine, type CommandLineIssue } from './commandLine'

/**
 * IPC `command:validate` — validação de linha de comando sob demanda,
 * consumida pela tela de Configurações (task 01-1.6 / item 7.5).
 *
 * O comando NUNCA é executado aqui: apenas checks estáticos (os mesmos de
 * `checkCommandLine`) + verificação de existência do executável resolvido.
 * Decisão conservadora: em qualquer dúvida, NÃO reportar "executável não
 * encontrado" — um falso positivo num campo que aceita comandos arbitrários
 * é pior do que silêncio (o app aceita comandos por design; salvar não é
 * bloqueado).
 */

/** Tamanho máximo aceito na entrada do IPC (o campo do renderer é texto livre). */
export const MAX_COMMAND_INPUT = 4096

export interface CommandValidateDeps {
  /** Mapa de ambiente para expandir %VAR% (default: process.env; injetável para testes). */
  env?: NodeJS.ProcessEnv
  /** Verificação de existência (default: fs.existsSync; injetável para testes). */
  exists?: (path: string) => boolean
}

/**
 * Expande `%VAR%` com o mapa fornecido. Espelha de propósito o tratamento de
 * `%VAR%` de `processManager.expandPath` — duplicado (3 linhas) para manter
 * este módulo sem dependência de `processManager` (que arrasta tree-kill e o
 * logger) e 100% testável em node. Variável desconhecida fica como está
 * (`%FOO%` → `%FOO%`), igual ao launch.
 */
export function expandEnvVars(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/g, (match, name: string) => {
    const envValue = env[name]
    return envValue !== undefined ? envValue : match
  })
}

/** Caminho absoluto no Windows: drive (`C:\` / `C:/`) ou UNC (`\\server\share`). */
const ABSOLUTE_PATH_RE = /^([A-Za-z]:[\\/]|\\\\)/

/** Extensões de executável comuns no Windows — usadas para desempatar o caso
 * "caminho absoluto sem aspas com espaços" no modo shell (ver abaixo). */
const EXECUTABLE_EXT_RE = /\.(exe|bat|cmd|com|ps1|msi)$/i

/**
 * Metacaracteres que tornam a heurística de extração de executável inútil no
 * modo shell (pipes, redirecionamentos, encadeamento, agrupamento, escape do
 * cmd.exe). Se qualquer um aparecer, NÃO reportamos nada: comandos complexos
 * falham por design e um falso positivo aqui seria ruído puro.
 */
const SHELL_METACHARS_RE = /[|&<>;()^\n\r]/

/**
 * Heurística CONSERVADORA de extração do executável no modo shell:
 * - expande %VAR% ANTES de procurar metacaracteres (`%ProgramFiles(x86)%`
 *   contém parênteses, mas é resolvido pela expansão);
 * - se sobrar `%` (variável desconhecida) ou aparecer metacaracter de shell,
 *   retorna null — não reporta;
 * - candidato = primeiro trecho entre aspas (simples ou duplas) ou, fora de
 *   aspas, até o primeiro espaço/tab;
 * - candidato sem aspas e sem extensão de executável (ex.: `C:\Program`,
 *   prefixo de `C:\Program Files\...`) é ambíguo demais — retorna null.
 */
function extractShellExecutable(expanded: string): { token: string; quoted: boolean } | null {
  const trimmed = expanded.trim()
  if (!trimmed) return null

  if (SHELL_METACHARS_RE.test(trimmed)) return null

  const quote = trimmed[0]
  if (quote === '"' || quote === "'") {
    const end = trimmed.indexOf(quote, 1)
    if (end === -1) return null // aspas não fechadas: checkCommandLine já avisa
    const token = trimmed.slice(1, end).trim()
    return token ? { token, quoted: true } : null
  }

  const match = /^[^\s"']+/.exec(trimmed)
  if (!match) return null
  const token = match[0]
  // Sem aspas e sem extensão de executável: pode ser prefixo de um caminho
  // com espaços digitado sem aspas — dúvida, não reporta.
  if (!EXECUTABLE_EXT_RE.test(token)) return null
  return { token, quoted: false }
}

/**
 * Resolve o executável candidato e reporta `error` quando ele parece um
 * caminho absoluto mas não existe. Qualquer outra situação (nome nu via
 * PATH, caminho relativo, variável não expandida, shell complexo) não
 * reporta — ver heurística acima.
 */
function checkExecutableExists(
  command: string,
  useShell: boolean,
  deps: CommandValidateDeps
): CommandLineIssue | null {
  const trimmed = command.trim()
  if (!trimmed) return null

  const env = deps.env ?? process.env
  const exists = deps.exists ?? existsSync
  const expanded = expandEnvVars(trimmed, env)

  // Sobrou % → alguma variável não foi expandida: não dá para checar, não reporta.
  if (expanded.includes('%')) return null

  let token: string | undefined
  if (useShell) {
    token = extractShellExecutable(expanded)?.token
  } else {
    // useShell: false → o argv é exatamente o que seria spawnado; argv[0] é
    // o executável. Caminho com espaços sem aspas aqui é genuinamente
    // quebrado (spawn falharia), então reportamos normalmente.
    token = splitCommandLine(expanded)[0]
  }
  if (!token) return null

  if (!ABSOLUTE_PATH_RE.test(token)) return null // nome via PATH/relativo: fora do escopo
  if (exists(token)) return null
  return { level: 'error', message: `Executável não encontrado: ${token}` }
}

/**
 * Valida a linha de comando configurada. Nunca lança: entrada inválida vira
 * issue, não exceção (o renderer pode estar comprometido — IPC valida tudo).
 *
 * - `command` deve ser string (máx. `MAX_COMMAND_INPUT` chars; acima disso,
 *   retorna warning).
 * - `useShell`, quando presente, deve ser boolean (default: true — o mesmo
 *   default do launch no Hub).
 */
export function validateCommandLine(
  command: unknown,
  useShell?: unknown,
  deps: CommandValidateDeps = {}
): CommandLineIssue[] {
  if (typeof command !== 'string') {
    return [{ level: 'error', message: 'Comando inválido: esperado texto' }]
  }
  if (useShell !== undefined && typeof useShell !== 'boolean') {
    return [{ level: 'error', message: 'Parâmetro "useShell" inválido: esperado booleano' }]
  }
  const shell = useShell !== false

  if (command.length > MAX_COMMAND_INPUT) {
    return [
      { level: 'warning', message: `Comando muito longo (> ${MAX_COMMAND_INPUT} caracteres)` }
    ]
  }

  const issues = checkCommandLine(command)
  const exeIssue = checkExecutableExists(command, shell, deps)
  if (exeIssue) issues.push(exeIssue)
  return issues
}

/** Registra o canal `command:validate`. Síncrono e barato — sem spawn, sem disco além do existsSync. */
export function registerCommandValidateIpc(): void {
  ipcMain.handle('command:validate', (_event, command: unknown, useShell: unknown) =>
    validateCommandLine(command, useShell)
  )
}
