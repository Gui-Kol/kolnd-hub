import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '../../shared/ipc'
import {
  MAX_BINARY_PAYLOAD_BYTES,
  MAX_TEXT_PAYLOAD_BYTES,
  checkPayloadLimits,
  isAllowedIpcChannel,
  isTrustedAppUrl,
  isTrustedSender,
  sanitizeIpcError
} from './ipcGuard'

/**
 * Hardening do IPC (task 13/T6).
 *
 * A allowlist é a de `src/shared/ipc.ts`; os handlers vivem em
 * `src/main/ipc/*.ts`. O teste não sobe Electron: valida o guarda central e
 * audita os nomes de canal usados nos módulos.
 */

const IPC_DIR = join(process.cwd(), 'src', 'main', 'ipc')
const LITERAL_CHANNEL = /ipcMain\.(?:handle|on)\(\s*(['"])([^'"]+)\1/g

describe('hardening do IPC', () => {
  it('canal fora da allowlist não existe', () => {
    expect(isAllowedIpcChannel(IPC.chatSend)).toBe(true)
    expect(isAllowedIpcChannel(IPC.captureResult)).toBe(true)
    expect(isAllowedIpcChannel('evil:canal')).toBe(false)
    expect(isAllowedIpcChannel('')).toBe(false)
    expect(isAllowedIpcChannel(123)).toBe(false)

    const channels = Object.values(IPC)
    expect(new Set(channels).size).toBe(channels.length)

    const literals: Array<{ file: string; channel: string }> = []
    for (const entry of readdirSync(IPC_DIR)) {
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue
      const text = readFileSync(join(IPC_DIR, entry), 'utf8')
      for (const match of text.matchAll(LITERAL_CHANNEL)) {
        const channel = match[2]
        if (channel) literals.push({ file: entry, channel })
      }
    }
    for (const item of literals) {
      expect(
        isAllowedIpcChannel(item.channel),
        `${item.file} registra canal fora da allowlist: ${item.channel}`
      ).toBe(true)
    }
  })

  it('payload acima do limite é recusado', () => {
    expect(checkPayloadLimits(new Uint8Array(MAX_BINARY_PAYLOAD_BYTES))).toEqual({ ok: true })
    const huge = checkPayloadLimits(new Uint8Array(MAX_BINARY_PAYLOAD_BYTES + 1))
    expect(huge.ok).toBe(false)
    if (!huge.ok) expect(huge.reason).toBe('binary')

    expect(checkPayloadLimits('a'.repeat(MAX_TEXT_PAYLOAD_BYTES))).toEqual({ ok: true })
    const long = checkPayloadLimits('a'.repeat(MAX_TEXT_PAYLOAD_BYTES + 1))
    expect(long.ok).toBe(false)
    if (!long.ok) expect(long.reason).toBe('text')

    expect(checkPayloadLimits({ requestId: 'r1', text: 'oi' })).toEqual({ ok: true })
  })

  it('remetente estranho é recusado', () => {
    expect(isTrustedSender({})).toBe(true)
    expect(isTrustedSender(null)).toBe(true)
    expect(isTrustedSender({ senderFrame: null })).toBe(false)
    expect(isTrustedSender({ senderFrame: { url: 'https://evil.example/' } })).toBe(false)
    expect(
      isTrustedSender({
        senderFrame: { url: 'file:///C:/Absolem/out/renderer/index.html#overlay' }
      })
    ).toBe(true)

    expect(isTrustedAppUrl('file:///C:/Absolem/out/renderer/index.html#settings', null)).toBe(true)
    expect(isTrustedAppUrl('https://evil.example/', 'http://localhost:5173')).toBe(false)
    expect(isTrustedAppUrl('http://localhost:5173/#overlay', 'http://localhost:5173')).toBe(true)
    expect(isTrustedAppUrl('file:///C:/out/renderer/outra.html', null)).toBe(false)
    expect(isTrustedAppUrl('javascript:alert(1)', null)).toBe(false)
  })

  it('erro não vaza stack, chave nem caminho pessoal', () => {
    const message = sanitizeIpcError(
      new Error(
        'falha api_key=AIzaSySegredo123 em C:\\Users\\joao\\projeto\n    at SDK.generate (sdk.js:1:1)\n    at main (index.js:2:2)'
      )
    )
    expect(message).not.toContain('AIzaSySegredo123')
    expect(message).not.toContain('joao')
    expect(message).not.toContain(' at ')
    expect(message).not.toContain('sdk.js')
    expect(message).toContain('[redigido]')
    expect(message).toContain('[usuario]')
    expect(message.length).toBeLessThanOrEqual(300)
    expect(sanitizeIpcError(undefined)).toBe('Falha ao executar a operação.')
  })
})
