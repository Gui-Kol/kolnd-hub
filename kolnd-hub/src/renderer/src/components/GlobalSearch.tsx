import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, Gamepad2, Search } from 'lucide-react'
import type { AppConfig, Game } from '../types'
import { filterSearch, type SearchResult } from '../lib/globalSearch'

interface GlobalSearchProps {
  apps: AppConfig[]
  onClose: () => void
  onLaunchApp: (app: AppConfig) => void
  onLaunchGame: (game: Game) => void
}

/**
 * Busca global do Hub (atalho `/`) — overlay discreto no topo central.
 * Apps vêm do estado do `App.tsx`; jogos são buscados via `window.api.getGames()`
 * a cada abertura do overlay (montagem) e mantidos em memória enquanto ele está
 * aberto — fechar e reabrir refaz a busca, sem cache entre aberturas além disso.
 */
export function GlobalSearch({
  apps,
  onClose,
  onLaunchApp,
  onLaunchGame
}: GlobalSearchProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  // null = ainda carregando; [] = carregado e vazio (ou falhou).
  const [games, setGames] = useState<Game[] | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  // Busca os jogos ao abrir o overlay. Falha silenciosa: a busca por apps
  // continua funcionando e a lista simplesmente não traz jogos.
  useEffect(() => {
    let cancelled = false
    window.api
      .getGames()
      .then((list) => {
        if (!cancelled) setGames(list)
      })
      .catch(() => {
        if (!cancelled) setGames([])
      })
    return (): void => {
      cancelled = true
    }
  }, [])

  const results = useMemo(() => filterSearch(query, apps, games ?? []), [query, apps, games])
  const trimmedQuery = query.trim()
  const activeId =
    results.length > 0
      ? `global-search-option-${Math.min(activeIndex, results.length - 1)}`
      : undefined

  const launch = useCallback(
    (result: SearchResult): void => {
      if (result.kind === 'app') {
        const app = apps.find((a) => a.id === result.id)
        if (app) onLaunchApp(app)
        return
      }
      const game = (games ?? []).find((g) => g.id === result.id)
      if (game) onLaunchGame(game)
    },
    [apps, games, onLaunchApp, onLaunchGame]
  )

  // Navegação por teclado no documento (capture) — o foco permanece no campo,
  // mas isto garante que ↑/↓/Enter/Esc funcionem mesmo se o foco escapar.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((prev) => {
          const count = results.length
          if (count === 0) return 0
          return event.key === 'ArrowDown' ? (prev + 1) % count : (prev - 1 + count) % count
        })
        return
      }
      if (event.key === 'Enter') {
        if (results.length === 0) return
        event.preventDefault()
        launch(results[Math.min(activeIndex, results.length - 1)])
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return (): void => window.removeEventListener('keydown', onKeyDown, true)
  }, [results, activeIndex, onClose, launch])

  // Mantém a opção selecionada visível quando a lista rola.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const active = list.children[Math.min(activeIndex, list.children.length - 1)]
    if (active instanceof HTMLElement) active.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, results])

  return (
    <div className="fixed inset-0 z-[80] flex justify-center" role="presentation">
      {/* Backdrop discreto — clique fecha sem lançar nada. */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative mt-16 sm:mt-24 w-full max-w-lg px-4">
        <div className="glass rounded-2xl overflow-hidden shadow-2xl shadow-black/50">
          {/* ── Campo único ─────────────────────────────────────────── */}
          <div className="flex items-center gap-3 border-b border-white/[0.06] px-4">
            <Search size={16} className="shrink-0 text-slate-500" aria-hidden="true" />
            <input
              // autoFocus: ao montar (tecla "/"), o campo já nasce focado.
              autoFocus
              type="text"
              role="combobox"
              aria-label="Busca global"
              aria-expanded="true"
              aria-controls="global-search-listbox"
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              spellCheck={false}
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActiveIndex(0)
              }}
              placeholder="Buscar apps e jogos…"
              className="h-12 w-full bg-transparent text-sm text-slate-100 placeholder-slate-600 outline-none"
            />
            <kbd className="shrink-0 rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
              Esc
            </kbd>
          </div>

          {/* ── Resultados ──────────────────────────────────────────── */}
          {results.length > 0 ? (
            <ul
              ref={listRef}
              id="global-search-listbox"
              role="listbox"
              aria-label="Resultados da busca"
              className="max-h-80 overflow-y-auto py-2"
            >
              {results.map((result, index) => {
                const isActive = index === Math.min(activeIndex, results.length - 1)
                const KindIcon = result.kind === 'app' ? AppWindow : Gamepad2
                return (
                  <li
                    key={`${result.kind}:${result.id}`}
                    id={`global-search-option-${index}`}
                    role="option"
                    aria-selected={isActive}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => launch(result)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors ${
                      isActive ? 'bg-white/[0.06]' : 'bg-transparent'
                    }`}
                  >
                    <KindIcon
                      size={16}
                      className={`shrink-0 ${result.kind === 'app' ? 'text-playstation-400' : 'text-emerald-400'}`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-100">
                        {result.label}
                      </span>
                      {result.subtitle && (
                        <span className="block truncate text-[10px] text-slate-500">
                          {result.subtitle}
                        </span>
                      )}
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                        result.kind === 'app'
                          ? 'border-playstation-500/25 bg-playstation-500/10 text-playstation-400'
                          : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'
                      }`}
                    >
                      {result.kind === 'app' ? 'App' : 'Jogo'}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="px-4 py-6 text-center" role="status">
              {trimmedQuery.length > 0 ? (
                <p className="text-xs text-slate-500">
                  Nada encontrado para &apos;{trimmedQuery}&apos;
                </p>
              ) : (
                <p className="text-xs text-slate-600">Digite para buscar apps e jogos…</p>
              )}
            </div>
          )}

          {/* ── Rodapé com atalhos ─────────────────────────────────── */}
          <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-4 py-2">
            <p className="text-[9px] text-slate-600">
              <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1">↑</kbd>{' '}
              <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1">↓</kbd>{' '}
              navegar
              {' · '}
              <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1">
                Enter
              </kbd>{' '}
              abrir{' · '}
              <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1">
                Esc
              </kbd>{' '}
              fechar
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
