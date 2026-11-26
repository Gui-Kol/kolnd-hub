import type { ToolDefinition } from '../../shared/tools'
import { CAPTURE_KINDS, type CaptureKind, type ScreenMode } from '../../shared/screen'
import type { ToolRegistry } from '../gemini/tools/registry'
import type { ToolHandler } from '../gemini/tools/internal'

/**
 * Ferramenta `look_at_screen` (task 07, T6), registrada no registro da task 05.
 *
 * - `category: 'screen'`, `sensitive: true`: o roteador da task 05 já abre
 *   confirmação nativa para toda chamada sensível;
 * - em `privacy.screen.mode = 'off'` a ferramenta NÃO é registrada: o modelo
 *   nem sabe que ela existe;
 * - o executor é injetado (o controlador de captura em produção) e devolve
 *   apenas metadados, nunca a imagem.
 */

export const SCREEN_TOOL_NAME = 'look_at_screen'
export const SCREEN_TOOL_CATEGORY = 'screen'
export const SCREEN_TOOL_TIMEOUT_MS = 30_000

export interface ScreenToolArgs {
  question: string
  kind?: CaptureKind
  displayId?: string
}

export type ScreenToolHandler = (args: ScreenToolArgs) => Promise<unknown> | unknown

export function createScreenToolDefinition(): ToolDefinition {
  return {
    name: SCREEN_TOOL_NAME,
    description:
      'Captura a tela (inteira, região escolhida ou janela ativa) para responder uma pergunta. ' +
      'Use somente quando o usuário pedir para olhar a tela.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'O que o usuário quer saber sobre a tela.',
          maxLength: 2_000
        },
        kind: {
          type: 'string',
          description: 'screen (tela inteira), region (região) ou active-window (janela ativa).',
          enum: [...CAPTURE_KINDS]
        },
        displayId: {
          type: 'string',
          description: 'Id do monitor, quando a tela inteira de um monitor específico for pedida.',
          maxLength: 64
        }
      },
      required: ['question'],
      additionalProperties: false
    },
    sensitive: true,
    category: SCREEN_TOOL_CATEGORY,
    timeoutMs: SCREEN_TOOL_TIMEOUT_MS
  }
}

export interface RegisterScreenToolOptions {
  mode: ScreenMode
  handler: ScreenToolHandler
}

/**
 * Registra definição + executor. Devolve `false` em `mode:'off'` (nada entra no
 * registro) ou quando a definição é recusada pelo próprio registro.
 */
export function registerScreenTool(
  registry: ToolRegistry,
  handlers: Map<string, ToolHandler>,
  options: RegisterScreenToolOptions
): boolean {
  if (options.mode === 'off') return false
  const result = registry.registerTool(createScreenToolDefinition())
  if (!result.ok) return false
  handlers.set(SCREEN_TOOL_NAME, (args) => {
    const normalized: ScreenToolArgs = {
      question: typeof args.question === 'string' ? args.question : '',
      ...(typeof args.kind === 'string' && (CAPTURE_KINDS as readonly string[]).includes(args.kind)
        ? { kind: args.kind as CaptureKind }
        : {}),
      ...(typeof args.displayId === 'string' && args.displayId.trim()
        ? { displayId: args.displayId.trim() }
        : {})
    }
    return options.handler(normalized)
  })
  return true
}
