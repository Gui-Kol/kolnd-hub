import type { ChatTurn } from '../../shared/config'
import type { GeminiContent } from './transport'

/**
 * Histórico da conversa e janela de contexto.
 *
 * - Os turnos ficam em `chat.turns` (máximo 200; os mais antigos saem do
 *   armazenamento ao passar do cap);
 * - a janela enviada ao modelo é medida em caracteres (tokens ≈ caracteres / 4)
 *   com teto default de 24.000 caracteres;
 * - o turno atual e os dois últimos pares entram SEMPRE, mesmo estourando o
 *   teto; histórico antigo não é apagado do disco, só não entra no prompt.
 */

export const CHAT_STORE_KEY = 'chat'
export const CHAT_MAX_TURNS = 200
export const DEFAULT_HISTORY_MAX_CHARS = 24_000

/** Quantos turnos antigos são obrigatórios (dois pares = 4 turnos). */
export const MANDATORY_RECENT_TURNS = 4

export interface ChatHistoryState {
  turns: ChatTurn[]
}

export interface ChatHistoryStoreLike {
  get<T>(key: string, defaultValue: T): T
  set(key: string, value: unknown): void
}

export interface ChatHistory {
  getTurns: () => ChatTurn[]
  append: (role: ChatTurn['role'], text: string, at?: number, interrupted?: boolean) => ChatTurn[]
}

export function defaultChatState(): ChatHistoryState {
  return { turns: [] }
}

/** Normaliza `chat` vindo do store/IPC; nunca lança. */
export function normalizeChatState(input: unknown): ChatHistoryState {
  const raw =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {}
  const turns = Array.isArray(raw.turns)
    ? raw.turns.flatMap((value): ChatTurn[] => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return []
        const turn = value as Record<string, unknown>
        if (turn.role !== 'user' && turn.role !== 'model') return []
        if (typeof turn.text !== 'string' || turn.text.length === 0) return []
        return [
          {
            role: turn.role,
            text: turn.text,
            at: typeof turn.at === 'number' && Number.isFinite(turn.at) ? turn.at : 0,
            ...(turn.interrupted === true ? { interrupted: true } : {})
          }
        ]
      })
    : []
  return { turns: turns.slice(-CHAT_MAX_TURNS) }
}

/** Adiciona um turno e mantém no máximo `maxTurns` (mais antigos saem). */
export function appendChatTurn(
  state: ChatHistoryState,
  turn: ChatTurn,
  maxTurns: number = CHAT_MAX_TURNS
): ChatHistoryState {
  return { turns: [...state.turns, turn].slice(-maxTurns) }
}

export function createChatHistory(options: {
  store: ChatHistoryStoreLike
  maxTurns?: number
}): ChatHistory {
  const maxTurns = options.maxTurns ?? CHAT_MAX_TURNS
  let state = normalizeChatState(
    options.store.get<ChatHistoryState>(CHAT_STORE_KEY, defaultChatState())
  )
  return {
    getTurns: () => [...state.turns],
    append: (role, text, at = Date.now(), interrupted = false) => {
      state = appendChatTurn(
        state,
        { role, text, at, ...(interrupted ? { interrupted: true } : {}) },
        maxTurns
      )
      options.store.set(CHAT_STORE_KEY, state)
      return [...state.turns]
    }
  }
}

function charsOf(turns: ChatTurn[]): number {
  return turns.reduce((total, turn) => total + turn.text.length, 0)
}

/**
 * Monta o contexto do prompt: histórico que cabe no teto + turno atual.
 *
 * Ordem cronológica. Os 4 turnos mais recentes (dois pares) e o texto atual são
 * inegociáveis; turnos anteriores entram enquanto houver orçamento.
 */
export function buildContextWindow(
  turns: ChatTurn[],
  currentText: string,
  maxChars: number = DEFAULT_HISTORY_MAX_CHARS
): GeminiContent[] {
  const history = turns.slice(-CHAT_MAX_TURNS)
  const mandatoryStart = Math.max(0, history.length - MANDATORY_RECENT_TURNS)
  const selected: ChatTurn[] = history.slice(mandatoryStart)
  let used = charsOf(selected) + currentText.length
  for (let index = mandatoryStart - 1; index >= 0; index -= 1) {
    const turn = history[index]
    if (!turn) continue
    if (used + turn.text.length > maxChars) break
    selected.unshift(turn)
    used += turn.text.length
  }
  const contents: GeminiContent[] = selected.map((turn) => ({
    role: turn.role,
    text: turn.text
  }))
  contents.push({ role: 'user', text: currentText })
  return contents
}
