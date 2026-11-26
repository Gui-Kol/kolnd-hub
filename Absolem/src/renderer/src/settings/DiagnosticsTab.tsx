import { useEffect, useMemo, useState } from 'react'
import type {
  AppInfoResult,
  DiagnosticsExportResult,
  DiagnosticsGeminiResult,
  DiagnosticsOverlayResult,
  MemoryStatsResult,
  SimpleResult,
  VoiceStatusResult
} from '../../../shared/ipc'
import type { GeminiErrorSummary } from '../../../shared/gemini'

/**
 * Aba Diagnóstico (task 11, T8).
 *
 * Mostra versões, modelos, promptVersion, fps do overlay, microfone, resumo da
 * memória e os últimos erros classificados (sem prompt nem resposta). O export
 * é manual, via diálogo nativo, e o JSON é redigido: sem chave e sem
 * transcrição. Nada é enviado automaticamente.
 */

export interface DiagnosticsSnapshot {
  app: { name: string; version: string; electron: string; chromium: string; node: string }
  model: string
  liveModel: string
  promptVersion: string
  fps: number | null
  microphone: { state: string; consentGranted: boolean }
  memory: { total: number; approxBytes: number } | null
  errors: GeminiErrorSummary[]
}

export interface DiagnosticsTabApi {
  appInfo: () => Promise<AppInfoResult>
  gemini: () => Promise<DiagnosticsGeminiResult>
  overlay: () => Promise<DiagnosticsOverlayResult>
  voice: () => Promise<VoiceStatusResult>
  memory: () => Promise<MemoryStatsResult>
  exportReport: () => Promise<DiagnosticsExportResult>
  openLogs: () => Promise<SimpleResult>
}

export interface DiagnosticsTabProps {
  api?: DiagnosticsTabApi
}

export const MAX_DIAGNOSTIC_ERRORS = 5

function defaultApi(): DiagnosticsTabApi {
  return {
    appInfo: () => window.absolem.getAppInfo(),
    gemini: () => window.absolem.diagnostics.gemini(),
    overlay: () => window.absolem.diagnostics.overlay(),
    voice: () => window.absolem.voice.status(),
    memory: () => window.absolem.memory.stats(),
    exportReport: () => window.absolem.diagnostics.export(),
    openLogs: () => window.absolem.openFolder('logs')
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

export function DiagnosticsTab({ api }: DiagnosticsTabProps) {
  const client = useMemo(() => api ?? defaultApi(), [api])
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      client.appInfo().catch(() => null),
      client.gemini().catch(() => null),
      client.overlay().catch(() => null),
      client.voice().catch(() => null),
      client.memory().catch(() => null)
    ]).then(([appResult, geminiResult, overlayResult, voiceResult, memoryResult]) => {
      if (cancelled) return
      const info = appResult?.ok ? appResult.info : null
      const gemini = geminiResult?.ok ? geminiResult.diagnostics : null
      const status = voiceResult?.ok ? voiceResult.status : null
      const stats = memoryResult?.ok ? memoryResult.stats : null
      const errors = gemini?.recentErrors ?? (gemini?.lastError ? [gemini.lastError] : [])
      setSnapshot({
        app: {
          name: info?.name ?? 'Absolem',
          version: info?.version ?? '—',
          electron: info?.electron ?? '—',
          chromium: info?.chromium ?? '—',
          node: info?.node ?? '—'
        },
        model: gemini?.model ?? '—',
        liveModel: gemini?.model ?? '—',
        promptVersion: gemini?.promptVersion ?? '—',
        fps: overlayResult?.ok ? overlayResult.fps : null,
        microphone: {
          state: status?.state ?? 'off',
          consentGranted: status?.consentGranted ?? false
        },
        memory: stats ? { total: stats.total, approxBytes: stats.approxBytes } : null,
        errors: errors.slice(-MAX_DIAGNOSTIC_ERRORS)
      })
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [client])

  async function exportReport(): Promise<void> {
    setError(null)
    setNotice(null)
    const result = await client.exportReport()
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (result.canceled) return
    setNotice(`Diagnóstico exportado${result.filePath ? ` em ${result.filePath}` : ''}.`)
  }

  return (
    <section aria-labelledby="diagnostics-title" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 id="diagnostics-title" className="text-base font-semibold text-ink-primary">
          Diagnóstico
        </h2>
        <p className="text-xs text-ink-tertiary">
          Metadados locais para investigar problemas. Nenhum dado é enviado automaticamente.
        </p>
      </header>

      {error ? (
        <p role="alert" className="rounded border border-red-400/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded border border-surface-2 px-3 py-2 text-xs text-ink-secondary"
        >
          {notice}
        </p>
      ) : null}

      {loading ? <p className="text-xs text-ink-tertiary">Carregando diagnóstico...</p> : null}

      {snapshot ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <section aria-labelledby="diagnostics-runtime-title" className="flex flex-col gap-1">
            <h3 id="diagnostics-runtime-title" className="text-sm font-semibold text-ink-primary">
              Versões
            </h3>
            <dl className="text-xs text-ink-secondary" data-diagnostics-versions>
              <div className="flex justify-between gap-2">
                <dt>App</dt>
                <dd>
                  {snapshot.app.name} {snapshot.app.version}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Electron</dt>
                <dd>{snapshot.app.electron}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Chromium</dt>
                <dd>{snapshot.app.chromium}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Node</dt>
                <dd>{snapshot.app.node}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="diagnostics-models-title" className="flex flex-col gap-1">
            <h3 id="diagnostics-models-title" className="text-sm font-semibold text-ink-primary">
              Modelos
            </h3>
            <dl className="text-xs text-ink-secondary">
              <div className="flex justify-between gap-2">
                <dt>Texto</dt>
                <dd>{snapshot.model}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Live</dt>
                <dd>{snapshot.liveModel}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Prompt</dt>
                <dd>{snapshot.promptVersion}</dd>
              </div>
            </dl>
          </section>

          <section
            aria-labelledby="diagnostics-runtime-state-title"
            className="flex flex-col gap-1"
          >
            <h3
              id="diagnostics-runtime-state-title"
              className="text-sm font-semibold text-ink-primary"
            >
              Estado
            </h3>
            <dl className="text-xs text-ink-secondary">
              <div className="flex justify-between gap-2">
                <dt>FPS do overlay</dt>
                <dd>{snapshot.fps === null ? 'indisponível' : snapshot.fps.toFixed(1)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Microfone</dt>
                <dd>
                  {snapshot.microphone.state}
                  {snapshot.microphone.consentGranted ? ' (consentido)' : ' (sem consentimento)'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Memória</dt>
                <dd>
                  {snapshot.memory
                    ? `${snapshot.memory.total} item(ns), ${formatBytes(snapshot.memory.approxBytes)}`
                    : 'indisponível'}
                </dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="diagnostics-errors-title" className="flex flex-col gap-1">
            <h3 id="diagnostics-errors-title" className="text-sm font-semibold text-ink-primary">
              Últimos erros ({snapshot.errors.length}/{MAX_DIAGNOSTIC_ERRORS})
            </h3>
            {snapshot.errors.length === 0 ? (
              <p className="text-xs text-ink-tertiary">Nenhum erro recente.</p>
            ) : (
              <ul
                className="flex flex-col gap-1 text-xs text-ink-secondary"
                data-diagnostics-errors
              >
                {snapshot.errors.map((item, index) => (
                  <li key={`${item.kind}-${index}`}>
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-ink-tertiary">
                      {item.kind}
                    </span>{' '}
                    {item.message}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-ink-tertiary">
              Sem prompt, resposta ou transcrição; só a classificação e a mensagem curta.
            </p>
          </section>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            void client.openLogs().then((result) => {
              if (!result.ok) setError(result.error)
            })
          }}
          className="rounded border border-surface-2 px-3 py-1.5 text-xs text-ink-secondary hover:border-accent hover:text-ink-primary"
        >
          Abrir pasta de logs
        </button>
        <button
          type="button"
          onClick={() => {
            void exportReport()
          }}
          className="rounded border border-surface-2 px-3 py-1.5 text-xs text-ink-secondary hover:border-accent hover:text-ink-primary"
        >
          Exportar diagnóstico…
        </button>
      </div>
    </section>
  )
}
