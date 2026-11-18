import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { entranceProps, useReducedMotion } from '../lib/motion'
import { AlertTriangle, FolderOpen, Loader2, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { CleanResult } from '../types'
import { Button, Card, Modal } from './ui'

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
  // Entradas decorativas (cards, resultado) viram fade curto com reduce.
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
      <Card className="space-y-5 p-6 text-center md:p-8">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card border border-accent-border bg-accent-muted">
          <Trash2 size={32} className="text-accent" aria-hidden="true" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-lg font-semibold tracking-tight text-ink-primary">
            Limpeza de arquivos temporários
          </h3>
          <p className="mx-auto max-w-md text-[12px] leading-relaxed text-ink-secondary">
            Remove com segurança arquivos temporários antigos (mais de 24 h). Arquivos em uso são
            ignorados e nada fora das pastas temporárias é alterado.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 text-[10px] text-ink-secondary">
          <FolderOpen size={12} className="shrink-0" aria-hidden="true" />
          {TEMP_FOLDER_LABELS.map((label) => (
            <code
              key={label}
              className="rounded-sm border border-[var(--border-subtle)] bg-surface-2 px-2 py-1 font-mono"
            >
              {label}
            </code>
          ))}
        </div>

        <div>
          <Button
            variant="primary"
            size="md"
            onClick={() => setShowConfirm(true)}
            disabled={cleaning}
          >
            {cleaning ? (
              <>
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                Limpando… isso pode levar alguns segundos
              </>
            ) : (
              <>
                <Sparkles size={14} aria-hidden="true" />
                Limpar Arquivos Temporários
              </>
            )}
          </Button>
        </div>
      </Card>

      {/* ── Resultado ────────────────────────────────────── */}
      {result &&
        (result.ok ? (
          <motion.div
            {...entranceProps(reduced, { y: 10 })}
            role="status"
            className="space-y-3 rounded-card border border-success-border bg-success-bg p-5"
          >
            <p className="text-[13px] font-semibold leading-relaxed text-success">
              {`✅ ${result.filesRemoved} arquivo${result.filesRemoved === 1 ? '' : 's'} removido${result.filesRemoved === 1 ? '' : 's'} · ${formatBytes(result.bytesFreed)} liberados · ${result.skippedLocked} ignorado${result.skippedLocked === 1 ? '' : 's'} (em uso/sem permissão)${result.errors > 0 ? ` · ${result.errors} com erro` : ''}`}
            </p>
            {result.filesRemoved === 0 && result.skippedLocked > 0 && (
              <p className="text-[11px] text-success/80">
                Nada pôde ser removido agora — os arquivos estão abertos ou sem permissão. Tente
                novamente mais tarde, de preferência com os programas fechados.
              </p>
            )}
            {result.paths && result.paths.length > 0 && (
              <p className="font-mono text-[10px] leading-relaxed text-ink-tertiary">
                Pastas varridas: {result.paths.join(' · ')}
              </p>
            )}
          </motion.div>
        ) : (
          <motion.div
            {...entranceProps(reduced, { y: 10 })}
            role="alert"
            className="flex items-start gap-3 rounded-card border border-danger-border bg-danger-bg p-5"
          >
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-[13px] font-semibold text-danger">
                Não foi possível concluir a limpeza
              </p>
              <p className="text-[11px] leading-relaxed text-ink-secondary">
                {result.error ??
                  'Os arquivos em uso foram mantidos e nada fora das pastas temporárias foi alterado. Tente novamente em alguns instantes.'}
              </p>
            </div>
          </motion.div>
        ))}

      {/* ── Modal de confirmação ─────────────────────────── */}
      {showConfirm && (
        <Modal
          title="Limpar arquivos temporários?"
          onClose={closeConfirm}
          disableClose={cleaning}
          closeLabel="Fechar"
          footer={
            <>
              <Button variant="secondary" size="md" onClick={closeConfirm} disabled={cleaning}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => void runCleanup()}
                disabled={cleaning}
              >
                <Trash2 size={14} aria-hidden="true" />
                Limpar agora
              </Button>
            </>
          }
        >
          <div className="space-y-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-control border border-warn-border bg-warn-bg">
              <ShieldCheck size={20} className="text-warn" aria-hidden="true" />
            </div>

            <div className="space-y-2 text-[12px] leading-relaxed">
              <p className="text-ink-primary">A limpeza vai:</p>
              <ul className="list-disc space-y-1 pl-5 text-ink-secondary">
                <li>
                  Remover apenas arquivos com <span className="text-ink-primary">mais de 24 h</span>{' '}
                  das pastas temporárias do Windows e do seu usuário;
                </li>
                <li>
                  <span className="text-ink-primary">Ignorar arquivos em uso</span> (abertos por
                  programas) e sem permissão, sem travamento nem erro;
                </li>
                <li>
                  <span className="text-ink-primary">Nunca tocar</span> em downloads, registro,
                  Prefetch ou pastas de programas.
                </li>
              </ul>
              <p className="text-[11px] text-ink-tertiary">
                Pastas: %TEMP% · %LOCALAPPDATA%\Temp · C:\Windows\Temp
              </p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
