import type { ConfirmationHandler } from './router'

/**
 * Confirmação nativa via `dialog.showMessageBox` (injetável).
 *
 * "Cancelar" é o botão default e o cancelId: fechar o diálogo (X/ESC) nega.
 * O texto mostra o que será feito e o alvo; o timeout de 30 s fica no roteador,
 * que trata ausência de resposta como negação.
 */

export interface ConfirmationDialogOptions {
  type: 'question' | 'warning'
  title: string
  message: string
  detail: string
  buttons: string[]
  defaultId: number
  cancelId: number
  noLink: boolean
}

export interface ConfirmationDialogLike {
  showMessageBox: (
    window: unknown,
    options: ConfirmationDialogOptions
  ) => Promise<{ response: number }>
}

const MAX_DETAIL = 500

function summarizeArgs(args: Record<string, unknown>): string {
  try {
    const text = JSON.stringify(args)
    return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL)}...` : text
  } catch {
    return '(argumentos não serializáveis)'
  }
}

export function createDialogConfirmation(
  dialog: ConfirmationDialogLike,
  getParent: () => unknown = () => null
): ConfirmationHandler {
  return async ({ tool, args }) => {
    try {
      const result = await dialog.showMessageBox(getParent(), {
        type: tool.sensitive ? 'warning' : 'question',
        title: 'Absolem - confirmação',
        message: `Permitir que o Absolem execute "${tool.name}"?`,
        detail: `${tool.description}\nAlvo: ${summarizeArgs(args)}`,
        buttons: ['Cancelar', 'Permitir'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      return result.response === 1
    } catch {
      return false
    }
  }
}
