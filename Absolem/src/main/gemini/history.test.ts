import { describe, expect, it } from 'vitest'
import {
  appendChatTurn,
  buildContextWindow,
  createChatHistory,
  DEFAULT_HISTORY_MAX_CHARS,
  normalizeChatState
} from './history'
import { buildSystemPrompt, PROMPT_VERSION } from './prompts'
import type { ChatTurn } from '../../shared/config'

function turns(count: number, chars = 10): ChatTurn[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? ('user' as const) : ('model' as const),
    text: `t${index}-${'x'.repeat(chars)}`,
    at: index
  }))
}

function memoryStore() {
  const data = new Map<string, unknown>()
  return {
    get<T>(key: string, defaultValue: T): T {
      return data.has(key) ? (data.get(key) as T) : defaultValue
    },
    set(key: string, value: unknown): void {
      data.set(key, value)
    }
  }
}

describe('histórico e janela de contexto', () => {
  it('janela não corta o turno atual', () => {
    const current = 'y'.repeat(DEFAULT_HISTORY_MAX_CHARS + 500)
    const contents = buildContextWindow(turns(10, 100), current, 500)

    const last = contents.at(-1)
    expect(last).toEqual({ role: 'user', text: current })
    expect(last?.text).toHaveLength(current.length)
  })

  it('preserva os dois últimos pares mesmo estourando o teto', () => {
    const history = turns(10, 100)
    const contents = buildContextWindow(history, 'atual', 10)

    // 4 turnos obrigatórios + turno atual; nenhum mais antigo entra.
    expect(contents).toHaveLength(5)
    expect(contents.slice(0, 4).map((part) => part.text)).toEqual(
      history.slice(-4).map((turn) => turn.text)
    )
    expect(contents.at(-1)).toEqual({ role: 'user', text: 'atual' })
  })

  it('prompt inclui versão e regras de ferramenta', () => {
    const prompt = buildSystemPrompt({
      defaultLanguage: 'pt-BR',
      tools: [{ name: 'echo', description: 'Repete o texto.' }]
    })

    expect(prompt).toContain(PROMPT_VERSION)
    expect(prompt).toContain('echo')
    expect(prompt).toContain('Ferramentas')
    expect(prompt).toContain('Nunca invente resultado de ferramenta')
    expect(prompt).toContain('exigem confirmação')
  })

  it('histórico vazio funciona', () => {
    expect(buildContextWindow([], 'primeira mensagem')).toEqual([
      { role: 'user', text: 'primeira mensagem' }
    ])

    const history = createChatHistory({ store: memoryStore() })
    expect(history.getTurns()).toEqual([])
    history.append('user', 'oi', 1)
    history.append('model', 'olá', 2)
    expect(history.getTurns()).toEqual([
      { role: 'user', text: 'oi', at: 1 },
      { role: 'model', text: 'olá', at: 2 }
    ])
  })

  it('store de chat mantém no máximo 200 turnos e descarta lixo', () => {
    let state = normalizeChatState({
      turns: [
        { role: 'system', text: 'ignorado', at: 0 },
        { role: 'user', text: 'ok', at: 1 }
      ]
    })
    expect(state.turns).toEqual([{ role: 'user', text: 'ok', at: 1 }])

    for (let index = 0; index < 205; index += 1) {
      state = appendChatTurn(state, {
        role: index % 2 === 0 ? 'user' : 'model',
        text: `m${index}`,
        at: index
      })
    }
    expect(state.turns).toHaveLength(200)
    expect(state.turns[0]?.text).toBe('m5')
    expect(state.turns.at(-1)?.text).toBe('m204')
  })
})
