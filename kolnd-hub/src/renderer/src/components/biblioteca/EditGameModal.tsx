import { memo, useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useFocusTrap } from '../../lib/useFocusTrap'
import {
  Gamepad2,
  Pencil,
  Loader2,
  AlertTriangle,
  ImagePlus,
  RotateCcw,
  Trash2
} from 'lucide-react'
import type { Game } from '../../types'
interface EditGameModalProps {
  game: Game
  /** dataURL do ícone atual (cacheado na grade) ou null para o fallback visual. */
  currentIcon: string | null
  /** Selo inicial de executável ausente (verificado na grade). */
  exeMissing: boolean
  showToast: (text: string) => void
  onClose: () => void
  onSaved: (id: string) => void
  onRemoved: (id: string) => void
}

/**
 * Modal "Editar Game" (T9).
 * Decisão de implementação: as trocas de ícone/exe são apenas PRÉ-VISUALIZADAS
 * aqui; nada é persistido até o "Salvar". O Salvar grava via `games:update`
 * (patch por id) e, quando há troca de ícone, encadeia `games:set-icon` /
 * `games:restore-exe-icon` antes dele — esses IPCs gravam o arquivo em
 * game-icons/ e devolvem o caminho; quem persiste no store é o `games:update`.
 * Fechar sem salvar descarta todas as alterações (nenhum arquivo é gravado
 * antes do Salvar). O cwd do lançamento acompanha o novo executável
 * automaticamente (launchGame usa a pasta do exe), nada extra a fazer aqui.
 */
export const EditGameModal = memo(function EditGameModal({
  game,
  currentIcon,
  exeMissing,
  showToast,
  onClose,
  onSaved,
  onRemoved
}: EditGameModalProps): JSX.Element {
  const [name, setName] = useState(game.name)
  const [exePath, setExePath] = useState(game.exePath)
  const [localExeMissing, setLocalExeMissing] = useState(exeMissing)
  // Troca de ícone pendente de persistência (pré-visualizada, nunca gravada antes do Salvar).
  const [iconSource, setIconSource] = useState<'none' | 'custom' | 'exe'>('none')
  const [customDataUrl, setCustomDataUrl] = useState<string | null>(null)
  const [exePreviewDataUrl, setExePreviewDataUrl] = useState<string | null>(null)
  const [iconBusy, setIconBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [removing, setRemoving] = useState(false)

  const busy = saving || removing
  const trimmedName = name.trim()
  const canSave = trimmedName.length > 0 && !busy
  const previewIcon =
    iconSource === 'custom' ? customDataUrl : iconSource === 'exe' ? exePreviewDataUrl : currentIcon

  const requestClose = useCallback((): void => {
    // Não fecha durante uma operação em andamento.
    if (busy) return
    onClose()
  }, [busy, onClose])

  // Esc fecha o modal (descarta as alterações), salvo durante salvar/remover.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return (): void => window.removeEventListener('keydown', onKeyDown)
  }, [requestClose])

  // Prende o foco no modal; o 1º focável (campo Nome) recebe o foco ao abrir.
  const trapRef = useFocusTrap({ active: true })

  const handlePickImage = useCallback(async (): Promise<void> => {
    if (iconBusy || busy) return
    setIconBusy(true)
    try {
      const picked = await window.api.pickGameIcon()
      if (!picked.success) {
        // Cancelado: nada acontece. Erro (ex.: .ico): aviso amigável.
        if (!picked.canceled && picked.error) showToast(picked.error)
        return
      }
      setCustomDataUrl(picked.dataUrl ?? null)
      setIconSource('custom')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível escolher a imagem.')
    } finally {
      setIconBusy(false)
    }
  }, [iconBusy, busy, showToast])

  const handleRestoreExeIcon = useCallback(async (): Promise<void> => {
    if (iconBusy || busy) return
    const target = exePath.trim()
    if (!target) return
    setIconBusy(true)
    try {
      // Só pré-visualiza: a extração/gravação de verdade acontece no "Salvar".
      const preview = await window.api.previewGameIcon(target)
      if (!preview.success || !preview.dataUrl) {
        showToast(preview.error ?? 'O executável não tem um ícone utilizável.')
        return
      }
      setExePreviewDataUrl(preview.dataUrl)
      setIconSource('exe')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'O executável não tem um ícone utilizável.')
    } finally {
      setIconBusy(false)
    }
  }, [iconBusy, busy, exePath, showToast])

  const handlePickExe = useCallback(async (): Promise<void> => {
    if (busy) return
    try {
      const picked = await window.api.pickAppPath(
        'file',
        exePath.trim() || undefined,
        'Selecione o executável do jogo'
      )
      if (!picked.success) {
        if (!picked.canceled && picked.error) {
          showToast(`Não foi possível escolher o arquivo: ${picked.error}`)
        }
        return
      }
      if (!picked.path) return
      setExePath(picked.path)
      // Reavalia o selo de ".exe não encontrado" para o caminho recém-escolhido.
      const flags = await window.api.checkGameExes([picked.path]).catch(() => [true])
      setLocalExeMissing(flags[0] === false)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível escolher o arquivo.')
    }
  }, [busy, exePath, showToast])

  const handleSave = useCallback(async (): Promise<void> => {
    if (!canSave) return
    setSaving(true)
    try {
      // 1) Troca de ícone (se houver): grava o arquivo em game-icons/ e devolve o caminho.
      let iconPath: string | undefined
      if (iconSource === 'custom' && customDataUrl) {
        const written = await window.api.setGameIcon(game.id, customDataUrl)
        if (!written.success || !written.iconPath) {
          showToast(written.error ?? 'Não foi possível salvar a imagem.')
          setSaving(false)
          return
        }
        iconPath = written.iconPath
      } else if (iconSource === 'exe') {
        const restored = await window.api.restoreGameIcon(game.id, exePath.trim())
        if (!restored.success || !restored.iconPath) {
          showToast(restored.error ?? 'Não foi possível extrair o ícone do executável.')
          setSaving(false)
          return
        }
        iconPath = restored.iconPath
      }

      // 2) Persiste nome/executável/ícone numa única escrita do store.
      const updated = await window.api.updateGame(game.id, {
        name: trimmedName,
        exePath: exePath.trim(),
        ...(iconPath !== undefined ? { iconPath } : {})
      })
      if (!updated.success) {
        showToast(updated.error ?? 'Não foi possível salvar as alterações.')
        setSaving(false)
        return
      }
      showToast('Alterações salvas')
      onSaved(game.id)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível salvar as alterações.')
      setSaving(false)
    }
  }, [canSave, iconSource, customDataUrl, exePath, game.id, trimmedName, showToast, onSaved])

  const handleRemove = useCallback(async (): Promise<void> => {
    if (!confirmingRemove) {
      setConfirmingRemove(true)
      return
    }
    if (removing) return
    setRemoving(true)
    try {
      const removed = await window.api.removeGame(game.id)
      if (!removed.success) {
        showToast(removed.error ?? 'Não foi possível remover o jogo.')
        setRemoving(false)
        setConfirmingRemove(false)
        return
      }
      showToast(`Jogo removido: ${game.name}`)
      onRemoved(game.id)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível remover o jogo.')
      setRemoving(false)
      setConfirmingRemove(false)
    }
  }, [confirmingRemove, removing, game.id, game.name, showToast, onRemoved])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop — fecha descartando as alterações */}
      <button
        type="button"
        aria-label="Fechar"
        disabled={busy}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm disabled:cursor-default"
        onClick={requestClose}
      />
      <motion.div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Editar Game"
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.18 }}
        className="relative glass-card border border-white/[0.08] shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-6"
      >
        {/* ── Cabeçalho ─────────────────────────────── */}
        <div className="flex items-center gap-3 pb-4 border-b border-white/[0.06]">
          <div className="w-11 h-11 rounded-xl bg-playstation-500/10 border border-playstation-500/30 flex items-center justify-center shrink-0">
            <Pencil size={18} className="text-playstation-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-100">Editar Game</h3>
            <p className="text-[11px] text-slate-400 truncate">{game.name}</p>
          </div>
        </div>

        <div className="space-y-5 pt-5">
          {/* ── Nome do jogo ─────────────────────────── */}
          <div>
            <label htmlFor="edit-game-name" className="label-panel">
              Nome do jogo
            </label>
            <input
              id="edit-game-name"
              type="text"
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nome do jogo"
              className="input-gamer"
            />
            {trimmedName.length === 0 && (
              <p className="text-[11px] text-amber-400 mt-1.5">O nome não pode ficar vazio.</p>
            )}
          </div>

          {/* ── Executável ───────────────────────────── */}
          <div>
            <span className="label-panel">Executável</span>
            <p className="rounded-lg border border-white/[0.06] bg-black/30 px-3 py-2 text-[11px] font-mono text-slate-400 break-all">
              {exePath}
            </p>
            {localExeMissing && (
              <p className="flex items-center gap-1.5 text-[11px] text-amber-400 mt-1.5">
                <AlertTriangle size={11} />
                Executável não encontrado no disco. Escolha o caminho correto ou remova o jogo.
              </p>
            )}
            <div className="flex items-center gap-3 mt-2">
              <button
                type="button"
                onClick={() => void handlePickExe()}
                disabled={busy}
                className="btn-secondary !px-4 !py-2 !text-[10px]"
              >
                Alterar…
              </button>
              <span className="text-[10px] text-slate-400 leading-snug">
                O jogo inicia a partir da pasta do executável.
              </span>
            </div>
          </div>

          {/* ── Ícone/capa ───────────────────────────── */}
          <div>
            <span className="label-panel">Ícone / capa</span>
            <div className="flex items-start gap-4">
              <div className="w-20 h-20 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center overflow-hidden shrink-0">
                {previewIcon ? (
                  <img
                    src={previewIcon}
                    alt={`Ícone de ${trimmedName || game.name}`}
                    className="w-full h-full object-contain"
                    draggable={false}
                  />
                ) : (
                  <Gamepad2 size={32} className="text-slate-400" />
                )}
              </div>
              <div className="flex flex-col items-start gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => void handlePickImage()}
                  disabled={busy || iconBusy}
                  className="btn-secondary !px-4 !py-2 !text-[10px]"
                >
                  {iconBusy ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <ImagePlus size={13} />
                  )}
                  Escolher imagem…
                </button>
                <button
                  type="button"
                  onClick={() => void handleRestoreExeIcon()}
                  disabled={busy || iconBusy}
                  className="btn-ghost !px-3 !py-1.5 text-[11px]"
                >
                  <RotateCcw size={12} />
                  Restaurar ícone do executável
                </button>
                <p className="text-[10px] text-slate-400 leading-snug">
                  Formatos aceitos: PNG, JPG e WebP. .ico não é suportado.
                </p>
              </div>
            </div>
          </div>

          {/* ── Remover jogo (confirmação em duas etapas) ── */}
          <div className="border-t border-white/[0.06] pt-4">
            {confirmingRemove ? (
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-3">
                <p className="flex items-center gap-2 text-sm font-bold text-red-300">
                  <AlertTriangle size={15} />
                  Tem certeza?
                </p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  <span className="font-semibold text-slate-200">{game.name}</span> sairá da sua
                  biblioteca. O arquivo do jogo não será apagado do computador.
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingRemove(false)}
                    disabled={removing}
                    className="btn-ghost"
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRemove()}
                    disabled={removing}
                    className="btn-danger !px-4 !py-2"
                  >
                    {removing ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        Removendo…
                      </>
                    ) : (
                      <>
                        <Trash2 size={13} />
                        Remover definitivamente
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingRemove(true)}
                disabled={busy}
                className="btn-danger w-full"
              >
                <Trash2 size={14} />
                Remover jogo
              </button>
            )}
          </div>

          {/* ── Rodapé ─────────────────────────────────── */}
          <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] pt-4">
            <button type="button" onClick={requestClose} disabled={busy} className="btn-ghost">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canSave}
              className="btn-primary"
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Salvando…
                </>
              ) : (
                'Salvar alterações'
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
})
