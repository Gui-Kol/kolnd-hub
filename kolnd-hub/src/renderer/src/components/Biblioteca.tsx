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
  X
} from 'lucide-react'
import { Game, SteamImportResult } from '../types'

interface Toast {
  id: number
  text: string
}

/** Estado do fluxo "Importar jogos da Steam" (menu Adicionar Games → modal). */
type SteamImportState =
  | { phase: 'idle' }
  | { phase: 'importing' }
  | { phase: 'done'; result: SteamImportResult }

/**
 * Biblioteca de jogos do Kolnd Hub — página exclusiva para jogos instalados.
 * Os cards lançam o executável via `window.api.launchGame(id)` (spawn direto,
 * sem ProcessManager), então o contador de apps ativos do Hub não é afetado.
 */
export function Biblioteca(): JSX.Element {
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [steamImport, setSteamImport] = useState<SteamImportState>({ phase: 'idle' })
  // Ícones por id: dataURL cacheada no estado do componente; `null` = sem ícone (fallback).
  const [icons, setIcons] = useState<Record<string, string | null>>({})
  const iconRequests = useRef<Set<string>>(new Set())

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
    void loadGames()
  }, [loadGames])

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
      showToast(`Iniciando ${game.name}…`)
    },
    [showToast]
  )

  // "Jogo Personalizado" ganha handler real na próxima atualização (T8).
  const handleAddCustom = useCallback((): void => {
    setMenuOpen(false)
    showToast('Disponível na próxima atualização')
  }, [showToast])

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
          error:
            err instanceof Error
              ? err.message
              : 'Não foi possível importar os jogos da Steam.'
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
                      onClick={handleAddCustom}
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
                {/* Edição — reservada para a próxima atualização (desabilitada) */}
                <span
                  role="note"
                  title="Editar (em breve)"
                  aria-label="Editar (em breve)"
                  className="absolute top-2 right-2 p-2 rounded-lg text-slate-600 border border-transparent cursor-not-allowed select-none"
                >
                  <Pencil size={14} />
                </span>

                <div className="w-24 h-24 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center overflow-hidden shrink-0 group-hover:border-steam-blue/30 transition-colors">
                  {icon ? (
                    <img
                      src={icon}
                      alt={`Ícone de ${game.name}`}
                      className="w-full h-full object-contain"
                      draggable={false}
                    />
                  ) : (
                    <Gamepad2 size={38} className="text-slate-600 group-hover:text-slate-500 transition-colors" />
                  )}
                </div>

                <p className="text-sm font-semibold text-slate-200 leading-snug line-clamp-2 w-full">
                  {game.name}
                </p>
                <span className={game.origin === 'steam' ? 'badge-steam' : 'badge-kloud'}>
                  {game.origin === 'steam' ? 'Steam' : 'Personalizado'}
                </span>
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
                  <h3 className="text-base font-bold text-slate-100">
                    Não foi possível importar
                  </h3>
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
