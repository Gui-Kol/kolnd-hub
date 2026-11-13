import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Save,
  RotateCcw,
  Terminal,
  FolderOpen,
  AlertCircle,
  FileSearch,
  FolderSearch,
  Gamepad2,
  Check
} from 'lucide-react'
import { AppConfig } from '../types'
import { BigPictureSettings } from './BigPictureSettings'
import { UninstallDangerZone } from './UninstallDangerZone'

interface SettingsProps {
  apps: AppConfig[]
  onSave: (apps: AppConfig[]) => void
  onToast?: (msg: string, kind: 'success' | 'error' | 'info') => void
}

export function Settings({ apps, onSave, onToast }: SettingsProps): JSX.Element {
  const [editedApps, setEditedApps] = useState<AppConfig[]>(apps.map((a) => ({ ...a })))
  const [saved, setSaved] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)

  // Preferência "Iniciar Kloud Games junto com o Hub": lida do electron-store
  // (via IPC) na montagem; `null` enquanto carrega (toggle desabilitado).
  const [launchKloudOnStart, setLaunchKloudOnStart] = useState<boolean | null>(null)
  const [prefFeedback, setPrefFeedback] = useState<'saved' | 'error' | null>(null)
  const prefFeedbackTimer = useRef<number | null>(null)

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

  useEffect(
    () => () => {
      if (prefFeedbackTimer.current) window.clearTimeout(prefFeedbackTimer.current)
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

  const handleChange = (index: number, field: keyof AppConfig, value: string): void => {
    setEditedApps((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
    setSaved(false)
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
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight gradient-text gradient-rainbow text-shadow">
            Configurações
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Ajuste comandos e diretórios de trabalho dos seus títulos
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-white glass glass-hover transition-all"
          >
            <RotateCcw size={14} /> Resetar tudo
          </button>
          <button
            onClick={handleSave}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow ${
              saved
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-glow-cyan'
                : 'bg-gradient-to-r from-kloud-500 to-nintendo-500 text-white shadow-glow-red hover:from-kloud-600 hover:to-nintendo-600'
            }`}
          >
            <Save size={14} /> {saved ? 'Salvo!' : 'Salvar alterações'}
          </button>
        </div>
      </motion.div>

      {/* ── Ao abrir o Hub ─────────────────────────── */}
      <p className="text-xs font-bold text-slate-600 uppercase tracking-widest mx-2">
        Ao abrir o Hub
      </p>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass rounded-2xl p-6 border-l-4 border-kloud-500/40"
      >
        <div className="flex items-center justify-between gap-6 flex-wrap">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-kloud-500/10 text-kloud-500 shadow-lg">
              <Gamepad2 size={20} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white">
                Iniciar Kloud Games junto com o Kolnd Hub
              </h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                O Hub abre o Kloud Games em segundo plano sempre que for iniciado.
              </p>
              {prefFeedback === 'saved' && (
                <p className="mt-2 text-[11px] font-semibold text-emerald-400 flex items-center gap-1.5">
                  <Check size={12} /> Salvo
                </p>
              )}
              {prefFeedback === 'error' && (
                <p className="mt-2 text-[11px] font-semibold text-red-400">
                  Não foi possível salvar. Tente de novo.
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={launchKloudOnStart === true}
            aria-label="Iniciar Kloud Games junto com o Kolnd Hub"
            disabled={launchKloudOnStart === null}
            onClick={() => void handleTogglePref()}
            className={`toggle-console shrink-0 ${
              launchKloudOnStart === true ? 'toggle-console-checked' : ''
            } ${launchKloudOnStart === null ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <span className="toggle-console-knob" />
          </button>
        </div>
      </motion.div>

      {/* ── Big Picture ─────────────────────────────── */}
      <BigPictureSettings />

      <p className="text-xs font-bold text-slate-600 uppercase tracking-widest mx-2">
        Gerenciador de títulos
      </p>

      {/* ── Cards de configuração ────────────────────── */}
      <div className="space-y-4">
        {editedApps.map((app, index) => (
          <motion.div
            key={app.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.04 }}
            className="glass rounded-2xl p-6 border-l-4 border-transparent hover:border-kloud-500/50 transition-all"
          >
            {/* Cabeçalho do app */}
            <div className="flex items-center gap-3.5 mb-5">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 shadow-lg"
                style={{
                  background: `linear-gradient(135deg, ${app.color}25, ${app.color}10)`,
                  boxShadow: `0 0 20px ${app.color}40`
                }}
              >
                {app.icon}
              </div>
              <div>
                <h3 className="text-base font-bold text-white">{app.name}</h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                  {app.category.toUpperCase()}
                </p>
              </div>
            </div>

            {/* Campos editáveis */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="label-panel">
                  <Terminal size={12} /> Comando
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={app.command}
                    onChange={(e) => handleChange(index, 'command', e.target.value)}
                    onClick={() => handlePickPath(index, 'command', 'file')}
                    className="input-gamer cursor-pointer pr-11"
                    placeholder="ex: kloud-games.exe"
                    title="Clique para selecionar o executável no explorador de arquivos"
                  />
                  <button
                    type="button"
                    onClick={() => handlePickPath(index, 'command', 'file')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-500 transition-colors hover:text-kloud-500 hover:bg-white/5"
                    title="Selecionar executável…"
                    aria-label="Selecionar executável"
                  >
                    <FileSearch size={18} />
                  </button>
                </div>
                <p className="mt-1.5 text-[10px] text-slate-600">
                  Clique no campo para escolher o .exe no explorador de arquivos.
                </p>
              </div>
              <div>
                <label className="label-panel">
                  <FolderOpen size={12} /> Diretório de trabalho
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={app.cwd}
                    onChange={(e) => handleChange(index, 'cwd', e.target.value)}
                    onClick={() => handlePickPath(index, 'cwd', 'directory')}
                    className="input-gamer cursor-pointer pr-11"
                    placeholder="ex: %USERPROFILE%\\Documents\\My Games\\kloud-games"
                    title="Clique para selecionar a pasta de instalação no explorador de arquivos"
                  />
                  <button
                    type="button"
                    onClick={() => handlePickPath(index, 'cwd', 'directory')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-500 transition-colors hover:text-kloud-500 hover:bg-white/5"
                    title="Selecionar pasta…"
                    aria-label="Selecionar pasta"
                  >
                    <FolderSearch size={18} />
                  </button>
                </div>
                <p className="mt-1.5 text-[10px] text-slate-600">
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
                  setSaved(false)
                }}
                className="mt-0.5 h-4 w-4 accent-kloud-500"
              />
              <span className="text-xs text-slate-400 leading-relaxed">
                <span className="text-slate-200 font-semibold">Executar via shell (cmd.exe)</span> —
                preserva aspas e argumentos, mas interpreta metacaracteres (&amp;, |, %VAR%).
                Desative apenas para comandos simples sem argumentos complexos: ele é executado sem
                interpretação de shell.
              </span>
            </label>
          </motion.div>
        ))}
      </div>

      {pickError && (
        <p className="text-xs text-red-400 flex items-center gap-1.5 px-2">
          <AlertCircle size={13} /> {pickError}
        </p>
      )}

      {/* ── Zona de perigo: desinstalação ──────────────── */}
      <UninstallDangerZone onToast={onToast} />

      {/* ── Nota informativa ─────────────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="glass rounded-2xl p-6 flex items-start gap-4 border-l-4 border-kloud-500/50"
      >
        <AlertCircle size={22} className="text-kloud-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Clique no campo de um caminho para abrir o explorador de arquivos e selecionar o
            executável ou a pasta correta — ou edite o texto manualmente. Caminhos relativos (como
            <code className="text-slate-300 bg-white/5 px-2 py-0.5 rounded font-mono text-[11px]">
              ../Mark-LVI
            </code>
            ) são resolvidos a partir da instalação do Kolnd Hub. Use caminhos absolutos se os
            programas estiverem em locais diferentes.
          </p>
        </div>
      </motion.div>
    </div>
  )
}
