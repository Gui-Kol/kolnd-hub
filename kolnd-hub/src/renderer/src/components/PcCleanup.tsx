import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { entranceProps, exitProps, fadeOnlyTransition, useReducedMotion } from '../lib/motion'
import { AlertTriangle, FolderOpen, Loader2, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react'
import { CleanResult } from '../types'

const TEMP_FOLDER_LABELS = ['%TEMP%', '%LOCALAPPDATA%\\Temp', 'C:\\Windows\\Temp']

/** Formata bytes em KB/MB/GB para o usuário final. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const gb = 1024 ** 3
  const mb = 1024 ** 2
  const kb = 1024
  if (bytes >= gb) return `${(bytes / gb).toFixed(2)} GB`
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / kb))} KB`
}

export function PcCleanup(): JSX.Element {
  // Entradas decorativas (cards, modal de confirmação) viram fade curto com reduce.
  const reduced = useReducedMotion()
  const [showConfirm, setShowConfirm] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [result, setResult] = useState<CleanResult | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const runCleanup = async (): Promise<void> => {
    if (cleaning) return
    setShowConfirm(false)
    setCleaning(true)
    setResult(null)
    try {
      const res = await window.api.cleanTempFiles()
      if (mountedRef.current) setResult(res)
    } catch {
      // Nunca exibir detalhes técnicos crus — mensagem amigável.
      if (mountedRef.current) {
        setResult({
          ok: false,
          filesRemoved: 0,
          bytesFreed: 0,
          skippedLocked: 0,
          errors: 1,
          error: 'Não foi possível concluir a limpeza. Tente novamente em alguns instantes.'
        })
      }
    } finally {
      if (mountedRef.current) setCleaning(false)
    }
  }

  const closeConfirm = (): void => {
    if (cleaning) return
    setShowConfirm(false)
  }

  return (
    <div className="space-y-4">
      {/* ── Cartão principal ─────────────────────────────── */}
      <motion.div
        {...entranceProps(reduced, { y: 10 })}
        className="glass rounded-2xl p-6 md:p-8 text-center space-y-5"
      >
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-kloud-500/20 to-nintendo-500/10 border border-kloud-500/20 flex items-center justify-center mx-auto">
          <Trash2 size={28} className="text-kloud-500" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-lg font-bold text-white">Limpeza de arquivos temporários</h3>
          <p className="text-[12px] text-slate-400 max-w-md mx-auto leading-relaxed">
            Remove com segurança arquivos temporários antigos (mais de 24 h). Arquivos em uso são
            ignorados e nada fora das pastas temporárias é alterado.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 text-[10px] text-slate-400">
          <FolderOpen size={12} className="shrink-0" />
          {TEMP_FOLDER_LABELS.map((label) => (
            <code
              key={label}
              className="px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.06] font-mono"
            >
              {label}
            </code>
          ))}
        </div>

        <div>
          <button onClick={() => setShowConfirm(true)} disabled={cleaning} className="btn-primary">
            {cleaning ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Limpando… isso pode levar alguns segundos
              </>
            ) : (
              <>
                <Sparkles size={14} />
                Limpar Arquivos Temporários
              </>
            )}
          </button>
        </div>
      </motion.div>

      {/* ── Resultado ────────────────────────────────────── */}
      {result &&
        (result.ok ? (
          <motion.div
            {...entranceProps(reduced, { y: 10 })}
            role="status"
            className="glass rounded-2xl p-5 border-emerald-500/25 bg-emerald-500/5 space-y-3"
          >
            <p className="text-[13px] font-bold text-emerald-300 leading-relaxed">
              {`✅ ${result.filesRemoved} arquivo${result.filesRemoved === 1 ? '' : 's'} removido${result.filesRemoved === 1 ? '' : 's'} · ${formatBytes(result.bytesFreed)} liberados · ${result.skippedLocked} ignorado${result.skippedLocked === 1 ? '' : 's'} (em uso/sem permissão)${result.errors > 0 ? ` · ${result.errors} com erro` : ''}`}
            </p>
            {result.filesRemoved === 0 && result.skippedLocked > 0 && (
              <p className="text-[11px] text-emerald-300/80">
                Nada pôde ser removido agora — os arquivos estão abertos ou sem permissão. Tente
                novamente mais tarde, de preferência com os programas fechados.
              </p>
            )}
            {result.paths && result.paths.length > 0 && (
              <p className="text-[10px] text-slate-400 font-mono leading-relaxed">
                Pastas varridas: {result.paths.join(' · ')}
              </p>
            )}
          </motion.div>
        ) : (
          <motion.div
            {...entranceProps(reduced, { y: 10 })}
            role="alert"
            className="glass rounded-2xl p-5 border-red-500/25 bg-red-500/5 flex items-start gap-3"
          >
            <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-[13px] font-bold text-red-300">
                Não foi possível concluir a limpeza
              </p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {result.error ??
                  'Os arquivos em uso foram mantidos e nada fora das pastas temporárias foi alterado. Tente novamente em alguns instantes.'}
              </p>
            </div>
          </motion.div>
        ))}

      {/* ── Modal de confirmação ─────────────────────────── */}
      <AnimatePresence>
        {showConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduced ? fadeOnlyTransition : undefined}
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
            onClick={closeConfirm}
          >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/70 backdrop-blur-xl" />

            <motion.div
              {...entranceProps(
                reduced,
                { y: 16, scale: 0.95 },
                { type: 'spring', damping: 25, stiffness: 400 }
              )}
              exit={exitProps(reduced, { y: 16, scale: 0.95 })}
              className="relative w-full max-w-md glass rounded-2xl border border-white/[0.08] shadow-2xl shadow-black/60 p-6 space-y-5"
              role="dialog"
              aria-modal="true"
              aria-labelledby="cleanup-confirm-title"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={closeConfirm}
                className="absolute top-4 right-4 p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                aria-label="Fechar"
              >
                <X size={16} />
              </button>

              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
                  <ShieldCheck size={20} className="text-amber-400" />
                </div>
                <h3 id="cleanup-confirm-title" className="text-base font-bold text-white">
                  Limpar arquivos temporários?
                </h3>
              </div>

              <div className="text-[12px] text-slate-300 leading-relaxed space-y-2">
                <p>A limpeza vai:</p>
                <ul className="list-disc pl-5 space-y-1 text-slate-400">
                  <li>
                    Remover apenas arquivos com <span className="text-white">mais de 24 h</span> das
                    pastas temporárias do Windows e do seu usuário;
                  </li>
                  <li>
                    <span className="text-white">Ignorar arquivos em uso</span> (abertos por
                    programas) e sem permissão, sem travamento nem erro;
                  </li>
                  <li>
                    <span className="text-white">Nunca tocar</span> em downloads, registro, Prefetch
                    ou pastas de programas.
                  </li>
                </ul>
                <p className="text-slate-400 text-[11px]">
                  Pastas: %TEMP% · %LOCALAPPDATA%\Temp · C:\Windows\Temp
                </p>
              </div>

              <div className="flex items-center gap-2 justify-end">
                <button onClick={closeConfirm} className="btn-secondary">
                  Cancelar
                </button>
                <button onClick={() => void runCleanup()} className="btn-primary">
                  <Trash2 size={14} />
                  Limpar agora
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
