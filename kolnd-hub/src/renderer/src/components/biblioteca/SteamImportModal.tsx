import { memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useReducedMotion, entranceProps, exitProps } from '../../lib/motion'
import { Download, Loader2, AlertTriangle } from 'lucide-react'
import type { SteamImportResult } from '../../types'
import { useFocusTrap } from '../../lib/useFocusTrap'

/** Estado do fluxo "Importar jogos da Steam" (menu Adicionar Games → modal). */
export type SteamImportState =
  { phase: 'idle' } | { phase: 'importing' } | { phase: 'done'; result: SteamImportResult }

export interface SteamImportModalProps {
  state: SteamImportState
  onClose: () => void
}

/** Modal "Importar jogos da Steam" — apresentação pura; o fluxo vive no pai. */
export const SteamImportModal = memo(function SteamImportModal({
  state,
  onClose
}: SteamImportModalProps): JSX.Element {
  // Entrada/saída do modal viram fade curto com reduce.
  const reduced = useReducedMotion()
  // Prende o foco no modal. Esc aciona onClose — o pai (Biblioteca) ignora o
  // fechamento durante a importação, então o comportamento do backdrop se repete.
  const trapRef = useFocusTrap({ onEscape: onClose })

  return (
    <AnimatePresence>
      {state.phase !== 'idle' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop — não fecha durante a importação (o IPC não pode ser cancelado) */}
          <button
            type="button"
            aria-label="Fechar"
            className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            ref={trapRef}
            role="dialog"
            aria-modal="true"
            aria-label="Importar jogos da Steam"
            {...entranceProps(reduced, { y: 12, scale: 0.95 }, { duration: 0.18 })}
            exit={exitProps(reduced, { y: 8, scale: 0.97 })}
            className="relative glass-card border border-white/[0.08] shadow-2xl w-full max-w-md p-6"
          >
            {state.phase === 'importing' ? (
              <div className="flex flex-col items-center text-center gap-4 py-4">
                <Loader2 size={32} className="animate-spin text-steam-blue" />
                <div>
                  <h3 className="text-base font-bold text-slate-100">Importando jogos da Steam…</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Detectando os jogos instalados. Isso pode levar alguns segundos.
                  </p>
                </div>
              </div>
            ) : !state.result.ok ? (
              <div className="flex flex-col items-center text-center gap-3 py-2">
                <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                  <AlertTriangle size={24} className="text-red-400" />
                </div>
                <h3 className="text-base font-bold text-slate-100">Não foi possível importar</h3>
                <p className="text-sm text-slate-400">
                  {state.result.error ?? 'Ocorreu um erro inesperado.'}
                </p>
                <button type="button" onClick={onClose} className="btn-primary mt-2">
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
                    <p className="text-[11px] text-slate-400">
                      Jogos detectados na sua instalação da Steam
                    </p>
                  </div>
                </div>

                <ul className="space-y-2 text-sm text-slate-300">
                  <li className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] pb-2">
                    <span>Jogos importados</span>
                    <span className="text-lg font-bold text-neon-cyan">
                      {state.result.imported}
                    </span>
                  </li>
                  <li className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] pb-2">
                    <span>Já estavam na biblioteca</span>
                    <span className="text-lg font-bold text-slate-200">
                      {state.result.alreadyInLibrary}
                    </span>
                  </li>
                  <li className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] pb-2">
                    <span>Itens ignorados (ferramentas)</span>
                    <span className="text-lg font-bold text-slate-200">
                      {state.result.ignoredTools}
                    </span>
                  </li>
                  {state.result.noExe > 0 && (
                    <li className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] pb-2">
                      <span>Sem executável localizado</span>
                      <span className="text-lg font-bold text-amber-400">{state.result.noExe}</span>
                    </li>
                  )}
                  {state.result.errors.length > 0 && (
                    <li className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] pb-2">
                      <span>Com erro</span>
                      <span className="text-lg font-bold text-red-400">
                        {state.result.errors.length}
                      </span>
                    </li>
                  )}
                </ul>

                {state.result.errors.length > 0 && (
                  <div className="max-h-28 overflow-y-auto rounded-lg border border-red-500/15 bg-red-500/5 px-3 py-2 space-y-1">
                    {state.result.errors.slice(0, 5).map((message, index) => (
                      <p key={index} className="text-[11px] leading-snug text-red-300/90">
                        {message}
                      </p>
                    ))}
                    {state.result.errors.length > 5 && (
                      <p className="text-[11px] text-red-300/60">
                        +{state.result.errors.length - 5} erro(s) — veja o log do app
                      </p>
                    )}
                  </div>
                )}

                <button type="button" onClick={onClose} className="btn-primary">
                  Fechar
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
})
