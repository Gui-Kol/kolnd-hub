import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Gamepad2,
  Plus,
  ChevronDown,
  Download,
  FilePlus2,
  Pencil,
  Loader2,
  AlertTriangle,
  ImagePlus,
  RotateCcw,
  Trash2,
  X,
  Square
} from 'lucide-react'
import { Game, SteamImportResult, AddCustomGameResult } from '../types'
import { useGamesRunning } from '../hooks/useGamesRunning'

interface Toast {
  id: number
  text: string
}

/** Estado do fluxo "Importar jogos da Steam" (menu Adicionar Games → modal). */
type SteamImportState =
  { phase: 'idle' } | { phase: 'importing' } | { phase: 'done'; result: SteamImportResult }

/**
 * Botão "Encerrar jogo" — só pode ser pressionado quando o jogo estiver
 * aberto (disabled caso contrário). Confirmação em duas etapas inline
 * ("Encerrar" → "Confirmar?" por 4 s), para não perder progresso por um
 * clique acidental.
 */
function StopGameButton({
  game,
  running,
  onStopped
}: {
  game: Game
  running: boolean
  onStopped: (game: Game, result: { ok: boolean; error?: string }) => void
}): JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const timeoutRef = useRef<number | null>(null)

  useEffect(
    () => (): void => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    },
    []
  )

  // Jogo fechado por conta própria: sai do modo de confirmação.
  // (Ajuste de estado durante o render — padrão oficial "you might not need an effect".)
  const [prevRunning, setPrevRunning] = useState(running)
  if (running !== prevRunning) {
    setPrevRunning(running)
    if (!running) setConfirming(false)
  }

  const handleActivate = useCallback(
    async (event: React.SyntheticEvent): Promise<void> => {
      event.stopPropagation()
      if (!running) return
      if (!confirming) {
        setConfirming(true)
        timeoutRef.current = window.setTimeout(() => setConfirming(false), 4000)
        return
      }
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      setConfirming(false)
      try {
        const result = await window.api.stopGame(game.id)
        onStopped(game, result)
      } catch (err) {
        onStopped(game, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
    [confirming, game, onStopped, running]
  )

  return (
    <span
      role="button"
      tabIndex={running ? 0 : -1}
      aria-label={`Encerrar ${game.name}`}
      aria-disabled={!running}
      aria-pressed={confirming}
      title={
        running
          ? confirming
            ? 'Clique de novo para encerrar o jogo'
            : `Encerrar ${game.name}`
          : 'O jogo não está em execução'
      }
      onClick={(event) => void handleActivate(event)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          void handleActivate(event)
        }
      }}
      className={`absolute top-2 right-12 inline-flex h-[30px] items-center justify-center rounded-lg border border-transparent p-2 text-red-400 transition-colors focus:outline-none focus:ring-2 focus:ring-red-400/50 ${
        !running
          ? 'cursor-not-allowed text-slate-700'
          : confirming
            ? 'border-red-500/40 bg-red-500/15 text-red-300'
            : 'hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 cursor-pointer'
      }`}
    >
      {confirming ? (
        <span className="text-[9px] font-bold uppercase tracking-wide">Confirmar?</span>
      ) : (
        <Square size={13} />
      )}
    </span>
  )
}

/**
 * Biblioteca de jogos do Kolnd Hub — página exclusiva para jogos instalados.
 * Os cards lançam o executável via `window.api.launchGame(id)` (spawn direto,
 * sem ProcessManager), então o contador de apps ativos do Hub não é afetado.
 * Se o jogo já estiver aberto, o launch foca a janela existente em vez de
 * abrir outra instância.
 */
export function Biblioteca(): JSX.Element {
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
        setMissingExes(new Set(games.filter((_, i) => flags[i] === false).map((g) => g.id)))
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
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight gradient-text bg-gradient-to-r from-steam-blue to-neon-cyan text-shadow">
            Biblioteca
          </h2>
          <p className="text-sm text-slate-400 mt-1">Seus jogos instalados, num só lugar</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="glass rounded-xl px-4 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <Gamepad2 size={12} className="text-slate-500" />
            <span>
              {games.length} {games.length === 1 ? 'jogo' : 'jogos'}
            </span>
          </div>

          {/* ── Botão "Adicionar Games" + menu ───────── */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="btn-primary"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <Plus size={16} />
              Adicionar Games
              <ChevronDown
                size={14}
                className={`transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`}
              />
            </button>

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
                    initial={{ opacity: 0, y: -6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 z-20 mt-2 w-72 glass-card border border-white/[0.08] shadow-2xl overflow-hidden"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleImportSteam()}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-slate-200 hover:bg-white/[0.05] transition-colors"
                    >
                      <div className="w-9 h-9 rounded-lg bg-steam-blue/10 border border-steam-blue/30 flex items-center justify-center shrink-0">
                        <Download size={16} className="text-steam-blue" />
                      </div>
                      <span className="min-w-0">
                        <span className="block font-medium">Importar jogos da Steam</span>
                        <span className="block text-[11px] text-slate-500 mt-0.5">
                          Detecta os jogos instalados via Steam
                        </span>
                      </span>
                    </button>
                    <div className="h-px bg-white/[0.06]" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleAddCustom()}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-slate-200 hover:bg-white/[0.05] transition-colors"
                    >
                      <div className="w-9 h-9 rounded-lg bg-kloud-500/10 border border-kloud-500/30 flex items-center justify-center shrink-0">
                        <FilePlus2 size={16} className="text-kloud-500" />
                      </div>
                      <span className="min-w-0">
                        <span className="block font-medium">Jogo Personalizado</span>
                        <span className="block text-[11px] text-slate-500 mt-0.5">
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
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-slate-500">
          <Loader2 size={32} className="animate-spin text-steam-blue" />
          <p className="text-sm">Carregando sua biblioteca…</p>
        </div>
      ) : loadError ? (
        <div className="glass-card p-10 flex flex-col items-center text-center gap-3">
          <AlertTriangle size={28} className="text-red-400" />
          <p className="text-sm text-slate-300">Não foi possível carregar sua biblioteca.</p>
          <p className="text-xs text-slate-500">{loadError}</p>
          <button type="button" onClick={() => void loadGames()} className="btn-secondary mt-2">
            Tentar novamente
          </button>
        </div>
      ) : games.length === 0 ? (
        <div className="glass-card p-16 flex flex-col items-center text-center gap-4">
          <div className="w-20 h-20 rounded-3xl bg-steam-blue/10 border border-steam-blue/20 flex items-center justify-center">
            <Gamepad2 size={36} className="text-steam-blue" />
          </div>
          <h3 className="text-lg font-bold text-slate-200">Sua biblioteca está vazia</h3>
          <p className="text-sm text-slate-500 max-w-md">
            Clique em <span className="text-slate-300 font-semibold">Adicionar Games</span> para
            começar
          </p>
          <button type="button" onClick={() => setMenuOpen(true)} className="btn-primary mt-2">
            <Plus size={16} />
            Adicionar Games
          </button>
        </div>
      ) : (
        /* ── Grade de jogos ─────────────────────────── */
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {games.map((game) => {
            const icon = icons[game.id]
            return (
              <button
                key={game.id}
                type="button"
                onClick={() => void handleLaunch(game)}
                title={`Jogar ${game.name}`}
                className="glass-card glass-hover group relative flex flex-col items-center gap-3 p-5 pt-6 text-center focus:outline-none focus:ring-2 focus:ring-steam-blue/50"
              >
                {/* Encerramento pelo Hub — só fica habilitado com o jogo aberto */}
                <StopGameButton
                  game={game}
                  running={runningIds.has(game.id)}
                  onStopped={handleGameStopped}
                />

                {/* Edição (T9) — abre o modal "Editar Game" */}
                <span
                  role="button"
                  tabIndex={0}
                  title="Editar jogo"
                  aria-label={`Editar ${game.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    openEdit(game)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      event.stopPropagation()
                      openEdit(game)
                    }
                  }}
                  className="absolute top-2 right-2 p-2 rounded-lg text-slate-500 border border-transparent hover:text-white hover:bg-white/[0.06] hover:border-white/10 transition-colors cursor-pointer"
                >
                  <Pencil size={14} />
                </span>

                {/* Selo discreto quando o executável não existe mais no disco */}
                {missingExes.has(game.id) && (
                  <span
                    role="button"
                    tabIndex={0}
                    title="O executável configurado não foi encontrado no disco — clique para editar"
                    aria-label="Executável não encontrado — editar jogo"
                    onClick={(event) => {
                      event.stopPropagation()
                      openEdit(game)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        event.stopPropagation()
                        openEdit(game)
                      }
                    }}
                    className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-1 text-[9px] font-bold uppercase tracking-wide text-amber-400 hover:bg-amber-500/20 transition-colors cursor-pointer"
                  >
                    <AlertTriangle size={10} />
                    .exe não encontrado
                  </span>
                )}

                <div className="w-24 h-24 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center overflow-hidden shrink-0 group-hover:border-steam-blue/30 transition-colors">
                  {icon ? (
                    <img
                      src={icon}
                      alt={`Ícone de ${game.name}`}
                      className="w-full h-full object-contain"
                      draggable={false}
                    />
                  ) : (
                    <Gamepad2
                      size={38}
                      className="text-slate-600 group-hover:text-slate-500 transition-colors"
                    />
                  )}
                </div>

                <p className="text-sm font-semibold text-slate-200 leading-snug line-clamp-2 w-full">
                  {game.name}
                </p>
                <div className="flex items-center gap-2">
                  {runningIds.has(game.id) && (
                    <span
                      className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400"
                      title="O jogo está aberto (processo detectado)"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      Em execução
                    </span>
                  )}
                  <span className={game.origin === 'steam' ? 'badge-steam' : 'badge-kloud'}>
                    {game.origin === 'steam' ? 'Steam' : 'Personalizado'}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* ── Modal "Importar jogos da Steam" ────────────── */}
      <AnimatePresence>
        {steamImport.phase !== 'idle' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop — não fecha durante a importação (o IPC não pode ser cancelado) */}
            <button
              type="button"
              aria-label="Fechar"
              className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
              onClick={closeSteamImport}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Importar jogos da Steam"
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.18 }}
              className="relative glass-card border border-white/[0.08] shadow-2xl w-full max-w-md p-6"
            >
              {steamImport.phase === 'importing' ? (
                <div className="flex flex-col items-center text-center gap-4 py-4">
                  <Loader2 size={32} className="animate-spin text-steam-blue" />
                  <div>
                    <h3 className="text-base font-bold text-slate-100">
                      Importando jogos da Steam…
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Detectando os jogos instalados. Isso pode levar alguns segundos.
                    </p>
                  </div>
                </div>
              ) : !steamImport.result.ok ? (
                <div className="flex flex-col items-center text-center gap-3 py-2">
                  <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                    <AlertTriangle size={24} className="text-red-400" />
                  </div>
                  <h3 className="text-base font-bold text-slate-100">Não foi possível importar</h3>
                  <p className="text-sm text-slate-400">
                    {steamImport.result.error ?? 'Ocorreu um erro inesperado.'}
                  </p>
                  <button type="button" onClick={closeSteamImport} className="btn-primary mt-2">
                    Fechar
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-steam-blue/10 border border-steam-blue/30 flex items-center justify-center shrink-0">
                      <Download size={18} className="text-steam-blue" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-100">Importação concluída</h3>
                      <p className="text-[11px] text-slate-500">
                        Jogos detectados na sua instalação da Steam
                      </p>
                    </div>
                  </div>

                  <ul className="space-y-2 text-sm text-slate-300">
                    <li className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] pb-2">
                      <span>Jogos importados</span>
                      <span className="text-lg font-bold text-neon-cyan">
                        {steamImport.result.imported}
                      </span>
                    </li>
                    <li className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] pb-2">
                      <span>Já estavam na biblioteca</span>
                      <span className="text-lg font-bold text-slate-200">
                        {steamImport.result.alreadyInLibrary}
                      </span>
                    </li>
                    <li className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] pb-2">
                      <span>Itens ignorados (ferramentas)</span>
                      <span className="text-lg font-bold text-slate-200">
                        {steamImport.result.ignoredTools}
                      </span>
                    </li>
                    {steamImport.result.noExe > 0 && (
                      <li className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] pb-2">
                        <span>Sem executável localizado</span>
                        <span className="text-lg font-bold text-amber-400">
                          {steamImport.result.noExe}
                        </span>
                      </li>
                    )}
                    {steamImport.result.errors.length > 0 && (
                      <li className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] pb-2">
                        <span>Com erro</span>
                        <span className="text-lg font-bold text-red-400">
                          {steamImport.result.errors.length}
                        </span>
                      </li>
                    )}
                  </ul>

                  {steamImport.result.errors.length > 0 && (
                    <div className="max-h-28 overflow-y-auto rounded-lg border border-red-500/15 bg-red-500/5 px-3 py-2 space-y-1">
                      {steamImport.result.errors.slice(0, 5).map((message, index) => (
                        <p key={index} className="text-[11px] leading-snug text-red-300/90">
                          {message}
                        </p>
                      ))}
                      {steamImport.result.errors.length > 5 && (
                        <p className="text-[11px] text-red-300/60">
                          +{steamImport.result.errors.length - 5} erro(s) — veja o log do app
                        </p>
                      )}
                    </div>
                  )}

                  <button type="button" onClick={closeSteamImport} className="btn-primary">
                    Fechar
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Modal "Editar Game" (T9) ────────────────────── */}
      <AnimatePresence>
        {editing && (
          <EditGameModal
            key={`${editing.id}:${editing.addedAt}`}
            game={editing}
            currentIcon={icons[editing.id] ?? null}
            exeMissing={missingExes.has(editing.id)}
            showToast={showToast}
            onClose={() => setEditing(null)}
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
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="fixed bottom-6 right-6 z-[60] flex max-w-md items-start gap-3 rounded-xl border border-steam-blue/25 bg-[#0d1420]/95 px-4 py-3 shadow-2xl shadow-black/50 backdrop-blur-xl"
          >
            <Gamepad2 size={16} className="mt-0.5 shrink-0 text-steam-blue" />
            <p className="text-xs leading-relaxed text-slate-100">{toast.text}</p>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="ml-2 shrink-0 rounded p-0.5 text-slate-500 transition-colors hover:text-white"
              aria-label="Fechar aviso"
            >
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

interface EditGameModalProps {
  game: Game
  /** dataURL do ícone atual (cacheado na grade) ou null para o fallback visual. */
  currentIcon: string | null
  /** Selo inicial de executável ausente (verificado na grade). */
  exeMissing: boolean
  showToast: (text: string) => void
  onClose: () => void
  onSaved: (id: string) => void
  onRemoved: (id: string) => void
}

/**
 * Modal "Editar Game" (T9).
 * Decisão de implementação: as trocas de ícone/exe são apenas PRÉ-VISUALIZADAS
 * aqui; nada é persistido até o "Salvar". O Salvar grava via `games:update`
 * (patch por id) e, quando há troca de ícone, encadeia `games:set-icon` /
 * `games:restore-exe-icon` antes dele — esses IPCs gravam o arquivo em
 * game-icons/ e devolvem o caminho; quem persiste no store é o `games:update`.
 * Fechar sem salvar descarta todas as alterações (nenhum arquivo é gravado
 * antes do Salvar). O cwd do lançamento acompanha o novo executável
 * automaticamente (launchGame usa a pasta do exe), nada extra a fazer aqui.
 */
function EditGameModal({
  game,
  currentIcon,
  exeMissing,
  showToast,
  onClose,
  onSaved,
  onRemoved
}: EditGameModalProps): JSX.Element {
  const [name, setName] = useState(game.name)
  const [exePath, setExePath] = useState(game.exePath)
  const [localExeMissing, setLocalExeMissing] = useState(exeMissing)
  // Troca de ícone pendente de persistência (pré-visualizada, nunca gravada antes do Salvar).
  const [iconSource, setIconSource] = useState<'none' | 'custom' | 'exe'>('none')
  const [customDataUrl, setCustomDataUrl] = useState<string | null>(null)
  const [exePreviewDataUrl, setExePreviewDataUrl] = useState<string | null>(null)
  const [iconBusy, setIconBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [removing, setRemoving] = useState(false)

  const busy = saving || removing
  const trimmedName = name.trim()
  const canSave = trimmedName.length > 0 && !busy
  const previewIcon =
    iconSource === 'custom' ? customDataUrl : iconSource === 'exe' ? exePreviewDataUrl : currentIcon

  const requestClose = useCallback((): void => {
    // Não fecha durante uma operação em andamento.
    if (busy) return
    onClose()
  }, [busy, onClose])

  // Esc fecha o modal (descarta as alterações), salvo durante salvar/remover.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return (): void => window.removeEventListener('keydown', onKeyDown)
  }, [requestClose])

  const handlePickImage = useCallback(async (): Promise<void> => {
    if (iconBusy || busy) return
    setIconBusy(true)
    try {
      const picked = await window.api.pickGameIcon()
      if (!picked.success) {
        // Cancelado: nada acontece. Erro (ex.: .ico): aviso amigável.
        if (!picked.canceled && picked.error) showToast(picked.error)
        return
      }
      setCustomDataUrl(picked.dataUrl ?? null)
      setIconSource('custom')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível escolher a imagem.')
    } finally {
      setIconBusy(false)
    }
  }, [iconBusy, busy, showToast])

  const handleRestoreExeIcon = useCallback(async (): Promise<void> => {
    if (iconBusy || busy) return
    const target = exePath.trim()
    if (!target) return
    setIconBusy(true)
    try {
      // Só pré-visualiza: a extração/gravação de verdade acontece no "Salvar".
      const preview = await window.api.previewGameIcon(target)
      if (!preview.success || !preview.dataUrl) {
        showToast(preview.error ?? 'O executável não tem um ícone utilizável.')
        return
      }
      setExePreviewDataUrl(preview.dataUrl)
      setIconSource('exe')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'O executável não tem um ícone utilizável.')
    } finally {
      setIconBusy(false)
    }
  }, [iconBusy, busy, exePath, showToast])

  const handlePickExe = useCallback(async (): Promise<void> => {
    if (busy) return
    try {
      const picked = await window.api.pickAppPath(
        'file',
        exePath.trim() || undefined,
        'Selecione o executável do jogo'
      )
      if (!picked.success) {
        if (!picked.canceled && picked.error) {
          showToast(`Não foi possível escolher o arquivo: ${picked.error}`)
        }
        return
      }
      if (!picked.path) return
      setExePath(picked.path)
      // Reavalia o selo de ".exe não encontrado" para o caminho recém-escolhido.
      const flags = await window.api.checkGameExes([picked.path]).catch(() => [true])
      setLocalExeMissing(flags[0] === false)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível escolher o arquivo.')
    }
  }, [busy, exePath, showToast])

  const handleSave = useCallback(async (): Promise<void> => {
    if (!canSave) return
    setSaving(true)
    try {
      // 1) Troca de ícone (se houver): grava o arquivo em game-icons/ e devolve o caminho.
      let iconPath: string | undefined
      if (iconSource === 'custom' && customDataUrl) {
        const written = await window.api.setGameIcon(game.id, customDataUrl)
        if (!written.success || !written.iconPath) {
          showToast(written.error ?? 'Não foi possível salvar a imagem.')
          setSaving(false)
          return
        }
        iconPath = written.iconPath
      } else if (iconSource === 'exe') {
        const restored = await window.api.restoreGameIcon(game.id, exePath.trim())
        if (!restored.success || !restored.iconPath) {
          showToast(restored.error ?? 'Não foi possível extrair o ícone do executável.')
          setSaving(false)
          return
        }
        iconPath = restored.iconPath
      }

      // 2) Persiste nome/executável/ícone numa única escrita do store.
      const updated = await window.api.updateGame(game.id, {
        name: trimmedName,
        exePath: exePath.trim(),
        ...(iconPath !== undefined ? { iconPath } : {})
      })
      if (!updated.success) {
        showToast(updated.error ?? 'Não foi possível salvar as alterações.')
        setSaving(false)
        return
      }
      showToast('Alterações salvas')
      onSaved(game.id)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível salvar as alterações.')
      setSaving(false)
    }
  }, [canSave, iconSource, customDataUrl, exePath, game.id, trimmedName, showToast, onSaved])

  const handleRemove = useCallback(async (): Promise<void> => {
    if (!confirmingRemove) {
      setConfirmingRemove(true)
      return
    }
    if (removing) return
    setRemoving(true)
    try {
      const removed = await window.api.removeGame(game.id)
      if (!removed.success) {
        showToast(removed.error ?? 'Não foi possível remover o jogo.')
        setRemoving(false)
        setConfirmingRemove(false)
        return
      }
      showToast(`Jogo removido: ${game.name}`)
      onRemoved(game.id)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível remover o jogo.')
      setRemoving(false)
      setConfirmingRemove(false)
    }
  }, [confirmingRemove, removing, game.id, game.name, showToast, onRemoved])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop — fecha descartando as alterações */}
      <button
        type="button"
        aria-label="Fechar"
        disabled={busy}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm disabled:cursor-default"
        onClick={requestClose}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Editar Game"
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.18 }}
        className="relative glass-card border border-white/[0.08] shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-6"
      >
        {/* ── Cabeçalho ─────────────────────────────── */}
        <div className="flex items-center gap-3 pb-4 border-b border-white/[0.06]">
          <div className="w-11 h-11 rounded-xl bg-playstation-500/10 border border-playstation-500/30 flex items-center justify-center shrink-0">
            <Pencil size={18} className="text-playstation-500" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-100">Editar Game</h3>
            <p className="text-[11px] text-slate-500 truncate">{game.name}</p>
          </div>
        </div>

        <div className="space-y-5 pt-5">
          {/* ── Nome do jogo ─────────────────────────── */}
          <div>
            <label htmlFor="edit-game-name" className="label-panel">
              Nome do jogo
            </label>
            <input
              id="edit-game-name"
              type="text"
              value={name}
              autoFocus
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nome do jogo"
              className="input-gamer"
            />
            {trimmedName.length === 0 && (
              <p className="text-[11px] text-amber-400 mt-1.5">O nome não pode ficar vazio.</p>
            )}
          </div>

          {/* ── Executável ───────────────────────────── */}
          <div>
            <span className="label-panel">Executável</span>
            <p className="rounded-lg border border-white/[0.06] bg-black/30 px-3 py-2 text-[11px] font-mono text-slate-500 break-all">
              {exePath}
            </p>
            {localExeMissing && (
              <p className="flex items-center gap-1.5 text-[11px] text-amber-400 mt-1.5">
                <AlertTriangle size={11} />
                Executável não encontrado no disco. Escolha o caminho correto ou remova o jogo.
              </p>
            )}
            <div className="flex items-center gap-3 mt-2">
              <button
                type="button"
                onClick={() => void handlePickExe()}
                disabled={busy}
                className="btn-secondary !px-4 !py-2 !text-[10px]"
              >
                Alterar…
              </button>
              <span className="text-[10px] text-slate-600 leading-snug">
                O jogo inicia a partir da pasta do executável.
              </span>
            </div>
          </div>

          {/* ── Ícone/capa ───────────────────────────── */}
          <div>
            <span className="label-panel">Ícone / capa</span>
            <div className="flex items-start gap-4">
              <div className="w-20 h-20 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center overflow-hidden shrink-0">
                {previewIcon ? (
                  <img
                    src={previewIcon}
                    alt={`Ícone de ${trimmedName || game.name}`}
                    className="w-full h-full object-contain"
                    draggable={false}
                  />
                ) : (
                  <Gamepad2 size={32} className="text-slate-600" />
                )}
              </div>
              <div className="flex flex-col items-start gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => void handlePickImage()}
                  disabled={busy || iconBusy}
                  className="btn-secondary !px-4 !py-2 !text-[10px]"
                >
                  {iconBusy ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <ImagePlus size={13} />
                  )}
                  Escolher imagem…
                </button>
                <button
                  type="button"
                  onClick={() => void handleRestoreExeIcon()}
                  disabled={busy || iconBusy}
                  className="btn-ghost !px-3 !py-1.5 text-[11px]"
                >
                  <RotateCcw size={12} />
                  Restaurar ícone do executável
                </button>
                <p className="text-[10px] text-slate-600 leading-snug">
                  Formatos aceitos: PNG, JPG e WebP. .ico não é suportado.
                </p>
              </div>
            </div>
          </div>

          {/* ── Remover jogo (confirmação em duas etapas) ── */}
          <div className="border-t border-white/[0.06] pt-4">
            {confirmingRemove ? (
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-3">
                <p className="flex items-center gap-2 text-sm font-bold text-red-300">
                  <AlertTriangle size={15} />
                  Tem certeza?
                </p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  <span className="font-semibold text-slate-200">{game.name}</span> sairá da sua
                  biblioteca. O arquivo do jogo não será apagado do computador.
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingRemove(false)}
                    disabled={removing}
                    className="btn-ghost"
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRemove()}
                    disabled={removing}
                    className="btn-danger !px-4 !py-2"
                  >
                    {removing ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        Removendo…
                      </>
                    ) : (
                      <>
                        <Trash2 size={13} />
                        Remover definitivamente
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingRemove(true)}
                disabled={busy}
                className="btn-danger w-full"
              >
                <Trash2 size={14} />
                Remover jogo
              </button>
            )}
          </div>

          {/* ── Rodapé ─────────────────────────────────── */}
          <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] pt-4">
            <button type="button" onClick={requestClose} disabled={busy} className="btn-ghost">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canSave}
              className="btn-primary"
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Salvando…
                </>
              ) : (
                'Salvar alterações'
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
