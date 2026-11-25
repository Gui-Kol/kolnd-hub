import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  Download,
  ExternalLink,
  Loader2,
  Monitor,
  Play,
  Power,
  PowerOff,
  Settings2,
  Smartphone
} from 'lucide-react'
import type { RemoteModeReason, RemoteStatus } from '../../../shared/remote'
import { KLOUD_WEB_PORT, ZEROTIER_DOWNLOAD_URL } from '../../../shared/remote'
import {
  bestRemoteAddress,
  buildAddressSummary,
  parseRemoteStatus,
  zeroTierBadge
} from '../lib/remoteAccess'
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

type TabId = 'pc' | 'mobile'
type Busy = 'install' | 'open' | 'close' | 'panel' | 'copy' | null

const BLOCKED_MESSAGE: Record<RemoteModeReason, string> = {
  'zerotier-missing':
    'O ZeroTier ainda não está instalado. Use o botão Instalar ZeroTier aqui mesmo — o Hub baixa a versão mais recente para você.',
  'zerotier-disconnected':
    'O ZeroTier está instalado, mas ainda não está conectado a uma rede. Siga os passos abaixo; é rápido.',
  'store-unavailable': 'Não foi possível salvar a preferência agora. Tente de novo.',
  invalid: 'Não foi possível alterar o modo remoto.'
}

const TABS: Array<{ id: TabId; label: string; icon: JSX.Element }> = [
  { id: 'pc', label: 'No PC (este computador)', icon: <Monitor size={15} aria-hidden="true" /> },
  { id: 'mobile', label: 'No celular', icon: <Smartphone size={15} aria-hidden="true" /> }
]

/** Botão pequeno de copiar com nome acessível previsível para os testes. */
function CopyButton({
  label,
  value,
  disabled,
  onCopy
}: {
  label: string
  value: string | null
  disabled: boolean
  onCopy: (label: string, text: string) => void
}): JSX.Element | null {
  if (!value) return null
  return (
    <Button
      size="sm"
      variant="ghost"
      className="!h-6 !px-1.5 align-middle"
      onClick={() => onCopy(label, value)}
      disabled={disabled}
      aria-label={`Copiar ${label.toLowerCase()}`}
      title={`Copiar ${label.toLowerCase()}`}
    >
      <ClipboardCopy size={11} aria-hidden="true" />
    </Button>
  )
}

/**
 * Tutorial do card do Kloud Games: como conectar no Moonlight pelo PC e pelo
 * celular, com o estado REAL do ZeroTier (serviço/GUI e rede), abrir/fechar
 * com UAC só no clique e bloco de endereços com copiar. Nada de endereço
 * inventado: valor ausente vira dica.
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
  const [tab, setTab] = useState<TabId>('pc')
  const [busy, setBusy] = useState<Busy>(null)

  useEffect(() => {
    let alive = true
    window.api
      .remoteStatus()
      .then((raw) => {
        if (!alive) return
        setStatus(parseRemoteStatus(raw))
      })
      .catch(() => {
        // Sem estado: o tutorial continua útil com os passos genéricos.
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return (): void => {
      alive = false
    }
  }, [])

  const refresh = async (): Promise<void> => {
    try {
      const parsed = parseRemoteStatus(await window.api.remoteStatus())
      if (parsed) setStatus(parsed)
    } catch {
      // Mantém o último estado conhecido.
    }
  }

  const zerotier = status?.zerotier ?? null
  const badge = zerotier ? zeroTierBadge(zerotier) : { tone: 'neutral' as const, label: 'Lendo…' }
  const remoteAddress = zerotier ? bestRemoteAddress(zerotier) : null
  const summary = status ? buildAddressSummary(status) : null
  const localAddress = summary?.lanIp ?? null
  const canOpen = !zerotier || zerotier.service !== 'running' || !zerotier.uiOpen
  const canClose = zerotier?.service === 'running'

  const notifyError = (err: unknown, fallback: string): void => {
    onToast?.(err instanceof Error ? err.message : fallback, 'error')
  }

  const install = async (): Promise<void> => {
    if (busy) return
    setBusy('install')
    try {
      const result = await window.api.remoteInstallZeroTier()
      if (!result.success) throw new Error(result.error ?? 'A instalação falhou.')
      onToast?.(
        result.installedNow
          ? 'ZeroTier instalado. Agora siga o passo 2 para entrar na sua rede.'
          : 'O ZeroTier já está instalado.',
        'success'
      )
      await refresh()
    } catch (err) {
      notifyError(err, 'Não foi possível instalar o ZeroTier.')
    } finally {
      setBusy(null)
    }
  }

  const setPower = async (open: boolean): Promise<void> => {
    if (busy) return
    setBusy(open ? 'open' : 'close')
    try {
      const result = await window.api.remoteSetZeroTierOpen(open)
      if (result.info) {
        setStatus((prev) => (prev ? { ...prev, zerotier: result.info! } : prev))
      }
      if (!result.success) throw new Error(result.error ?? 'Não foi possível alterar o ZeroTier.')
      onToast?.(
        open
          ? 'ZeroTier aberto. Se a janela não aparecer, procure o ícone perto do relógio.'
          : 'ZeroTier fechado. O acesso remoto fica indisponível até abrir de novo.',
        'info'
      )
      await refresh()
    } catch (err) {
      notifyError(err, 'Não foi possível alterar o ZeroTier.')
    } finally {
      setBusy(null)
    }
  }

  const openPanel = async (): Promise<void> => {
    if (busy) return
    setBusy('panel')
    try {
      const result = await window.api.remoteOpenKloudWeb()
      if (!result.success) throw new Error(result.error ?? 'Não foi possível abrir o painel.')
      onToast?.('Painel do Kloud Games aberto para digitar o PIN.', 'info')
    } catch (err) {
      notifyError(err, 'Não foi possível abrir o painel.')
    } finally {
      setBusy(null)
    }
  }

  const copy = async (label: string, text: string): Promise<void> => {
    if (busy) return
    setBusy('copy')
    try {
      const result = await window.api.remoteCopy(text)
      if (!result.success) throw new Error(result.error ?? 'Não foi possível copiar.')
      onToast?.(`${label} copiado: ${text}`, 'success')
    } catch (err) {
      notifyError(err, 'Não foi possível copiar.')
    } finally {
      setBusy(null)
    }
  }

  const copyAll = (): void => {
    if (!summary?.text) return
    void copy('Endereços', summary.text)
  }

  const networkId = summary?.networkId ?? null

  return (
    <Modal
      title="Como conectar no Moonlight"
      onClose={onClose}
      className="!max-w-3xl"
      footer={
        <>
          <Button variant="secondary" onClick={() => void openPanel()} disabled={busy !== null}>
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

      {/* Estado do ZeroTier + abrir/fechar/instalar */}
      <div className="rounded-control border border-[var(--border-subtle)] bg-surface-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-bold text-ink-primary">ZeroTier</span>
            <Badge tone={badge.tone}>{badge.label}</Badge>
            {loading && (
              <span
                className="flex items-center gap-1.5 text-[11px] text-ink-tertiary"
                role="status"
              >
                <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Lendo…
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!zerotier?.installed ? (
              <Button
                size="sm"
                variant="primary"
                onClick={() => void install()}
                disabled={busy !== null}
              >
                {busy === 'install' ? (
                  <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Download size={12} aria-hidden="true" />
                )}
                Instalar ZeroTier
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void setPower(true)}
                  disabled={busy !== null || !canOpen}
                  title={
                    canOpen
                      ? 'Liga o serviço do ZeroTier e abre a janela oficial.'
                      : 'O ZeroTier já está aberto.'
                  }
                >
                  {busy === 'open' ? (
                    <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Power size={12} aria-hidden="true" />
                  )}
                  Abrir ZeroTier
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void setPower(false)}
                  disabled={busy !== null || !canClose}
                  title="Fecha a janela e o serviço do ZeroTier. O acesso remoto cai até você abrir de novo."
                >
                  {busy === 'close' ? (
                    <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <PowerOff size={12} aria-hidden="true" />
                  )}
                  Fechar ZeroTier
                </Button>
              </>
            )}
          </div>
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed text-ink-tertiary">
          Fechar o ZeroTier derruba a conexão de quem está jogando de fora — abra de novo para
          receber alguém.
        </p>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-secondary">
        O <strong className="text-ink-primary">Kloud Games</strong> fica neste PC e o{' '}
        <strong className="text-ink-primary">Moonlight</strong> é o app que assiste e joga. O
        pareamento é sempre igual: o Moonlight mostra um PIN e você digita no painel do Kloud Games.
      </p>

      {/* Abas PC / celular */}
      <div
        role="tablist"
        aria-label="Onde você vai jogar"
        className="mt-4 flex flex-col gap-1 rounded-control border border-[var(--border-subtle)] bg-surface-1 p-1 sm:flex-row"
      >
        {TABS.map(({ id, label, icon }) => {
          const active = tab === id
          return (
            <button
              key={id}
              role="tab"
              id={`remote-tab-${id}`}
              aria-selected={active}
              aria-controls={`remote-panel-${id}`}
              onClick={() => setTab(id)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault()
                  setTab(id === 'pc' ? 'mobile' : 'pc')
                }
              }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-control border px-4 py-2 text-xs font-semibold transition-colors duration-2 ${
                active
                  ? 'border-accent-border bg-accent-muted text-accent'
                  : 'border-transparent text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'
              }`}
            >
              {icon}
              {label}
            </button>
          )
        })}
      </div>

      {tab === 'pc' && (
        <section
          role="tabpanel"
          id="remote-panel-pc"
          aria-labelledby="remote-tab-pc"
          className="mt-4 rounded-control border border-[var(--border-subtle)] bg-surface-2 p-4"
        >
          <h3 className="text-xs font-bold text-ink-primary">
            Jogar de outro computador ou notebook
          </h3>
          <ol className="mt-3 list-decimal space-y-2.5 pl-4 text-[11px] leading-relaxed text-ink-secondary">
            <li>
              Deixe o ZeroTier <strong className="text-ink-primary">aberto</strong> neste PC pelo
              botão acima. Se ainda não tem, clique em Instalar ZeroTier.
            </li>
            <li>
              No ícone do ZeroTier perto do relógio, escolha{' '}
              <strong className="text-ink-primary">Join Network</strong> (entrar em uma rede) e cole
              o <strong className="text-ink-primary">ID da rede</strong>:
              <br />
              <code className="mt-1 inline-block break-all rounded-sm border border-[var(--border-subtle)] bg-surface-1 px-1.5 py-0.5 font-mono text-[10.5px] text-accent">
                {networkId ?? 'abra o ZeroTier e ingresse na rede para aparecer'}
              </code>
              <CopyButton
                label="ID da rede"
                value={networkId}
                disabled={busy !== null}
                onCopy={(label, text) => void copy(label, text)}
              />
            </li>
            <li>
              Em <strong className="text-ink-primary">my.zerotier.com</strong>, abra a sua rede e
              marque a caixa do aparelho em <strong className="text-ink-primary">Members</strong>{' '}
              para autorizá-lo.
            </li>
            <li>
              Inicie o Kloud Games
              {!kloudRunning && ' (agora ele está parado — use o botão abaixo)'}.
              {!kloudRunning && (
                <span className="ml-1 inline-block align-middle">
                  <Button size="sm" variant="ghost" className="!h-6 !px-1.5" onClick={onStartKloud}>
                    <Play size={11} aria-hidden="true" /> Iniciar Kloud Games
                  </Button>
                </span>
              )}
            </li>
            <li>
              No Moonlight do outro aparelho, toque em{' '}
              <strong className="text-ink-primary">Adicionar PC</strong> e digite o{' '}
              <strong className="text-ink-primary">IP do ZeroTier</strong>:
              <br />
              <code className="mt-1 inline-block break-all rounded-sm border border-[var(--border-subtle)] bg-surface-1 px-1.5 py-0.5 font-mono text-[10.5px] text-accent">
                {remoteAddress ?? 'abra o ZeroTier para aparecer'}
              </code>
              <CopyButton
                label="IP do ZeroTier"
                value={remoteAddress}
                disabled={busy !== null}
                onCopy={(label, text) => void copy(label, text)}
              />
            </li>
            <li>
              O Moonlight mostra um PIN de 4 dígitos. Abra o painel do Kloud Games (
              <code className="font-mono text-[10.5px]">localhost:{KLOUD_WEB_PORT}</code>) e digite
              o PIN em <strong className="text-ink-primary">PIN</strong>. Conecte e jogue.
            </li>
          </ol>
        </section>
      )}

      {tab === 'mobile' && (
        <section
          role="tabpanel"
          id="remote-panel-mobile"
          aria-labelledby="remote-tab-mobile"
          className="mt-4 rounded-control border border-[var(--border-subtle)] bg-surface-2 p-4"
        >
          <h3 className="text-xs font-bold text-ink-primary">Jogar no celular ou tablet</h3>
          <ol className="mt-3 list-decimal space-y-2.5 pl-4 text-[11px] leading-relaxed text-ink-secondary">
            <li>
              Instale o app <strong className="text-ink-primary">ZeroTier One</strong> no celular
              (Play Store ou App Store).{' '}
              <Button
                size="sm"
                variant="ghost"
                className="!h-6 !px-1.5 align-middle"
                onClick={() => void window.api.openExternal(ZEROTIER_DOWNLOAD_URL)}
              >
                <ExternalLink size={11} aria-hidden="true" /> Ver download
              </Button>
            </li>
            <li>
              Abra o app, toque em <strong className="text-ink-primary">+</strong> e escolha{' '}
              <strong className="text-ink-primary">Adicionar rede</strong>.
            </li>
            <li>
              Cole o <strong className="text-ink-primary">ID da rede</strong>:
              <br />
              <code className="mt-1 inline-block break-all rounded-sm border border-[var(--border-subtle)] bg-surface-1 px-1.5 py-0.5 font-mono text-[10.5px] text-accent">
                {networkId ?? 'abra o ZeroTier neste PC para aparecer'}
              </code>
              <CopyButton
                label="ID da rede"
                value={networkId}
                disabled={busy !== null}
                onCopy={(label, text) => void copy(label, text)}
              />
            </li>
            <li>
              Ligue a chave ao lado da rede e autorize o celular em{' '}
              <strong className="text-ink-primary">my.zerotier.com</strong> →{' '}
              <strong className="text-ink-primary">Members</strong>.
            </li>
            <li>
              Instale o <strong className="text-ink-primary">Moonlight</strong> no celular (mesma
              loja de apps).
            </li>
            <li>
              No Moonlight, toque em <strong className="text-ink-primary">Adicionar PC</strong> e
              digite o <strong className="text-ink-primary">IP do ZeroTier</strong>:
              <br />
              <code className="mt-1 inline-block break-all rounded-sm border border-[var(--border-subtle)] bg-surface-1 px-1.5 py-0.5 font-mono text-[10.5px] text-accent">
                {remoteAddress ?? 'abra o ZeroTier neste PC para aparecer'}
              </code>
              <CopyButton
                label="IP do ZeroTier"
                value={remoteAddress}
                disabled={busy !== null}
                onCopy={(label, text) => void copy(label, text)}
              />
            </li>
            <li>
              Conecte e digite o PIN no painel do Kloud Games (
              <code className="font-mono text-[10.5px]">localhost:{KLOUD_WEB_PORT}</code> aberto
              neste PC).
            </li>
          </ol>
        </section>
      )}

      {/* Bloco de endereços com copiar */}
      <div className="mt-4 rounded-control border border-[var(--border-subtle)] bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-bold text-ink-primary">Endereços</h3>
          <Button
            size="sm"
            variant="secondary"
            onClick={copyAll}
            disabled={busy !== null || !summary?.text}
            aria-label="Copiar tudo"
          >
            <ClipboardCopy size={12} aria-hidden="true" /> Copiar tudo
          </Button>
        </div>

        <dl className="mt-3 space-y-2">
          {[
            {
              label: 'IP do ZeroTier',
              value: summary?.zerotierIp ?? null,
              hint: 'abra o ZeroTier e entre na rede'
            },
            {
              label: 'ID da rede',
              value: networkId,
              hint: 'ingresse na rede no ZeroTier'
            },
            {
              label: 'IP local',
              value: localAddress,
              hint: 'sem rede local visível'
            }
          ].map((row) => (
            <div key={row.label} className="flex flex-wrap items-center gap-2">
              <dt className="w-32 shrink-0 text-[11px] text-ink-secondary">{row.label}</dt>
              <dd className="flex min-w-0 flex-1 items-center gap-1.5">
                <code className="break-all font-mono text-[11px] text-ink-primary">
                  {row.value ?? '—'}
                </code>
                {!row.value && <span className="text-[10px] text-ink-tertiary">{row.hint}</span>}
                <CopyButton
                  label={row.label}
                  value={row.value}
                  disabled={busy !== null}
                  onCopy={(label, text) => void copy(label, text)}
                />
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3 text-[11px] text-ink-secondary">
          <span className="flex items-center gap-2">
            Kloud Games{' '}
            <Badge tone={kloudRunning ? 'success' : 'warning'}>
              {kloudRunning ? 'Em execução' : 'Parado'}
            </Badge>
          </span>
          {remoteAddress && (
            <Badge tone="accent">
              <Check size={11} aria-hidden="true" /> {remoteAddress}
            </Badge>
          )}
        </div>
      </div>

      <p className="mt-3 text-[10.5px] leading-relaxed text-ink-tertiary">
        Nota técnica: o ZeroTier cria uma rede privada entre os aparelhos e o Moonlight usa UDP
        (portas 47998–48002). Nenhuma porta do roteador precisa ser aberta.
      </p>
    </Modal>
  )
}
