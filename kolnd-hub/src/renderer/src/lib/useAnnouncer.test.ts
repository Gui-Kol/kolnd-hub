import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANNOUNCE_DEBOUNCE_MS,
  __resetAnnouncerForTests,
  announce,
  formatFocusItem,
  getAnnouncementSnapshot,
  subscribeAnnouncements,
  visibleAnnouncement
} from './useAnnouncer'

beforeEach(() => {
  vi.useFakeTimers()
  __resetAnnouncerForTests()
})

afterEach(() => {
  __resetAnnouncerForTests()
  vi.useRealTimers()
})

describe('formatFocusItem', () => {
  it('formata "área, i de n: nome" em pt-BR', () => {
    expect(formatFocusItem('Jogos', 3, 12, 'Hades')).toBe('Jogos, 3 de 12: Hades')
    expect(formatFocusItem('Menu', 1, 3, 'Jogos')).toBe('Menu, 1 de 3: Jogos')
  })
})

describe('announce (debounce/substituição)', () => {
  it('não publica antes de ~150 ms sem mudanças', () => {
    announce('Jogos, 1 de 12: Hades')
    expect(visibleAnnouncement(getAnnouncementSnapshot())).toBe('')
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS - 1)
    expect(visibleAnnouncement(getAnnouncementSnapshot())).toBe('')
  })

  it('publica o último anúncio após o debounce', () => {
    announce('Jogos, 1 de 12: Hades')
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS)
    expect(visibleAnnouncement(getAnnouncementSnapshot())).toBe('Jogos, 1 de 12: Hades')
  })

  it('substitui o pendente e zera o timer — nunca enfileira', () => {
    announce('Jogos, 1 de 12: Hades')
    vi.advanceTimersByTime(100)
    announce('Jogos, 2 de 12: Celeste')
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS - 1)
    // O primeiro anúncio nunca chegou a ser publicado (timer zerado pelo segundo).
    expect(visibleAnnouncement(getAnnouncementSnapshot())).toBe('')
    vi.advanceTimersByTime(1)
    expect(visibleAnnouncement(getAnnouncementSnapshot())).toBe('Jogos, 2 de 12: Celeste')
  })

  it('troca rápida de muitos anúncios publica só o último', () => {
    for (const name of ['A', 'B', 'C', 'D', 'E']) {
      announce(`Jogos, 1 de 12: ${name}`)
      vi.advanceTimersByTime(50)
    }
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS)
    expect(visibleAnnouncement(getAnnouncementSnapshot())).toBe('Jogos, 1 de 12: E')
  })

  it('mesmo texto repetido gera mutação nova (ZWSP alterna)', () => {
    announce('Seção: Jogos')
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS)
    const first = getAnnouncementSnapshot()
    announce('Seção: Jogos')
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS)
    const second = getAnnouncementSnapshot()
    expect(second).not.toBe(first)
    expect(visibleAnnouncement(second)).toBe('Seção: Jogos')
  })

  it('ignora anúncio vazio', () => {
    announce('')
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS * 2)
    expect(getAnnouncementSnapshot()).toBe('')
  })

  it('notifica os assinantes ao publicar', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeAnnouncements(listener)
    announce('Modo Big Picture')
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    announce('Saindo do Modo Big Picture')
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
