import type { IpcContext } from './lifecycle'
import { registerActionsIpc } from './actions'
import { registerAppIpc } from './app'
import { registerAvatarIpc } from './avatar'
import { registerCaptureIpc } from './capture'
import { registerChatIpc } from './chat'
import { registerDiagnosticsIpc } from './diagnostics'
import { registerGeminiIpc } from './gemini'
import { registerHistoryIpc } from './history'
import { registerMemoryIpc } from './memory'
import { registerOverlayIpc } from './overlay'
import { registerSearchIpc } from './search'
import { registerStoreIpc } from './store'
import { registerThemeIpc } from './theme'
import { getGeminiEngine, getUsageMeter } from '../gemini/instance'
import { ensureMemoryRuntime, getMemoryRuntime } from '../memory/instance'
import { ensureSearchRuntime } from '../search/instance'
import { ensureVoiceRuntime, getVoiceController } from '../voice/instance'
import { app } from 'electron'
import { ensureCaptureRuntime } from '../capture/instance'
import { ensureActionsRuntime } from '../actions/instance'
import { resolveHubVersion } from '../../shared/version'

export type { IpcContext } from './lifecycle'

/** Um `ipcMain.handle` por canal: re-registrar acumularia handlers no Electron. */
let registered = false

/**
 * Ponto único de registro dos módulos IPC.
 *
 * O motor Gemini (task 05) é o único dono do cliente: os canais de chave,
 * streaming e diagnóstico recebem a mesma instância compartilhada.
 * A função é idempotente para que um remount/reload do main não registre os
 * mesmos canais duas vezes.
 */
export function registerIpc(ctx: IpcContext): void {
  if (registered) return
  registered = true
  registerAppIpc(ctx)
  registerStoreIpc()
  registerOverlayIpc(ctx)
  registerAvatarIpc(ctx)
  registerThemeIpc(ctx)
  const engine = getGeminiEngine()
  registerGeminiIpc(engine)
  registerChatIpc(ctx, engine)
  registerDiagnosticsIpc(engine, {
    getAppInfo: () => ({
      name: app.getName(),
      version: resolveHubVersion(process.env, app.getVersion()),
      platform: process.platform
    }),
    getRuntimeVersions: () => ({
      electron: process.versions.electron ?? '',
      chromium: process.versions.chrome ?? '',
      node: process.versions.node ?? ''
    }),
    getLiveModel: () => ctx.getStoreSnapshot().gemini.liveModel,
    getOverlayFps: async () => {
      const overlay = ctx.getOverlayWindow()
      if (!overlay || overlay.isDestroyed()) return null
      const metrics = await overlay.webContents.executeJavaScript(
        'window.__absolemAvatarMetrics ? window.__absolemAvatarMetrics() : null'
      )
      const fps =
        metrics && typeof metrics === 'object' && typeof metrics.fps === 'number'
          ? metrics.fps
          : null
      return fps
    },
    getMicrophone: () => {
      const status = getVoiceController()?.status()
      return {
        state: status?.state ?? 'off',
        consentGranted: status?.consentGranted ?? false
      }
    },
    getMemory: () => {
      try {
        const stats = ensureMemoryRuntime(ctx).service.stats()
        return { total: stats.total, approxBytes: stats.approxBytes }
      } catch {
        return null
      }
    }
  })
  registerHistoryIpc({
    getTurns: () => {
      // Turnos de texto vêm de `chat.turns`; a voz grava em `turns` (SQLite).
      const turns = ctx.getStoreSnapshot().chat.turns.map((turn) => ({ ...turn }))
      const voiceTurns = getMemoryRuntime()?.recentTurns(200) ?? []
      for (const turn of voiceTurns) {
        turns.push({
          role: turn.role,
          text: turn.content,
          at: turn.at,
          interrupted: turn.interrupted
        })
      }
      return turns.sort((a, b) => a.at - b.at)
    },
    memoryEnabled: () => ctx.getStoreSnapshot().memory.enabled
  })
  registerMemoryIpc(ensureMemoryRuntime(ctx).service)
  registerSearchIpc(
    ensureSearchRuntime(ctx, {
      checkBudget: () => getUsageMeter().checkBudget()
    })
  )
  ensureVoiceRuntime(ctx)
  registerCaptureIpc(ensureCaptureRuntime(ctx))
  registerActionsIpc(ctx)
  ensureActionsRuntime(ctx)
}
