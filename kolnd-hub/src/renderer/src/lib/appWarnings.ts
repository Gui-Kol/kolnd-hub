/**
 * Avisos de UI por app (ex.: "ainda em desenvolvimento"). Fica só no renderer:
 * não persiste no store nem passa pelo IPC — é rótulo de tela, não configuração.
 */
export const APP_WARNINGS: Record<string, string> = {
  absolem: 'Ainda em desenvolvimento, não recomendado utilização'
}

/** Mensagem de aviso do app, ou `null` quando não há aviso. */
export function appWarning(id: string): string | null {
  return APP_WARNINGS[id] ?? null
}
