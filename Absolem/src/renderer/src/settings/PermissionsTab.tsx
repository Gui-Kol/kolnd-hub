import { useEffect, useMemo, useState } from 'react'
import type { StoreGetResult } from '../../../shared/ipc'
import type { ActionsPauseResult, PermissionsGetResult, SimpleResult } from '../../../shared/ipc'
import {
  ACTIONS_PAUSE_SHORTCUT,
  PERMISSION_CATEGORIES,
  type PermissionCategory,
  type PermissionDecision,
  type PermissionsState
} from '../../../shared/permissions'
import { normalizeBlocklist, type PrivacyScreenConfig } from '../../../shared/screen'

/**
 * Aba Permissões (task 11, T6).
 *
 * Três estados por categoria, texto de risco, pausa global, blocklist da visão
 * de tela, pesquisa web e acesso à auditoria local. Mudar `system.power` ou
 * `uia.control` para `allow` exige confirmação explícita.
 */

const CATEGORY_LABELS: Record<PermissionCategory, string> = {
  'apps.launch': 'Abrir programas',
  'apps.close': 'Fechar programas',
  'files.read': 'Ler arquivos',
  'files.write': 'Gravar arquivos',
  'system.power': 'Desligar ou reiniciar o PC',
  'uia.control': 'Controlar janelas e interface',
  'web.search': 'Pesquisar e abrir páginas na web'
}

const CATEGORY_RISKS: Record<PermissionCategory, string> = {
  'apps.launch': 'Pode abrir qualquer programa instalado na sua conta.',
  'apps.close': 'Pode fechar programas abertos, inclusive com trabalho não salvo.',
  'files.read': 'Pode ler arquivos e pastas que você escolher.',
  'files.write': 'Pode criar, alterar ou apagar arquivos.',
  'system.power': 'Pode desligar, reiniciar ou bloquear o computador.',
  'uia.control': 'Pode clicar, digitar e manipular outras janelas em seu nome.',
  'web.search': 'Pode pesquisar e abrir links http/https com fontes.'
}

const DECISION_LABELS: Record<PermissionDecision, string> = {
  allow: 'Permitir',
  ask: 'Perguntar',
  deny: 'Negar'
}

const HIGH_RISK: readonly PermissionCategory[] = ['system.power', 'uia.control']

export interface PermissionsTabApi {
  getPermissions: () => Promise<PermissionsGetResult>
  setPermission: (
    category: PermissionCategory,
    decision: PermissionDecision
  ) => Promise<SimpleResult>
  pause: (paused: boolean) => Promise<ActionsPauseResult>
  getWeb: () => Promise<StoreGetResult>
  setWeb: (value: { enabled: boolean }) => Promise<SimpleResult>
  getPrivacy: () => Promise<StoreGetResult>
  setPrivacy: (value: { telemetry: boolean; screen: PrivacyScreenConfig }) => Promise<SimpleResult>
  openAudit: () => Promise<SimpleResult>
}

export interface PermissionsTabProps {
  api?: PermissionsTabApi
}

function defaultPermissions(): PermissionsState {
  return {
    microphone: false,
    paused: false,
    categories: {
      'apps.launch': 'ask',
      'apps.close': 'ask',
      'files.read': 'ask',
      'files.write': 'ask',
      'system.power': 'deny',
      'uia.control': 'deny',
      'web.search': 'allow'
    }
  }
}

function readPermissions(value: unknown): PermissionsState {
  const fallback = defaultPermissions()
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const categories = { ...fallback.categories }
  const rawCategories =
    raw.categories && typeof raw.categories === 'object' && !Array.isArray(raw.categories)
      ? (raw.categories as Record<string, unknown>)
      : {}
  for (const category of PERMISSION_CATEGORIES) {
    const decision = rawCategories[category]
    if (decision === 'allow' || decision === 'ask' || decision === 'deny') {
      categories[category] = decision
    }
  }
  return {
    microphone: raw.microphone === true,
    paused: raw.paused === true,
    categories
  }
}

function readPrivacy(value: unknown): { telemetry: boolean; screen: PrivacyScreenConfig } {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const screenRaw =
    raw.screen && typeof raw.screen === 'object' && !Array.isArray(raw.screen)
      ? (raw.screen as Record<string, unknown>)
      : {}
  return {
    telemetry: raw.telemetry === true,
    screen: {
      mode: screenRaw.mode === 'on' ? 'on' : screenRaw.mode === 'ask' ? 'ask' : 'off',
      proactive: screenRaw.proactive === true,
      blocklist: normalizeBlocklist(screenRaw.blocklist)
    }
  }
}

function defaultApi(): PermissionsTabApi {
  return {
    getPermissions: () => window.absolem.permissions.get(),
    setPermission: (category, decision) => window.absolem.permissions.set({ category, decision }),
    pause: (paused) => window.absolem.actions.pause(paused),
    getWeb: () => window.absolem.storeGet('web'),
    setWeb: (value) => window.absolem.storeSet('web', value),
    getPrivacy: () => window.absolem.storeGet('privacy'),
    setPrivacy: (value) => window.absolem.storeSet('privacy', value),
    openAudit: () => window.absolem.openFolder('audit')
  }
}

export function PermissionsTab({ api }: PermissionsTabProps) {
  const client = useMemo(() => api ?? defaultApi(), [api])
  const [permissions, setPermissions] = useState<PermissionsState>(defaultPermissions)
  const [privacy, setPrivacy] = useState(() => readPrivacy(undefined))
  const [webEnabled, setWebEnabled] = useState(true)
  const [blocklistDraft, setBlocklistDraft] = useState('')
  const [pending, setPending] = useState<{
    category: PermissionCategory
    decision: PermissionDecision
  } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      client.getPermissions().catch(() => null),
      client.getWeb().catch(() => null),
      client.getPrivacy().catch(() => null)
    ]).then(([permissionsResult, webResult, privacyResult]) => {
      if (cancelled) return
      if (permissionsResult?.ok) setPermissions(readPermissions(permissionsResult.permissions))
      if (webResult?.ok && webResult.value && typeof webResult.value === 'object') {
        setWebEnabled((webResult.value as { enabled?: unknown }).enabled !== false)
      }
      if (privacyResult?.ok) setPrivacy(readPrivacy(privacyResult.value))
    })
    return () => {
      cancelled = true
    }
  }, [client])

  function applyDecision(category: PermissionCategory, decision: PermissionDecision): void {
    const next: PermissionsState = {
      ...permissions,
      categories: { ...permissions.categories, [category]: decision }
    }
    setPermissions(next)
    void client.setPermission(category, decision).then((result) => {
      if (!result.ok) {
        setError(result.error)
        return
      }
      setError(null)
      setNotice(`${CATEGORY_LABELS[category]}: ${DECISION_LABELS[decision].toLowerCase()}.`)
    })
  }

  function chooseDecision(category: PermissionCategory, decision: PermissionDecision): void {
    if (decision === 'allow' && HIGH_RISK.includes(category)) {
      setPending({ category, decision })
      return
    }
    setPending(null)
    applyDecision(category, decision)
  }

  async function togglePause(next: boolean): Promise<void> {
    const result = await client.pause(next)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setPermissions((current) => ({ ...current, paused: result.paused }))
    setNotice(result.paused ? 'Todas as ações estão pausadas.' : 'Ações retomadas.')
  }

  async function toggleWeb(next: boolean): Promise<void> {
    setWebEnabled(next)
    const result = await client.setWeb({ enabled: next })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setNotice(next ? 'Pesquisa web ligada.' : 'Pesquisa web desligada.')
  }

  async function saveBlocklist(blocklist: string[]): Promise<void> {
    const next = { ...privacy, screen: { ...privacy.screen, blocklist } }
    setPrivacy(next)
    const result = await client.setPrivacy(next)
    if (!result.ok) setError(result.error)
  }

  function addBlocklistEntry(): void {
    const entry = blocklistDraft.trim().toLowerCase()
    if (!entry) return
    if (privacy.screen.blocklist.includes(entry)) {
      setBlocklistDraft('')
      return
    }
    setBlocklistDraft('')
    void saveBlocklist([...privacy.screen.blocklist, entry])
  }

  return (
    <section aria-labelledby="permissions-title" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 id="permissions-title" className="text-base font-semibold text-ink-primary">
          Permissões
        </h2>
        <p className="text-xs text-ink-tertiary">
          Cada categoria decide antes de a ferramenta executar. Negar nunca executa; perguntar
          mostra a confirmação na conversa. A pausa global vence qualquer categoria.
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

      <section aria-labelledby="permissions-pause-title" className="flex flex-col gap-2">
        <h3 id="permissions-pause-title" className="text-sm font-semibold text-ink-primary">
          Pausa global
        </h3>
        <label
          htmlFor="permissions-paused"
          className="flex items-center gap-2 text-sm text-ink-primary"
        >
          <input
            id="permissions-paused"
            type="checkbox"
            checked={permissions.paused}
            onChange={(event) => {
              void togglePause(event.target.checked)
            }}
          />
          Pausar todas as ações
        </label>
        <p className="text-xs text-ink-tertiary">
          Atalho: <kbd className="rounded bg-surface-2 px-1.5 py-0.5">{ACTIONS_PAUSE_SHORTCUT}</kbd>
        </p>
      </section>

      <section aria-labelledby="permissions-categories-title" className="flex flex-col gap-3">
        <h3 id="permissions-categories-title" className="text-sm font-semibold text-ink-primary">
          Categorias
        </h3>
        <ul className="flex flex-col gap-2">
          {PERMISSION_CATEGORIES.map((category) => (
            <li
              key={category}
              data-permission-category={category}
              className="flex flex-col gap-1 rounded border border-surface-2 px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor={`permission-${category.replace(/\./g, '-')}`}
                  className="text-sm text-ink-primary"
                >
                  {CATEGORY_LABELS[category]}
                </label>
                <select
                  id={`permission-${category.replace(/\./g, '-')}`}
                  value={permissions.categories[category]}
                  onChange={(event) => {
                    chooseDecision(category, event.target.value as PermissionDecision)
                  }}
                  className="rounded border border-surface-2 bg-surface-1 px-2 py-1 text-xs text-ink-primary"
                >
                  {(Object.keys(DECISION_LABELS) as PermissionDecision[]).map((decision) => (
                    <option key={decision} value={decision}>
                      {DECISION_LABELS[decision]}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-ink-tertiary">{CATEGORY_RISKS[category]}</p>
            </li>
          ))}
        </ul>

        {pending ? (
          <div
            role="alertdialog"
            aria-labelledby="permission-confirm-title"
            className="flex flex-col gap-2 rounded border border-amber-400/60 bg-amber-400/5 px-3 py-2"
          >
            <p id="permission-confirm-title" className="text-sm text-amber-100">
              Permitir &quot;{CATEGORY_LABELS[pending.category]}&quot; sem confirmação a cada uso?
              {CATEGORY_RISKS[pending.category]}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  const current = pending
                  setPending(null)
                  applyDecision(current.category, current.decision)
                }}
                className="rounded bg-amber-400/20 px-3 py-1 text-xs text-amber-100"
              >
                Confirmar permissão
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                className="rounded border border-surface-2 px-3 py-1 text-xs text-ink-secondary"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="permissions-web-title" className="flex flex-col gap-2">
        <h3 id="permissions-web-title" className="text-sm font-semibold text-ink-primary">
          Pesquisa web
        </h3>
        <label
          htmlFor="permissions-web"
          className="flex items-center gap-2 text-sm text-ink-primary"
        >
          <input
            id="permissions-web"
            type="checkbox"
            checked={webEnabled}
            onChange={(event) => {
              void toggleWeb(event.target.checked)
            }}
          />
          Permitir pesquisa e abertura de páginas
        </label>
        <p className="text-xs text-ink-tertiary">
          Desligada, as ferramentas web nem são declaradas ao modelo.
        </p>
      </section>

      <section aria-labelledby="permissions-blocklist-title" className="flex flex-col gap-3">
        <h3 id="permissions-blocklist-title" className="text-sm font-semibold text-ink-primary">
          Blocklist da visão de tela
        </h3>
        <p className="text-xs text-ink-tertiary">
          Títulos ou processos que contêm estas palavras nunca são capturados. Comparação sem
          diferenciar maiúsculas.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="permissions-blocklist-input" className="text-xs text-ink-secondary">
              Adicionar termo
            </label>
            <input
              id="permissions-blocklist-input"
              value={blocklistDraft}
              onChange={(event) => setBlocklistDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addBlocklistEntry()
                }
              }}
              className="rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
            />
          </div>
          <button
            type="button"
            onClick={addBlocklistEntry}
            className="rounded border border-surface-2 px-3 py-1.5 text-xs text-ink-secondary hover:border-accent hover:text-ink-primary"
          >
            Adicionar
          </button>
        </div>
        {privacy.screen.blocklist.length === 0 ? (
          <p className="text-xs text-ink-tertiary">Nenhum termo na blocklist.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {privacy.screen.blocklist.map((entry) => (
              <li
                key={entry}
                data-blocklist-entry
                className="flex items-center gap-2 rounded bg-surface-2 px-2 py-1 text-xs text-ink-secondary"
              >
                {entry}
                <button
                  type="button"
                  aria-label={`Remover ${entry}`}
                  onClick={() => {
                    void saveBlocklist(privacy.screen.blocklist.filter((item) => item !== entry))
                  }}
                  className="text-red-300"
                >
                  remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="permissions-audit-title" className="flex flex-col gap-2">
        <h3 id="permissions-audit-title" className="text-sm font-semibold text-ink-primary">
          Auditoria
        </h3>
        <p className="text-xs text-ink-tertiary">
          Cada ação executada é registrada localmente sem conteúdo de arquivo nem transcrição.
        </p>
        <button
          type="button"
          onClick={() => {
            void client.openAudit().then((result) => {
              if (!result.ok) setError(result.error)
            })
          }}
          className="self-start rounded border border-surface-2 px-3 py-1.5 text-xs text-ink-secondary hover:border-accent hover:text-ink-primary"
        >
          Ver auditoria
        </button>
      </section>
    </section>
  )
}
