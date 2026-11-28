/**
 * Saudação por horário local do Absolem.
 *
 * Função pura compartilhada pelo main (fala no overlay) e pelos testes: o
 * intervalo das 5h às 11h59 é "Bom dia", das 12h às 17h59 é "Boa tarde" e das
 * 18h às 4h59 é "Boa noite".
 */

export const GREETING_MORNING = 'Bom dia'
export const GREETING_AFTERNOON = 'Boa tarde'
export const GREETING_EVENING = 'Boa noite'

export type GreetingText =
  typeof GREETING_MORNING | typeof GREETING_AFTERNOON | typeof GREETING_EVENING

/** Saudação para uma hora local (0–23). Valores fora da faixa são normalizados. */
export function greetingForHour(hour: number): GreetingText {
  const h = Number.isFinite(hour) ? ((Math.floor(hour) % 24) + 24) % 24 : 0
  if (h >= 5 && h <= 11) return GREETING_MORNING
  if (h >= 12 && h <= 17) return GREETING_AFTERNOON
  return GREETING_EVENING
}

/** Saudação para um instante (usa a hora local do processo). */
export function greetingForDate(date: Date): GreetingText {
  return greetingForHour(date.getHours())
}
