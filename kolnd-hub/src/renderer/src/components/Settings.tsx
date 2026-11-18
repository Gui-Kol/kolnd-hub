import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { entranceProps, useReducedMotion } from '../lib/motion'
import {
  Save,
  RotateCcw,
  Terminal,
  FolderOpen,
  AlertCircle,
  FileSearch,
  FolderSearch,
  Gamepad2,
  Check,
  ClipboardCopy,
  Loader2,
  AlertTriangle,
  FlaskConical,
  Bell,
  Power,
  Archive,
  Download,
  Upload,
  Info
} from 'lucide-react'
import { AppConfig } from '../types'
import { BigPictureSettings } from './BigPictureSettings'
import { RemoteAccessSettings } from './RemoteAccessSettings'
import { UninstallDangerZone } from './UninstallDangerZone'
import { Badge, Button, Card, IconButton, Input, SectionTitle, Switch } from './ui'

interface SettingsProps {
  apps: AppConfig[]
  onSave: (apps: AppConfig[]) => void
  onToast?: (msg: string, kind: 'success' | 'error' | 'info') => void
}

/** Issue de validação devolvida pelo IPC `command:validate` (espelho do main). */
type CommandIssue = { level: 'error' | 'warning'; message: string }

export function Settings({ apps, onSave, onToast }: SettingsProps): JSX.Element {
  // Entradas decorativas das seções (incl. cascata dos cards de apps) viram fade curto com reduce.
  const reduced = useReducedMotion()
  const [editedApps, setEditedApps] = useState<AppConfig[]>(apps.map((a) => ({ ...a })))
  const [saved, setSaved] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)

  // Preferência "Iniciar Kloud Games junto com o Hub": lida do electron-store
  // (via IPC) na montagem; `null` enquanto carrega (toggle desabilitado).
  const [launchKloudOnStart, setLaunchKloudOnStart] = useState<boolean | null>(null)
  const [prefFeedback, setPrefFeedback] = useState<'saved' | 'error' | null>(null)
  const prefFeedbackTimer = useRef<number | null>(null)
  // Preferência "Notificar quando um programa parar inesperadamente" (07-7.2):
  // opt-out, default ligado. Mesmo padrão do toggle acima.
  const [notifyOnCrash, setNotifyOnCrash] = useState<boolean | null>(null)
  const [notifyFeedback, setNotifyFeedback] = useState<'saved' | 'error' | null>(null)
  const notifyFeedbackTimer = useRef<number | null>(null)
  // Autostart do próprio Hub no Windows (07-7.3): estado lido do SO via IPC.
  // `null` enquanto carrega; `supported=false` fora do app instalado (dev) —
  // toggle desabilitado com dica.
  const [autostart, setAutostart] = useState<boolean | null>(null)
  const [autostartSupported, setAutostartSupported] = useState(true)
  const [autostartFeedback, setAutostartFeedback] = useState<'saved' | 'error' | null>(null)
  const autostartFeedbackTimer = useRef<number | null>(null)
  const [exportingDiagnostic, setExportingDiagnostic] = useState(false)
  // Backup e restauração (07-7.6): exportar/importar a configuração do Hub.
  // O import acontece em DOIS passos no main (prévia → confirmação → aplicar);
  // aqui ficam apenas os estados da UI.
  const [exportingConfig, setExportingConfig] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<{
    kind: 'done' | 'error'
    message: string
  } | null>(null)
  const exportFeedbackTimer = useRef<number | null>(null)
  const [importFlow, setImportFlow] = useState<'idle' | 'previewing' | 'confirm' | 'applying'>(
    'idle'
  )
  const [importSummary, setImportSummary] = useState<{
    apps: number
    games: number
    sections: string[]
    rejected: Array<{ section: string; error: string }>
  } | null>(null)
  const [importFeedback, setImportFeedback] = useState<{
    kind: 'done' | 'partial' | 'error'
    message: string
  } | null>(null)
  const importFeedbackTimer = useRef<number | null>(null)
  // Issues inline do campo de comando, por id de app (debounce de ~300 ms no
  // efeito abaixo) + resultado do botão "Testar comando" (clique explícito).
  const [commandIssues, setCommandIssues] = useState<Record<string, CommandIssue[]>>({})
  const [testResults, setTestResults] = useState<Record<string, CommandIssue[]>>({})
  const [testingAppId, setTestingAppId] = useState<string | null>(null)
  // Sequência para descartar respostas fora de ordem do debounce.
  const validateSeq = useRef(0)

  useEffect(() => {
    let mounted = true
    window.api
      .getLaunchKloudOnStart()
      .then((value) => {
        if (mounted) setLaunchKloudOnStart(value)
      })
      .catch(() => {
        if (mounted) setLaunchKloudOnStart(false)
      })
    return (): void => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true
    window.api
      .getHubAutostart()
      .then((value) => {
        if (!mounted) return
        setAutostart(value.enabled)
        setAutostartSupported(value.supported)
      })
      .catch((err) => {
        console.error('[settings] Falha ao ler o autostart do Hub:', err)
        if (!mounted) return
        setAutostart(false)
        setAutostartSupported(false)
      })
    return (): void => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true
    window.api
      .getNotifyOnCrash()
      .then((value) => {
        if (mounted) setNotifyOnCrash(value)
      })
      .catch(() => {
        // Falha na leitura → assume ligado (default opt-out persistido no store).
        if (mounted) setNotifyOnCrash(true)
      })
    return (): void => {
      mounted = false
    }
  }, [])

  // Validação sob demanda (debounce ~300 ms) do campo de comando de cada
  // app. Apenas informa na UI — nunca bloqueia o salvamento. Se a IPC
  // falhar, a UI fica sem avisos (campo informativo, não fatal).
  useEffect(() => {
    const snapshot = editedApps
    const seq = ++validateSeq.current
    const handle = window.setTimeout(() => {
      void (async () => {
        const entries = await Promise.all(
          snapshot.map(async (app) => {
            try {
              const issues = await window.api.validateCommand(app.command, app.useShell !== false)
              return [app.id, issues] as const
            } catch {
              return [app.id, []] as const
            }
          })
        )
        if (seq === validateSeq.current) {
          setCommandIssues(Object.fromEntries(entries))
        }
      })()
    }, 300)
    return (): void => window.clearTimeout(handle)
  }, [editedApps])

  useEffect(
    () => () => {
      if (prefFeedbackTimer.current) window.clearTimeout(prefFeedbackTimer.current)
      if (notifyFeedbackTimer.current) window.clearTimeout(notifyFeedbackTimer.current)
      if (autostartFeedbackTimer.current) window.clearTimeout(autostartFeedbackTimer.current)
      if (exportFeedbackTimer.current) window.clearTimeout(exportFeedbackTimer.current)
      if (importFeedbackTimer.current) window.clearTimeout(importFeedbackTimer.current)
    },
    []
  )

  const handleTogglePref = async (): Promise<void> => {
    if (launchKloudOnStart === null) return
    const next = !launchKloudOnStart
    setLaunchKloudOnStart(next)
    setPrefFeedback(null)
    try {
      const result = await window.api.setLaunchKloudOnStart(next)
      if (!result.success) throw new Error(result.error ?? 'erro desconhecido')
      setPrefFeedback('saved')
    } catch (err) {
      console.error('[settings] Falha ao salvar preferência:', err)
      // Reverte o toggle — o valor real continua sendo o persistido.
      setLaunchKloudOnStart(!next)
      setPrefFeedback('error')
    } finally {
      if (prefFeedbackTimer.current) window.clearTimeout(prefFeedbackTimer.current)
      prefFeedbackTimer.current = window.setTimeout(() => setPrefFeedback(null), 2500)
    }
  }

  const handleToggleAutostart = async (): Promise<void> => {
    if (autostart === null || !autostartSupported) return
    const next = !autostart
    setAutostart(next)
    setAutostartFeedback(null)
    try {
      const result = await window.api.setHubAutostart(next)
      if (!result.success) throw new Error(result.error ?? 'erro desconhecido')
      setAutostartFeedback('saved')
    } catch (err) {
      console.error('[settings] Falha ao salvar autostart:', err)
      // Reverte o toggle — o valor real continua sendo o persistido no SO.
      setAutostart(!next)
      setAutostartFeedback('error')
    } finally {
      if (autostartFeedbackTimer.current) window.clearTimeout(autostartFeedbackTimer.current)
      autostartFeedbackTimer.current = window.setTimeout(() => setAutostartFeedback(null), 2500)
    }
  }

  const handleToggleNotify = async (): Promise<void> => {
    if (notifyOnCrash === null) return
    const next = !notifyOnCrash
    setNotifyOnCrash(next)
    setNotifyFeedback(null)
    try {
      const result = await window.api.setNotifyOnCrash(next)
      if (!result.success) throw new Error(result.error ?? 'erro desconhecido')
      setNotifyFeedback('saved')
    } catch (err) {
      console.error('[settings] Falha ao salvar preferência:', err)
      // Reverte o toggle — o valor real continua sendo o persistido.
      setNotifyOnCrash(!next)
      setNotifyFeedback('error')
    } finally {
      if (notifyFeedbackTimer.current) window.clearTimeout(notifyFeedbackTimer.current)
      notifyFeedbackTimer.current = window.setTimeout(() => setNotifyFeedback(null), 2500)
    }
  }

  // Exportar diagnóstico sanitizado para a área de transferência (task 06-6.3).
  const handleExportDiagnostic = async (): Promise<void> => {
    if (exportingDiagnostic) return
    setExportingDiagnostic(true)
    try {
      const result = await window.api.exportDiagnostic()
      if (!result.success) throw new Error(result.error ?? 'erro desconhecido')
      onToast?.('Diagnóstico copiado para a área de transferência.', 'success')
    } catch (err) {
      console.error('[settings] Falha ao exportar diagnóstico:', err)
      onToast?.('Não foi possível copiar o diagnóstico. Tente de novo.', 'error')
    } finally {
      setExportingDiagnostic(false)
    }
  }

  // Agenda a limpeza de um feedback de backup/restauração (mensagens podem
  // ser longas — 6 s para dar tempo de ler o caminho do arquivo).
  const scheduleFeedbackClear = (
    setter: (value: null) => void,
    timerRef: { current: number | null }
  ): void => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setter(null), 6000)
  }

  // Exportar configuração para um JSON (07-7.6).
  const handleExportConfig = async (): Promise<void> => {
    if (exportingConfig) return
    setExportingConfig(true)
    setExportFeedback(null)
    try {
      const result = await window.api.exportConfig()
      if (!result.success) {
        // Cancelar o diálogo "salvar como" não é erro — não mostra feedback.
        if (result.canceled) return
        throw new Error(result.error ?? 'erro desconhecido')
      }
      setExportFeedback({
        kind: 'done',
        message: `Configuração exportada para ${result.path ?? 'arquivo JSON'}`
      })
    } catch (err) {
      console.error('[settings] Falha ao exportar configuração:', err)
      setExportFeedback({
        kind: 'error',
        message: 'Não foi possível exportar a configuração. Tente de novo.'
      })
    } finally {
      setExportingConfig(false)
      scheduleFeedbackClear(setExportFeedback, exportFeedbackTimer)
    }
  }

  // Importar, passo 1: abre o diálogo, valida o arquivo e devolve o resumo
  // do que será substituído. Nada é aplicado nesta etapa.
  const handleImportPreview = async (): Promise<void> => {
    if (importFlow !== 'idle') return
    setImportFlow('previewing')
    setImportFeedback(null)
    setImportSummary(null)
    try {
      const result = await window.api.importConfigPreview()
      if (result.ok) {
        setImportSummary({ ...result.summary, rejected: result.rejected })
        setImportFlow('confirm')
        return
      }
      if ('canceled' in result && result.canceled) {
        setImportFlow('idle')
        return
      }
      const errors = 'errors' in result ? result.errors : ['Erro desconhecido.']
      setImportFeedback({ kind: 'error', message: errors.join(' ') })
      setImportFlow('idle')
      scheduleFeedbackClear(setImportFeedback, importFeedbackTimer)
    } catch (err) {
      console.error('[settings] Falha ao importar configuração:', err)
      setImportFeedback({
        kind: 'error',
        message: 'Não foi possível ler o arquivo. Tente de novo.'
      })
      setImportFlow('idle')
      scheduleFeedbackClear(setImportFeedback, importFeedbackTimer)
    }
  }

  const handleImportCancel = (): void => {
    setImportFlow('idle')
    setImportSummary(null)
  }

  // Importar, passo 2: aplica a prévia guardada no main (com backup prévio).
  const handleImportApply = async (): Promise<void> => {
    if (importFlow !== 'confirm') return
    setImportFlow('applying')
    try {
      const result = await window.api.importConfigApply()
      if (!result.success) {
        setImportFeedback({ kind: 'error', message: result.error })
      } else if (result.failed.length > 0) {
        setImportFeedback({
          kind: 'partial',
          message: `Importação concluída com problemas em: ${result.failed
            .map((f) => f.section)
            .join(', ')}. O restante foi aplicado. Backup salvo em ${result.backupPath}.`
        })
      } else {
        setImportFeedback({
          kind: 'done',
          message:
            `Configuração importada. Backup automático salvo em ${result.backupPath}. ` +
            'Reinicie o Hub para ver os valores importados.'
        })
      }
    } catch (err) {
      console.error('[settings] Falha ao aplicar importação:', err)
      setImportFeedback({
        kind: 'error',
        message: 'Não foi possível aplicar a importação. Tente de novo.'
      })
    } finally {
      setImportFlow('idle')
      setImportSummary(null)
      scheduleFeedbackClear(setImportFeedback, importFeedbackTimer)
    }
  }

  // Limpa o resultado do "Testar comando" de um app (evita mostrar resultado obsoleto).
  const clearTestResult = (appId: string | undefined): void => {
    if (!appId) return
    setTestResults((prev) => {
      if (!(appId in prev)) return prev
      const next = { ...prev }
      delete next[appId]
      return next
    })
  }

  const handleChange = (index: number, field: keyof AppConfig, value: string): void => {
    setEditedApps((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
    if (field === 'command') clearTestResult(editedApps[index]?.id)
    setSaved(false)
  }

  // Botão "Testar comando": roda APENAS a validação síncrona do main e
  // exibe o resultado em área dedicada. Decisão explícita: o comando do
  // usuário NÃO é spawnado aqui (nem spawn seco, nem `where`) — executar
  // binário arbitrário a partir de um botão de "teste" é imprevisível e
  // arriscado demais; a validação cobre os casos do relatório.
  const handleTestCommand = async (app: AppConfig): Promise<void> => {
    if (testingAppId) return
    setTestingAppId(app.id)
    try {
      const issues = await window.api.validateCommand(app.command, app.useShell !== false)
      setTestResults((prev) => ({ ...prev, [app.id]: issues }))
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [app.id]: [{ level: 'error', message: 'Não foi possível validar o comando agora.' }]
      }))
    } finally {
      setTestingAppId(null)
    }
  }

  // Abre o explorador de arquivos nativo para escolher o caminho correto.
  // 'file' (Comando): seleciona o executável e salva entre aspas.
  // 'directory' (Diretório de trabalho): seleciona a pasta de instalação.
  const handlePickPath = async (
    index: number,
    field: 'command' | 'cwd',
    mode: 'file' | 'directory'
  ): Promise<void> => {
    const current = editedApps[index]?.[field]
    setPickError(null)

    try {
      const result = await window.api.pickAppPath(mode, current)
      if (!result.success) {
        if (!result.canceled) {
          setPickError(result.error ?? 'Não foi possível abrir o explorador de arquivos.')
        }
        return
      }
      if (result.path) {
        handleChange(index, field, field === 'command' ? `"${result.path}"` : result.path)
      }
    } catch (err) {
      setPickError(
        `Não foi possível abrir o explorador de arquivos: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  const handleSave = (): void => {
    onSave(editedApps)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleReset = (): void => {
    setEditedApps(apps.map((a) => ({ ...a })))
    setSaved(false)
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* ── Header ───────────────────────────────────── */}
      <motion.div
        {...entranceProps(reduced, { y: -10 })}
        className="flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div>
          <h2 className="text-[28px] font-bold leading-9 tracking-tight text-ink-primary md:text-[32px] md:leading-10">
            Configurações
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-secondary">
            Ajuste comandos e diretórios de trabalho dos seus títulos
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={handleReset}>
            <RotateCcw size={14} aria-hidden="true" /> Resetar tudo
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            className={saved ? '!border-success-border !bg-success-bg !text-success' : ''}
          >
            <Save size={14} aria-hidden="true" /> {saved ? 'Salvo!' : 'Salvar alterações'}
          </Button>
        </div>
      </motion.div>

      {/* ── Ao abrir o Hub ─────────────────────────── */}
      <SectionTitle>Ao abrir o Hub</SectionTitle>

      <div className="space-y-4">
        <motion.div {...entranceProps(reduced, { y: 20 })}>
          <Card className="p-6">
            <div className="flex items-center justify-between gap-6 flex-wrap">
              <div className="flex items-start gap-4 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-accent-muted text-accent">
                  <Gamepad2 size={20} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-ink-primary">
                    Iniciar Kloud Games junto com o Kolnd Hub
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                    O Hub abre o Kloud Games em segundo plano sempre que for iniciado.
                  </p>
                  {prefFeedback === 'saved' && (
                    <Badge tone="success" className="mt-2">
                      <Check size={12} aria-hidden="true" /> Salvo
                    </Badge>
                  )}
                  {prefFeedback === 'error' && (
                    <p className="mt-2 text-[11px] font-semibold text-danger">
                      Não foi possível salvar. Tente de novo.
                    </p>
                  )}
                </div>
              </div>

              <Switch
                aria-label="Iniciar Kloud Games junto com o Kolnd Hub"
                checked={launchKloudOnStart === true}
                disabled={launchKloudOnStart === null}
                onCheckedChange={() => void handleTogglePref()}
                className="shrink-0"
              />
            </div>
          </Card>
        </motion.div>

        {/* ── Autostart do Hub no Windows (07-7.3) ────── */}
        <motion.div {...entranceProps(reduced, { y: 20 })}>
          <Card className="p-6">
            <div className="flex items-center justify-between gap-6 flex-wrap">
              <div className="flex items-start gap-4 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-accent-muted text-accent">
                  <Power size={20} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-ink-primary">
                    Iniciar o Kolnd Hub com o Windows (minimizado na bandeja)
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                    O Hub sobe junto com o Windows, direto para a bandeja — sem abrir a janela.
                  </p>
                  {!autostartSupported && (
                    <p className="mt-2 text-[11px] text-ink-tertiary">
                      Disponível apenas no app instalado
                    </p>
                  )}
                  {autostartFeedback === 'saved' && (
                    <Badge tone="success" className="mt-2">
                      <Check size={12} aria-hidden="true" /> Salvo
                    </Badge>
                  )}
                  {autostartFeedback === 'error' && (
                    <p className="mt-2 text-[11px] font-semibold text-danger">
                      Não foi possível salvar. Tente de novo.
                    </p>
                  )}
                </div>
              </div>

              <Switch
                aria-label="Iniciar o Kolnd Hub com o Windows (minimizado na bandeja)"
                checked={autostart === true}
                disabled={autostart === null || !autostartSupported}
                onCheckedChange={() => void handleToggleAutostart()}
                className="shrink-0"
              />
            </div>
          </Card>
        </motion.div>
      </div>

      {/* ── Notificações ─────────────────────────────── */}
      <SectionTitle>Notificações</SectionTitle>

      <motion.div {...entranceProps(reduced, { y: 20 })}>
        <Card className="p-6">
          <div className="flex items-center justify-between gap-6 flex-wrap">
            <div className="flex items-start gap-4 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-accent-muted text-accent">
                <Bell size={20} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-ink-primary">
                  Notificar quando um programa parar inesperadamente
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                  O Hub avisa com uma notificação do Windows quando um programa iniciado por ele
                  fecha sozinho. O clique na notificação traz o Hub de volta à tela.
                </p>
                {notifyFeedback === 'saved' && (
                  <Badge tone="success" className="mt-2">
                    <Check size={12} aria-hidden="true" /> Salvo
                  </Badge>
                )}
                {notifyFeedback === 'error' && (
                  <p className="mt-2 text-[11px] font-semibold text-danger">
                    Não foi possível salvar. Tente de novo.
                  </p>
                )}
              </div>
            </div>

            <Switch
              aria-label="Notificar quando um programa parar inesperadamente"
              checked={notifyOnCrash === true}
              disabled={notifyOnCrash === null}
              onCheckedChange={() => void handleToggleNotify()}
              className="shrink-0"
            />
          </div>
        </Card>
      </motion.div>

      {/* ── Acesso remoto (Tailscale) ────────────────── */}
      <RemoteAccessSettings onToast={onToast} />

      {/* ── Big Picture ─────────────────────────────── */}
      <BigPictureSettings />

      <SectionTitle>Gerenciador de títulos</SectionTitle>

      {/* ── Cards de configuração ────────────────────── */}
      <div className="space-y-4">
        {editedApps.map((app, index) => {
          const issues = commandIssues[app.id] ?? []
          const hasError = issues.some((issue) => issue.level === 'error')
          const testResult = testResults[app.id]
          return (
            <motion.div
              key={app.id}
              {...entranceProps(reduced, { y: 20 }, { delay: index * 0.04 })}
            >
              <Card className="p-6 transition-colors duration-2 ease-standard hover:border-[var(--border-strong)]">
                {/* Cabeçalho do app */}
                <div className="flex items-center gap-3.5 mb-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-surface-2 text-xl">
                    {app.icon}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-ink-primary">{app.name}</h3>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-ink-tertiary">
                      {app.category.toUpperCase()}
                    </p>
                  </div>
                </div>

                {/* Campos editáveis */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="label-panel" htmlFor={`app-command-${index}`}>
                      <Terminal size={12} aria-hidden="true" /> Comando
                    </label>
                    <div className="relative">
                      <Input
                        id={`app-command-${index}`}
                        type="text"
                        value={app.command}
                        onChange={(e) => handleChange(index, 'command', e.target.value)}
                        onClick={() => handlePickPath(index, 'command', 'file')}
                        error={hasError}
                        className={`cursor-pointer pr-11 font-mono ${
                          !hasError && issues.length > 0 ? 'ring-1 ring-warn-border' : ''
                        }`}
                        placeholder="ex: kloud-games.exe"
                        title="Clique para selecionar o executável no explorador de arquivos"
                      />
                      <IconButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handlePickPath(index, 'command', 'file')}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-tertiary"
                        title="Selecionar executável…"
                        aria-label="Selecionar executável"
                      >
                        <FileSearch size={18} aria-hidden="true" />
                      </IconButton>
                    </div>
                    <p className="mt-1.5 text-[10px] text-ink-tertiary">
                      Clique no campo para escolher o .exe no explorador de arquivos.
                    </p>
                    {issues.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {issues.map((issue, i) => (
                          <li
                            key={i}
                            className={`flex items-start gap-1.5 text-[11px] leading-snug ${
                              issue.level === 'error' ? 'text-danger' : 'text-warn'
                            }`}
                          >
                            {issue.level === 'error' ? (
                              <AlertCircle
                                size={12}
                                className="mt-0.5 shrink-0"
                                aria-hidden="true"
                              />
                            ) : (
                              <AlertTriangle
                                size={12}
                                className="mt-0.5 shrink-0"
                                aria-hidden="true"
                              />
                            )}
                            <span>{issue.message}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleTestCommand(app)}
                        disabled={testingAppId === app.id}
                        className="disabled:cursor-wait"
                        title="Valida o comando sem executá-lo"
                      >
                        {testingAppId === app.id ? (
                          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                        ) : (
                          <FlaskConical size={12} aria-hidden="true" />
                        )}
                        Testar comando
                      </Button>
                      {testResult !== undefined && (
                        <div
                          className={`mt-2 rounded-control border px-3 py-2 text-[11px] leading-snug ${
                            testResult.length === 0
                              ? 'border-success-border bg-success-bg text-success'
                              : 'border-warn-border bg-warn-bg'
                          }`}
                          role="status"
                        >
                          {testResult.length === 0 ? (
                            <span className="flex items-center gap-1.5">
                              <Check size={12} className="shrink-0" aria-hidden="true" /> Validação:
                              nenhum problema encontrado. O comando NÃO foi executado.
                            </span>
                          ) : (
                            <div className="space-y-1">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-warn">
                                Resultado da validação (o comando NÃO foi executado)
                              </p>
                              {testResult.map((issue, i) => (
                                <p
                                  key={i}
                                  className={`flex items-start gap-1.5 ${
                                    issue.level === 'error' ? 'text-danger' : 'text-warn'
                                  }`}
                                >
                                  {issue.level === 'error' ? (
                                    <AlertCircle
                                      size={12}
                                      className="mt-0.5 shrink-0"
                                      aria-hidden="true"
                                    />
                                  ) : (
                                    <AlertTriangle
                                      size={12}
                                      className="mt-0.5 shrink-0"
                                      aria-hidden="true"
                                    />
                                  )}
                                  <span>{issue.message}</span>
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="label-panel" htmlFor={`app-cwd-${index}`}>
                      <FolderOpen size={12} aria-hidden="true" /> Diretório de trabalho
                    </label>
                    <div className="relative">
                      <Input
                        id={`app-cwd-${index}`}
                        type="text"
                        value={app.cwd}
                        onChange={(e) => handleChange(index, 'cwd', e.target.value)}
                        onClick={() => handlePickPath(index, 'cwd', 'directory')}
                        className="cursor-pointer pr-11 font-mono"
                        placeholder="ex: %USERPROFILE%\\Documents\\My Games\\kloud-games"
                        title="Clique para selecionar a pasta de instalação no explorador de arquivos"
                      />
                      <IconButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handlePickPath(index, 'cwd', 'directory')}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-tertiary"
                        title="Selecionar pasta…"
                        aria-label="Selecionar pasta"
                      >
                        <FolderSearch size={18} aria-hidden="true" />
                      </IconButton>
                    </div>
                    <p className="mt-1.5 text-[10px] text-ink-tertiary">
                      Clique no campo para escolher a pasta no explorador de arquivos.
                    </p>
                  </div>
                </div>

                {/* Modo de execução do comando */}
                <label className="mt-4 flex items-start gap-2.5 cursor-pointer select-none w-fit">
                  <input
                    type="checkbox"
                    checked={app.useShell !== false}
                    onChange={(e) => {
                      const useShell = e.target.checked
                      setEditedApps((prev) => {
                        const next = [...prev]
                        next[index] = { ...next[index], useShell }
                        return next
                      })
                      clearTestResult(app.id)
                      setSaved(false)
                    }}
                    className="mt-0.5 h-4 w-4 accent-accent"
                  />
                  <span className="text-xs leading-relaxed text-ink-secondary">
                    <span className="font-semibold text-ink-primary">
                      Executar via shell (cmd.exe)
                    </span>{' '}
                    — preserva aspas e argumentos, mas interpreta metacaracteres (&amp;, |, %VAR%).
                    Desative apenas para comandos simples sem argumentos complexos: ele é executado
                    sem interpretação de shell.
                  </span>
                </label>

                {/* Reinício automático (06-6.4): opt-in por app. Persiste junto de
                    onSave(apps) — nenhum IPC novo de preferência. */}
                <div className="mt-4 flex items-center justify-between gap-4 flex-wrap">
                  <span className="text-xs leading-relaxed text-ink-secondary">
                    <span className="font-semibold text-ink-primary">
                      Reiniciar automaticamente se cair (máx. 3 tentativas a cada 10 min)
                    </span>
                  </span>
                  <Switch
                    aria-label="Reiniciar automaticamente se cair (máx. 3 tentativas a cada 10 min)"
                    checked={app.autoRestart === true}
                    onCheckedChange={() => {
                      setEditedApps((prev) => {
                        const next = [...prev]
                        next[index] = {
                          ...next[index],
                          autoRestart: !(next[index].autoRestart === true)
                        }
                        return next
                      })
                      setSaved(false)
                    }}
                    className="shrink-0"
                  />
                </div>

                {/* Log persistente (05-5.7): opt-in por app. Persiste junto de
                    onSave(apps) — nenhum IPC novo de preferência. */}
                <div className="mt-4 flex items-center justify-between gap-4 flex-wrap">
                  <span className="text-xs leading-relaxed text-ink-secondary">
                    <span className="font-semibold text-ink-primary">
                      Gravar logs em arquivo para este app
                    </span>
                  </span>
                  <Switch
                    aria-label="Gravar logs em arquivo para este app"
                    checked={app.persistLogs === true}
                    onCheckedChange={() => {
                      setEditedApps((prev) => {
                        const next = [...prev]
                        next[index] = {
                          ...next[index],
                          persistLogs: !(next[index].persistLogs === true)
                        }
                        return next
                      })
                      setSaved(false)
                    }}
                    className="shrink-0"
                  />
                </div>
              </Card>
            </motion.div>
          )
        })}
      </div>

      {pickError && (
        <p className="flex items-center gap-1.5 px-2 text-xs text-danger">
          <AlertCircle size={14} aria-hidden="true" /> {pickError}
        </p>
      )}

      {/* ── Diagnóstico ─────────────────────────── */}
      <SectionTitle>Diagnóstico</SectionTitle>

      <motion.div {...entranceProps(reduced, { y: 20 })}>
        <Card className="p-6">
          <div className="flex items-center justify-between gap-6 flex-wrap">
            <div className="flex items-start gap-4 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-accent-muted text-accent">
                <ClipboardCopy size={20} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-ink-primary">Exportar diagnóstico</h3>
                <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                  Copia para a área de transferência um relatório sanitizado (versões do Hub,
                  contagens do Hub e últimas linhas dos logs) para abrir um ticket de suporte.
                  Nenhum comando, caminho ou nome de jogo é incluído.
                </p>
              </div>
            </div>

            <Button
              variant="primary"
              onClick={() => void handleExportDiagnostic()}
              disabled={exportingDiagnostic}
              className="shrink-0 disabled:cursor-wait"
            >
              {exportingDiagnostic ? (
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              ) : (
                <ClipboardCopy size={14} aria-hidden="true" />
              )}
              {exportingDiagnostic ? 'Copiando…' : 'Copiar diagnóstico'}
            </Button>
          </div>
        </Card>
      </motion.div>

      {/* ── Backup e restauração (07-7.6) ────────────── */}
      <SectionTitle>Backup e restauração</SectionTitle>

      <motion.div {...entranceProps(reduced, { y: 20 })}>
        <Card className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-accent-muted text-accent">
              <Archive size={20} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-ink-primary">Backup e restauração</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                Leve apps, biblioteca de jogos, importâncias e preferências de um PC para outro com
                um arquivo JSON. A importação substitui as configurações atuais — um backup
                automático é feito antes.
              </p>
            </div>
          </div>

          {/* Aviso permanente */}
          <div className="mt-4 flex items-start gap-2.5 rounded-control border border-warn-border bg-warn-bg px-4 py-3">
            <Info size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
            <p className="text-[11px] leading-relaxed text-warn">
              O arquivo de backup contém seus comandos e caminhos configurados. Não o compartilhe
              publicamente. Chaves de API do Mark LVI não estão incluídas (ficam fora do Hub).
            </p>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              onClick={() => void handleExportConfig()}
              disabled={exportingConfig}
              className="disabled:cursor-wait"
            >
              {exportingConfig ? (
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              ) : (
                <Download size={14} aria-hidden="true" />
              )}
              {exportingConfig ? 'Exportando…' : 'Exportar configuração'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleImportPreview()}
              disabled={importFlow !== 'idle'}
              className="disabled:cursor-wait"
            >
              {importFlow === 'previewing' ? (
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              ) : (
                <Upload size={14} aria-hidden="true" />
              )}
              {importFlow === 'previewing' ? 'Lendo arquivo…' : 'Importar configuração'}
            </Button>
          </div>

          {exportFeedback && (
            <p
              className={`mt-3 flex items-start gap-1.5 break-all text-[11px] leading-relaxed ${
                exportFeedback.kind === 'done' ? 'text-success' : 'text-danger'
              }`}
              role="status"
            >
              {exportFeedback.kind === 'done' && (
                <Check size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              )}
              <span>{exportFeedback.message}</span>
            </p>
          )}

          {/* Confirmação inline: o que será substituído (resumo vindo do main) */}
          {importSummary && (importFlow === 'confirm' || importFlow === 'applying') && (
            <div className="mt-4 space-y-3 rounded-control border border-warn-border bg-warn-bg p-4">
              <p className="text-xs leading-relaxed text-warn">
                Isto substituirá{' '}
                <strong className="text-ink-primary">
                  {importSummary.apps} {importSummary.apps === 1 ? 'app' : 'apps'} e{' '}
                  {importSummary.games} {importSummary.games === 1 ? 'jogo' : 'jogos'}
                </strong>{' '}
                pelas versões do arquivo. Um backup automático será feito antes. Continuar?
              </p>
              {importSummary.rejected.length > 0 && (
                <div className="text-[11px] leading-relaxed text-warn">
                  <p className="font-semibold">Seções recusadas (serão mantidas como estão):</p>
                  <ul className="list-disc list-inside">
                    {importSummary.rejected.map((r) => (
                      <li key={r.section}>
                        {r.section}: {r.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="danger"
                  onClick={() => void handleImportApply()}
                  disabled={importFlow === 'applying'}
                  className="disabled:cursor-wait"
                >
                  {importFlow === 'applying' ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Upload size={14} aria-hidden="true" />
                  )}
                  {importFlow === 'applying' ? 'Importando…' : 'Importar'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleImportCancel}
                  disabled={importFlow === 'applying'}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {importFeedback && (
            <p
              className={`mt-3 flex items-start gap-1.5 break-all text-[11px] leading-relaxed ${
                importFeedback.kind === 'done'
                  ? 'text-success'
                  : importFeedback.kind === 'partial'
                    ? 'text-warn'
                    : 'text-danger'
              }`}
              role="status"
            >
              {importFeedback.kind === 'done' && (
                <Check size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              )}
              <span>{importFeedback.message}</span>
            </p>
          )}
        </Card>
      </motion.div>

      {/* ── Zona de perigo: desinstalação ──────────────── */}
      <UninstallDangerZone onToast={onToast} />

      {/* ── Nota informativa ─────────────────────────── */}
      <motion.div {...entranceProps(reduced, {}, { delay: 0.3 })}>
        <Card className="flex items-start gap-4 p-6">
          <Info size={24} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <p className="text-xs leading-relaxed text-ink-secondary">
              Clique no campo de um caminho para abrir o explorador de arquivos e selecionar o
              executável ou a pasta correta — ou edite o texto manualmente. Caminhos relativos (como{' '}
              <code className="rounded-sm border border-[var(--border-subtle)] bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-primary">
                ../Mark-LVI
              </code>
              ) são resolvidos a partir da instalação do Kolnd Hub. Use caminhos absolutos se os
              programas estiverem em locais diferentes.
            </p>
          </div>
        </Card>
      </motion.div>
    </div>
  )
}
