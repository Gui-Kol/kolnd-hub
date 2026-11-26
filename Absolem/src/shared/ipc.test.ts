import { describe, expect, it } from 'vitest'
import { IPC, IPC_PREFIXES } from './ipc'

describe('contrato IPC', () => {
  it('todos os canais são únicos', () => {
    const channels = Object.values(IPC)
    const unique = new Set(channels)
    expect(unique.size).toBe(channels.length)
  })

  it('todos os canais usam um prefixo conhecido', () => {
    const prefixes: readonly string[] = IPC_PREFIXES
    for (const channel of Object.values(IPC)) {
      const [prefix, action, ...rest] = channel.split(':')
      expect(prefixes).toContain(prefix)
      expect(action.length).toBeGreaterThan(0)
      expect(rest).toHaveLength(0)
    }
  })
})
