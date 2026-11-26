/**
 * Flag de saída do processo.
 *
 * O fechamento da janela será interceptado para viver na bandeja (task 01).
 * Quando o encerramento é pedido de propósito (Sair, app.quit, desligamento do
 * Windows) este flag fica `true` e o `close` deixa o fechamento acontecer.
 *
 * Módulo sem dependências para poder ser importado por index, IPC e lifecycle.
 */
let quitting = false

export function markQuitting(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}
