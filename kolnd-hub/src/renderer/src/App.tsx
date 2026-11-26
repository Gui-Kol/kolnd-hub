import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { useReducedMotion } from './lib/motion'
import { Button, Modal, Toast } from './components/ui'
import { Layout } from './components/Layout'
import { Dashboard } from './components/Dashboard'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LoadingScreen } from './components/LoadingScreen'
import { apps as defaultApps } from './config/apps'
import type { ReleaseInfo, UpdateCheckResult } from '../../shared/updates'
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
import { once } from './lib/once'
import { useGuideButtonShortcut } from './hooks/useGuideButtonShortcut'

// Code splitting: páginas fora da inicial viajam em chunks próprios, carregados
// só quando visitadas (o boot deixa de pagar Settings/Inicialização/Big Picture
// inteiros). Fallback `null`: nenhum spinner/texto novo — a transição de página
// existente continua idêntica.
const Settings = lazy(() => import('./components/Settings').then((m) => ({ default: m.Settings })))
const Inicializacao = lazy(() =>
  import('./components/Inicializacao').then((m) => ({ default: m.Inicializacao }))
)
const Biblioteca = lazy(() =>
  import('./components/Biblioteca').then((m) => ({ default: m.Biblioteca }))
)
const BigPicture = lazy(() =>
  import('./components/BigPicture').then((m) => ({ default: m.BigPicture }))
)
const FirstRunInstall = lazy(() =>
  import('./components/FirstRunInstall').then((m) => ({ default: m.FirstRunInstall }))
)
const GlobalSearch = lazy(() =>
  import('./components/GlobalSearch').then((m) => ({ default: m.GlobalSearch }))
)
const UpdateBanner = lazy(() =>
  import('./components/UpdateBanner').then((m) => ({ default: m.UpdateBanner }))
)

// Uma consulta por processo (StrictMode no dev monta o init duas vezes): o main
// paga WMI/PowerShell caro para o nome do PC e para a lista de inicialização.
const systemPcNameOnce = once(() => window.api.systemPcName())
const startupListOnce = once(() => window.api.startupList())

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

/**
 * Uma consulta por processo, compartilhada entre montagens (StrictMode dev
 * executa o efeito duas vezes; um GET só evita gastar rate limit do GitHub).
 */
let pendingUpdateCheck: Promise<UpdateCheckResult> | null = null

function checkForUpdatesOnce(): Promise<UpdateCheckResult> {
  pendingUpdateCheck ??= Promise.resolve()
    .then(() => window.api.checkForUpdates())
    .catch((): UpdateCheckResult => ({
      ok: false,
      release: null,
      updateAvailable: false,
      canAutoInstall: false
    }))
  return pendingUpdateCheck
}

function App(): JSX.Element {
  // Toast de aviso decorativo vira fade curto com reduce.
  const reduced = useReducedMotion()
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
  // Atualização do app: release nova no GitHub (uma consulta por abertura) e
  // "adiar" só para esta sessão — a próxima abertura avisa de novo.
  const [updateInfo, setUpdateInfo] = useState<{
    release: ReleaseInfo
    canAutoInstall: boolean
  } | null>(null)
  const [updateDismissed, setUpdateDismissed] = useState(false)
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
  // Fechar o toast é estável (o primitivo <Toast/> gerencia o timer de 7 s;
  // identidade estável evita resetar o auto-dismiss a cada render do App).
  const closeNotice = useCallback((): void => setNotice(null), [])

  // Registro de uso: uma chamada por troca de página. O ref evita evento
  // duplicado quando o StrictMode monta o efeito duas vezes no dev.
  const loggedPageViewRef = useRef<Page | null>(null)
  useEffect(() => {
    if (loggedPageViewRef.current === currentPage) return
    loggedPageViewRef.current = currentPage
    window.api.logPageView(currentPage).catch(() => {
      // Registro é best-effort: falha não afeta a navegação.
    })
  }, [currentPage])

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

  // Nome do computador (exibe na titlebar, no mega menu e na página de inicialização).
  // Carregado pelo `init()` abaixo — não há efeito dedicado duplicando a IPC.

  // Atualização do app: consulta a última release do GitHub a cada abertura.
  // Sem rede/GitHub fora, falha em silêncio (o Hub abre normal, só sem banner).
  useEffect(() => {
    let mounted = true
    checkForUpdatesOnce()
      .then((result) => {
        if (!mounted) return
        if (result.ok && result.updateAvailable && result.release) {
          setUpdateInfo({ release: result.release, canAutoInstall: result.canAutoInstall })
        }
      })
      .catch(() => {
        // Verificação é opcional: nunca bloqueia nem vira toast.
      })
    return (): void => {
      mounted = false
    }
  }, [])

  // ── Itens de inicialização do PC ──────────────────────────────
  // `refresh: true` força uma releitura do main (ex.: após remover itens) e
  // também do mapa de importância; na montagem valem os snapshots do processo.
  const loadStartupItems = useCallback(async (refresh = false): Promise<void> => {
    let items: StartupItem[] = []
    try {
      items = await (refresh ? window.api.startupList() : startupListOnce())
    } catch (err) {
      setNotice({
        id: Date.now(),
        text: `Não foi possível listar a inicialização: ${err instanceof Error ? err.message : String(err)}`
      })
    }
    setStartupItems(items)

    const map = await loadImportanceMap(refresh)

    const next: Record<string, ImportanceLevel> = {}
    for (const item of items) {
      next[item.id] = map[item.id] ?? classifyImportance(item)
    }
    setStartupImportance(next)
  }, [])

  // ── Carregamento inicial (tela de loading) ────────────────────────
  // ÚNICA carga de montagem: mantém a tela de loading visível até que os dados
  // essenciais estejam disponíveis, sem efeitos paralelos repetindo as mesmas
  // leituras de IPC.
  useEffect(() => {
    let mounted = true

    const init = async (): Promise<void> => {
      await Promise.allSettled([
        // Perfil do sistema (nome do PC, usado na titlebar e inicialização).
        systemPcNameOnce().then((name) => {
          if (mounted) setPcName(name)
        }),
        // Status inicial de todos os apps gerenciados pelo Hub.
        window.api.getAllStatus().then((status) => {
          if (mounted) {
            setAppStates(status as Record<string, AppState>)
          }
        })
      ])

      if (mounted) setDataReady(true)

      // A lista de inicialização não é necessária para a primeira pintura:
      // carrega em segundo plano (a página Inicialização mostra o estado
      // vazio até ela chegar) em vez de segurar a LoadingScreen.
      void loadStartupItems()
    }

    void init()

    return (): void => {
      mounted = false
    }
  }, [loadStartupItems])

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

  // Processos do sistema em segundo plano: o main tem UM agendador (WMI a cada
  // 15 s com a janela visível, 60 s na bandeja). Antes este efeito tinha o
  // próprio setTimeout recursivo e consultava o WMI em paralelo ao Big
  // Picture/Biblioteca. O badge "em segundo plano" usa o mesmo estado.
  useEffect(() => {
    let active = true
    const consumerId = 'app:background-processes'

    const unsubscribe = window.api.onProcessWatchUpdate((processes) => {
      if (active) setBgProcesses(processes)
    })

    const subscribe = (): void => {
      const intervalMs = document.visibilityState === 'visible' ? 15000 : 60000
      void window.api.startProcessWatch(consumerId, intervalMs).catch(() => {
        // Sem main: mantém o último retrato conhecido e não trava a UI.
      })
    }

    const onVisibility = (): void => {
      // Re-registrar o mesmo id atualiza o intervalo no agendador único.
      subscribe()
    }

    subscribe()
    document.addEventListener('visibilitychange', onVisibility)
    return (): void => {
      active = false
      document.removeEventListener('visibilitychange', onVisibility)
      unsubscribe()
      void window.api.stopProcessWatch(consumerId).catch(() => undefined)
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

      await loadStartupItems(true)
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
      await loadStartupItems(true)
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
      await loadStartupItems(true)
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
      await loadStartupItems(true)
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
  // Único ponto de decisão (todos os caminhos de entrada — botão da topbar,
  // mega menu, deep-links futuros — passam por aqui):
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

  // Atalho do botão PS/Guide (índice 16): só com o Hub em foco (gate dentro do
  // hook) e no shell normal — setup/transição/home do Big Picture, modais,
  // busca e primeira execução ficam de fora. Passar pelo `enterBigPicture`
  // mantém o gate de configuração como única porta de entrada.
  useGuideButtonShortcut({
    enabled: !isFirstRun && !isLoading && bigPicture === 'hidden' && !exitModalOpen && !searchOpen,
    onTrigger: enterBigPicture
  })

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
  // o Big Picture e a Zona de perigo (via onToast). Mesmo canto inferior
  // direito e 7 s do aviso anterior, agora via primitivo <Toast/> (cores/ícones
  // tokenizados). `kind` ausente vira 'error' — mesmo tom vermelho de antes;
  // `key` por id reinicia o timer de 7 s e reanuncia a cada aviso novo.
  const noticeToast = notice && (
    <Toast
      key={notice.id}
      kind={notice.kind ?? 'error'}
      message={notice.text}
      onClose={closeNotice}
    />
  )

  return (
    <>
      {/* ── Tela de primeira execução ─────────────────── */}
      {isFirstRun ? (
        <Suspense fallback={null}>
          <FirstRunInstall
            onComplete={() => {
              saveDefaultAppConfigs()
              setIsFirstRun(false)
              // Vai direto para o Hub: a animação da loading screen só faz
              // sentido na abertura do app, não após a primeira execução.
              setAnimationDone(true)
            }}
          />
        </Suspense>
      ) : isLoading ? (
        <LoadingScreen onReady={handleLoadingReady} />
      ) : bigPicture !== 'hidden' ? (
        <>
          {/* ── Big Picture: takeover em tela cheia (no lugar do Layout) ── */}
          <Suspense fallback={null}>
            <BigPicture
              mode={bigPicture}
              onExit={exitBigPicture}
              onSetupComplete={handleBigPictureSetupComplete}
              onTransitionComplete={handleBigPictureTransitionComplete}
            />
          </Suspense>
          {noticeToast}
        </>
      ) : (
        <>
          <Layout
            currentPage={currentPage}
            onNavigate={setCurrentPage}
            runningCount={runningCount}
            toolCount={apps.length}
            pcName={pcName}
            onExit={() => setExitModalOpen(true)}
            onEnterBigPicture={enterBigPicture}
            onOpenSearch={() => setSearchOpen(true)}
            updateBanner={
              updateInfo && !updateDismissed ? (
                <Suspense fallback={null}>
                  <UpdateBanner
                    release={updateInfo.release}
                    canAutoInstall={updateInfo.canAutoInstall}
                    onDismiss={() => setUpdateDismissed(true)}
                  />
                </Suspense>
              ) : null
            }
          >
            {/* ── Transição única de página (13.19): fade + slide ≤ 8 px, 200 ms,
                easing --ease-standard; uma camada por página. Com reduce: 0 ms.
                O <main> rolável vem do Layout; o wrapper anima só a troca. ── */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={currentPage}
                initial={{ opacity: 0, y: reduced ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduced ? 0 : -8 }}
                transition={reduced ? { duration: 0 } : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
                {currentPage === 'dashboard' ? (
                  <Dashboard
                    apps={apps}
                    appStates={effectiveStates}
                    onLaunch={handleLaunch}
                    onStop={handleStop}
                    onToast={onToast}
                    onOpenSettings={() => setCurrentPage('settings')}
                  />
                ) : currentPage === 'inicializacao' ? (
                  <ErrorBoundary>
                    <Suspense fallback={null}>
                      <Inicializacao
                        pcName={pcName ?? ''}
                        items={startupItems}
                        importance={startupImportance}
                        labels={IMPORTANCE_LABELS}
                        onRemove={handleRemoveStartup}
                        onRemoveBatch={handleRemoveBatchStartup}
                        onAdd={handleAddStartup}
                        onAddBatch={handleAddBatchStartup}
                        onReload={() => loadStartupItems(true)}
                        appsNotInStartup={appsNotInStartup}
                      />
                    </Suspense>
                  </ErrorBoundary>
                ) : currentPage === 'biblioteca' ? (
                  <ErrorBoundary>
                    <Suspense fallback={null}>
                      <Biblioteca />
                    </Suspense>
                  </ErrorBoundary>
                ) : (
                  <Suspense fallback={null}>
                    <Settings apps={apps} onSave={handleSaveApps} onToast={onToast} />
                  </Suspense>
                )}
              </motion.div>
            </AnimatePresence>
          </Layout>

          {/* ── Error toast ──────────────────────────────── */}
          {noticeToast}

          {/* ── Busca global (atalho "/") ───────────────── */}
          {searchOpen && (
            <Suspense fallback={null}>
              <GlobalSearch
                apps={apps}
                onClose={() => setSearchOpen(false)}
                onLaunchApp={handleSearchLaunchApp}
                onLaunchGame={handleSearchLaunchGame}
              />
            </Suspense>
          )}

          {/* Modal: confirmação de saída — Esc/backdrop/botões fecham (comportamento
              restaurado em 16/11/2026 após decisão do usuário). Textos intactos. */}
          {exitModalOpen && (
            <Modal
              title="Encerrar Kolnd Hub?"
              onClose={closeExitModal}
              closeLabel="Fechar confirmação de saída"
              footer={
                <>
                  <Button variant="ghost" onClick={() => setExitModalOpen(false)}>
                    Não
                  </Button>
                  <Button variant="danger" onClick={handleExit}>
                    Sim, encerrar
                  </Button>
                </>
              }
            >
              <div className="flex items-start gap-3">
                <AlertTriangle
                  size={24}
                  className="mt-0.5 shrink-0 text-danger"
                  aria-hidden="true"
                />
                <p className="text-sm leading-relaxed text-ink-secondary">
                  Todos os programas e servidores iniciados pelo Hub serão fechados, incluindo o que
                  estiver rodando em segundo plano. Nada do Kolnd Hub permanecerá aberto.
                </p>
              </div>
            </Modal>
          )}
        </>
      )}
    </>
  )
}

export default App
