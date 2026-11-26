// Página Chat — o Go Live (golive.nemtudo.me) rodando dentro do Hub.
//
// O <webview> é criado imperativamente (e não via JSX) porque ele é um guest
// do Chromium: `partition` e `src` precisam estar definidos antes de anexar ao
// DOM, e o cleanup remove o elemento (sair da página encerra o guest). Fora do
// `AnimatePresence` do App: transform/filter no ancestral quebram a composição
// do webview. O main valida o src e as permissões (src/main/chat.ts).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WebviewTag } from 'electron'
import { ArrowLeft, Home, RotateCw } from 'lucide-react'
import { Button, ErrorState, Spinner } from './ui'
import { CHAT_PARTITION, CHAT_URL } from '../../../shared/chat'

export function Chat(): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<WebviewTag | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [canGoBack, setCanGoBack] = useState(false)

  const syncHistory = useCallback((): void => {
    try {
      setCanGoBack(viewRef.current?.canGoBack() ?? false)
    } catch {
      // Ainda não anexado ao DOM: o próximo evento de navegação atualiza.
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // StrictMode monta/desmonta duas vezes no dev: remove qualquer guest
    // remanescente antes de criar o novo (evita webviews duplicados).
    host.querySelectorAll('webview').forEach((el) => el.remove())

    const view = document.createElement('webview') as WebviewTag
    view.setAttribute('data-testid', 'chat-webview')
    view.setAttribute('partition', CHAT_PARTITION)
    view.setAttribute('src', CHAT_URL)
    view.className = 'h-full w-full'

    const handleStartLoading = (): void => {
      setLoading(true)
      setLoadError(null)
    }
    const handleStopLoading = (): void => {
      setLoading(false)
      syncHistory()
    }
    const handleNavigate = (): void => {
      syncHistory()
    }
    const handleFailLoad = (event: Electron.DidFailLoadEvent): void => {
      // -3 = ERR_ABORTED (navegação cancelada/substituída), não é falha real.
      if (event.errorCode === -3 || !event.isMainFrame) return
      setLoading(false)
      setLoadError('Não foi possível carregar o Go Live. Verifique sua conexão e tente novamente.')
    }

    view.addEventListener('did-start-loading', handleStartLoading)
    view.addEventListener('did-stop-loading', handleStopLoading)
    view.addEventListener('did-navigate', handleNavigate)
    view.addEventListener('did-navigate-in-page', handleNavigate)
    view.addEventListener('did-fail-load', handleFailLoad)

    viewRef.current = view
    host.appendChild(view)
    syncHistory()

    return () => {
      view.removeEventListener('did-start-loading', handleStartLoading)
      view.removeEventListener('did-stop-loading', handleStopLoading)
      view.removeEventListener('did-navigate', handleNavigate)
      view.removeEventListener('did-navigate-in-page', handleNavigate)
      view.removeEventListener('did-fail-load', handleFailLoad)
      view.remove()
      viewRef.current = null
    }
  }, [syncHistory])

  const goBack = (): void => {
    const view = viewRef.current
    if (!view) return
    try {
      if (view.canGoBack()) view.goBack()
    } catch {
      // Guest fora do DOM: nada a fazer.
    }
  }

  const reload = (): void => {
    try {
      viewRef.current?.reload()
    } catch {
      // Guest fora do DOM: nada a fazer.
    }
  }

  const goHome = (): void => {
    try {
      void viewRef.current?.loadURL(CHAT_URL).catch(() => {})
    } catch {
      // Guest fora do DOM: nada a fazer.
    }
  }

  return (
    <div data-testid="chat-root" className="flex h-full min-h-0 w-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-ink-primary">Chat</h1>
          <p className="text-xs text-ink-tertiary">Grupos e salas do Go Live</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={goBack} disabled={!canGoBack}>
            <ArrowLeft size={14} aria-hidden="true" />
            Voltar
          </Button>
          <Button size="sm" variant="ghost" onClick={reload}>
            <RotateCw size={14} aria-hidden="true" />
            Recarregar
          </Button>
          <Button size="sm" variant="ghost" onClick={goHome}>
            <Home size={14} aria-hidden="true" />
            Início
          </Button>
        </div>
      </div>

      <div ref={hostRef} className="relative flex-1 min-h-0 w-full h-full">
        {loadError && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-1 p-6">
            <ErrorState
              title="Não foi possível abrir o Chat"
              message={loadError}
              onRetry={reload}
            />
          </div>
        )}

        {loading && !loadError && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface-1">
            <Spinner size={28} label="Carregando o Go Live" />
            <p className="text-sm text-ink-secondary">Carregando o Go Live…</p>
          </div>
        )}
      </div>
    </div>
  )
}
