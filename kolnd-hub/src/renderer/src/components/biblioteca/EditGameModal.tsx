import { memo, useCallback, useState } from 'react'
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
import { Button, Input, Modal } from '../ui'
interface EditGameModalProps {
  game: Game
  /** dataURL do ícone atual (cacheada na grade) ou null para o fallback visual. */
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

  // Esc fecha o modal (descarta as alterações), salvo durante salvar/remover — o
  // Modal repassa onEscape ao trap só quando !disableClose (busy bloqueia Esc/backdrop/X).
  // O trap do Modal também devolve o foco ao card que abriu o modal ao desmontar.

  return (
    <Modal
      ariaLabel="Editar Game"
      onClose={requestClose}
      disableClose={busy}
      footer={
        <>
          <Button variant="ghost" onClick={requestClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={!canSave}>
            {saving ? (
              <>
                <Loader2 size={14} aria-hidden="true" className="animate-spin" />
                Salvando…
              </>
            ) : (
              'Salvar alterações'
            )}
          </Button>
        </>
      }
    >
      {/* ── Cabeçalho ─────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] pb-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-accent-border bg-accent-muted">
          <Pencil size={18} aria-hidden="true" className="text-accent" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-ink-primary">Editar Game</h3>
          <p className="truncate text-[11px] text-ink-secondary">{game.name}</p>
        </div>
      </div>

      <div className="space-y-5 pt-5">
        {/* ── Nome do jogo ─────────────────────────── */}
        <div>
          <label
            htmlFor="edit-game-name"
            className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-tertiary"
          >
            Nome do jogo
          </label>
          <Input
            id="edit-game-name"
            type="text"
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nome do jogo"
            error={trimmedName.length === 0}
            errorMessage={trimmedName.length === 0 ? 'O nome não pode ficar vazio.' : undefined}
            data-autofocus
          />
        </div>

        {/* ── Executável ───────────────────────────── */}
        <div>
          <span className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-tertiary">
            Executável
          </span>
          <p className="break-all rounded-control border border-[var(--border-subtle)] bg-surface-sunken px-3 py-2 font-mono text-[11px] text-ink-secondary">
            {exePath}
          </p>
          {localExeMissing && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-warn">
              <AlertTriangle size={12} aria-hidden="true" />
              Executável não encontrado no disco. Escolha o caminho correto ou remova o jogo.
            </p>
          )}
          <div className="mt-2 flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handlePickExe()}
              disabled={busy}
            >
              Alterar…
            </Button>
            <span className="text-[10px] leading-snug text-ink-tertiary">
              O jogo inicia a partir da pasta do executável.
            </span>
          </div>
        </div>

        {/* ── Ícone/capa ───────────────────────────── */}
        <div>
          <span className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-tertiary">
            Ícone / capa
          </span>
          <div className="flex items-start gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-card border border-[var(--border-subtle)] bg-surface-2">
              {previewIcon ? (
                <img
                  src={previewIcon}
                  alt={`Ícone de ${trimmedName || game.name}`}
                  className="h-full w-full object-contain"
                  draggable={false}
                />
              ) : (
                <Gamepad2 size={32} aria-hidden="true" className="text-ink-tertiary" />
              )}
            </div>
            <div className="flex min-w-0 flex-col items-start gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handlePickImage()}
                disabled={busy || iconBusy}
              >
                {iconBusy ? (
                  <Loader2 size={14} aria-hidden="true" className="animate-spin" />
                ) : (
                  <ImagePlus size={14} aria-hidden="true" />
                )}
                Escolher imagem…
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleRestoreExeIcon()}
                disabled={busy || iconBusy}
              >
                <RotateCcw size={12} aria-hidden="true" />
                Restaurar ícone do executável
              </Button>
              <p className="text-[10px] leading-snug text-ink-tertiary">
                Formatos aceitos: PNG, JPG e WebP. .ico não é suportado.
              </p>
            </div>
          </div>
        </div>

        {/* ── Remover jogo (confirmação em duas etapas) ── */}
        <div className="border-t border-[var(--border-subtle)] pt-4">
          {confirmingRemove ? (
            <div className="space-y-3 rounded-card border border-danger-border bg-danger-bg p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-danger">
                <AlertTriangle size={16} aria-hidden="true" />
                Tem certeza?
              </p>
              <p className="text-xs leading-relaxed text-ink-secondary">
                <span className="font-semibold text-ink-primary">{game.name}</span> sairá da sua
                biblioteca. O arquivo do jogo não será apagado do computador.
              </p>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingRemove(false)}
                  disabled={removing}
                >
                  Voltar
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void handleRemove()}
                  disabled={removing}
                >
                  {removing ? (
                    <>
                      <Loader2 size={14} aria-hidden="true" className="animate-spin" />
                      Removendo…
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} aria-hidden="true" />
                      Remover definitivamente
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="danger"
              onClick={() => setConfirmingRemove(true)}
              disabled={busy}
              className="w-full"
            >
              <Trash2 size={14} aria-hidden="true" />
              Remover jogo
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
})
