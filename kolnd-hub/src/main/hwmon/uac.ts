/**
 * Reconhecimento de UAC recusado pelo usuário.
 *
 * Vive num módulo sem dependências porque dois caminhos precisam do mesmo
 * teste: o instalador do PawnIO e o agente de sensores. Antes ele morava em
 * `driver.ts`, o que obrigava esses módulos a importar o driver inteiro (e
 * criava ciclo).
 */
export function isUacCancelled(text: string): boolean {
  return /0x800704c7|1223|cancel(?:ed|led)?\s+by\s+the\s+user|cancelad[oa]\s+pelo\s+usu[aá]rio/i.test(
    text
  )
}
