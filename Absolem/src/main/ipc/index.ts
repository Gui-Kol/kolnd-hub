import type { IpcContext } from './lifecycle'
import { registerActionsIpc } from './actions'
import { registerAppIpc } from './app'
import { registerAvatarIpc } from './avatar'
import { registerCaptureIpc } from './capture'
import { registerChatIpc } from './chat'
import { registerDiagnosticsIpc } from './diagnostics'
import { registerGeminiIpc } from './gemini'
import { registerMemoryIpc } from './memory'
import { registerOverlayIpc } from './overlay'
import { registerStoreIpc } from './store'
import { registerThemeIpc } from './theme'
import { getGeminiEngine } from '../gemini/instance'
import { ensureMemoryRuntime } from '../memory/instance'
import { ensureVoiceRuntime } from '../voice/instance'
import { ensureCaptureRuntime } from '../capture/instance'
import { ensureActionsRuntime } from '../actions/instance'

export type { IpcContext } from './lifecycle'

/**
 * Ponto único de registro dos módulos IPC.
 *
 * O motor Gemini (task 05) é o único dono do cliente: os canais de chave,
 * streaming e diagnóstico recebem a mesma instância compartilhada.
 */
export function registerIpc(ctx: IpcContext): void {
  registerAppIpc(ctx)
  registerStoreIpc()
  registerOverlayIpc()
  registerAvatarIpc(ctx)
  registerThemeIpc(ctx)
  const engine = getGeminiEngine()
  registerGeminiIpc(engine)
  registerChatIpc(ctx, engine)
  registerDiagnosticsIpc(engine)
  registerMemoryIpc(ensureMemoryRuntime(ctx).service)
  ensureVoiceRuntime(ctx)
  registerCaptureIpc(ensureCaptureRuntime(ctx))
  registerActionsIpc(ctx)
  ensureActionsRuntime(ctx)
}
