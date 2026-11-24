/**
 * Reconhecimento de UAC recusado pelo usuário.
 *
 * Vive num módulo sem dependências porque três caminhos precisam do mesmo
 * teste: o instalador do PawnIO, o helper de FPS e o agente de FPS. Antes ele
 * morava em `driver.ts`, o que obrigava esses módulos a importar o driver
 * inteiro (e criava ciclo quando o agente de sensores passou a preparar o
 * coletor de FPS).
 */
export function isUacCancelled(text: string): boolean {
  return /0x800704c7|1223|cancel(?:ed|led)?\s+by\s+the\s+user|cancelad[oa]\s+pelo\s+usu[aá]rio/i.test(
    text
  )
}
