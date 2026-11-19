import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  ExternalLink,
  Globe2,
  Loader2,
  MonitorPlay,
  Play,
  Settings2,
  Wifi
} from 'lucide-react'
import type { RemoteModeReason, RemoteStatus } from '../../../shared/remote'
import { KLOUD_WEB_PORT } from '../../../shared/remote'
import { bestRemoteAddress, parseRemoteStatus, zeroTierBadge } from '../lib/remoteAccess'
import { Badge, Button, Modal } from './ui'

interface RemoteHelpModalProps {
  /** Motivo do bloqueio quando o modo remoto não pôde ser ligado. */
  blockedReason?: RemoteModeReason
  /** Estado atual do Kloud Games (o host precisa estar rodando para receber conexão). */
  kloudRunning: boolean
  onStartKloud: () => void
  onOpenSettings: () => void
  onClose: () => void
  onToast?: (msg: string, kind: 'success' | 'error' | 'info') => void
}

const BLOCKED_MESSAGE: Record<RemoteModeReason, string> = {
  'zerotier-missing':
    'O modo remoto precisa do ZeroTier instalado. Instale em Configurações → Acesso remoto e tente de novo.',
  'zerotier-disconnected':
    'O ZeroTier está instalado, mas o serviço está desligado ou nenhuma rede foi ingressada. Abra o ZeroTier, entre na sua rede e tente de novo.',
  'store-unavailable': 'Não foi possível salvar a preferência agora. Tente de novo.',
  invalid: 'Não foi possível alterar o modo remoto.'
}

/**
 * Ajuda do card do Kloud Games: como conectar no Moonlight na mesma rede e de
 * qualquer lugar. O conteúdo reflete o estado REAL lido do main (ZeroTier,
 * interfaces e Kloud Games) — nada de endereço inventado.
 */
export function RemoteHelpModal({
  blockedReason,
  kloudRunning,
  onStartKloud,
  onOpenSettings,
  onClose,
  onToast
}: RemoteHelpModalProps): JSX.Element {
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'zerotier' | 'panel' | 'copy' | null>(null)

  useEffect(() => {
    let alive = true
    window.api
      .remoteStatus()
      .then((raw) => {
        if (!alive) return
        setStatus(parseRemoteStatus(raw))
      })
      .catch(() => {
        // Sem estado: o modal continua útil com as instruções genéricas.
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return (): void => {
      alive = false
    }
  }, [])

  const zerotier = status?.zerotier ?? null
  const badge = zerotier ? zeroTierBadge(zerotier) : { tone: 'neutral' as const, label: 'Lendo…' }
  const remoteAddress = zerotier ? bestRemoteAddress(zerotier) : null
  const localAddress = status?.addresses.lan[0] ?? null

  const run = async (
    kind: 'zerotier' | 'panel' | 'copy',
    task: () => Promise<{ success: boolean; error?: string }>,
    message: string
  ): Promise<void> => {
    if (busy) return
    setBusy(kind)
    try {
      const result = await task()
      if (!result.success) throw new Error(result.error ?? 'Ação indisponível.')
      onToast?.(message, 'info')
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : 'Não foi possível concluir a ação.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      title="Como conectar no Moonlight"
      onClose={onClose}
      className="!max-w-2xl"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() =>
              void run(
                'panel',
                () => window.api.remoteOpenKloudWeb(),
                'Painel do Kloud Games aberto para digitar o PIN.'
              )
            }
            disabled={busy !== null}
          >
            <ExternalLink size={14} aria-hidden="true" /> Abrir painel do Kloud Games
          </Button>
          <Button variant="primary" onClick={onOpenSettings}>
            <Settings2 size={14} aria-hidden="true" /> Abrir Acesso remoto
          </Button>
        </>
      }
    >
      {blockedReason && (
        <div className="mb-4 flex items-start gap-2.5 rounded-control border border-warn-border bg-warn-bg px-4 py-3">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
          <p className="text-[11px] leading-relaxed text-warn">{BLOCKED_MESSAGE[blockedReason]}</p>
        </div>
      )}

      <p className="text-xs leading-relaxed text-ink-secondary">
        O <strong className="text-ink-primary">Kloud Games</strong> é o host e o{' '}
        <strong className="text-ink-primary">Moonlight</strong> é o cliente. Dá para jogar no mesmo
        PC, na mesma rede ou de qualquer lugar — o pareamento é sempre o mesmo: o Moonlight mostra
        um PIN e você digita no painel do Kloud Games.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <section
          aria-labelledby="remote-help-local"
          className="rounded-control border border-[var(--border-subtle)] bg-surface-2 p-4"
        >
          <h3
            id="remote-help-local"
            className="flex items-center gap-2 text-xs font-bold text-ink-primary"
          >
            <Wifi size={14} className="text-accent" aria-hidden="true" /> Na mesma rede (local)
          </h3>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-secondary">
            PC e aparelho no mesmo Wi-Fi/roteador. Menor latência.
          </p>
          <ol className="mt-3 list-decimal space-y-2 pl-4 text-[11px] leading-relaxed text-ink-secondary">
            <li>
              Inicie o Kloud Games
              {!kloudRunning && ' (agora ele está parado — use o botão abaixo)'}.
            </li>
            <li>
              No Moonlight, toque em <strong className="text-ink-primary">Adicionar PC</strong> e
              use o endereço{' '}
              <code className="rounded-sm border border-[var(--border-subtle)] bg-surface-1 px-1 py-0.5 font-mono text-[10.5px] text-accent">
                {localAddress ?? 'IP local do PC'}
              </code>
              .
            </li>
            <li>
              O Moonlight exibe um PIN de 4 dígitos. Abra o painel do Kloud Games (
              <code className="font-mono text-[10.5px]">localhost:{KLOUD_WEB_PORT}</code>) e digite
              o PIN em <strong className="text-ink-primary">PIN</strong>.
            </li>
            <li>Conecte e jogue.</li>
          </ol>
        </section>

        <section
          aria-labelledby="remote-help-remote"
          className="rounded-control border border-[var(--border-subtle)] bg-surface-2 p-4"
        >
          <h3
            id="remote-help-remote"
            className="flex items-center gap-2 text-xs font-bold text-ink-primary"
          >
            <Globe2 size={14} className="text-accent" aria-hidden="true" /> De qualquer lugar
            (remoto)
          </h3>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-secondary">
            Atravessa NAT/CGNAT sem abrir porta no roteador, via ZeroTier (rede privada virtual).
          </p>
          <ol className="mt-3 list-decimal space-y-2 pl-4 text-[11px] leading-relaxed text-ink-secondary">
            <li>
              Instale o <strong className="text-ink-primary">ZeroTier</strong> neste PC e no
              aparelho e ingresse os dois na mesma rede (painel my.zerotier.com).
            </li>
            <li>Deixe o ZeroTier conectado no aparelho antes de abrir o Moonlight.</li>
            <li>
              No Moonlight, adicione um PC com o endereço{' '}
              <code className="rounded-sm border border-[var(--border-subtle)] bg-surface-1 px-1 py-0.5 font-mono text-[10.5px] text-accent">
                {remoteAddress ?? '10.x.y.z'}
              </code>
              {remoteAddress && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="!ml-1 !h-6 !px-1.5 align-middle"
                  onClick={() =>
                    void run(
                      'copy',
                      () => window.api.remoteCopy(remoteAddress),
                      `Endereço copiado: ${remoteAddress}`
                    )
                  }
                  disabled={busy !== null}
                  aria-label="Copiar endereço remoto"
                >
                  <ClipboardCopy size={11} aria-hidden="true" />
                </Button>
              )}
              .
            </li>
            <li>
              Digite o PIN no painel do Kloud Games e conecte. Nenhuma porta do roteador precisa ser
              aberta.
            </li>
          </ol>
        </section>
      </div>

      <div className="mt-4 rounded-control border border-[var(--border-subtle)] bg-surface-1 p-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-ink-secondary">
          <span className="flex items-center gap-2">
            ZeroTier <Badge tone={badge.tone}>{badge.label}</Badge>
          </span>
          <span className="flex items-center gap-2">
            Kloud Games{' '}
            <Badge tone={kloudRunning ? 'success' : 'warning'}>
              {kloudRunning ? 'Em execução' : 'Parado'}
            </Badge>
          </span>
          {loading && (
            <span className="flex items-center gap-1.5 text-ink-tertiary" role="status">
              <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Lendo rede…
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!kloudRunning && (
            <Button size="sm" variant="primary" onClick={onStartKloud}>
              <Play size={12} aria-hidden="true" /> Iniciar Kloud Games
            </Button>
          )}
          {zerotier?.installed ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void run(
                  'zerotier',
                  () => window.api.remoteOpenZeroTier(),
                  'ZeroTier aberto — entre na sua rede.'
                )
              }
              disabled={busy !== null}
            >
              <MonitorPlay size={12} aria-hidden="true" /> Abrir ZeroTier
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={onOpenSettings}>
              <Settings2 size={12} aria-hidden="true" /> Instalar ZeroTier
            </Button>
          )}
          {remoteAddress && (
            <Badge tone="accent">
              <Check size={11} aria-hidden="true" /> {remoteAddress}
            </Badge>
          )}
        </div>
      </div>

      <p className="mt-3 text-[10.5px] leading-relaxed text-ink-tertiary">
        O vídeo, o áudio e o controle do Moonlight usam <strong>UDP</strong> (portas 47998–48002) —
        proxy HTTP (Cloudflare Tunnel, ngrok) não carrega esse tráfego. Por isso o caminho remoto é
        uma VPN mesh, não um túnel web.
      </p>
    </Modal>
  )
}
