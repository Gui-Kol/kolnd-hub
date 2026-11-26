import type { IpcContext } from './lifecycle'
import { registerAppIpc } from './app'
import { registerAvatarIpc } from './avatar'
import { registerChatIpc } from './chat'
import { registerDiagnosticsIpc } from './diagnostics'
import { registerGeminiIpc } from './gemini'
import { registerOverlayIpc } from './overlay'
import { registerThemeIpc } from './theme'
import { getGeminiEngine } from '../gemini/instance'
import { ensureVoiceRuntime } from '../voice/instance'

export type { IpcContext } from './lifecycle'

/**
 * Ponto único de registro dos módulos IPC.
 *
 * O motor Gemini (task 05) é o único dono do cliente: os canais de chave,
 * streaming e diagnóstico recebem a mesma instância compartilhada.
 */
export function registerIpc(ctx: IpcContext): void {
  registerAppIpc(ctx)
  registerOverlayIpc()
  registerAvatarIpc(ctx)
  registerThemeIpc(ctx)
  const engine = getGeminiEngine()
  registerGeminiIpc(engine)
  registerChatIpc(ctx, engine)
  registerDiagnosticsIpc(engine)
  ensureVoiceRuntime(ctx)
}
