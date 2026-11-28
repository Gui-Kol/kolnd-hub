import { useEffect, useMemo, useRef, useState } from 'react'
import type { OverlayLayout, SettingsTab, UiConfig } from '../../../shared/config'
import { isSettingsTab } from '../../../shared/config'
import {
  DEFAULT_OVERLAY_LAYOUT,
  OVERLAY_HEIGHT_MAX,
  OVERLAY_HEIGHT_MIN,
  OVERLAY_WIDTH_MAX,
  OVERLAY_WIDTH_MIN
} from '../../../shared/overlay'
import {
  applyThemePreset,
  defaultTheme,
  normalizeTheme,
  type ThemeConfig,
  type ThemePresetId
} from '../../../shared/theme'
import { AboutTab } from './AboutTab'
import { AppearanceTab } from './AppearanceTab'
import { AvatarPreview } from './AvatarPreview'
import { DiagnosticsTab } from './DiagnosticsTab'
import { HistoryPanel } from './history/HistoryPanel'
import { KeyTab } from './KeyTab'
import { MemoryPanel } from './memory/MemoryPanel'
import { PermissionsTab } from './PermissionsTab'
import { VoiceTab } from './VoiceTab'
import { createDebounced, createThrottled } from './timing'

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'appearance', label: 'Aparência' },
  { id: 'voice', label: 'Voz' },
  { id: 'permissions', label: 'Permissões' },
  { id: 'memory', label: 'Memória' },
  { id: 'key', label: 'Chave e custo' },
  { id: 'diagnostics', label: 'Diagnóstico' },
  { id: 'about', label: 'Sobre' }
]

function readTabFromHash(hash: string): SettingsTab | null {
  const body = hash.startsWith('#') ? hash.slice(1) : hash
  if (!body.startsWith('settings/')) return null
  const tab = body.slice('settings/'.length).split('?')[0]
  return isSettingsTab(tab) ? tab : null
}

function readUiConfig(value: unknown): UiConfig {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  return {
    language: typeof raw.language === 'string' ? raw.language : 'pt-BR',
    reducedMotion: raw.reducedMotion === true,
    startMinimized: raw.startMinimized === true,
    lastSettingsTab: isSettingsTab(raw.lastSettingsTab) ? raw.lastSettingsTab : 'appearance'
  }
}

/** Envio ao overlay e persistência têm cadências diferentes (task 04/T5). */
const OVERLAY_PUSH_DELAY_MS = 100
const PERSIST_INTERVAL_MS = 300

/**
 * Janela de Configurações (rota `#settings`).
 *
 * Navegação lateral com sete abas (task 11). A aba ativa persiste em
 * `ui.lastSettingsTab`; sem chave do Gemini, o primeiro uso abre em "Chave e
 * custo". Fechar a janela apenas a oculta (regra da task 01), então o estado
 * local continua o mesmo ao reabrir.
 */
export function SettingsApp() {
  const [section, setSection] = useState<SettingsTab>(
    () => readTabFromHash(window.location.hash) ?? 'appearance'
  )
  const [theme, setTheme] = useState<ThemeConfig>(defaultTheme)
  const [layout, setLayout] = useState<OverlayLayout>(() => ({ ...DEFAULT_OVERLAY_LAYOUT }))
  const [uiConfig, setUiConfig] = useState<UiConfig>(() => readUiConfig(undefined))
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [windowVisible, setWindowVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
  )
  const activeTabRef = useRef<HTMLButtonElement | null>(null)

  const pushToOverlay = useMemo(
    () =>
      createDebounced((next: ThemeConfig) => {
        void window.absolem.themeSet(next, { persist: false })
      }, OVERLAY_PUSH_DELAY_MS),
    []
  )

  const persistTheme = useMemo(
    () =>
      createThrottled((next: ThemeConfig) => {
        void window.absolem.themeSet(next, { persist: true })
      }, PERSIST_INTERVAL_MS),
    []
  )

  useEffect(() => {
    let cancelled = false

    void Promise.all([
      window.absolem.themeGet().catch(() => null),
      window.absolem.overlayStatus().catch(() => null)
    ]).then(([themeResult, statusResult]) => {
      if (cancelled) return
      if (themeResult?.ok) setTheme(normalizeTheme(themeResult.theme))
      else if (themeResult) setLoadError(themeResult.error)
      if (statusResult?.ok) setLayout(statusResult.status.layout)
    })

    return () => {
      cancelled = true
    }
  }, [])

  // Aba inicial: hash explícito vence; senão a última aba; sem chave e sem
  // escolha explícita, o primeiro uso abre em "Chave e custo".
  useEffect(() => {
    let cancelled = false
    const explicit = readTabFromHash(window.location.hash)
    void Promise.all([
      window.absolem.storeGet('ui').catch(() => null),
      window.absolem.gemini.status().catch(() => null)
    ]).then(([uiResult, statusResult]) => {
      if (cancelled) return
      const ui = uiResult?.ok ? readUiConfig(uiResult.value) : readUiConfig(undefined)
      setUiConfig(ui)
      const hasKey = statusResult?.ok ? statusResult.status.configured : true
      setConfigured(hasKey)
      let next = explicit ?? ui.lastSettingsTab ?? 'appearance'
      if (!explicit && !hasKey && next === 'appearance') next = 'key'
      setSection(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onVisibilityChange = (): void => {
      setWindowVisible(document.visibilityState !== 'hidden')
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  useEffect(() => {
    const onHashChange = (): void => {
      const tab = readTabFromHash(window.location.hash)
      if (tab) setSection(tab)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => {
      window.removeEventListener('hashchange', onHashChange)
    }
  }, [])

  useEffect(() => {
    // Foco inicial na aba ativa (teclado e leitor de tela).
    activeTabRef.current?.focus()
  }, [section])

  function persistTab(next: SettingsTab): void {
    const nextUi = { ...uiConfig, lastSettingsTab: next }
    setUiConfig(nextUi)
    void window.absolem.storeSet('ui', nextUi).catch(() => undefined)
  }

  function navigate(next: SettingsTab): void {
    setSection(next)
    persistTab(next)
    const hash = `#settings/${next}`
    if (window.location.hash !== hash) window.history.replaceState(null, '', hash)
  }

  useEffect(() => {
    return () => {
      pushToOverlay.cancel()
      // Fechar a janela não pode perder a última edição ainda não gravada.
      persistTheme.flush()
    }
  }, [pushToOverlay, persistTheme])

  function updateTheme(next: ThemeConfig): void {
    setTheme(next)
    pushToOverlay.schedule(next)
    persistTheme.schedule(next)
  }

  function changeLayout(patch: Partial<OverlayLayout>): void {
    setLayout((current) => ({ ...current, ...patch }))
    const outOfRange =
      (patch.width !== undefined &&
        (patch.width < OVERLAY_WIDTH_MIN || patch.width > OVERLAY_WIDTH_MAX)) ||
      (patch.height !== undefined &&
        (patch.height < OVERLAY_HEIGHT_MIN || patch.height > OVERLAY_HEIGHT_MAX))
    if (outOfRange) {
      setActionError(
        `Tamanho fora da faixa: largura ${OVERLAY_WIDTH_MIN}..${OVERLAY_WIDTH_MAX}, altura ${OVERLAY_HEIGHT_MIN}..${OVERLAY_HEIGHT_MAX}.`
      )
      return
    }

    setActionError(null)
    void window.absolem
      .overlaySetLayout(patch)
      .then((result) => {
        if (!result.ok) {
          setActionError(result.error)
          return
        }
        setLayout(result.status.layout)
      })
      .catch(() => setActionError('Não foi possível mover o overlay.'))
  }

  function resetLayout(): void {
    const next = { ...DEFAULT_OVERLAY_LAYOUT }
    setLayout(next)
    setActionError(null)
    void window.absolem
      .overlaySetLayout(next)
      .then((result) => {
        if (result.ok) setLayout(result.status.layout)
        else setActionError(result.error)
      })
      .catch(() => setActionError('Não foi possível mover o overlay.'))
  }

  async function exportTheme(): Promise<void> {
    setNotice(null)
    setActionError(null)
    // Garante que o arquivo exportado tenha a última edição, mesmo que o
    // throttle de persistência ainda esteja pendente.
    pushToOverlay.cancel()
    persistTheme.cancel()
    const saved = await window.absolem.themeSet(theme, { persist: true }).catch(() => null)
    if (!saved?.ok) {
      setActionError(saved?.error ?? 'Não foi possível salvar o tema antes de exportar.')
      return
    }
    const result = await window.absolem.themeExport().catch(() => null)
    if (!result) {
      setActionError('Não foi possível exportar o tema.')
      return
    }
    if (!result.ok) {
      setActionError(result.error)
      return
    }
    if (!result.canceled) setNotice('Tema exportado.')
  }

  async function importTheme(): Promise<void> {
    setNotice(null)
    setActionError(null)
    const result = await window.absolem.themeImport().catch(() => null)
    if (!result) {
      setActionError('Não foi possível importar o tema.')
      return
    }
    if (!result.ok) {
      setActionError(result.error)
      return
    }
    if (result.canceled) return

    // O main já persistiu e empurrou o tema importado; a UI apenas sincroniza.
    pushToOverlay.cancel()
    persistTheme.cancel()
    if (result.theme) setTheme(normalizeTheme(result.theme))
    setNotice(
      result.warnings.length > 0
        ? `Tema importado com ajustes: ${result.warnings.join(' ')}`
        : 'Tema importado.'
    )
  }

  function renderAppearance() {
    return (
      <>
        <h2 className="mb-4 text-base font-semibold">Aparência</h2>
        {loadError ? (
          <p
            role="alert"
            className="mb-4 rounded border border-red-400/40 px-3 py-2 text-sm text-red-300"
          >
            Não foi possível carregar o tema: {loadError}
          </p>
        ) : null}

        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="min-w-0 flex-1">
            <AppearanceTab
              theme={theme}
              layout={layout}
              onThemeChange={updateTheme}
              onPreset={(presetId: ThemePresetId) => updateTheme(applyThemePreset(presetId))}
              onResetTheme={() => updateTheme(defaultTheme())}
              onLayoutChange={changeLayout}
              onResetLayout={resetLayout}
            />
          </div>
          <aside className="flex flex-col gap-2" aria-labelledby="appearance-preview-title">
            <h3 id="appearance-preview-title" className="text-xs text-ink-secondary">
              Prévia
            </h3>
            {windowVisible ? <AvatarPreview theme={theme} /> : null}
            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="rounded border border-surface-2 px-3 py-1.5 text-xs text-ink-secondary hover:border-accent hover:text-ink-primary"
                onClick={() => {
                  void exportTheme()
                }}
              >
                Exportar tema…
              </button>
              <button
                type="button"
                className="rounded border border-surface-2 px-3 py-1.5 text-xs text-ink-secondary hover:border-accent hover:text-ink-primary"
                onClick={() => {
                  void importTheme()
                }}
              >
                Importar tema…
              </button>
            </div>
            {notice ? (
              <p role="status" className="max-w-[240px] text-xs text-ink-secondary">
                {notice}
              </p>
            ) : null}
            {actionError ? (
              <p role="alert" className="max-w-[240px] text-xs text-red-300">
                {actionError}
              </p>
            ) : null}
          </aside>
        </div>
      </>
    )
  }

  function renderPanel() {
    if (section === 'voice') return <VoiceTab />
    if (section === 'permissions') return <PermissionsTab />
    if (section === 'key') return <KeyTab />
    if (section === 'diagnostics') return <DiagnosticsTab />
    if (section === 'about') return <AboutTab />
    if (section === 'memory') {
      return (
        <div className="flex flex-col gap-8">
          <MemoryPanel />
          <HistoryPanel />
        </div>
      )
    }
    return renderAppearance()
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface-base text-ink-primary">
      <header className="border-b border-surface-2 px-6 py-4">
        <h1 className="text-lg font-semibold tracking-wide">Configurações do Absolem</h1>
        <p className="text-xs text-ink-tertiary">
          Aparência, voz, permissões, memória, chave, diagnóstico e informações do app. As
          alterações são locais a esta máquina.
        </p>
        {configured === false ? (
          <p role="status" className="mt-2 text-xs text-amber-200">
            Chave do Gemini não configurada: o app continua utilizável, mas a conversa fica
            indisponível até salvar uma chave.
          </p>
        ) : null}
      </header>

      <div className="flex flex-1 flex-col sm:flex-row">
        <nav
          aria-label="Seções de configuração"
          className="border-b border-surface-2 px-4 py-3 sm:w-48 sm:border-b-0 sm:border-r"
        >
          <ul className="flex gap-2 overflow-x-auto sm:flex-col sm:overflow-visible">
            {TABS.map((tab) => {
              const active = section === tab.id
              return (
                <li key={tab.id}>
                  <button
                    ref={active ? activeTabRef : undefined}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => navigate(tab.id)}
                    className={`w-full rounded px-3 py-2 text-left text-sm ${
                      active
                        ? 'bg-surface-2 font-medium text-ink-primary'
                        : 'text-ink-secondary hover:text-ink-primary'
                    }`}
                  >
                    {tab.label}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <main className="flex-1 overflow-y-auto px-6 py-5">{renderPanel()}</main>
      </div>
    </div>
  )
}
