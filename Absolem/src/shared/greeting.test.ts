import { describe, expect, it } from 'vitest'
import {
  GREETING_AFTERNOON,
  GREETING_EVENING,
  GREETING_MORNING,
  greetingForDate,
  greetingForHour
} from './greeting'

describe('saudação por horário', () => {
  it('madrugada é boa noite (0–4)', () => {
    for (const hour of [0, 1, 4]) expect(greetingForHour(hour)).toBe(GREETING_EVENING)
  })

  it('manhã é bom dia (5–11)', () => {
    for (const hour of [5, 8, 11]) expect(greetingForHour(hour)).toBe(GREETING_MORNING)
  })

  it('tarde é boa tarde (12–17)', () => {
    for (const hour of [12, 15, 17]) expect(greetingForHour(hour)).toBe(GREETING_AFTERNOON)
  })

  it('noite é boa noite (18–23)', () => {
    for (const hour of [18, 21, 23]) expect(greetingForHour(hour)).toBe(GREETING_EVENING)
  })

  it('limites 4/5/11/12/17/18', () => {
    expect(greetingForHour(4)).toBe(GREETING_EVENING)
    expect(greetingForHour(5)).toBe(GREETING_MORNING)
    expect(greetingForHour(11)).toBe(GREETING_MORNING)
    expect(greetingForHour(12)).toBe(GREETING_AFTERNOON)
    expect(greetingForHour(17)).toBe(GREETING_AFTERNOON)
    expect(greetingForHour(18)).toBe(GREETING_EVENING)
  })

  it('hora fora da faixa é normalizada e valor inválido vira madrugada', () => {
    expect(greetingForHour(24)).toBe(GREETING_EVENING)
    expect(greetingForHour(29)).toBe(GREETING_MORNING)
    expect(greetingForHour(-1)).toBe(GREETING_EVENING)
    expect(greetingForHour(Number.NaN)).toBe(GREETING_EVENING)
  })

  it('usa a hora local do instante', () => {
    const morning = new Date(2026, 0, 1, 9, 30)
    expect(greetingForDate(morning)).toBe(GREETING_MORNING)
  })
})
