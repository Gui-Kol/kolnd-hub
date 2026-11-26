import { logger } from './logger'

/**
 * Handlers da segunda instância. `showOverlay` é o mesmo handler da bandeja
 * (task 02 substitui pelo controlador real); `notify` é opcional e só avisa
 * pelo balão que o app já está em execução.
 */
export interface SecondInstanceHandlers {
  showOverlay: () => void
  notify?: () => void
}

/**
 * Segunda instância com o lock já tomado pela primeira: NÃO cria janela nem
 * duplica o app. Apenas registra o evento e pede a exibição do overlay.
 */
export function handleSecondInstance(handlers: SecondInstanceHandlers): void {
  logger.info('singleInstance', 'segunda instância recebida')
  handlers.showOverlay()
  handlers.notify?.()
}
