/**
 * Tokenizer de linha de comando para o modo `useShell: false`.
 *
 * O modo padrão do Hub é `shell: true` (cmd.exe interpreta a string inteira),
 * que preserva aspas e argumentos de comandos complexos. Para comandos sem
 * necessidade de shell, `shell: false` + argv evita a interpretação de
 * metacaracteres (&, |, %, etc.). Esta função converte:
 *
 *   "C:\Program Files\App\app.exe" --flag valor=1
 *   → ['C:\Program Files\App\app.exe', '--flag', 'valor=1']
 *
 * Regras:
 * - aspas duplas agrupam e são removidas;
 * - aspas simples também agrupam (compatibilidade com shells POSIX-like);
 * - `\"` dentro de aspas duplas vira uma aspa literal;
 * - espaços/tabs separam tokens fora de aspas;
 * - a barra invertida (\) NÃO é escape fora de aspas (é separador do Windows).
 */
export function splitCommandLine(commandLine: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuotes: '"' | "'" | null = null
  let hasToken = false // distinguishes '' (empty arg) from no token

  const pushCurrent = (): void => {
    if (hasToken || current.length > 0) {
      tokens.push(current)
      current = ''
      hasToken = false
    }
  }

  for (let i = 0; i < commandLine.length; i++) {
    const ch = commandLine[i]

    if (inQuotes === '"') {
      if (ch === '\\' && commandLine[i + 1] === '"') {
        current += '"'
        i++
        continue
      }
      if (ch === '"') {
        inQuotes = null
        continue
      }
      current += ch
      continue
    }

    if (inQuotes === "'") {
      if (ch === "'") {
        inQuotes = null
        continue
      }
      current += ch
      continue
    }

    if (ch === '"' || ch === "'") {
      inQuotes = ch
      hasToken = true
      continue
    }

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      pushCurrent()
      continue
    }

    current += ch
    hasToken = true
  }

  pushCurrent()
  return tokens
}

export type CommandLineIssue = { level: 'error' | 'warning'; message: string }

/**
 * Verificações baratas de sanidade para a string de comando configurada.
 * Não bloqueia — apenas informa (o design do Hub aceita comandos arbitrários).
 */
export function checkCommandLine(commandLine: string): CommandLineIssue[] {
  const issues: CommandLineIssue[] = []
  const trimmed = commandLine.trim()

  if (!trimmed) {
    issues.push({ level: 'error', message: 'Comando vazio' })
    return issues
  }

  if (trimmed.length > 2048) {
    issues.push({ level: 'warning', message: 'Comando muito longo (> 2048 caracteres)' })
  }

  // Contagem de aspas duplas ímpar quase sempre indica aspas desbalanceadas.
  const doubleQuotes = (trimmed.match(/"/g) ?? []).length
  if (doubleQuotes % 2 !== 0) {
    issues.push({
      level: 'warning',
      message: 'Número ímpar de aspas duplas — possíveis aspas não fechadas'
    })
  }

  return issues
}
