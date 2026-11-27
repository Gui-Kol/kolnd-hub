import { useEffect, useMemo, useState } from 'react'
import type { GeminiConfig } from '../../../shared/config'
import { USAGE_WARNING_PERCENT, type GeminiTestKeyOutcome } from '../../../shared/gemini'
import type {
  GeminiStatusResult,
  GeminiTestKeyResult,
  SimpleResult,
  StoreGetResult
} from '../../../shared/ipc'

/**
 * Aba Chave e custo (task 11, T7).
 *
 * A chave é write-only: o campo nunca é preenchido com o valor salvo, não é
 * logado e não entra no diagnóstico. O consumo é exibido em tokens (nunca em
 * moeda), com barra, aviso em 80% e botão para aumentar o teto mensal.
 */

export interface KeyTabApi {
  status: () => Promise<GeminiStatusResult>
  setKey: (key: string) => Promise<SimpleResult>
  clearKey: () => Promise<SimpleResult>
  testKey: () => Promise<GeminiTestKeyResult>
  getGeminiConfig: () => Promise<StoreGetResult>
  setGeminiConfig: (config: GeminiConfig) => Promise<SimpleResult>
}

export interface KeyTabProps {
  api?: KeyTabApi
}

function defaultApi(): KeyTabApi {
  return {
    status: () => window.absolem.gemini.status(),
    setKey: (key) => window.absolem.gemini.setKey(key),
    clearKey: () => window.absolem.gemini.clearKey(),
    testKey: () => window.absolem.gemini.testKey(),
    getGeminiConfig: () => window.absolem.storeGet('gemini'),
    setGeminiConfig: (config) => window.absolem.storeSet('gemini', config)
  }
}

/** Piso do teto mensal ao reduzir pela interface (tokens). */
export const MIN_MONTHLY_TOKEN_CAP = 100_000

/**
 * Próximo teto ao diminuir: metade do atual arredondada para baixo, nunca
 * abaixo do piso. Valor não finito cai no piso.
 */
export function decreaseMonthlyCap(current: number, min: number = MIN_MONTHLY_TOKEN_CAP): number {
  if (!Number.isFinite(current)) return min
  return Math.max(min, Math.floor(current / 2))
}

function readGeminiConfig(value: unknown): GeminiConfig {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  return {
    model: typeof raw.model === 'string' ? raw.model : 'gemini-2.0-flash',
    temperature: typeof raw.temperature === 'number' ? raw.temperature : 0.7,
    monthlyTokenCap: typeof raw.monthlyTokenCap === 'number' ? raw.monthlyTokenCap : 2_000_000
  }
}

export function describeTestError(outcome: GeminiTestKeyOutcome): string {
  if (outcome.ok) return 'Conexão testada com sucesso.'
  const kind = outcome.error?.kind ?? 'unknown'
  if (kind === 'auth') {
    return 'Falha de autenticação (401): a chave é inválida, expirou ou não tem permissão. Salve uma chave válida e teste de novo.'
  }
  if (kind === 'quota')
    return 'Cota ou teto de tokens atingido. Ajuste o teto ou aguarde o próximo mês.'
  if (kind === 'network') return 'Falha de rede: verifique a conexão e tente de novo.'
  if (kind === 'timeout') return 'A chamada demorou demais. Tente de novo.'
  return outcome.error?.message ?? 'Não foi possível testar a conexão.'
}

export function KeyTab({ api }: KeyTabProps) {
  const client = useMemo(() => api ?? defaultApi(), [api])
  const [status, setStatus] = useState<{
    configured: boolean
    model: string
    disabledReason: string | null
    usage: { today: number; month: number; cap: number; percent: number }
  } | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [config, setConfig] = useState<GeminiConfig>(() => readGeminiConfig(undefined))
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testOutcome, setTestOutcome] = useState<GeminiTestKeyOutcome | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload(): Promise<void> {
    const [statusResult, configResult] = await Promise.all([
      client.status().catch(() => null),
      client.getGeminiConfig().catch(() => null)
    ])
    if (statusResult?.ok) {
      setStatus({
        configured: statusResult.status.configured,
        model: statusResult.status.model,
        disabledReason: statusResult.status.disabledReason,
        usage: statusResult.status.usage
      })
    }
    if (configResult?.ok) setConfig(readGeminiConfig(configResult.value))
  }

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      client.status().catch(() => null),
      client.getGeminiConfig().catch(() => null)
    ]).then(([statusResult, configResult]) => {
      if (cancelled) return
      if (statusResult?.ok) {
        setStatus({
          configured: statusResult.status.configured,
          model: statusResult.status.model,
          disabledReason: statusResult.status.disabledReason,
          usage: statusResult.status.usage
        })
      }
      if (configResult?.ok) setConfig(readGeminiConfig(configResult.value))
    })
    return () => {
      cancelled = true
    }
  }, [client])

  async function saveKey(): Promise<void> {
    const key = keyDraft.trim()
    if (key.length < 8) {
      setError('Chave inválida: curta demais.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await client.setKey(key)
      if (!result.ok) {
        setError(result.error)
        return
      }
      // O valor nunca fica no estado depois de salvar.
      setKeyDraft('')
      setTestOutcome(null)
      setNotice('Chave salva com segurança. O valor não é exibido novamente.')
      await reload()
    } finally {
      setSaving(false)
    }
  }

  async function testConnection(): Promise<void> {
    setTesting(true)
    setError(null)
    setTestOutcome(null)
    try {
      const result = await client.testKey()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setTestOutcome(result.result)
    } finally {
      setTesting(false)
    }
  }

  async function removeKey(): Promise<void> {
    const result = await client.clearKey()
    if (!result.ok) {
      setError(result.error)
      return
    }
    setConfirmRemove(false)
    setTestOutcome(null)
    setNotice('Chave removida. O app continua utilizável sem chave.')
    await reload()
  }

  async function increaseCap(): Promise<void> {
    const current = status?.usage.cap ?? config.monthlyTokenCap
    const nextCap = Math.max(config.monthlyTokenCap, Math.ceil(current * 2))
    const next: GeminiConfig = { ...config, monthlyTokenCap: nextCap }
    const result = await client.setGeminiConfig(next)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setConfig(next)
    setNotice(`Teto mensal aumentado para ${nextCap.toLocaleString('pt-BR')} tokens.`)
    await reload()
  }

  async function decreaseCap(): Promise<void> {
    const current = status?.usage.cap ?? config.monthlyTokenCap
    const nextCap = decreaseMonthlyCap(current)
    const next: GeminiConfig = { ...config, monthlyTokenCap: nextCap }
    const result = await client.setGeminiConfig(next)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setConfig(next)
    setNotice(`Teto mensal reduzido para ${nextCap.toLocaleString('pt-BR')} tokens.`)
    await reload()
  }

  const usage = status?.usage
  const percent = usage?.percent ?? 0
  const capNow = usage?.cap ?? config.monthlyTokenCap

  return (
    <section aria-labelledby="key-title" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 id="key-title" className="text-base font-semibold text-ink-primary">
          Chave e custo
        </h2>
        <p className="text-xs text-ink-tertiary">
          A chave fica cifrada pelo Windows (safeStorage) e nunca é exibida. O consumo é da sua
          conta Google; os preços são definidos pelo Google. A v1 mede tokens e não estima moeda.
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

      <section aria-labelledby="key-status-title" className="flex flex-col gap-2">
        <h3 id="key-status-title" className="text-sm font-semibold text-ink-primary">
          Chave do Gemini
        </h3>
        <p className="text-xs text-ink-secondary">
          Status:{' '}
          <strong data-key-configured={status?.configured ? 'true' : 'false'}>
            {status?.configured ? 'configurada' : 'não configurada'}
          </strong>
          {status?.model ? ` · modelo ${status.model}` : ''}
        </p>
        {status?.disabledReason ? (
          <p className="text-xs text-amber-200">{status.disabledReason}</p>
        ) : null}

        <div className="flex flex-col gap-1">
          <label htmlFor="gemini-key" className="text-xs text-ink-secondary">
            {status?.configured ? 'Substituir chave (write-only)' : 'Chave do Gemini'}
          </label>
          <input
            id="gemini-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={keyDraft}
            onChange={(event) => setKeyDraft(event.target.value)}
            placeholder={status?.configured ? '•••••••• (salva)' : 'cole a chave aqui'}
            className="rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
          />
          <p className="text-xs text-ink-tertiary">
            O valor nunca é renderizado depois de salvo, nunca é logado e nunca entra no
            diagnóstico.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void saveKey()
            }}
            disabled={saving || keyDraft.trim().length === 0}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-surface-base disabled:opacity-40"
          >
            {saving ? 'Salvando…' : 'Salvar chave'}
          </button>
          <button
            type="button"
            onClick={() => {
              void testConnection()
            }}
            disabled={testing || status?.configured === false}
            className="rounded border border-surface-2 px-3 py-1.5 text-xs text-ink-secondary hover:border-accent hover:text-ink-primary disabled:opacity-40"
          >
            {testing ? 'Testando…' : 'Testar conexão'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            disabled={!status?.configured}
            className="rounded border border-red-400/40 px-3 py-1.5 text-xs text-red-300 disabled:opacity-40"
          >
            Remover chave
          </button>
        </div>

        {testOutcome ? (
          <p
            role="status"
            data-test-key-outcome={testOutcome.ok ? 'ok' : (testOutcome.error?.kind ?? 'error')}
            className={testOutcome.ok ? 'text-xs text-emerald-200' : 'text-xs text-amber-200'}
          >
            {describeTestError(testOutcome)}
            {testOutcome.ok && typeof testOutcome.durationMs === 'number'
              ? ` Latência: ${testOutcome.durationMs} ms.`
              : ''}
          </p>
        ) : null}

        {confirmRemove ? (
          <div
            role="alertdialog"
            aria-labelledby="key-remove-title"
            className="flex flex-col gap-2 rounded border border-red-400/50 px-3 py-2"
          >
            <p id="key-remove-title" className="text-xs text-red-200">
              Remover a chave? A conversa fica indisponível até configurar outra. Nada mais é
              apagado.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  void removeKey()
                }}
                className="rounded bg-red-400/20 px-3 py-1 text-xs text-red-100"
              >
                Confirmar remoção
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                className="rounded border border-surface-2 px-3 py-1 text-xs text-ink-secondary"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="key-usage-title" className="flex flex-col gap-3">
        <h3 id="key-usage-title" className="text-sm font-semibold text-ink-primary">
          Consumo em tokens
        </h3>
        <p className="text-xs text-ink-secondary" data-usage-summary>
          {usage
            ? `${usage.month.toLocaleString('pt-BR')} de ${usage.cap.toLocaleString(
                'pt-BR'
              )} tokens neste mês · hoje ${usage.today.toLocaleString('pt-BR')}`
            : 'Carregando consumo...'}
        </p>
        <div
          role="progressbar"
          aria-label="Uso do teto mensal de tokens"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, percent)}
          className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
        >
          <div
            data-usage-bar
            className={`h-full ${percent >= USAGE_WARNING_PERCENT ? 'bg-amber-400' : 'bg-accent'}`}
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        </div>
        {percent >= USAGE_WARNING_PERCENT ? (
          <p
            role="status"
            data-usage-warning
            className="rounded border border-amber-400/50 bg-amber-400/5 px-3 py-2 text-xs text-amber-200"
          >
            Você já usou {percent}% do teto mensal. Aumente o teto ou aguarde o próximo mês para
            evitar o bloqueio em 100%.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void increaseCap()
            }}
            className="self-start rounded border border-surface-2 px-3 py-1.5 text-xs text-ink-secondary hover:border-accent hover:text-ink-primary"
          >
            Aumentar teto
          </button>
          <button
            type="button"
            onClick={() => {
              void decreaseCap()
            }}
            disabled={capNow <= MIN_MONTHLY_TOKEN_CAP}
            className="self-start rounded border border-surface-2 px-3 py-1.5 text-xs text-ink-secondary hover:border-accent hover:text-ink-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Diminuir teto
          </button>
        </div>
      </section>
    </section>
  )
}
