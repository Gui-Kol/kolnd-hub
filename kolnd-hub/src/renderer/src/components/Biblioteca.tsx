import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { entranceProps, exitProps, useReducedMotion } from '../lib/motion'
import {
  Gamepad2,
  Plus,
  ChevronDown,
  Search,
  FilePlus2,
  Loader2,
  RefreshCw,
  AlertTriangle
} from 'lucide-react'
import { Game, AddCustomGameResult } from '../types'
import { useGamesRunning } from '../hooks/useGamesRunning'
import { findMissingGameIds } from '../lib/games'
import {
  nextIconRetryIds,
  pruneIconsForReload,
  requestIconsForIds,
  retryDelayForAttempt
} from '../lib/libraryIcons'
import {
  applyLibraryFilters,
  DEFAULT_LIBRARY_FILTERS,
  hasActiveLibraryFilters,
  type LibrarySort,
  type LibrarySourceFilter
} from '../lib/libraryFilter'
import {
  Badge,
  Button,
  Skeleton,
  Toast,
  EmptyState,
  ErrorState,
  LoadingState,
  SearchInput,
  Select
} from './ui'
import { BibliotecaGrid } from './biblioteca/BibliotecaGrid'
import { BuscarJogosModal, BuscarJogosState } from './biblioteca/BuscarJogosModal'
import { EditGameModal } from './biblioteca/EditGameModal'

interface LocalToast {
  id: number
  text: string
}

/**
 * Biblioteca de jogos do Kolnd Hub — página exclusiva para jogos instalados.
 * Os cards lançam o executável via `window.api.launchGame(id)` (spawn direto,
 * sem ProcessManager), então o contador de apps ativos do Hub não é afetado.
 * Se o jogo já estiver aberto, o launch foca a janela existente em vez de
 * abrir outra instância.
 */
export function Biblioteca(): JSX.Element {
  // Movimento decorativo (entradas, menu, toast) vira fade curto com reduce.
  const reduced = useReducedMotion()
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState<LocalToast | null>(null)
  // Guarda contra reentrada enquanto o seletor/extração/salvamento está em curso.
  const [addingCustom, setAddingCustom] = useState(false)
  // Fluxo "Buscar jogos" (Steam + Epic Games + Minecraft Launcher): idle/importing/done.
  const [buscarJogos, setBuscarJogos] = useState<BuscarJogosState>({ phase: 'idle' })
  // Ícones por id: dataURL cacheada no estado do componente; `null` = sem ícone (fallback).
  const [icons, setIcons] = useState<Record<string, string | null>>({})
  const iconRequests = useRef<Set<string>>(new Set())
  // Retentativa com backoff: tentativas por id e timers pendentes.
  const iconRetryAttempts = useRef<Map<string, number>>(new Map())
  const iconRetryTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // `true` enquanto o componente está montado. Respostas de IPC antigas NÃO
  // podem ser descartadas só porque o estado mudou (o cleanup de um efeito roda
  // a cada re-render e era o que deixava 9 de 10 ícones de fora).
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return (): void => {
      mountedRef.current = false
    }
  }, [])
  // Capas por id (T6): mesma cache em memória; `null` = sem capa (card usa ícone).
  const [covers, setCovers] = useState<Record<string, string | null>>({})
  const coverRequests = useRef<Set<string>>(new Set())
  // T9 — selo ".exe não encontrado": ids cujo executável não existe mais no disco.
  const [missingExes, setMissingExes] = useState<Set<string>>(new Set())
  // Quais jogos estão com processo aberto (para habilitar o botão "Encerrar").
  const { runningIds, refresh: refreshRunning } = useGamesRunning(games)
  // T9 — jogo aberto no modal "Editar Game" (null = fechado).
  const [editing, setEditing] = useState<Game | null>(null)
  // Filtros da Biblioteca (T3/T4) — só em memória, nunca persistidos.
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [collectionFilter, setCollectionFilter] = useState('')
  const [collections, setCollections] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [source, setSource] = useState<LibrarySourceFilter>(DEFAULT_LIBRARY_FILTERS.source)
  const [missingOnly, setMissingOnly] = useState(false)
  const [sort, setSort] = useState<LibrarySort>(DEFAULT_LIBRARY_FILTERS.sort)
  // "Atualizar ícones": re-extrai de todos os executáveis de uma vez.
  const [refreshingIcons, setRefreshingIcons] = useState(false)

  // 6 s de auto-dismiss — o primitivo Toast cuida do timer e do fechar manual.
  const showToast = useCallback((text: string): void => {
    setToast({ id: Date.now(), text })
  }, [])

  const loadGames = useCallback(async (): Promise<void> => {
    setLoading(true)
    setLoadError(null)
    try {
      const list = await window.api.getGames()
      setGames(list)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar a biblioteca.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Coleções existentes (chave `gameCollections`). Falha é silenciosa: os
  // filtros continuam funcionando com "Todas" e o modal ainda cria ao salvar.
  const loadCollections = useCallback(async (): Promise<void> => {
    try {
      setCollections(await window.api.getGameCollections())
    } catch {
      // Sem coleções no seletor; nada quebra.
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      await loadCollections()
      if (cancelled) return
    }
    void run()
    return (): void => {
      cancelled = true
    }
  }, [loadCollections])

  // Cancela timer e zera tentativas de um id (ícone trocado/removido).
  const clearIconRetry = useCallback((id: string): void => {
    const timer = iconRetryTimers.current.get(id)
    if (timer) clearTimeout(timer)
    iconRetryTimers.current.delete(id)
    iconRetryAttempts.current.delete(id)
  }, [])

  const clearAllIconRetries = useCallback((): void => {
    for (const timer of iconRetryTimers.current.values()) clearTimeout(timer)
    iconRetryTimers.current.clear()
    iconRetryAttempts.current.clear()
  }, [])

  // A lista aparece primeiro; o reparo/aquisição roda em segundo plano. Quando
  // termina, os `null` cacheados são descartados e re-pedidos (o main pode ter
  // materializado/extraído/adquirido o ícone nesse meio-tempo).
  const iconReloadDone = useRef(false)

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      await loadGames()
      if (cancelled) return
      if (!iconReloadDone.current) {
        iconReloadDone.current = true
        try {
          await window.api.reloadGameIcons()
        } catch {
          // Recarregar ícones é opcional — a lista deve abrir de qualquer jeito.
        }
        if (cancelled) return
        clearAllIconRetries()
        iconRequests.current.clear()
        // Re-pede null (sem ícone) e SVG gerado (upgrade para arte real).
        setIcons((prev) => pruneIconsForReload(prev))
      }
    }
    void run()
    return (): void => {
      cancelled = true
    }
  }, [loadGames, clearAllIconRetries])

  // T9 — verifica quais executáveis da biblioteca existem no disco e marca
  // os ids ausentes para o selo ".exe não encontrado" nos cards.
  useEffect(() => {
    let cancelled = false
    if (games.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMissingExes(new Set())
      return
    }
    window.api
      .checkGameExes(games.map((game) => game.exePath))
      .then((flags) => {
        if (cancelled) return
        setMissingExes(findMissingGameIds(games, flags))
      })
      .catch(() => {
        // Sem verificação, não exibe selo nenhum — melhor do que falso positivo.
      })
    return (): void => {
      cancelled = true
    }
  }, [games])

  // Descarta a dataURL cacheada de um jogo (ícone trocado/removido) e força
  // o `useEffect` de ícones a buscar a versão nova.
  const dropIconCache = useCallback(
    (id: string): void => {
      setIcons((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
      iconRequests.current.delete(id)
      clearIconRetry(id)
    },
    [clearIconRetry]
  )

  const dropCoverCache = useCallback((id: string): void => {
    setCovers((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    coverRequests.current.delete(id)
  }, [])

  const openEdit = useCallback((game: Game): void => {
    setEditing(game)
  }, [])

  const closeEdit = useCallback((): void => {
    setEditing(null)
  }, [])

  // Salvar/remover no modal: descarta o ícone cacheado, fecha e recarrega a grade.
  const handleSaved = useCallback(
    (id: string): void => {
      dropIconCache(id)
      dropCoverCache(id)
      setEditing(null)
      void loadGames()
      // O modal também pode ter criado coleções novas.
      void loadCollections()
    },
    [dropIconCache, dropCoverCache, loadGames, loadCollections]
  )

  const handleRemoved = useCallback(
    (id: string): void => {
      dropIconCache(id)
      dropCoverCache(id)
      setEditing(null)
      void loadGames()
    },
    [dropIconCache, dropCoverCache, loadGames]
  )

  // Estrela do card: patch `favorite` na whitelist do main. Handler estável —
  // o card é `memo`, então a identidade não pode mudar a cada render.
  const handleToggleFavorite = useCallback(
    async (game: Game): Promise<void> => {
      const next = game.favorite !== true
      try {
        const result = await window.api.updateGame(game.id, { favorite: next })
        if (!result.success) {
          showToast(result.error ?? 'Não foi possível atualizar o favorito.')
          return
        }
        setGames((prev) =>
          prev.map((item) => (item.id === game.id ? { ...item, favorite: next } : item))
        )
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Não foi possível atualizar o favorito.')
      }
    },
    [showToast]
  )

  // Busca os ícones dos jogos que ainda não têm um cacheado. Cada id é
  // solicitado no máximo uma vez por montagem (iconRequests). A aplicação da
  // resposta usa `mountedRef` — re-render nenhum descarta as respostas em voo.
  useEffect(() => {
    const pendingIds = games
      .filter((game) => !(game.id in icons) && !iconRequests.current.has(game.id))
      .map((game) => game.id)
    if (pendingIds.length === 0) return
    for (const id of pendingIds) iconRequests.current.add(id)

    void requestIconsForIds(pendingIds, {
      fetchIcon: (id) => window.api.getGameIcon(id),
      apply: (id, dataUrl) => {
        if (dataUrl) clearIconRetry(id)
        setIcons((prev) => ({ ...prev, [id]: dataUrl }))
      },
      onSettled: (id, dataUrl) => {
        // Falha/ausência: libera o id para uma nova tentativa (backoff).
        if (!dataUrl) iconRequests.current.delete(id)
      },
      isMounted: () => mountedRef.current
    })
  }, [games, icons, clearIconRetry])

  // Retentativa com backoff (1 s, 2 s, 4 s) para ids que voltaram `null`.
  const scheduleIconRetry = useCallback((id: string): void => {
    if (iconRetryTimers.current.has(id)) return
    const attempt = (iconRetryAttempts.current.get(id) ?? 0) + 1
    const delay = retryDelayForAttempt(attempt)
    if (delay === null) return
    iconRetryAttempts.current.set(id, attempt)
    const timer = setTimeout(() => {
      iconRetryTimers.current.delete(id)
      window.api
        .getGameIcon(id)
        .then((dataUrl) => {
          if (!mountedRef.current) return
          if (dataUrl) iconRetryAttempts.current.delete(id)
          setIcons((prev) => {
            if (!dataUrl) return { ...prev, [id]: null }
            return prev[id] === dataUrl ? prev : { ...prev, [id]: dataUrl }
          })
        })
        .catch(() => {
          if (!mountedRef.current) return
          setIcons((prev) => ({ ...prev, [id]: null }))
        })
    }, delay)
    iconRetryTimers.current.set(id, timer)
  }, [])

  useEffect(() => {
    if (loading) return
    const retryIds = nextIconRetryIds(
      games,
      icons,
      iconRetryAttempts.current,
      new Set(iconRetryTimers.current.keys())
    )
    for (const id of retryIds) scheduleIconRetry(id)
  }, [loading, games, icons, scheduleIconRetry])

  // Cancela todos os timers ao desmontar (sem setState depois).
  useEffect(() => () => clearAllIconRetries(), [clearAllIconRetries])

  // Capas: mesma estratégia dos ícones (mountedRef + liberação em falha).
  useEffect(() => {
    const pendingIds = games
      .filter((game) => !(game.id in covers) && !coverRequests.current.has(game.id))
      .map((game) => game.id)
    if (pendingIds.length === 0) return
    for (const id of pendingIds) coverRequests.current.add(id)

    void requestIconsForIds(pendingIds, {
      fetchIcon: (id) => window.api.getGameCover(id),
      apply: (id, dataUrl) => {
        setCovers((prev) => ({ ...prev, [id]: dataUrl }))
      },
      onSettled: (id, dataUrl) => {
        if (!dataUrl) coverRequests.current.delete(id)
      },
      isMounted: () => mountedRef.current
    })
  }, [games, covers])

  const handleLaunch = useCallback(
    async (game: Game): Promise<void> => {
      const result = await window.api.launchGame(game.id)
      if (!result.ok) {
        showToast(`Não foi possível iniciar ${game.name}: ${result.error ?? 'erro desconhecido'}`)
        return
      }
      showToast(
        result.focused
          ? `${game.name} já está aberto — trazendo a janela para frente.`
          : result.alreadyRunning
            ? `${game.name} já está em execução — aguarde a janela.`
            : `Iniciando ${game.name}…`
      )
      void refreshRunning()
    },
    [showToast, refreshRunning]
  )

  // Encerramento pelo Hub (botão só fica habilitado com o jogo aberto).
  const handleGameStopped = useCallback(
    (game: Game, result: { ok: boolean; error?: string }): void => {
      showToast(
        result.ok
          ? `Encerrando ${game.name}…`
          : `Não foi possível encerrar ${game.name}: ${result.error ?? 'erro desconhecido'}`
      )
      void refreshRunning()
    },
    [showToast, refreshRunning]
  )

  // "Atualizar ícones automáticos": o main re-extrai do executável apenas os
  // ícones que não foram escolhidos à mão (`iconOrigin:'manual'` é preservado).
  // Depois limpamos o cache do renderer e a grade busca as imagens novas.
  const handleRefreshIcons = useCallback(async (): Promise<void> => {
    if (refreshingIcons) return
    setRefreshingIcons(true)
    try {
      const result = await window.api.refreshGameIcons()
      iconRequests.current.clear()
      clearAllIconRetries()
      setIcons({})
      if (result.checked === 0) {
        showToast('Sua biblioteca está vazia — nada para atualizar.')
      } else if (result.refreshed === 0 && result.failed === 0) {
        showToast('Nenhum ícone automático para atualizar — os ícones manuais são preservados.')
      } else if (result.refreshed === 0) {
        showToast('Não foi possível atualizar os ícones dos jogos.')
      } else if (result.failed > 0) {
        showToast(
          `Ícones atualizados: ${result.refreshed} de ${result.checked}. ${result.failed} sem ícone utilizável.`
        )
      } else {
        showToast(`Ícones atualizados: ${result.refreshed} de ${result.checked}.`)
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível atualizar os ícones.')
    } finally {
      setRefreshingIcons(false)
    }
  }, [refreshingIcons, showToast, clearAllIconRetries])

  // "Jogo Personalizado" (T8): abre o seletor nativo filtrado para .exe,
  // o main deriva o nome/extrai o ícone/persiste via `games:add-custom`,
  // a grade recarrega e um toast confirma. Cancelar o seletor não tem efeito.
  const handleAddCustom = useCallback(async (): Promise<void> => {
    setMenuOpen(false)
    if (addingCustom) return
    setAddingCustom(true)
    try {
      const picked = await window.api.pickAppPath(
        'file',
        undefined,
        'Selecione o executável do jogo'
      )
      if (!picked.success) {
        // Cancelado pelo usuário: nada acontece (sem toast de erro).
        if (picked.error) showToast(`Não foi possível escolher o arquivo: ${picked.error}`)
        return
      }
      if (!picked.path) return
      const result: AddCustomGameResult = await window.api.addCustomGame(picked.path)
      if (!result.success) {
        showToast(result.error ?? 'Não foi possível adicionar o jogo.')
        return
      }
      await loadGames()
      showToast(`Jogo adicionado à sua biblioteca: ${result.name ?? 'jogo personalizado'}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível adicionar o jogo.')
    } finally {
      setAddingCustom(false)
    }
  }, [addingCustom, loadGames, showToast])

  // Busca jogos instalados em todas as fontes suportadas (Steam, Epic Games e
  // Minecraft Launcher): fecha o menu, abre o modal em "Procurando…" e só
  // recarrega a grade quando o relatório geral der certo.
  const handleFindGames = useCallback(async (): Promise<void> => {
    setMenuOpen(false)
    setBuscarJogos({ phase: 'importing' })
    try {
      const result = await window.api.importGames()
      setBuscarJogos({ phase: 'done', result })
      if (result.ok) void loadGames()
    } catch (err) {
      setBuscarJogos({
        phase: 'done',
        result: {
          ok: false,
          sources: [],
          imported: 0,
          error: err instanceof Error ? err.message : 'Não foi possível buscar os jogos.'
        }
      })
    }
  }, [loadGames])

  const closeFindGames = useCallback((): void => {
    // Não fecha enquanto a varredura está em andamento (o IPC não é cancelável).
    setBuscarJogos((current) => (current.phase === 'importing' ? current : { phase: 'idle' }))
  }, [])

  // Filtros em memória (T3/T4). A busca ignora acento/caixa; coleção compara
  // sem diferenciar caixa. "Sem executável" usa o conjunto já calculado.
  const filterState = {
    search,
    source,
    collection: collectionFilter,
    missingOnly,
    sort
  }
  const filteredByLib = applyLibraryFilters(games, filterState, missingExes)
  const visibleGames = favoriteOnly
    ? filteredByLib.filter((game) => game.favorite === true)
    : filteredByLib
  const filtersActive = favoriteOnly || hasActiveLibraryFilters(filterState)
  const clearFilters = (): void => {
    setFavoriteOnly(false)
    setCollectionFilter('')
    setSearch('')
    setSource(DEFAULT_LIBRARY_FILTERS.source)
    setMissingOnly(false)
    setSort(DEFAULT_LIBRARY_FILTERS.sort)
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* ── Header ─────────────────────────────────── */}
      <motion.div
        {...entranceProps(reduced, { y: -10 })}
        className="flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div>
          <h2 className="text-[28px] font-bold leading-9 tracking-tight text-ink-primary md:text-[32px] md:leading-10">
            Biblioteca
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-secondary">
            Seus jogos instalados, num só lugar
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="neutral" className="px-3 py-1 text-[11px]">
            <Gamepad2 size={12} aria-hidden="true" />
            <span className="tnum">
              {games.length} {games.length === 1 ? 'jogo' : 'jogos'}
            </span>
          </Badge>

          {/* "Atualizar ícones automáticos": preserva os escolhidos à mão. */}
          <Button
            variant="secondary"
            onClick={() => void handleRefreshIcons()}
            disabled={loading || refreshingIcons || games.length === 0}
            title="Re-extrai o ícone dos jogos automáticos a partir dos executáveis. Ícones escolhidos manualmente são preservados."
          >
            {refreshingIcons ? (
              <Loader2 size={16} aria-hidden="true" className="animate-spin" />
            ) : (
              <RefreshCw size={16} aria-hidden="true" />
            )}
            {refreshingIcons ? 'Atualizando…' : 'Atualizar ícones automáticos'}
          </Button>

          {/* ── Botão "Adicionar Games" + menu ───────── */}
          <div className="relative">
            <Button
              variant="primary"
              onClick={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <Plus size={16} aria-hidden="true" />
              Adicionar Games
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={`transition-transform duration-2 ease-standard ${menuOpen ? 'rotate-180' : ''}`}
              />
            </Button>

            <AnimatePresence>
              {menuOpen && (
                <>
                  {/* Overlay para fechar ao clicar fora do menu */}
                  <button
                    type="button"
                    aria-label="Fechar menu"
                    className="fixed inset-0 z-10 cursor-default bg-transparent"
                    onClick={() => setMenuOpen(false)}
                  />
                  <motion.div
                    role="menu"
                    {...entranceProps(reduced, { y: -6, scale: 0.96 }, { duration: 0.15 })}
                    exit={exitProps(reduced, { y: -6, scale: 0.96 })}
                    className="absolute right-0 z-dropdown mt-2 w-72 overflow-hidden rounded-card border border-[var(--border-subtle)] bg-surface-1 shadow-elevation-3"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleFindGames()}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-ink-primary transition-colors duration-1 ease-standard hover:bg-surface-2"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-surface-2">
                        <Search size={16} aria-hidden="true" className="text-ink-secondary" />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium">Buscar jogos</span>
                        <span className="mt-0.5 block text-[11px] text-ink-tertiary">
                          Procura jogos instalados na Steam, Epic Games e Minecraft Launcher
                        </span>
                      </span>
                    </button>
                    <div aria-hidden="true" className="h-px bg-[var(--border-subtle)]" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleAddCustom()}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-ink-primary transition-colors duration-1 ease-standard hover:bg-surface-2"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-surface-2">
                        <FilePlus2 size={16} aria-hidden="true" className="text-ink-secondary" />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium">Jogo Personalizado</span>
                        <span className="mt-0.5 block text-[11px] text-ink-tertiary">
                          Escolha um executável (.exe) no seu PC
                        </span>
                      </span>
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>

      {/* ── Filtros da Biblioteca (T3/T4) ───────────── */}
      {!loading && !loadError && games.length > 0 && (
        <div
          role="group"
          aria-label="Filtros da biblioteca"
          className="flex flex-col gap-3 rounded-card border border-[var(--border-subtle)] bg-surface-1 p-3"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="w-full lg:max-w-xs">
              <SearchInput
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nome…"
                aria-label="Buscar jogos por nome"
              />
            </div>

            <div className="flex w-fit items-center gap-1 rounded-control border border-[var(--border-subtle)] bg-surface-sunken p-1">
              {(
                [
                  { value: false, label: 'Todos' },
                  { value: true, label: 'Favoritos' }
                ] as const
              ).map((option) => (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={favoriteOnly === option.value}
                  onClick={() => setFavoriteOnly(option.value)}
                  className={`rounded-sm px-3 py-1.5 text-xs font-semibold transition-colors duration-1 ease-standard ${
                    favoriteOnly === option.value
                      ? 'bg-surface-3 text-ink-primary'
                      : 'text-ink-secondary hover:text-ink-primary'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="w-full sm:w-52">
              <Select
                aria-label="Filtrar por coleção"
                value={collectionFilter}
                onChange={(event) => setCollectionFilter(event.target.value)}
              >
                <option value="">Todas as coleções</option>
                {collections.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="w-full sm:w-44">
              <Select
                aria-label="Filtrar por origem"
                value={source}
                onChange={(event) => setSource(event.target.value as LibrarySourceFilter)}
              >
                <option value="all">Todas as origens</option>
                <option value="steam">Steam</option>
                <option value="epic">Epic Games</option>
                <option value="minecraft">Minecraft</option>
                <option value="custom">Personalizado</option>
              </Select>
            </div>

            <div className="w-full sm:w-48">
              <Select
                aria-label="Ordenar jogos"
                value={sort}
                onChange={(event) => setSort(event.target.value as LibrarySort)}
              >
                <option value="name-asc">Nome A–Z</option>
                <option value="name-desc">Nome Z–A</option>
                <option value="playtime-desc">Tempo de jogo</option>
                <option value="recent">Mais recentes</option>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={missingOnly}
              onClick={() => setMissingOnly((value) => !value)}
              className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-xs font-semibold transition-colors duration-1 ease-standard ${
                missingOnly
                  ? 'border-warn-border bg-warn-bg text-warn'
                  : 'border-[var(--border-subtle)] bg-surface-2 text-ink-secondary hover:border-[var(--border-strong)] hover:text-ink-primary'
              }`}
            >
              <AlertTriangle size={12} aria-hidden="true" />
              Sem executável
            </button>

            {filtersActive && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Limpar filtros
              </Button>
            )}

            <span className="tnum ml-auto text-[11px] text-ink-tertiary">
              {visibleGames.length} de {games.length} {games.length === 1 ? 'jogo' : 'jogos'}
            </span>
          </div>
        </div>
      )}

      {/* ── Estados ────────────────────────────────── */}
      {loading ? (
        <div aria-busy="true" className="flex flex-col gap-6">
          <LoadingState label="Carregando sua biblioteca…" className="pb-0" />
          {/* Grade fantasma — skeleton dos tiles, mesmo layout da grade real */}
          <div
            aria-hidden="true"
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          >
            {Array.from({ length: 10 }, (_, index) => (
              <div
                key={index}
                className="flex flex-col items-center gap-3 rounded-card border border-[var(--border-subtle)] bg-surface-1 p-5 pt-6"
              >
                <Skeleton rounded="control" className="h-24 w-24" />
                <Skeleton rounded="sm" className="h-4 w-4/5" />
                <div className="flex gap-2">
                  <Skeleton rounded="pill" className="h-5 w-20" />
                  <Skeleton rounded="pill" className="h-5 w-16" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : loadError ? (
        <ErrorState
          title="Não foi possível carregar sua biblioteca."
          message={loadError ?? 'Tente novamente em instantes.'}
          onRetry={() => void loadGames()}
        />
      ) : games.length === 0 ? (
        <EmptyState
          icon={Gamepad2}
          tone="accent"
          title="Sua biblioteca está vazia"
          hint={
            <>
              Clique em <span className="font-semibold text-ink-primary">Adicionar Games</span> para
              começar
            </>
          }
          action={
            <Button variant="primary" onClick={() => setMenuOpen(true)}>
              <Plus size={16} aria-hidden="true" />
              Adicionar Games
            </Button>
          }
          className="p-16"
        />
      ) : visibleGames.length === 0 ? (
        <EmptyState
          icon={Gamepad2}
          tone="muted"
          title="Nenhum jogo neste filtro"
          hint="Ajuste a busca/coleção ou limpe os filtros para ver a biblioteca inteira."
          action={
            <Button variant="secondary" onClick={clearFilters}>
              Limpar filtros
            </Button>
          }
        />
      ) : (
        /* ── Grade de jogos ─────────────────────────── */
        <BibliotecaGrid
          games={visibleGames}
          icons={icons}
          covers={covers}
          runningIds={runningIds}
          missingExes={missingExes}
          onLaunch={handleLaunch}
          onEdit={openEdit}
          onToggleFavorite={handleToggleFavorite}
          onStopped={handleGameStopped}
        />
      )}

      {/* ── Modal "Buscar jogos" (Steam + Epic Games + Minecraft Launcher) ── */}
      <BuscarJogosModal state={buscarJogos} onClose={closeFindGames} />

      {/* ── Modal "Editar Game" (T9) ────────────────────── */}
      <AnimatePresence>
        {editing && (
          <EditGameModal
            key={`${editing.id}:${editing.addedAt}`}
            game={editing}
            currentIcon={icons[editing.id] ?? null}
            currentCover={covers[editing.id] ?? null}
            exeMissing={missingExes.has(editing.id)}
            showToast={showToast}
            onClose={closeEdit}
            onSaved={handleSaved}
            onRemoved={handleRemoved}
          />
        )}
      </AnimatePresence>

      {/* ── Toast local (primitivo Toast; coexiste com o toast global do App) ── */}
      {toast && (
        <Toast
          key={toast.id}
          kind="info"
          message={toast.text}
          duration={6000}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  )
}
