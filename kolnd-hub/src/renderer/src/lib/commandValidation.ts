// Validação inline do campo "Comando" (em Configurações) — decisão pura.
// Fica em `lib/` (como `hudLayout.ts`) para ser testável em vitest sem DOM.
//
// A tela validava TODOS os apps a cada edição (uma IPC `command:validate` por
// app), mesmo quando só um comando mudou. Aqui o cache por id + assinatura do
// par (`command`, `useShell`) permite disparar apenas o que ficou desatualizado.

/** Issue de validação devolvida pelo IPC `command:validate` (espelho do main). */
export type CommandIssue = { level: 'error' | 'warning'; message: string }

/** Entrada do cache: assinatura validada + issues devolvidas pelo main. */
export type CommandValidationEntry = { signature: string; issues: CommandIssue[] }

/** Cache por id de app — vive num `useRef` no componente, nunca no store. */
export type CommandValidationCache = Record<string, CommandValidationEntry>

/** App mínimo necessário para decidir a validação (evita acoplar ao AppConfig). */
export type ValidatableApp = { id: string; command: string; useShell?: boolean }

/** Pendência já normalizada: `useShell` resolvido para boolean (pronto para a IPC). */
export type PendingValidation = { id: string; command: string; useShell: boolean }

/**
 * Identidade do que foi validado. O separador NUL evita colisão entre pares
 * diferentes (ex.: comando terminando em "0" e shell desligado) e o modo shell
 * entra normalizado porque `undefined` significa ligado (default do app).
 */
export function commandSignature(command: string, useShell: boolean): string {
  return command + '\u0000' + (useShell ? '1' : '0')
}

/**
 * Apps cujo par (`command`, `useShell`) ainda não está no cache, na ordem da
 * lista recebida. Ids fora da lista simplesmente não entram — a poda das
 * entradas removidas é responsabilidade de quem consome o cache.
 */
export function pendingValidations(
  cache: CommandValidationCache,
  apps: ValidatableApp[]
): PendingValidation[] {
  const pending: PendingValidation[] = []
  for (const app of apps) {
    const useShell = app.useShell !== false
    if (cache[app.id]?.signature === commandSignature(app.command, useShell)) continue
    pending.push({ id: app.id, command: app.command, useShell })
  }
  return pending
}

/**
 * Aplica os resultados das validações disparadas. Só as entradas recebidas são
 * sobrescritas; as demais continuam válidas (foram validadas antes e o par não
 * mudou). Devolve um objeto novo para o `useRef` do componente.
 */
export function mergeValidationResults(
  cache: CommandValidationCache,
  results: CommandValidationCache
): CommandValidationCache {
  return { ...cache, ...results }
}
