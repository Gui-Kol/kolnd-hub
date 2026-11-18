import { useCallback, useEffect, useState } from 'react'
import { ArrowUpCircle, Download, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from './ui'
import { releaseInstallBlocker } from '../../../shared/updates'
import type { ReleaseInfo, UpdateProgress } from '../../../shared/updates'

interface UpdateBannerProps {
  release: ReleaseInfo
  /** `false` em dev/portable: a UI cai para "abrir a página do release". */
  canAutoInstall: boolean
  /** "Depois": some só nesta sessão; a próxima abertura avisa de novo. */
  onDismiss: () => void
}

type Phase = 'idle' | 'downloading' | 'installing' | 'error'

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const mb = bytes / (1024 * 1024)
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`
}

/**
 * Faixa fixa sob a topbar avisando de uma release nova no GitHub.
 *
 * O download e a execução do instalador acontecem no main (`updates:install`);
 * aqui só refletimos o progresso (`update:progress`) e, quando o Hub vai
 * encerrar para o Setup substituir os arquivos, mostramos o aviso final.
 */
export function UpdateBanner({
  release,
  canAutoInstall,
  onDismiss
}: UpdateBannerProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Sem hash SHA-256 publicado o main não instala (ver `isReleaseInstallable`);
  // a nota precisa ser a da RELEASE, não a de "build não instalado".
  const blocker = releaseInstallBlocker(release)
  const canInstallNow = canAutoInstall && blocker === null
  const busy = phase === 'downloading' || phase === 'installing'

  useEffect(() => {
    return window.api.onUpdateProgress((next) => setProgress(next))
  }, [])

  const openReleasePage = useCallback((): void => {
    void window.api.openExternal(release.pageUrl)
  }, [release.pageUrl])

  const handleInstall = useCallback(async (): Promise<void> => {
    if (!canInstallNow) {
      openReleasePage()
      return
    }

    setError(null)
    setPhase('downloading')
    setProgress({ received: 0, bytesTotal: release.installer?.size ?? 0, percent: 0 })

    try {
      const result = await window.api.installUpdate(release.id)
      if (result.cancelled) {
        setProgress(null)
        setPhase('idle')
        return
      }
      if (!result.ok) {
        setPhase('error')
        setError(result.error ?? 'Não foi possível baixar a atualização.')
        return
      }
      setPhase('installing')
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : 'Não foi possível baixar a atualização.')
    }
  }, [canInstallNow, openReleasePage, release.id, release.installer?.size])

  const percent = progress ? Math.max(0, Math.min(100, progress.percent)) : 0
  const totalLabel = progress ? formatSize(progress.bytesTotal) : ''

  let detail: string
  if (phase === 'downloading') {
    detail = `Baixando instalador${totalLabel ? ` (${totalLabel})` : ''}… ${percent}%`
  } else if (phase === 'installing') {
    detail = 'Instalador aberto — o Hub vai fechar para concluir. Abra o Hub de novo em seguida.'
  } else if (phase === 'error') {
    detail = error ?? 'Falha ao baixar a atualização.'
  } else {
    detail = canInstallNow
      ? 'Baixe e instale por cima da versão atual — seus dados e configurações são preservados.'
      : (blocker ??
        'Este build não pode se atualizar sozinho. Abra a página do release para baixar o instalador.')
  }

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-accent-border bg-accent-muted px-4 py-2.5"
      data-testid="update-banner"
    >
      <ArrowUpCircle size={20} className="shrink-0 text-accent" aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-[12px] font-semibold text-ink-primary">
          <span role="status" aria-live="polite">
            Nova atualização disponível
          </span>
          <span className="rounded-pill border border-accent-border bg-surface-1 px-2 py-0.5 font-mono text-[10px] font-bold text-accent">
            {release.tag}
          </span>
        </p>
        <p
          className={`mt-0.5 text-[10.5px] leading-relaxed ${
            phase === 'error' ? 'text-danger' : 'text-ink-secondary'
          }`}
          role={phase === 'error' ? 'alert' : undefined}
        >
          {detail}
        </p>
        {phase === 'downloading' && (
          <div
            className="mt-1.5 h-1 w-full max-w-md overflow-hidden rounded-pill bg-surface-2"
            role="progressbar"
            aria-label="Progresso do download da atualização"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div
              className="h-full bg-accent transition-all duration-2"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="sm" onClick={openReleasePage} disabled={busy}>
          <ExternalLink size={13} aria-hidden="true" />
          Ver no GitHub
        </Button>

        {phase !== 'installing' && (
          <Button variant="primary" size="sm" onClick={() => void handleInstall()} disabled={busy}>
            {busy ? (
              <Loader2 size={13} className="animate-spin" aria-hidden="true" />
            ) : (
              <Download size={13} aria-hidden="true" />
            )}
            {phase === 'downloading'
              ? `Baixando… ${percent}%`
              : phase === 'error'
                ? 'Tentar novamente'
                : canInstallNow
                  ? 'Atualizar agora'
                  : 'Abrir página do release'}
          </Button>
        )}

        {phase === 'downloading' ? (
          <Button variant="secondary" size="sm" onClick={() => void window.api.cancelUpdate()}>
            Cancelar
          </Button>
        ) : (
          phase !== 'installing' && (
            <Button variant="secondary" size="sm" onClick={onDismiss} disabled={busy}>
              Depois
            </Button>
          )
        )}
      </div>
    </div>
  )
}
