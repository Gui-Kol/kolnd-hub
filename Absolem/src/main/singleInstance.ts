import { logger } from './logger'

/**
 * Handlers da segunda instância. `showOverlay` é o mesmo handler da bandeja
 * (task 02 substitui pelo controlador real); `notify` é opcional e só avisa
 * pelo balão que o app já está em execução.
 */
export interface SecondInstanceHandlers {
  showOverlay: () => void
  notify?: () => void
  /** Evita reabrir janelas quando o encerramento já começou. */
  isQuitting?: () => boolean
}

/**
 * Segunda instância com o lock já tomado pela primeira: NÃO cria janela nem
 * duplica o app. Apenas registra o evento e pede a exibição do overlay.
 * Durante o encerramento o evento é ignorado: nenhuma janela nasce enquanto os
 * hooks destroem as existentes.
 */
export function handleSecondInstance(handlers: SecondInstanceHandlers): void {
  logger.info('singleInstance', 'segunda instância recebida')
  if (handlers.isQuitting?.()) {
    logger.info('singleInstance', 'segunda instância ignorada durante o encerramento')
    return
  }
  handlers.showOverlay()
  handlers.notify?.()
}
