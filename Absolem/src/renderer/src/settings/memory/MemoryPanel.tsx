import { useEffect, useMemo, useState } from 'react'
import type {
  SimpleResult,
  StoreGetResult,
  MemoryExportResult,
  MemoryCreateResult,
  MemoryImportResult,
  MemoryListResult,
  MemoryRemoveAllResult,
  MemoryRemoveResult,
  MemorySearchResult,
  MemoryStatsResult,
  MemoryUpdateResult,
  MemoryListRequest
} from '../../../../shared/ipc'
import type { MemoryConfig, StoreKey } from '../../../../shared/config'
import {
  MEMORY_KINDS,
  MEMORY_KIND_LABELS,
  MEMORY_REMOVE_ALL_CONFIRM,
  type MemoryArchiveRecord,
  type MemoryKind,
  type MemoryMaintenanceEntry,
  type MemoryRecord,
  type MemorySort,
  type MemoryStats
} from '../../../../shared/memory'

/**
 * Tela de memória (rota `#settings/memory`).
 *
 * O usuário vê, filtra, edita, apaga e pausa a memória, exporta/importa e lê o
 * relatório de manutenção. A extração automática pode ser desligada sem apagar
 * nada. "Apagar tudo" exige o texto literal `APAGAR TUDO`.
 */

export interface MemoryPanelApi {
  list: (request?: MemoryListRequest) => Promise<MemoryListResult>
  search: (request: { query: string; limit?: number }) => Promise<MemorySearchResult>
  create: (request: {
    kind: MemoryKind
    content: string
    tags?: string[]
  }) => Promise<MemoryCreateResult>
  update: (request: {
    id: string
    patch: { content?: string; tags?: string[]; pinned?: boolean; kind?: MemoryKind }
  }) => Promise<MemoryUpdateResult>
  remove: (request: { id: string }) => Promise<MemoryRemoveResult>
  removeAll: (request: {
    confirm: string
    includeTurns?: boolean
  }) => Promise<MemoryRemoveAllResult>
  stats: () => Promise<MemoryStatsResult>
  export: (request?: { includeTranscripts?: boolean }) => Promise<MemoryExportResult>
  import: () => Promise<MemoryImportResult>
  storeGet: (key: StoreKey) => Promise<StoreGetResult>
  storeSet: (key: StoreKey, value: unknown) => Promise<SimpleResult>
}

export interface MemoryPanelProps {
  /** Injeção para o teste de componente; em produção usa `window.absolem`. */
  api?: MemoryPanelApi
}

type KindFilter = MemoryKind | 'all'

const DATE_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short'
})

function defaultApi(): MemoryPanelApi {
  const memory = window.absolem.memory
  return {
    list: (request) => memory.list(request),
    search: (request) => memory.search(request),
    create: (request) => memory.create(request),
    update: (request) => memory.update(request),
    remove: (request) => memory.remove(request),
    removeAll: (request) => memory.removeAll(request),
    stats: () => memory.stats(),
    export: (request) => memory.export(request),
    import: () => memory.import(),
    storeGet: (key) => window.absolem.storeGet(key),
    storeSet: (key, value) => window.absolem.storeSet(key, value)
  }
}

function readConfig(value: unknown): MemoryConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  return {
    enabled: record.enabled !== false,
    autoExtract: record.autoExtract !== false,
    lastConsolidationAt:
      typeof record.lastConsolidationAt === 'number' && Number.isFinite(record.lastConsolidationAt)
        ? record.lastConsolidationAt
        : null
  }
}

function formatDate(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return '—'
  return DATE_FORMAT.format(new Date(value))
}

function parseTagInput(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
        .slice(0, 8)
    )
  ]
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

export function MemoryPanel({ api }: MemoryPanelProps) {
  const client = useMemo(() => api ?? defaultApi(), [api])
  const [memories, setMemories] = useState<MemoryRecord[]>([])
  const [archived, setArchived] = useState<MemoryArchiveRecord[]>([])
  const [maintenance, setMaintenance] = useState<MemoryMaintenanceEntry[]>([])
  const [stats, setStats] = useState<MemoryStats | null>(null)
  const [config, setConfig] = useState<MemoryConfig>({
    enabled: true,
    autoExtract: true,
    lastConsolidationAt: null
  })
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const [sort, setSort] = useState<MemorySort>('date')
  const [reloadToken, setReloadToken] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftContent, setDraftContent] = useState('')
  const [draftTags, setDraftTags] = useState('')
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [confirmAllText, setConfirmAllText] = useState('')
  const [includeTurns, setIncludeTurns] = useState(false)
  const [includeTranscripts, setIncludeTranscripts] = useState(false)
  const [newKind, setNewKind] = useState<MemoryKind>('fact')
  const [newContent, setNewContent] = useState('')
  const [newTags, setNewTags] = useState('')

  useEffect(() => {
    let cancelled = false
    void client
      .storeGet('memory')
      .then((result) => {
        if (cancelled || !result.ok) return
        const parsed = readConfig(result.value)
        if (parsed) setConfig(parsed)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [client])

  useEffect(() => {
    let cancelled = false
    const request: MemoryListRequest = {
      sort,
      limit: 200,
      ...(query.trim() ? { query: query.trim() } : {}),
      ...(kind === 'all' ? {} : { kind })
    }
    void Promise.all([client.list(request), client.stats()])
      .then(([listResult, statsResult]) => {
        if (cancelled) return
        if (!listResult.ok) {
          setError(listResult.error)
          return
        }
        setMemories(listResult.memories)
        setArchived(listResult.archived)
        setMaintenance(listResult.maintenance)
        setStats(statsResult.ok ? statsResult.stats : null)
        setError(null)
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar a memória.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [client, query, kind, sort, reloadToken])

  function refresh(message?: string): void {
    if (message) setNotice(message)
    setReloadToken((token) => token + 1)
  }

  async function toggleConfig(patch: Partial<MemoryConfig>): Promise<void> {
    const next = { ...config, ...patch }
    setConfig(next)
    const result = await client.storeSet('memory', next)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setNotice(patch.enabled === false ? 'Memória pausada. Nada foi apagado.' : 'Preferência salva.')
  }

  function startEdit(memory: MemoryRecord): void {
    setEditingId(memory.id)
    setDraftContent(memory.content)
    setDraftTags(memory.tags.join(', '))
    setConfirmRemoveId(null)
    setError(null)
  }

  async function saveEdit(id: string): Promise<void> {
    const result = await client.update({
      id,
      patch: { content: draftContent, tags: parseTagInput(draftTags) }
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setEditingId(null)
    refresh('Memória atualizada.')
  }

  async function removeMemory(id: string): Promise<void> {
    const result = await client.remove({ id })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setConfirmRemoveId(null)
    refresh(result.removed ? 'Memória apagada.' : 'Memória já não existia.')
  }

  async function removeAll(): Promise<void> {
    const result = await client.removeAll({
      confirm: confirmAllText,
      includeTurns
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setConfirmAllText('')
    refresh(`Tudo apagado: ${result.removed} memória(s).`)
  }

  async function exportMemories(): Promise<void> {
    const result = await client.export({ includeTranscripts })
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (result.canceled) return
    setNotice(
      `Exportado: ${result.count ?? 0} memória(s), ${formatBytes(result.bytes ?? 0)}${
        result.sessions !== undefined ? `, ${result.sessions} sessão(ões)` : ''
      }${result.filePath ? ` em ${result.filePath}` : ''}.`
    )
  }

  async function importMemories(): Promise<void> {
    const result = await client.import()
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (result.canceled) return
    setNotice(
      `Importado: ${result.imported ?? 0}, duplicado(s): ${result.duplicates ?? 0}, inválido(s): ${
        result.invalid ?? 0
      }.`
    )
    refresh()
  }

  async function createMemory(): Promise<void> {
    if (!newContent.trim()) {
      setError('Escreva o conteúdo da nova memória.')
      return
    }
    const result = await client.create({
      kind: newKind,
      content: newContent,
      tags: parseTagInput(newTags)
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setNewContent('')
    setNewTags('')
    refresh('Memória adicionada.')
  }

  const profile = useMemo(
    () =>
      memories
        .filter((memory) => memory.kind === 'profile' || memory.kind === 'preference')
        .slice()
        .sort((a, b) => b.useCount - a.useCount)
        .slice(0, 5),
    [memories]
  )

  return (
    <section aria-labelledby="memory-title" className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h2 id="memory-title" className="text-base font-semibold text-ink-primary">
          Memória
        </h2>
        <p className="text-xs text-ink-tertiary">
          O Absolem registra fatos, preferências e seu perfil para lembrar entre sessões. Tudo fica
          em SQLite nesta máquina; nada é enviado além do texto da conversa. Você pode editar,
          apagar ou pausar a qualquer momento.
        </p>
        <div className="flex flex-wrap gap-4 rounded border border-surface-2 px-3 py-2">
          <label
            className="flex items-center gap-2 text-sm text-ink-primary"
            htmlFor="memory-enabled"
          >
            <input
              id="memory-enabled"
              type="checkbox"
              checked={config.enabled}
              onChange={(event) => {
                void toggleConfig({ enabled: event.target.checked })
              }}
            />
            Memória ligada
          </label>
          <label
            className="flex items-center gap-2 text-sm text-ink-primary"
            htmlFor="memory-auto-extract"
          >
            <input
              id="memory-auto-extract"
              type="checkbox"
              checked={config.autoExtract}
              onChange={(event) => {
                void toggleConfig({ autoExtract: event.target.checked })
              }}
            />
            Extração automática
          </label>
          <span className="text-xs text-ink-tertiary">
            Pausar interrompe extração e recuperação sem apagar nada.
          </span>
        </div>
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

      <section aria-labelledby="memory-stats-title" className="flex flex-col gap-2">
        <h3 id="memory-stats-title" className="text-sm font-semibold text-ink-primary">
          Resumo
        </h3>
        <p className="text-xs text-ink-secondary" data-memory-stats>
          {stats
            ? `Total ${stats.total} · Fixadas ${stats.pinned} · Aproximadamente ${formatBytes(
                stats.approxBytes
              )} · Última extração ${formatDate(stats.lastExtractionAt)} · Última consolidação ${formatDate(
                stats.lastConsolidationAt ?? config.lastConsolidationAt
              )}`
            : 'Carregando estatísticas...'}
        </p>
        {profile.length > 0 ? (
          <div>
            <p className="text-xs text-ink-tertiary">Perfil e preferências mais usados:</p>
            <ul className="list-inside list-disc text-xs text-ink-secondary">
              {profile.map((memory) => (
                <li key={memory.id}>
                  {memory.content} ({memory.useCount} uso(s))
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="memory-list-title" className="flex flex-col gap-3">
        <h3 id="memory-list-title" className="text-sm font-semibold text-ink-primary">
          Memórias
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="memory-search" className="text-xs text-ink-secondary">
              Buscar
            </label>
            <input
              id="memory-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="palavra ou assunto"
              className="rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="memory-kind" className="text-xs text-ink-secondary">
              Tipo
            </label>
            <select
              id="memory-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as KindFilter)}
              className="rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
            >
              <option value="all">Todos</option>
              {MEMORY_KINDS.map((item) => (
                <option key={item} value={item}>
                  {MEMORY_KIND_LABELS[item]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="memory-sort" className="text-xs text-ink-secondary">
              Ordenar por
            </label>
            <select
              id="memory-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as MemorySort)}
              className="rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
            >
              <option value="date">Data</option>
              <option value="usage">Uso</option>
              <option value="confidence">Confiança</option>
            </select>
          </div>
        </div>

        {loading ? <p className="text-xs text-ink-tertiary">Carregando...</p> : null}
        {!loading && memories.length === 0 ? (
          <p className="rounded border border-surface-2 px-3 py-2 text-xs text-ink-secondary">
            Nenhuma memória encontrada. A memória guarda o que você conta nas conversas (fatos,
            preferências, perfil e lembretes temporários). Desligue a extração automática acima para
            parar de registrar sem apagar o que existe.
          </p>
        ) : null}

        <ul className="flex flex-col gap-2">
          {memories.map((memory) => (
            <li
              key={memory.id}
              data-memory-item
              className="flex flex-col gap-2 rounded border border-surface-2 px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-tertiary">
                <span className="rounded bg-surface-2 px-2 py-0.5 text-ink-secondary">
                  {MEMORY_KIND_LABELS[memory.kind]}
                </span>
                {memory.pinned ? <span>fixada</span> : null}
                <span>{formatDate(memory.updatedAt)}</span>
                {memory.kind === 'temporary' ? (
                  <span>expira em {formatDate(memory.expiresAt)}</span>
                ) : null}
                <span>{memory.useCount} uso(s)</span>
              </div>

              {editingId === memory.id ? (
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor={`memory-content-${memory.id}`}
                    className="text-xs text-ink-secondary"
                  >
                    Conteúdo
                  </label>
                  <textarea
                    id={`memory-content-${memory.id}`}
                    value={draftContent}
                    maxLength={400}
                    onChange={(event) => setDraftContent(event.target.value)}
                    className="min-h-[64px] rounded border border-surface-2 bg-surface-1 px-2 py-1 text-sm text-ink-primary"
                  />
                  <label
                    htmlFor={`memory-tags-${memory.id}`}
                    className="text-xs text-ink-secondary"
                  >
                    Tags (separadas por vírgula)
                  </label>
                  <input
                    id={`memory-tags-${memory.id}`}
                    value={draftTags}
                    onChange={(event) => setDraftTags(event.target.value)}
                    className="rounded border border-surface-2 bg-surface-1 px-2 py-1 text-sm text-ink-primary"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void saveEdit(memory.id)
                      }}
                      className="rounded bg-accent px-3 py-1 text-xs font-medium text-surface-base"
                    >
                      Salvar
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded border border-surface-2 px-3 py-1 text-xs text-ink-secondary"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-ink-primary">{memory.content}</p>
                  {memory.tags.length > 0 ? (
                    <p className="text-xs text-ink-tertiary">tags: {memory.tags.join(', ')}</p>
                  ) : null}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(memory)}
                      className="rounded border border-surface-2 px-2 py-1 text-xs text-ink-secondary"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveId(memory.id)}
                      className="rounded border border-red-400/40 px-2 py-1 text-xs text-red-300"
                    >
                      Apagar
                    </button>
                  </div>
                </>
              )}

              {confirmRemoveId === memory.id ? (
                <div className="flex flex-wrap items-center gap-2 rounded border border-red-400/40 px-2 py-1 text-xs text-red-200">
                  <span>Apagar esta memória? Não há como desfazer.</span>
                  <button
                    type="button"
                    onClick={() => {
                      void removeMemory(memory.id)
                    }}
                    className="rounded bg-red-400/20 px-2 py-1 text-red-100"
                  >
                    Confirmar
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRemoveId(null)}
                    className="rounded border border-surface-2 px-2 py-1 text-ink-secondary"
                  >
                    Cancelar
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="memory-create-title" className="flex flex-col gap-3">
        <h3 id="memory-create-title" className="text-sm font-semibold text-ink-primary">
          Adicionar memória
        </h3>
        <p className="text-xs text-ink-tertiary">
          A memória manual fica no mesmo banco local, sem cifragem. Não guarde senhas, chaves ou
          números de cartão.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="memory-new-kind" className="text-xs text-ink-secondary">
              Tipo
            </label>
            <select
              id="memory-new-kind"
              value={newKind}
              onChange={(event) => setNewKind(event.target.value as MemoryKind)}
              className="rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
            >
              {MEMORY_KINDS.map((item) => (
                <option key={item} value={item}>
                  {MEMORY_KIND_LABELS[item]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="memory-new-tags" className="text-xs text-ink-secondary">
              Tags (separadas por vírgula)
            </label>
            <input
              id="memory-new-tags"
              value={newTags}
              onChange={(event) => setNewTags(event.target.value)}
              className="rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
            />
          </div>
        </div>
        <label htmlFor="memory-new-content" className="text-xs text-ink-secondary">
          Conteúdo
        </label>
        <textarea
          id="memory-new-content"
          value={newContent}
          maxLength={400}
          onChange={(event) => setNewContent(event.target.value)}
          className="min-h-[64px] rounded border border-surface-2 bg-surface-1 px-2 py-1 text-sm text-ink-primary"
        />
        <button
          type="button"
          onClick={() => {
            void createMemory()
          }}
          className="self-start rounded border border-surface-2 px-3 py-1.5 text-xs text-ink-secondary"
        >
          Adicionar memória
        </button>
      </section>

      <section aria-labelledby="memory-io-title" className="flex flex-col gap-3">
        <h3 id="memory-io-title" className="text-sm font-semibold text-ink-primary">
          Exportar, importar e apagar
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void exportMemories()
            }}
            className="rounded border border-surface-2 px-3 py-1.5 text-xs text-ink-secondary"
          >
            Exportar memórias…
          </button>
          <label
            className="flex items-center gap-2 text-xs text-ink-secondary"
            htmlFor="memory-export-turns"
          >
            <input
              id="memory-export-turns"
              type="checkbox"
              checked={includeTranscripts}
              onChange={(event) => setIncludeTranscripts(event.target.checked)}
            />
            Incluir transcrições
          </label>
          <button
            type="button"
            onClick={() => {
              void importMemories()
            }}
            className="rounded border border-surface-2 px-3 py-1.5 text-xs text-ink-secondary"
          >
            Importar memórias…
          </button>
        </div>

        <div className="flex flex-col gap-2 rounded border border-red-400/40 px-3 py-2">
          <p className="text-xs text-red-200">
            Apagar tudo é irreversível. O banco é local e não cifrado; depois de apagar, rode a
            limpeza (VACUUM) que o app executa automaticamente.
          </p>
          <label
            className="flex items-center gap-2 text-xs text-ink-secondary"
            htmlFor="memory-include-turns"
          >
            <input
              id="memory-include-turns"
              type="checkbox"
              checked={includeTurns}
              onChange={(event) => setIncludeTurns(event.target.checked)}
            />
            Apagar também as transcrições das sessões
          </label>
          <label htmlFor="memory-confirm-all" className="text-xs text-ink-secondary">
            Escreva {MEMORY_REMOVE_ALL_CONFIRM} para confirmar
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="memory-confirm-all"
              value={confirmAllText}
              onChange={(event) => setConfirmAllText(event.target.value)}
              className="rounded border border-surface-2 bg-surface-1 px-2 py-1 text-sm text-ink-primary"
            />
            <button
              type="button"
              disabled={confirmAllText !== MEMORY_REMOVE_ALL_CONFIRM}
              onClick={() => {
                void removeAll()
              }}
              className="rounded border border-red-400/50 px-3 py-1 text-xs text-red-200 disabled:opacity-40"
            >
              Apagar tudo
            </button>
          </div>
        </div>

        <details className="rounded border border-surface-2 px-3 py-2">
          <summary className="cursor-pointer text-xs text-ink-secondary">
            Memórias arquivadas ({archived.length}, somente leitura)
          </summary>
          {archived.length === 0 ? (
            <p className="mt-2 text-xs text-ink-tertiary">Nada arquivado.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-tertiary">
              {archived.slice(0, 50).map((memory) => (
                <li key={`${memory.id}-${memory.archivedAt}`}>
                  [{MEMORY_KIND_LABELS[memory.kind]}] {memory.content} — {memory.reason} em{' '}
                  {formatDate(memory.archivedAt)}
                </li>
              ))}
            </ul>
          )}
        </details>

        <details className="rounded border border-surface-2 px-3 py-2">
          <summary className="cursor-pointer text-xs text-ink-secondary">
            Relatório de manutenção
          </summary>
          {maintenance.length === 0 ? (
            <p className="mt-2 text-xs text-ink-tertiary">Nenhuma manutenção registrada.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-tertiary">
              {maintenance.map((entry, index) => (
                <li key={`${entry.at}-${index}`}>
                  {formatDate(entry.at)} — {entry.detail}
                </li>
              ))}
            </ul>
          )}
        </details>
      </section>
    </section>
  )
}
