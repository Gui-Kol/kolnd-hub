import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  Check,
  ClipboardCopy,
  ExternalLink,
  Globe2,
  Loader2,
  Monitor,
  Network,
  RefreshCw,
  ShieldCheck,
  Wifi
} from 'lucide-react'
import { entranceProps, useReducedMotion } from '../lib/motion'
import {
  bestRemoteAddress,
  closedLocalhostPorts,
  networkKindBadge,
  parseRemoteStatus,
  summarizePorts,
  tailscaleBadge,
  type RemoteTone
} from '../lib/remoteAccess'
import type { ReactNode } from 'react'
import type { RemoteStatus } from '../../../shared/remote'
import { KLOUD_TCP_PORTS, PUBLIC_IP_ENDPOINT } from '../../../shared/remote'
import { Badge, Button, Card, SectionTitle } from './ui'

interface RemoteAccessSettingsProps {
  onToast?: (msg: string, kind: 'success' | 'error' | 'info') => void
}

type Feedback = { kind: 'done' | 'error' | 'info'; message: string }

function formatCheckedAt(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('pt-BR')
}

function toneForText(tone: RemoteTone): string {
  switch (tone) {
    case 'success':
      return 'text-success'
    case 'warning':
      return 'text-warn'
    case 'danger':
      return 'text-danger'
    case 'accent':
      return 'text-accent'
    default:
      return 'text-ink-tertiary'
  }
}

/** Cartão de estado dentro do bloco (Tailscale · Kloud Games · Rede). */
function StatusTile({
  icon,
  title,
  badge,
  children
}: {
  icon: JSX.Element
  title: string
  badge: { tone: RemoteTone; label: string }
  children: ReactNode
}): JSX.Element {
  return (
    <div className="rounded-control border border-[var(--border-subtle)] bg-surface-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-ink-secondary">
          <span aria-hidden="true">{icon}</span>
          <h4 className="text-xs font-bold text-ink-primary">{title}</h4>
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      <div className="mt-3 space-y-1.5 text-[11px] leading-relaxed text-ink-secondary">
        {children}
      </div>
    </div>
  )
}

export function RemoteAccessSettings({ onToast }: RemoteAccessSettingsProps): JSX.Element {
  const reduced = useReducedMotion()
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [action, setAction] = useState<null | 'public-ip' | 'install' | 'open' | 'panel' | 'copy'>(
    null
  )
  const [confirmInstall, setConfirmInstall] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return (): void => {
      mounted.current = false
    }
  }, [])

  const fetchStatus = useCallback(async (): Promise<RemoteStatus> => {
    const parsed = parseRemoteStatus(await window.api.remoteStatus())
    if (!parsed) throw new Error('O Hub devolveu um estado de rede inesperado.')
    return parsed
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const next = await fetchStatus()
      if (!mounted.current) return
      setStatus(next)
      setLoadError(null)
    } catch (err) {
      if (!mounted.current) return
      setLoadError(
        err instanceof Error ? err.message : 'Não foi possível ler o estado da rede agora.'
      )
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [fetchStatus])

  // Carga inicial: o setState acontece nos callbacks da promise (nunca síncrono
  // no corpo do efeito) — regra react-hooks/set-state-in-effect.
  useEffect(() => {
    let alive = true
    fetchStatus()
      .then((next) => {
        if (!alive) return
        setStatus(next)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setLoadError(
          err instanceof Error ? err.message : 'Não foi possível ler o estado da rede agora.'
        )
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return (): void => {
      alive = false
    }
  }, [fetchStatus])

  const notify = (message: string, kind: 'success' | 'error' | 'info'): void => {
    setFeedback({ kind: kind === 'success' ? 'done' : kind, message })
    onToast?.(message, kind)
  }

  const copy = async (text: string): Promise<void> => {
    if (action) return
    setAction('copy')
    try {
      const result = await window.api.remoteCopy(text)
      if (!result.success) throw new Error(result.error ?? 'Não foi possível copiar.')
      notify(`Copiado: ${text}`, 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Não foi possível copiar.', 'error')
    } finally {
      setAction(null)
    }
  }

  const install = async (): Promise<void> => {
    if (action) return
    setAction('install')
    try {
      const result = await window.api.remoteInstallTailscale()
      if (!result.success) throw new Error(result.error ?? 'A instalação falhou.')
      notify(
        result.installedNow
          ? 'Tailscale instalado. Clique em “Abrir Tailscale” e entre com sua conta.'
          : 'O Tailscale já está instalado.',
        'success'
      )
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'A instalação falhou.', 'error')
    } finally {
      setAction(null)
      setConfirmInstall(false)
    }
  }

  const openTailscale = async (): Promise<void> => {
    if (action) return
    setAction('open')
    try {
      const result = await window.api.remoteOpenTailscale()
      if (!result.success) throw new Error(result.error ?? 'Não foi possível abrir o Tailscale.')
      if (result.opened === 'download') {
        notify('Abrimos a página de download do Tailscale no navegador.', 'info')
      } else if (result.opened === 'login') {
        notify('Login do Tailscale iniciado — conclua pelo navegador.', 'info')
      } else {
        notify('Tailscale aberto. Entre com a mesma conta nos aparelhos.', 'info')
      }
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Não foi possível abrir o Tailscale.', 'error')
    } finally {
      setAction(null)
    }
  }

  const openPanel = async (): Promise<void> => {
    if (action) return
    setAction('panel')
    try {
      const result = await window.api.remoteOpenKloudWeb()
      if (!result.success) throw new Error(result.error ?? 'Não foi possível abrir o painel.')
      notify('Painel do Kloud Games aberto no navegador para digitar o PIN.', 'info')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Não foi possível abrir o painel.', 'error')
    } finally {
      setAction(null)
    }
  }

  const checkPublicIp = async (): Promise<void> => {
    if (action) return
    setAction('public-ip')
    try {
      const result = await window.api.remotePublicIp()
      if (!result.success || !result.ip) {
        throw new Error(result.error ?? 'Não foi possível descobrir o IP público.')
      }
      const kind = result.kind ?? 'unknown'
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              publicIp: {
                address: result.ip ?? null,
                checkedAt: result.checkedAt ?? null,
                kind
              }
            }
          : prev
      )
      notify(`Seu IP público é ${result.ip}. ${networkKindBadge(kind).label}.`, 'success')
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'Não foi possível descobrir o IP público.',
        'error'
      )
    } finally {
      setAction(null)
    }
  }

  const ts = status?.tailscale
  const tsBadge = ts ? tailscaleBadge(ts) : { tone: 'neutral' as RemoteTone, label: 'Lendo…' }
  const address = ts ? bestRemoteAddress(ts) : null
  const ports = status ? summarizePorts(status.ports) : null
  const closed = status ? closedLocalhostPorts(status.ports) : []
  const netBadge = networkKindBadge(status?.publicIp.kind ?? 'unknown')
  const checkedAt = formatCheckedAt(status?.publicIp.checkedAt ?? null)

  return (
    <>
      <SectionTitle>Acesso remoto</SectionTitle>

      <motion.div {...entranceProps(reduced, { y: 20 })}>
        <Card className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-accent-muted text-accent">
              <Globe2 size={20} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-ink-primary">Jogar de qualquer lugar</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                O Moonlight transmite vídeo, áudio e controle por <strong>UDP</strong>. Proxy HTTP
                (Cloudflare Tunnel, ngrok) não carrega esse tráfego — por isso o caminho recomendado
                é o <strong>Tailscale</strong>: uma rede privada WireGuard que atravessa NAT e CGNAT
                sem abrir porta no roteador.
              </p>
            </div>
          </div>

          {loading && !status && (
            <p className="mt-5 flex items-center gap-2 text-xs text-ink-secondary" role="status">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Lendo interfaces e
              serviços…
            </p>
          )}

          {loadError && !status && (
            <p className="mt-5 flex items-start gap-2 text-xs text-danger" role="alert">
              <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {loadError}{' '}
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="underline underline-offset-2 hover:text-ink-primary"
                >
                  Tentar de novo
                </button>
              </span>
            </p>
          )}

          {status && ts && (
            <>
              <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                <StatusTile
                  icon={<Network size={16} aria-hidden="true" />}
                  title="Tailscale"
                  badge={tsBadge}
                >
                  {!ts.installed && <p>Não instalado. Instale para criar sua rede privada.</p>}
                  {ts.installed && !ts.connected && (
                    <p>
                      Instalado, mas desconectado
                      {ts.backendState ? ` (${ts.backendState})` : ''}. Abra o Tailscale e entre com
                      sua conta.
                    </p>
                  )}
                  {ts.connected && (
                    <>
                      <p className="text-ink-primary">
                        Endereço para o Moonlight:{' '}
                        <code className="break-all font-mono text-[11px] text-accent">
                          {address ?? '—'}
                        </code>
                      </p>
                      {address && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="!h-7 !px-2"
                          onClick={() => void copy(address)}
                          disabled={action !== null}
                        >
                          <ClipboardCopy size={12} aria-hidden="true" /> Copiar endereço
                        </Button>
                      )}
                      {ts.dnsName && address !== ts.dnsName && (
                        <p className="break-all">MagicDNS: {ts.dnsName}</p>
                      )}
                      {ts.onlinePeers > 0 && (
                        <p>{ts.onlinePeers} aparelho(s) on-line na tailnet.</p>
                      )}
                    </>
                  )}
                  {ts.error && (
                    <p className="break-words text-[10px] text-ink-tertiary">{ts.error}</p>
                  )}
                </StatusTile>

                <StatusTile
                  icon={<ShieldCheck size={16} />}
                  title="Kloud Games"
                  badge={{
                    tone: status.kloud.running
                      ? 'success'
                      : status.kloud.installed
                        ? 'warning'
                        : 'neutral',
                    label: status.kloud.running
                      ? 'Em execução'
                      : status.kloud.installed
                        ? 'Parado'
                        : 'Não instalado'
                  }}
                >
                  {!status.kloud.installed && (
                    <p>Instale o Kloud Games pela primeira execução do Hub.</p>
                  )}
                  {status.kloud.installed && (
                    <p>
                      Portas TCP do Moonlight em localhost:{' '}
                      <strong
                        className={ports && ports.localhostOpen > 0 ? 'text-success' : 'text-warn'}
                      >
                        {ports?.localhostOpen ?? 0} de {KLOUD_TCP_PORTS.length}
                      </strong>{' '}
                      abertas.
                    </p>
                  )}
                  {ts.connected && ports && (
                    <p>
                      No IP da tailnet: <strong>{ports.tailscaleOpen}</strong> de{' '}
                      {KLOUD_TCP_PORTS.length} abertas.
                    </p>
                  )}
                  {status.kloud.installed && closed.length > 0 && (
                    <p className="text-[10px] text-ink-tertiary">
                      Fechadas: {closed.join(', ')} — inicie o Kloud Games pelo Dashboard.
                    </p>
                  )}
                </StatusTile>

                <StatusTile icon={<Wifi size={16} />} title="Rede" badge={netBadge}>
                  <p className="break-all">
                    IP local: <span className="font-mono">{status.addresses.lan[0] ?? '—'}</span>
                  </p>
                  <p className="break-all">
                    IP público:{' '}
                    <span className="font-mono">{status.publicIp.address ?? 'não consultado'}</span>
                  </p>
                  {checkedAt && (
                    <p className="text-[10px] text-ink-tertiary">Consultado em {checkedAt}</p>
                  )}
                  {status.publicIp.kind === 'cgnat' && (
                    <p className={toneForText('warning')}>
                      Sua operadora usa CGNAT: port forward não funciona. Use o Tailscale.
                    </p>
                  )}
                </StatusTile>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                {!ts.installed ? (
                  confirmInstall ? (
                    <>
                      <Button
                        variant="primary"
                        onClick={() => void install()}
                        disabled={action !== null}
                        className="disabled:cursor-wait"
                      >
                        {action === 'install' ? (
                          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                        ) : (
                          <Check size={14} aria-hidden="true" />
                        )}
                        Confirmar instalação (UAC)
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setConfirmInstall(false)}
                        disabled={action !== null}
                      >
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <Button variant="primary" onClick={() => setConfirmInstall(true)}>
                      <ExternalLink size={14} aria-hidden="true" /> Instalar Tailscale
                    </Button>
                  )
                ) : (
                  <Button
                    variant="primary"
                    onClick={() => void openTailscale()}
                    disabled={action !== null}
                    className="disabled:cursor-wait"
                  >
                    {action === 'open' ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Monitor size={14} aria-hidden="true" />
                    )}
                    {ts.connected ? 'Abrir Tailscale' : 'Conectar Tailscale'}
                  </Button>
                )}

                <Button
                  variant="secondary"
                  onClick={() => void openPanel()}
                  disabled={action !== null}
                >
                  <ExternalLink size={14} aria-hidden="true" /> Abrir painel do Kloud Games
                </Button>

                <Button
                  variant="ghost"
                  onClick={() => void refresh()}
                  disabled={action !== null || loading}
                  className="disabled:cursor-wait"
                >
                  <RefreshCw
                    size={14}
                    className={loading ? 'animate-spin' : undefined}
                    aria-hidden="true"
                  />
                  Atualizar
                </Button>
              </div>

              {confirmInstall && (
                <div className="mt-3 rounded-control border border-warn-border bg-warn-bg px-4 py-3">
                  <p className="text-[11px] leading-relaxed text-warn">
                    A instalação usa o <strong>winget</strong> e abre o Windows UAC (precisa de
                    administrador). O Tailscale é um cliente oficial, BSD-3-Clause. Nada é
                    configurado sem você entrar com a sua conta depois.
                  </p>
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4">
                <p className="max-w-xl text-[11px] leading-relaxed text-ink-tertiary">
                  O IP público só é consultado quando você clicar, em{' '}
                  <code className="font-mono">{PUBLIC_IP_ENDPOINT}</code>. O Hub guarda apenas o
                  resultado no seu <code className="font-mono">config.json</code> — nenhuma
                  credencial do Tailscale passa por aqui.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void checkPublicIp()}
                  disabled={action !== null}
                  className="shrink-0 disabled:cursor-wait"
                >
                  {action === 'public-ip' ? (
                    <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Wifi size={12} aria-hidden="true" />
                  )}
                  Descobrir meu IP público
                </Button>
              </div>

              <ol className="mt-5 list-decimal space-y-1.5 pl-5 text-[11px] leading-relaxed text-ink-secondary">
                <li>
                  Instale o Tailscale <strong>neste PC</strong> e no aparelho onde vai jogar
                  (celular/notebook/TV), entrando com a mesma conta.
                </li>
                <li>Mantenha o Kloud Games em execução (Dashboard do Hub).</li>
                <li>
                  No Moonlight, adicione um PC com o endereço{' '}
                  <code className="font-mono text-ink-primary">{address ?? '100.x.y.z'}</code>.
                </li>
                <li>
                  O Moonlight mostra um PIN. Abra o painel do Kloud Games e digite o PIN para
                  parear.
                </li>
                <li>
                  Jogue de qualquer rede — nenhuma porta do roteador precisa ser aberta. No celular,
                  deixe a VPN do Tailscale ativa antes de abrir o Moonlight.
                </li>
              </ol>
            </>
          )}

          {feedback && (
            <p
              className={`mt-4 flex items-start gap-1.5 break-words text-[11px] leading-relaxed ${
                feedback.kind === 'done'
                  ? 'text-success'
                  : feedback.kind === 'error'
                    ? 'text-danger'
                    : 'text-ink-secondary'
              }`}
              role="status"
              aria-live="polite"
            >
              {feedback.kind === 'done' && (
                <Check size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              )}
              <span>{feedback.message}</span>
            </p>
          )}
        </Card>
      </motion.div>
    </>
  )
}
