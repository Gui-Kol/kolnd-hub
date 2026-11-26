import { getPersistentStore, getStoreSnapshot } from '../store'
import { clearApiKey, getApiKey, hasApiKey, setApiKey } from '../secrets'
import { logger } from '../logger'
import { GeminiEngine, type GeminiEngineConfig } from './engine'
import { createChatHistory } from './history'
import { SdkGeminiTransport } from './sdk'
import { createUsageMeter, type UsageMeter, type UsageWarning } from './usage'

/**
 * Composição de produção do motor Gemini.
 *
 * Só este arquivo liga `engine` às implementações reais (SDK, safeStorage,
 * store, logger). Os testes constroem o engine com fakes e nunca chegam aqui.
 */

const usageWarningListeners = new Set<(warning: UsageWarning) => void>()

/** Assina o aviso de 80% do teto (o IPC de chat empurra para o renderer). */
export function subscribeUsageWarning(listener: (warning: UsageWarning) => void): () => void {
  usageWarningListeners.add(listener)
  return () => {
    usageWarningListeners.delete(listener)
  }
}

function currentConfig(): GeminiEngineConfig {
  const gemini = getStoreSnapshot().gemini
  return {
    model: gemini.model,
    temperature: gemini.temperature,
    monthlyTokenCap: gemini.monthlyTokenCap
  }
}

let sharedUsage: UsageMeter | null = null

export function getUsageMeter(): UsageMeter {
  if (!sharedUsage) {
    sharedUsage = createUsageMeter({
      store: getPersistentStore(),
      cap: () => currentConfig().monthlyTokenCap,
      onWarning: (warning: UsageWarning) => {
        for (const listener of usageWarningListeners) {
          try {
            listener(warning)
          } catch (err) {
            logger.warn('gemini', 'falha ao emitir aviso de uso', err)
          }
        }
      }
    })
  }
  return sharedUsage
}

let engine: GeminiEngine | null = null

export function createGeminiEngine(): GeminiEngine {
  return new GeminiEngine({
    transport: new SdkGeminiTransport(),
    keys: { getApiKey, hasApiKey, setApiKey, clearApiKey },
    config: currentConfig,
    usage: getUsageMeter(),
    history: createChatHistory({ store: getPersistentStore() }),
    logger,
    defaultLanguage: getStoreSnapshot().ui.language
  })
}

export function getGeminiEngine(): GeminiEngine {
  if (!engine) engine = createGeminiEngine()
  return engine
}

/** Hook de teste/smoke: substitui a instância compartilhada. */
export function setGeminiEngineForTests(next: GeminiEngine | null): void {
  engine = next
}
