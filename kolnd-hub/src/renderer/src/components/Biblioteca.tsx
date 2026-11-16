import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { entranceProps, exitProps, useReducedMotion } from '../lib/motion'
import { Gamepad2, Plus, ChevronDown, Download, FilePlus2, AlertTriangle, X } from 'lucide-react'
import { Game, AddCustomGameResult } from '../types'
import { useGamesRunning } from '../hooks/useGamesRunning'
import { findMissingGameIds } from '../lib/games'
import { Badge, Button, Card, Spinner, Skeleton } from './ui'
import { BibliotecaGrid } from './biblioteca/BibliotecaGrid'
import { SteamImportModal, SteamImportState } from './biblioteca/SteamImportModal'
import { EditGameModal } from './biblioteca/EditGameModal'

interface Toast {
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
  const [toast, setToast] = useState<Toast | null>(null)
  // Guarda contra reentrada enquanto o seletor/extração/salvamento está em curso.
  const [addingCustom, setAddingCustom] = useState(false)
  const [steamImport, setSteamImport] = useState<SteamImportState>({ phase: 'idle' })
  // Ícones por id: dataURL cacheada no estado do componente; `null` = sem ícone (fallback).
  const [icons, setIcons] = useState<Record<string, string | null>>({})
  const iconRequests = useRef<Set<string>>(new Set())
  // T9 — selo ".exe não encontrado": ids cujo executável não existe mais no disco.
  const [missingExes, setMissingExes] = useState<Set<string>>(new Set())
  // Quais jogos estão com processo aberto (para habilitar o botão "Encerrar").
  const { runningIds, refresh: refreshRunning } = useGamesRunning(games)
  // T9 — jogo aberto no modal "Editar Game" (null = fechado).
  const [editing, setEditing] = useState<Game | null>(null)

  const showToast = useCallback((text: string): void => {
    setToast({ id: Date.now(), text })
  }, [])

  // Auto-dismiss do toast local.
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 6000)
    return (): void => window.clearTimeout(timer)
  }, [toast])

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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadGames()
  }, [loadGames])

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
  const dropIconCache = useCallback((id: string): void => {
    setIcons((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    iconRequests.current.delete(id)
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
      setEditing(null)
      void loadGames()
    },
    [dropIconCache, loadGames]
  )

  const handleRemoved = useCallback(
    (id: string): void => {
      dropIconCache(id)
      setEditing(null)
      void loadGames()
    },
    [dropIconCache, loadGames]
  )

  // Busca os ícones dos jogos que ainda não têm um cacheado. Cada id é
  // solicitado no máximo uma vez por montagem (iconRequests).
  useEffect(() => {
    let cancelled = false
    for (const game of games) {
      if (game.id in icons) continue
      if (iconRequests.current.has(game.id)) continue
      iconRequests.current.add(game.id)
      window.api
        .getGameIcon(game.id)
        .then((dataUrl) => {
          if (cancelled) return
          setIcons((prev) => ({ ...prev, [game.id]: dataUrl }))
        })
        .catch(() => {
          if (cancelled) return
          setIcons((prev) => ({ ...prev, [game.id]: null }))
        })
    }
    return (): void => {
      cancelled = true
    }
  }, [games, icons])

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

  // Importa os jogos da Steam: fecha o menu, mostra "Importando…" e, ao
  // concluir, abre o modal-resumo e recarrega a grade.
  const handleImportSteam = useCallback(async (): Promise<void> => {
    setMenuOpen(false)
    setSteamImport({ phase: 'importing' })
    try {
      const result = await window.api.importSteamGames()
      setSteamImport({ phase: 'done', result })
      if (result.ok) void loadGames()
    } catch (err) {
      setSteamImport({
        phase: 'done',
        result: {
          ok: false,
          imported: 0,
          alreadyInLibrary: 0,
          ignoredTools: 0,
          noExe: 0,
          errors: [],
          error: err instanceof Error ? err.message : 'Não foi possível importar os jogos da Steam.'
        }
      })
    }
  }, [loadGames])

  const closeSteamImport = useCallback((): void => {
    // Não fecha enquanto a importação está em andamento (o IPC não pode ser cancelado).
    setSteamImport((current) => (current.phase === 'importing' ? current : { phase: 'idle' }))
  }, [])

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
        <div className="flex items-center gap-3">
          <Badge tone="neutral" className="px-3 py-1 text-[11px]">
            <Gamepad2 size={12} aria-hidden="true" />
            <span className="tnum">
              {games.length} {games.length === 1 ? 'jogo' : 'jogos'}
            </span>
          </Badge>

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
                      onClick={() => void handleImportSteam()}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-ink-primary transition-colors duration-1 ease-standard hover:bg-surface-2"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-surface-2">
                        <Download size={16} aria-hidden="true" className="text-ink-secondary" />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium">Importar jogos da Steam</span>
                        <span className="mt-0.5 block text-[11px] text-ink-tertiary">
                          Detecta os jogos instalados via Steam
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

      {/* ── Estados ────────────────────────────────── */}
      {loading ? (
        <div className="flex flex-col gap-6" aria-busy="true">
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-ink-secondary">
            <Spinner size={32} label="Carregando sua biblioteca…" />
            <p className="text-sm">Carregando sua biblioteca…</p>
          </div>
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
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <AlertTriangle size={32} aria-hidden="true" className="text-danger" />
          <p className="text-sm text-ink-primary">Não foi possível carregar sua biblioteca.</p>
          <p className="text-xs text-ink-secondary">{loadError}</p>
          <Button variant="secondary" onClick={() => void loadGames()} className="mt-2">
            Tentar novamente
          </Button>
        </Card>
      ) : games.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 p-16 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-card border border-accent-border bg-accent-muted">
            <Gamepad2 size={32} aria-hidden="true" className="text-accent" />
          </div>
          <h3 className="text-lg font-bold tracking-tight text-ink-primary">
            Sua biblioteca está vazia
          </h3>
          <p className="max-w-md text-sm text-ink-secondary">
            Clique em <span className="font-semibold text-ink-primary">Adicionar Games</span> para
            começar
          </p>
          <Button variant="primary" onClick={() => setMenuOpen(true)} className="mt-2">
            <Plus size={16} aria-hidden="true" />
            Adicionar Games
          </Button>
        </Card>
      ) : (
        /* ── Grade de jogos ─────────────────────────── */
        <BibliotecaGrid
          games={games}
          icons={icons}
          runningIds={runningIds}
          missingExes={missingExes}
          onLaunch={handleLaunch}
          onEdit={openEdit}
          onStopped={handleGameStopped}
        />
      )}

      {/* ── Modal "Importar jogos da Steam" ────────────── */}
      <SteamImportModal state={steamImport} onClose={closeSteamImport} />

      {/* ── Modal "Editar Game" (T9) ────────────────────── */}
      <AnimatePresence>
        {editing && (
          <EditGameModal
            key={`${editing.id}:${editing.addedAt}`}
            game={editing}
            currentIcon={icons[editing.id] ?? null}
            exeMissing={missingExes.has(editing.id)}
            showToast={showToast}
            onClose={closeEdit}
            onSaved={handleSaved}
            onRemoved={handleRemoved}
          />
        )}
      </AnimatePresence>

      {/* ── Toast local ─────────────────────────────── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            {...entranceProps(reduced, { y: 20, scale: 0.95 })}
            exit={exitProps(reduced, { y: 10, scale: 0.95 })}
            className="fixed bottom-6 right-6 z-[60] flex max-w-md items-start gap-3 rounded-xl border border-steam-blue/25 bg-[#0d1420]/95 px-4 py-3 shadow-2xl shadow-black/50 backdrop-blur-xl"
          >
            <Gamepad2 size={16} className="mt-0.5 shrink-0 text-steam-blue" />
            <p className="text-xs leading-relaxed text-slate-100">{toast.text}</p>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="ml-2 shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:text-white"
              aria-label="Fechar aviso"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
