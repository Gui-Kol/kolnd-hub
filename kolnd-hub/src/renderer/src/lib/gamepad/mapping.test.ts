import { describe, it, expect } from 'vitest'
import { mappingsEqual } from './mapping'
import { GAMEPAD_ACTIONS } from './types'
import type { GamepadButtonMapping } from './types'

// Mapeamento base determinístico: ação i → botão i.
const baseMapping = (): GamepadButtonMapping =>
  Object.fromEntries(
    GAMEPAD_ACTIONS.map((action, index) => [action, index])
  ) as unknown as GamepadButtonMapping

describe('mappingsEqual', () => {
  it('retorna true para mapeamentos idênticos', () => {
    expect(mappingsEqual(baseMapping(), baseMapping())).toBe(true)
  })

  it('retorna false quando um botão difere', () => {
    const a = baseMapping()
    const b = { ...a, confirm: 99 }
    expect(mappingsEqual(a, b)).toBe(false)
  })

  it('distingue null de número', () => {
    const a = { ...baseMapping(), back: null }
    expect(mappingsEqual(a, baseMapping())).toBe(false)
    expect(mappingsEqual(a, { ...a })).toBe(true)
  })

  it('não depende da ordem de inserção das chaves', () => {
    const a = baseMapping()
    const reversed = Object.fromEntries(
      Object.entries(a).reverse()
    ) as unknown as GamepadButtonMapping
    expect(mappingsEqual(a, reversed)).toBe(true)
  })
})
