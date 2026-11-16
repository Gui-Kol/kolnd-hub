import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Check, X } from 'lucide-react'
import { Layout } from './components/Layout'
import { BigPicture } from './components/BigPicture'
import { Dashboard } from './components/Dashboard'
import { Settings } from './components/Settings'
import { Inicializacao } from './components/Inicializacao'
import { Biblioteca } from './components/Biblioteca'
import { GlobalSearch } from './components/GlobalSearch'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LoadingScreen } from './components/LoadingScreen'
import { FirstRunInstall } from './components/FirstRunInstall'
import { useFocusTrap } from './lib/useFocusTrap'
import { apps as defaultApps } from './config/apps'
import {
  AppConfig,
  AppState,
  Page,
  SystemProcess,
  ImportanceLevel,
  StartupItem,
  Game,
  IMPORTANCE_LABELS
} from './types'
import { executableName, matchesProcess, classifyImportance } from './lib/startup'
import { loadAppConfigs, saveAppConfigs, loadImportanceMap } from './lib/hubConfig'

interface Notice {
  id: number
  text: string
  kind?: 'success' | 'error' | 'info'
}

function isFirstRunFromQuery(): boolean {
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get('first-run') === '1'
  } catch {
    return false
  }
}

function App(): JSX.Element {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard')
  const [appStates, setAppStates] = useState<Record<string, AppState>>({})
  const [apps, setApps] = useState<AppConfig[]>(defaultApps)
  const [notice, setNotice] = useState<Notice | null>(null)
  // A loading screen só sai quando DOIS eventos ocorreram:
  //  1. os dados essenciais terminaram de carregar (perfil, inicialização, status);
  //  2. a animação de carregamento concluiu (evita que a tela suma num flash).
  const [dataReady, setDataReady] = useState(false)
  const [animationDone, setAnimationDone] = useState(false)
  const isLoading = !dataReady || !animationDone
  const handleLoadingReady = useCallback((): void => setAnimationDone(true), [])
  const [pcName, setPcName] = useState<string | null>(null)
  const [bgProcesses, setBgProcesses] = useState<SystemProcess[]>([])
  const [startupItems, setStartupItems] = useState<StartupItem[]>([])
  const [startupImportance, setStartupImportance] = useState<Record<string, ImportanceLevel>>({})
  const [isFirstRun, setIsFirstRun] = useState<boolean>(isFirstRunFromQuery())
  const [exitModalOpen, setExitModalOpen] = useState<boolean>(false)
  // Busca global (atalho "/"): overlay discreto com apps + jogos.
  const [searchOpen, setSearchOpen] = useState<boolean>(false)
  // Modo Big Picture: 'hidden' = shell normal; 'setup' = gate (sem controle
  // configurado, exibe a tela de configuração antes da home); 'transitioning'
  // = transição cinematográfica (T7) antes da home liberar; 'active' = home.
  const [bigPicture, setBigPicture] = useState<'hidden' | 'setup' | 'transitioning' | 'active'>(
    'hidden'
  )
  // Garante que o autostart do Kloud Games seja avaliado uma única vez por
  // sessão (StrictMode invoca os efeitos duas vezes em dev).
  const kloudAutoLaunchTriedRef = useRef(false)
  const closeExitModal = useCallback((): void => setExitModalOpen(false), [])
  const exitTrapRef = useFocusTrap<HTMLDivElement>({
    active: exitModalOpen,
    onEscape: closeExitModal
  })

  // Aplica o caminho resolvido do KLOUD_GAMES.exe na config do app (e persiste),
  // para que abrir/fechar pelo Hub funcione sempre com o caminho real.
  const applyKloudGamesConfig = useCallback((exePath: string): void => {
    const dir = exePath.replace(/[\\/][^\\/]*$/, '')
    const command = `"${exePath}"`
    setApps((prev) => {
      const next = prev.map((a) => (a.id === 'kloud-games' ? { ...a, command, cwd: dir } : a))
      void saveAppConfigs(next)
      return next
    })
  }, [])

  // Auto-dismiss launch/stop error toasts.
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 7000)
    return (): void => clearTimeout(timer)
  }, [notice])

  // Load saved app configs (electron-store via IPC, com migração única do
  // legado localStorage e fallback para ele se o store estiver indisponível).
  useEffect(() => {
    let mounted = true
    loadAppConfigs()
      .then((saved) => {
        if (mounted) setApps(saved)
      })
      .catch(() => {
        // Ignora — mantém os defaults
      })
    return (): void => {
      mounted = false
    }
  }, [])

  // Kloud Games: revalida os caminhos salvos em resources/programs/kloud-games
  // (kloud-games.paths.json) e ajusta a config do app para o caminho real do .exe.
  useEffect(() => {
    window.api
      .kloudGamesStatus()
      .then((status) => {
        if (status.exePath) applyKloudGamesConfig(status.exePath)
      })
      .catch(() => {
        // Sem status: mantém os defaults (%ProgramFiles%\KLOUD_GAMES).
      })
  }, [applyKloudGamesConfig])

  // Nome do computador (exibe na aba lateral e na página de inicialização).
  useEffect(() => {
    window.api
      .systemPcName()
      .then(setPcName)
      .catch(() => setPcName(null))
  }, [])

  // ── Carregamento inicial (tela de loading) ────────────────────────
  // Mantém a tela de loading visível até que os dados essenciais para
  // todas as funcionalidades estejam disponíveis, evitando travamentos
  // e engasgos ao usar o hub.
  useEffect(() => {
    let mounted = true

    const init = async (): Promise<void> => {
      await Promise.allSettled([
        // Perfil do sistema (nome do PC, usado na sidebar e inicialização).
        window.api.systemPcName().then((name) => {
          if (mounted) setPcName(name)
        }),
        // Programas configurados para iniciar com o PC.
        window.api.startupList().then((items) => {
          if (mounted) setStartupItems(items)
        }),
        // Status inicial de todos os apps gerenciados pelo Hub.
        window.api.getAllStatus().then((status) => {
          if (mounted) {
            setAppStates(status as Record<string, AppState>)
          }
        })
      ])

      if (mounted) setDataReady(true)
    }

    init()

    return (): void => {
      mounted = false
    }
  }, [])

  // Status dos processos lançados pelo Hub é 100% orientado a eventos:
  // o main emite `status-change` em toda transição (ver onStatusChanged abaixo),
  // então o polling periódico de getAllStatus era redundante. O estado inicial
  // vem da carga em `init()`; o restante chega por eventos.

  // Autostart do Kloud Games (preferência em Configurações). Só é avaliado
  // depois da tela de carregamento, uma única vez e nunca durante a 1ª
  // execução (?first-run=1). Se o jogo já estiver em execução, não abre uma
  // segunda instância. Falhas são registradas e avisadas discretamente —
  // nunca bloqueiam o Hub.
  useEffect(() => {
    if (isLoading) return
    if (kloudAutoLaunchTriedRef.current) return
    if (isFirstRunFromQuery()) return
    kloudAutoLaunchTriedRef.current = true

    void (async () => {
      try {
        const enabled = await window.api.getLaunchKloudOnStart()
        if (!enabled) return

        const status = await window.api.kloudGamesStatus()
        if (status.running) return

        const result = await window.api.kloudGamesLaunch()
        if (!result.success) {
          console.error('[kloud-games] Falha ao iniciar automaticamente:', result.error)
          setNotice({
            id: Date.now(),
            text: `Não foi possível iniciar o Kloud Games automaticamente: ${result.error ?? 'erro desconhecido'}`
          })
        } else if (result.installedNow) {
          setNotice({ id: Date.now(), text: 'Kloud Games foi instalado e iniciado.' })
        }
      } catch (err) {
        console.error('[kloud-games] Erro ao iniciar automaticamente:', err)
        setNotice({
          id: Date.now(),
          text: 'Não foi possível iniciar o Kloud Games automaticamente. Você pode abri-lo pela aba Ferramentas.'
        })
      }
    })()
  }, [isLoading])

  // Processos do sistema em segundo plano: intervalo ADAPTATIVO —
  // 5s com a janela visível, 30s quando oculta (bandeja), trocando
  // imediatamente no visibilitychange.
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const tick = async (): Promise<void> => {
      try {
        const procs = await window.api.systemRunningProcesses()
        if (!cancelled) setBgProcesses(procs as SystemProcess[])
      } catch {
        // Ignore polling errors
      } finally {
        if (!cancelled) {
          const delay = document.visibilityState === 'visible' ? 5000 : 30000
          timer = window.setTimeout(() => void tick(), delay)
        }
      }
    }

    const onVisibility = (): void => {
      // Reinicia já com o intervalo novo; se a janela voltou a ficar visível,
      // atualiza na hora em vez de esperar o ciclo de 30s.
      window.clearTimeout(timer)
      void tick()
    }

    void tick()
    document.addEventListener('visibilitychange', onVisibility)
    return (): void => {
      cancelled = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // Listen for real-time status changes from main process
  useEffect(() => {
    const unsub = window.api.onStatusChanged((appId, status) => {
      setAppStates((prev) => ({
        ...prev,
        [appId]: { ...prev[appId], status: status as AppState['status'] }
      }))
    })
    return unsub
  }, [])

  // ── Itens de inicialização do PC ──────────────────────────────
  const loadStartupItems = useCallback(async (): Promise<void> => {
    let items: StartupItem[] = []
    try {
      items = await window.api.startupList()
    } catch (err) {
      setNotice({
        id: Date.now(),
        text: `Não foi possível listar a inicialização: ${err instanceof Error ? err.message : String(err)}`
      })
    }
    setStartupItems(items)

    const map = await loadImportanceMap()

    const next: Record<string, ImportanceLevel> = {}
    for (const item of items) {
      next[item.id] = map[item.id] ?? classifyImportance(item)
    }
    setStartupImportance(next)
  }, [])

  useEffect(() => {
    // Caregamento assíncrono: o estado só muda quando a lista chega.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStartupItems()
  }, [loadStartupItems])

  const handleRemoveStartup = useCallback(
    async (item: StartupItem): Promise<void> => {
      const result = await window.api.startupRemove(item)
      if (!result.success) {
        setNotice({
          id: Date.now(),
          text: `Não foi possível remover da inicialização: ${result.error ?? 'erro desconhecido'}`
        })
        return
      }

      await loadStartupItems()
    },
    [loadStartupItems]
  )

  // Remove vários itens da inicialização em lote.
  const handleRemoveBatchStartup = useCallback(
    async (items: StartupItem[]): Promise<void> => {
      const result = await window.api.startupRemoveBatch(items)
      if (!result.success) {
        setNotice({
          id: Date.now(),
          text: `Não foi possível remover alguns itens da inicialização: ${result.errors.join(', ')}`
        })
        return
      }
      await loadStartupItems()
    },
    [loadStartupItems]
  )

  // Verifica se um app configurado no Hub já está na inicialização do Windows.
  const isAppInStartup = useCallback((app: AppConfig, items: StartupItem[]): boolean => {
    const exe = executableName(app.command)
    if (!exe) return false
    return items.some(
      (item) => executableName(item.path) === exe || executableName(item.name) === exe
    )
  }, [])

  // Apps configurados no Hub que ainda não iniciam com o PC.
  const appsNotInStartup = useMemo(() => {
    return apps.filter((app) => !isAppInStartup(app, startupItems))
  }, [apps, startupItems, isAppInStartup])

  const handleAddStartup = useCallback(
    async (app: AppConfig): Promise<void> => {
      const result = await window.api.startupAdd({
        name: app.name,
        path: app.command
      })
      if (!result.success) {
        setNotice({
          id: Date.now(),
          text: `Não foi possível adicionar "${app.name}" à inicialização: ${result.error ?? 'erro desconhecido'}`
        })
        return
      }
      await loadStartupItems()
    },
    [loadStartupItems]
  )

  // Adiciona vários apps à inicialização em lote.
  const handleAddBatchStartup = useCallback(
    async (apps: AppConfig[]): Promise<void> => {
      const result = await window.api.startupAddBatch(
        apps.map((a) => ({ name: a.name, path: a.command }))
      )
      if (!result.success) {
        setNotice({
          id: Date.now(),
          text: `Não foi possível adicionar alguns apps à inicialização: ${result.errors.join(', ')}`
        })
        return
      }
      await loadStartupItems()
    },
    [loadStartupItems]
  )

  // ── Estado efetivo de cada app ────────────────────────────────
  // Prioridade: processo lançado pelo Hub > detectado em segundo plano > parado.
  const appEffectiveState = useCallback(
    (app: AppConfig): AppState => {
      const hub = appStates[app.id]
      if (hub?.status === 'running') {
        return { ...hub, source: 'hub' }
      }

      const runningInBackground = bgProcesses.some((p) => matchesProcess(app, p))
      if (runningInBackground) {
        return { status: 'running', source: 'background' }
      }

      return hub ?? { status: 'stopped' }
    },
    [appStates, bgProcesses]
  )

  const effectiveStates = useMemo(() => {
    const map: Record<string, AppState> = {}
    for (const app of apps) {
      map[app.id] = appEffectiveState(app)
    }
    return map
  }, [apps, appEffectiveState])

  const handleLaunch = useCallback(
    async (app: AppConfig): Promise<void> => {
      // Kloud Games: procura o .exe; se não existir, abre o MSI embutido
      // para instalação e salva os caminhos detectados.
      if (app.id === 'kloud-games') {
        const result = await window.api.kloudGamesLaunch()
        if (!result.success) {
          setNotice({
            id: Date.now(),
            text: `Não foi possível iniciar ${app.name}: ${result.error ?? 'erro desconhecido'}`
          })
          return
        }
        if (result.exePath) applyKloudGamesConfig(result.exePath)
        if (result.installedNow) {
          setNotice({ id: Date.now(), text: 'Kloud Games foi instalado e iniciado.' })
        }
        return
      }

      const result = await window.api.launchApp(app.id, app.command, app.cwd, app.useShell)
      if (!result.success) {
        setNotice({
          id: Date.now(),
          text: `Não foi possível iniciar ${app.name}: ${result.error ?? 'erro desconhecido'}`
        })
      }
    },
    [applyKloudGamesConfig]
  )

  const handleStop = useCallback(
    async (appId: string): Promise<void> => {
      const app = apps.find((a) => a.id === appId)
      const result = await window.api.stopApp(appId, app?.command)
      if (!result.success) {
        setNotice({
          id: Date.now(),
          text: `Não foi possível parar o programa: ${result.error ?? 'erro desconhecido'}`
        })
      } else {
        // Atualiza a UI imediatamente para processos encerrados fora do Hub.
        setAppStates((prev) => ({
          ...prev,
          [appId]: { ...prev[appId], status: 'stopped' }
        }))
      }
    },
    [apps]
  )

  // Busca global: lançar um jogo pelo Enter/clique usa o mesmo caminho do
  // card da Biblioteca (`window.api.launchGame`), com aviso discreto no lugar
  // do toast local da grade (que não existe aqui).
  const handleLaunchGame = useCallback(async (game: Game): Promise<void> => {
    const result = await window.api.launchGame(game.id)
    if (!result.ok) {
      setNotice({
        id: Date.now(),
        text: `Não foi possível iniciar ${game.name}: ${result.error ?? 'erro desconhecido'}`,
        kind: 'error'
      })
      return
    }
    setNotice({
      id: Date.now(),
      text: result.focused
        ? `${game.name} já está aberto — trazendo a janela para frente.`
        : result.alreadyRunning
          ? `${game.name} já está em execução — aguarde a janela.`
          : `Iniciando ${game.name}…`,
      kind: 'info'
    })
  }, [])

  // Atalhos da busca global: fecham o overlay e delegam ao fluxo de launch.
  const handleSearchLaunchApp = useCallback(
    (app: AppConfig): void => {
      setSearchOpen(false)
      void handleLaunch(app)
    },
    [handleLaunch]
  )

  const handleSearchLaunchGame = useCallback(
    (game: Game): void => {
      setSearchOpen(false)
      void handleLaunchGame(game)
    },
    [handleLaunchGame]
  )

  // "/" abre a busca global — apenas fora de campos editáveis, sem modificadores,
  // com o overlay fechado e fora do Big Picture (que tem navegação própria).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== '/') return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (searchOpen) return
      if (bigPicture !== 'hidden' || isFirstRun || isLoading || exitModalOpen) return
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
          return
        }
      }
      event.preventDefault()
      setSearchOpen(true)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return (): void => window.removeEventListener('keydown', onKeyDown, true)
  }, [searchOpen, bigPicture, isFirstRun, isLoading, exitModalOpen])

  const handleSaveApps = useCallback((updatedApps: AppConfig[]): void => {
    setApps(updatedApps)
    void saveAppConfigs(updatedApps)
  }, [])

  // Repassa o toast do App para a Zona de perigo (onToast opcional).
  const onToast = useCallback((msg: string, kind: 'success' | 'error' | 'info'): void => {
    setNotice({ id: Date.now(), text: msg, kind })
  }, [])

  // Solicita ao processo principal que encerre tudo (processos, servidores,
  // segundo plano) e feche o Hub completamente.
  const handleExit = useCallback(async (): Promise<void> => {
    try {
      const result = await window.api.shutdownHub()
      if (!result.success) {
        setNotice({
          id: Date.now(),
          text: result.error ?? 'Não foi possível encerrar o Hub completamente.'
        })
      }
    } catch (err) {
      setNotice({
        id: Date.now(),
        text: `Erro ao encerrar o Hub: ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }, [])

  // ── Big Picture: entrada sempre passa pelo gate ─────────────
  // Único ponto de decisão (todos os caminhos de entrada — botão da sidebar,
  // deep-links futuros — passam por aqui):
  //   controle configurado (ou store ilegível tratada como ausente) inexistente
  //   → gate de configuração ('setup'); config válida → home ('active').
  const enterBigPicture = useCallback((): void => {
    // ?first-run=1 nunca abre o Big Picture (P12) — recusa silenciosa.
    if (isFirstRunFromQuery()) {
      console.warn('[big-picture] entrada recusada durante a primeira execução')
      return
    }
    void (async () => {
      let hasConfig: boolean
      try {
        const result = await window.api.getGamepadConfig()
        // Config ausente/inválida/erro (store corrompido) → gate ("não configurado").
        hasConfig = result.ok && result.config !== null
      } catch {
        hasConfig = false
      }
      void window.api.setFullScreen(true)
      // Config válida → transição cinematográfica (T7); sem config → gate (T6).
      setBigPicture(hasConfig ? 'transitioning' : 'setup')
    })()
  }, [])

  const exitBigPicture = useCallback((): void => {
    void window.api.setFullScreen(false)
    setBigPicture('hidden')
  }, [])

  // Setup do gate concluído (config persistida): transição cinematográfica
  // direto para a home — nunca volta para o Hub no meio do caminho.
  const handleBigPictureSetupComplete = useCallback((): void => {
    setBigPicture('transitioning')
  }, [])

  // T7: transição cinematográfica concluída (ou pulada) → home liberada.
  const handleBigPictureTransitionComplete = useCallback((): void => {
    setBigPicture('active')
  }, [])

  const saveDefaultAppConfigs = useCallback((): void => {
    setApps(defaultApps)
    void saveAppConfigs(defaultApps)
  }, [])

  const runningCount = Object.values(effectiveStates).filter((s) => s.status === 'running').length

  // Toast de aviso/erro/sucesso — compartilhado entre o shell normal,
  // o Big Picture e a Zona de perigo (via onToast). Mantém o canto/posição
  // já usados pelo app; muda cor/ícone conforme o tipo.
  const noticeToast = (
    <AnimatePresence>
      {notice && (
        <motion.div
          key={notice.id}
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          className={`fixed bottom-6 right-6 z-[60] flex max-w-md items-start gap-3 rounded-xl px-4 py-3 shadow-2xl shadow-black/50 backdrop-blur-xl ${
            notice.kind === 'success'
              ? 'border-emerald-500/25 bg-[#071510]/95'
              : notice.kind === 'info'
                ? 'border-slate-500/25 bg-[#0a0a0f]/95'
                : 'border-red-500/25 bg-[#1a1014]/95'
          }`}
        >
          {notice.kind === 'success' ? (
            <Check size={16} className="mt-0.5 shrink-0 text-emerald-400" />
          ) : (
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />
          )}
          <p
            className={`text-xs leading-relaxed ${notice.kind === 'success' ? 'text-emerald-100' : notice.kind === 'info' ? 'text-slate-100' : 'text-red-100'}`}
          >
            {notice.text}
          </p>
          <button
            onClick={() => setNotice(null)}
            className="ml-2 shrink-0 rounded p-0.5 text-slate-500 transition-colors hover:text-white"
            aria-label="Fechar aviso"
          >
            <X size={13} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )

  return (
    <>
      {/* ── Tela de primeira execução ─────────────────── */}
      {isFirstRun ? (
        <FirstRunInstall
          onComplete={() => {
            saveDefaultAppConfigs()
            setIsFirstRun(false)
            // Vai direto para o Hub: a animação da loading screen só faz
            // sentido na abertura do app, não após a primeira execução.
            setAnimationDone(true)
          }}
        />
      ) : isLoading ? (
        <LoadingScreen onReady={handleLoadingReady} />
      ) : bigPicture !== 'hidden' ? (
        <>
          {/* ── Big Picture: takeover em tela cheia (no lugar do Layout) ── */}
          <BigPicture
            mode={bigPicture}
            onExit={exitBigPicture}
            onSetupComplete={handleBigPictureSetupComplete}
            onTransitionComplete={handleBigPictureTransitionComplete}
          />
          {noticeToast}
        </>
      ) : (
        <>
          <Layout
            currentPage={currentPage}
            onNavigate={setCurrentPage}
            runningCount={runningCount}
            pcName={pcName}
            onExit={() => setExitModalOpen(true)}
            onEnterBigPicture={enterBigPicture}
          >
            {currentPage === 'dashboard' ? (
              <Dashboard
                apps={apps}
                appStates={effectiveStates}
                onLaunch={handleLaunch}
                onStop={handleStop}
              />
            ) : currentPage === 'inicializacao' ? (
              <ErrorBoundary>
                <Inicializacao
                  pcName={pcName ?? ''}
                  items={startupItems}
                  importance={startupImportance}
                  labels={IMPORTANCE_LABELS}
                  onRemove={handleRemoveStartup}
                  onRemoveBatch={handleRemoveBatchStartup}
                  onAdd={handleAddStartup}
                  onAddBatch={handleAddBatchStartup}
                  onReload={loadStartupItems}
                  appsNotInStartup={appsNotInStartup}
                />
              </ErrorBoundary>
            ) : currentPage === 'biblioteca' ? (
              <ErrorBoundary>
                <Biblioteca />
              </ErrorBoundary>
            ) : (
              <Settings apps={apps} onSave={handleSaveApps} onToast={onToast} />
            )}
          </Layout>

          {/* ── Error toast ──────────────────────────────── */}
          {noticeToast}

          {/* ── Busca global (atalho "/") ───────────────── */}
          {searchOpen && (
            <GlobalSearch
              apps={apps}
              onClose={() => setSearchOpen(false)}
              onLaunchApp={handleSearchLaunchApp}
              onLaunchGame={handleSearchLaunchGame}
            />
          )}

          {/* ── Modal: confirmação de saída ──────────────── */}
          {exitModalOpen && (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center"
              role="dialog"
              aria-modal="true"
              aria-labelledby="exit-hub-title"
            >
              <button
                type="button"
                aria-label="Fechar confirmação de saída"
                className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
                onClick={closeExitModal}
              />
              <div
                ref={exitTrapRef}
                className="relative w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#0f1117]/95 p-6 shadow-2xl backdrop-blur-xl"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle
                    size={24}
                    className="mt-0.5 shrink-0 text-red-400"
                    aria-hidden="true"
                  />
                  <div>
                    <h2 id="exit-hub-title" className="text-lg font-bold text-white">
                      Encerrar Kolnd Hub?
                    </h2>
                    <p className="mt-1 text-sm text-slate-400 leading-relaxed">
                      Todos os programas e servidores iniciados pelo Hub serão fechados, incluindo o
                      que estiver rodando em segundo plano. Nada do Kolnd Hub permanecerá aberto.
                    </p>
                  </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                  <button
                    onClick={() => setExitModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white hover:bg-white/[0.05] transition-colors"
                  >
                    Não
                  </button>
                  <button
                    onClick={handleExit}
                    className="px-4 py-2 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-500 shadow-glow-red transition-colors"
                  >
                    Sim, encerrar
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}

export default App
