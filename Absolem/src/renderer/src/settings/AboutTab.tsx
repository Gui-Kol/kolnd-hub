import { useEffect, useMemo, useState } from 'react'
import type { AppInfoResult, SimpleResult } from '../../../shared/ipc'

/** Aba Sobre (task 11): identidade, versão da Hub e limites da v1. */

export interface AboutTabApi {
  appInfo: () => Promise<AppInfoResult>
  relaunch: () => Promise<SimpleResult>
}

export interface AboutTabProps {
  api?: AboutTabApi
}

function defaultApi(): AboutTabApi {
  return {
    appInfo: () => window.absolem.getAppInfo(),
    relaunch: () => window.absolem.relaunch()
  }
}

export function AboutTab({ api }: AboutTabProps) {
  const client = useMemo(() => api ?? defaultApi(), [api])
  const [info, setInfo] = useState<{ name: string; version: string; platform: string } | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [restartMessage, setRestartMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void client
      .appInfo()
      .then((result) => {
        if (!cancelled && result.ok) {
          setInfo({
            name: result.info.name,
            version: result.info.version,
            platform: result.info.platform
          })
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [client])

  async function restart(): Promise<void> {
    if (!window.confirm('Reiniciar o Absolem agora? A janela será fechada e reaberta.')) return
    setRestarting(true)
    setRestartMessage(null)
    try {
      const result = await client.relaunch()
      if (!result.ok) {
        setRestarting(false)
        setRestartMessage(result.error)
      }
    } catch {
      setRestarting(false)
      setRestartMessage('Não foi possível reiniciar o Absolem.')
    }
  }

  return (
    <section aria-labelledby="about-title" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 id="about-title" className="text-base font-semibold text-ink-primary">
          Sobre o Absolem
        </h2>
        <p className="text-xs text-ink-tertiary">
          Assistente de IA para Windows inspirado na lagarta azul de Alice no País das Maravilhas.
        </p>
      </header>

      <dl className="grid grid-cols-1 gap-1 text-xs text-ink-secondary">
        <div className="flex justify-between gap-2">
          <dt>Versão do Kolnd Hub</dt>
          {/* O Absolem não tem versão própria: a Hub injeta a dela no launch. */}
          <dd data-app-version={info?.version ?? ''}>{info?.version || '—'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Plataforma</dt>
          <dd>{info?.platform ?? '—'}</dd>
        </div>
      </dl>

      <section className="flex flex-col gap-2 rounded border border-surface-2 px-3 py-2 text-xs text-ink-secondary">
        <p>Atualizado junto com o Kolnd Hub — não há versão, instalador ou updater próprios.</p>
        <p>
          O Absolem fica na bandeja do sistema. O avatar não rouba foco e o microfone só abre com
          consentimento. Chave e memória ficam nesta máquina; a chave usa o cofre do Windows.
        </p>
        <p>
          Wake word está fora da v1: use o clique no avatar ou o atalho. Temas claros, marketplace e
          múltiplas conversas também estão fora desta versão.
        </p>
      </section>

      <section aria-labelledby="about-restart-title" className="flex flex-col gap-2">
        <h3 id="about-restart-title" className="text-sm font-semibold text-ink-primary">
          Reiniciar
        </h3>
        <p className="text-xs text-ink-tertiary">
          Fecha e reabre somente o Absolem. O Windows não será reiniciado.
        </p>
        <button
          type="button"
          onClick={() => {
            void restart()
          }}
          disabled={restarting}
          className="self-start rounded border border-surface-2 px-3 py-1.5 text-xs text-ink-secondary hover:border-accent hover:text-ink-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {restarting ? 'Reiniciando…' : 'Reiniciar Absolem'}
        </button>
        {restartMessage ? (
          <p role="alert" className="text-xs text-red-300">
            {restartMessage}
          </p>
        ) : restarting ? (
          <p role="status" className="text-xs text-ink-tertiary">
            O Absolem está sendo reiniciado.
          </p>
        ) : null}
      </section>
    </section>
  )
}
