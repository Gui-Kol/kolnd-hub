import type { MenuItemConstructorOptions } from 'electron'

/**
 * Handlers injetados no menu da bandeja.
 *
 * A interface é própria (e não importa a task 02 nem a task 11) para que o
 * menu continue sendo lógica pura, testável com um objeto de funções. A task
 * 02 preenche `showOverlay`; a task 11 preenche `openSettings`.
 */
export interface TrayHandlers {
  showOverlay: () => void
  openSettings: () => void
  quit: () => void
}

/**
 * Template do menu de contexto da bandeja, na ordem fechada da task 01:
 * "Abrir Overlay", "Configurações", um separador e "Sair".
 *
 * "Sair" chama o handler de encerramento (que marca isQuitting antes de
 * `app.quit`) em vez de chamar `app.quit` direto: sem essa marca o handler de
 * `close` da janela intercepta a saída e o processo fica preso.
 */
export function buildTrayMenuTemplate(handlers: TrayHandlers): MenuItemConstructorOptions[] {
  return [
    {
      label: 'Abrir Overlay',
      click: () => handlers.showOverlay()
    },
    {
      label: 'Configurações',
      click: () => handlers.openSettings()
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => handlers.quit()
    }
  ]
}
