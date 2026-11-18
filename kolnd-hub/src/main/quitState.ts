/**
 * Estado de saída do processo (task x-para-bandeja).
 *
 * O `close` da janela é interceptado para ocultar o app na bandeja — exceto
 * quando o encerramento foi pedido de propósito (Mais → Encerrar Hub, Sair da
 * bandeja, `app.quit()` do Playwright) ou quando o Windows está desligando.
 * Nesses casos o flag fica `true` e o `close` deixa o fechamento real
 * acontecer.
 *
 * Módulo sem dependências: é importado pelo `index.ts`, pelo IPC e pelo
 * `shutdownHub`, sem risco de ciclo.
 */
let quitting = false

export function markQuitting(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}
