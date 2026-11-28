import { app } from 'electron'
import { FakeLiveTransport } from './testing/fakeLiveTransport'
import { SdkLiveTransport } from './sdk'
import type { LiveTransport } from './liveTransport'

/**
 * O transporte fake só existe no processo não empacotado de teste.
 * O binário distribuído sempre usa o SDK real, mesmo que a variável de teste
 * seja herdada pelo ambiente.
 */
function fakeResponseDelayMs(): number {
  const raw = Number(process.env.ABSOLEM_TEST_FAKE_DELAY_MS)
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 5_000) : 0
}

export function createLiveTransport(): LiveTransport {
  if (!app.isPackaged && process.env.ABSOLEM_TEST_TRANSPORT === 'fake') {
    return new FakeLiveTransport(true, fakeResponseDelayMs())
  }
  return new SdkLiveTransport()
}

export function getLiveApiKey(read: () => string | null): string | null {
  let key: string | null
  try {
    key = read()
  } catch {
    // Falha de safeStorage/segredo conta como "sem chave", como antes.
    key = null
  }
  if (key) return key
  return !app.isPackaged && process.env.ABSOLEM_TEST_TRANSPORT === 'fake'
    ? 'absolem-test-live-key'
    : null
}
