import { describe, it, expect } from 'vitest'
import {
  AUTO_RESTART_MAX_ATTEMPTS,
  AUTO_RESTART_WINDOW_MS,
  AUTO_RESTART_BACKOFF_MS,
  pruneAttempts,
  shouldAutoRestart,
  autoRestartBackoffMs
} from './processManager'

const NOW = 1_700_000_000_000
const MIN = 60 * 1000

describe('pruneAttempts', () => {
  it('lista vazia → vazia', () => {
    expect(pruneAttempts([], NOW)).toEqual([])
  })

  it('mantém tentativas dentro da janela', () => {
    const dentro = [NOW - 9 * MIN, NOW - 1 * MIN, NOW]
    expect(pruneAttempts(dentro, NOW)).toEqual(dentro)
  })

  it('expira tentativas com mais de 10 minutos', () => {
    const antigas = [NOW - 11 * MIN, NOW - 10 * MIN - 1]
    const novas = [NOW - 10 * MIN + 1, NOW - 5 * MIN]
    expect(pruneAttempts([...antigas, ...novas], NOW)).toEqual(novas)
  })

  it('exatamente 10 minutos atrás já expirou (limite inferior exclusivo)', () => {
    expect(pruneAttempts([NOW - AUTO_RESTART_WINDOW_MS], NOW)).toEqual([])
  })

  it('descarta timestamps no futuro (defesa contra clock skew)', () => {
    expect(pruneAttempts([NOW + 1, NOW + MIN], NOW)).toEqual([])
  })

  it('mistura: mantém só as recentes e retorna em ordem de entrada', () => {
    expect(
      pruneAttempts([NOW - 20 * MIN, NOW - 3 * MIN, NOW - 30 * MIN, NOW - 1 * MIN], NOW)
    ).toEqual([NOW - 3 * MIN, NOW - 1 * MIN])
  })
})

describe('shouldAutoRestart', () => {
  it('0 tentativas na janela → true', () => {
    expect(shouldAutoRestart([], NOW)).toBe(true)
  })

  it('1 e 2 tentativas na janela → true', () => {
    expect(shouldAutoRestart([NOW - 1 * MIN], NOW)).toBe(true)
    expect(shouldAutoRestart([NOW - 1 * MIN, NOW - 2 * MIN], NOW)).toBe(true)
  })

  it('exatamente 3 tentativas na janela → false', () => {
    const tres = [NOW - 1 * MIN, NOW - 2 * MIN, NOW - 3 * MIN]
    expect(shouldAutoRestart(tres, NOW)).toBe(false)
    expect(tres.length).toBe(AUTO_RESTART_MAX_ATTEMPTS)
  })

  it('3 tentativas antigas (>10 min) não contam → true', () => {
    const antigas = [NOW - 11 * MIN, NOW - 15 * MIN, NOW - 60 * MIN]
    expect(shouldAutoRestart(antigas, NOW)).toBe(true)
  })

  it('2 recentes + 1 antiga (expirada) → true (2 contam)', () => {
    const mix = [NOW - 1 * MIN, NOW - 2 * MIN, NOW - 11 * MIN]
    expect(shouldAutoRestart(mix, NOW)).toBe(true)
  })

  it('3 recentes no limite da janela contam → false', () => {
    const tres = [NOW - 9 * MIN, NOW - 9.5 * MIN, NOW - 9.9 * MIN]
    expect(shouldAutoRestart(tres, NOW)).toBe(false)
  })

  it('limite 3 é o default; janela default é 10 min', () => {
    expect(AUTO_RESTART_MAX_ATTEMPTS).toBe(3)
    expect(AUTO_RESTART_WINDOW_MS).toBe(10 * 60 * 1000)
  })
})

describe('autoRestartBackoffMs', () => {
  it('ordem 1ª→2s, 2ª→5s, 3ª→10s', () => {
    expect(autoRestartBackoffMs(0)).toBe(2000)
    expect(autoRestartBackoffMs(1)).toBe(5000)
    expect(autoRestartBackoffMs(2)).toBe(10000)
  })

  it('além da 3ª tentativa, mantém 10s', () => {
    expect(autoRestartBackoffMs(3)).toBe(10000)
    expect(autoRestartBackoffMs(10)).toBe(10000)
  })

  it('tabela de backoff publicada é 2s/5s/10s', () => {
    expect([...AUTO_RESTART_BACKOFF_MS]).toEqual([2000, 5000, 10000])
  })

  it('índice inválido degrada para o primeiro backoff', () => {
    expect(autoRestartBackoffMs(-1)).toBe(2000)
    expect(autoRestartBackoffMs(NaN)).toBe(2000)
  })
})
