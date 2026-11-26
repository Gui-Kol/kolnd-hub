import { useEffect, useMemo, useState } from 'react'
import type { OverlayLayout } from '../../../shared/config'
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
import { AppearanceTab } from './AppearanceTab'
import { AvatarPreview } from './AvatarPreview'
import { createDebounced, createThrottled } from './timing'

/** Envio ao overlay e persistência têm cadências diferentes (task 04/T5). */
const OVERLAY_PUSH_DELAY_MS = 100
const PERSIST_INTERVAL_MS = 300

/**
 * Janela de Configurações (rota `#settings`).
 *
 * Nesta task a navegação tem apenas "Aparência"; voz, permissões, memória,
 * chave e diagnóstico entram na task 11. Fechar a janela apenas a oculta (regra
 * da task 01), então o estado local continua o mesmo ao reabrir.
 *
 * Fluxo de uma edição: preview local imediato; `theme:set` para o overlay com
 * debounce de 100 ms; persistência com throttle de 300 ms. O preview só fica
 * montado enquanto a janela está visível e é descartado ao ocultar.
 */
export function SettingsApp() {
  const [theme, setTheme] = useState<ThemeConfig>(defaultTheme)
  const [layout, setLayout] = useState<OverlayLayout>(() => ({ ...DEFAULT_OVERLAY_LAYOUT }))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [windowVisible, setWindowVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
  )

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

  return (
    <div className="flex min-h-screen flex-col bg-surface-base text-ink-primary">
      <header className="border-b border-surface-2 px-6 py-4">
        <h1 className="text-lg font-semibold tracking-wide">Configurações do Absolem</h1>
        <p className="text-xs text-ink-tertiary">
          Aparência do avatar e posição do overlay. As alterações são locais a esta máquina.
        </p>
      </header>

      <div className="flex flex-1 flex-col sm:flex-row">
        <nav
          aria-label="Seções de configuração"
          className="border-b border-surface-2 px-4 py-3 sm:w-48 sm:border-b-0 sm:border-r"
        >
          <ul className="flex gap-2 sm:flex-col">
            <li>
              <button
                type="button"
                aria-current="page"
                className="w-full rounded bg-surface-2 px-3 py-2 text-left text-sm font-medium text-ink-primary"
              >
                Aparência
              </button>
            </li>
          </ul>
        </nav>

        <main className="flex-1 overflow-y-auto px-6 py-5">
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
        </main>
      </div>
    </div>
  )
}
