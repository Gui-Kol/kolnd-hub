import { memo, useCallback, useEffect, useState } from 'react'
import {
  Check,
  Gamepad2,
  Pencil,
  Loader2,
  AlertTriangle,
  ImagePlus,
  Plus,
  RotateCcw,
  Tags,
  Trash2
} from 'lucide-react'
import type { Game } from '../../types'
import { Button, Input, Modal } from '../ui'
interface EditGameModalProps {
  game: Game
  /** dataURL do ícone atual (cacheada na grade) ou null para o fallback visual. */
  currentIcon: string | null
  /** dataURL da capa atual (cacheada na grade) ou null quando não há capa. */
  currentCover: string | null
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
  currentCover,
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
  // Coleções (T3): lista existente + seleção pendente de persistência.
  const [availableCollections, setAvailableCollections] = useState<string[]>([])
  const [selectedCollections, setSelectedCollections] = useState<string[]>(
    () => game.collections ?? []
  )
  const [newCollection, setNewCollection] = useState('')
  const [collectionBusy, setCollectionBusy] = useState(false)
  // Capa (T6): pré-visualizada aqui, só gravada/persistida no Salvar.
  const [coverSource, setCoverSource] = useState<'none' | 'custom' | 'remove'>('none')
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(null)
  const [coverBusy, setCoverBusy] = useState(false)

  const busy = saving || removing
  const trimmedName = name.trim()
  const canSave = trimmedName.length > 0 && !busy
  const previewIcon =
    iconSource === 'custom' ? customDataUrl : iconSource === 'exe' ? exePreviewDataUrl : currentIcon
  const previewCover =
    coverSource === 'remove' ? null : coverSource === 'custom' ? coverDataUrl : currentCover

  useEffect(() => {
    let alive = true
    window.api
      .getGameCollections()
      .then((list) => {
        if (alive) setAvailableCollections(list)
      })
      .catch(() => {
        // Sem a lista, os chips não aparecem; a seleção salva é preservada.
      })
    return (): void => {
      alive = false
    }
  }, [])

  const toggleCollection = useCallback((name: string): void => {
    setSelectedCollections((prev) => {
      const exists = prev.some((item) => item.toLowerCase() === name.toLowerCase())
      if (exists) return prev.filter((item) => item.toLowerCase() !== name.toLowerCase())
      if (prev.length >= 8) return prev
      return [...prev, name]
    })
  }, [])

  const handleCreateCollection = useCallback(async (): Promise<void> => {
    const name = newCollection.trim()
    if (!name || collectionBusy) return
    setCollectionBusy(true)
    try {
      const result = await window.api.createGameCollection(name)
      if (!result.success) {
        showToast(result.error ?? 'Não foi possível criar a coleção.')
        return
      }
      const list = result.collections ?? (await window.api.getGameCollections())
      setAvailableCollections(list)
      setNewCollection('')
      // Coleção recém-criada já entra marcada (se houver espaço no jogo).
      const created = list.find((item) => item.toLowerCase() === name.toLowerCase())
      if (created) {
        setSelectedCollections((prev) =>
          prev.some((item) => item.toLowerCase() === created.toLowerCase()) || prev.length >= 8
            ? prev
            : [...prev, created]
        )
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível criar a coleção.')
    } finally {
      setCollectionBusy(false)
    }
  }, [collectionBusy, newCollection, showToast])

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

  const handlePickCover = useCallback(async (): Promise<void> => {
    if (coverBusy || busy) return
    setCoverBusy(true)
    try {
      const picked = await window.api.pickGameCover()
      if (!picked.success) {
        if (!picked.canceled && picked.error) showToast(picked.error)
        return
      }
      setCoverDataUrl(picked.dataUrl ?? null)
      setCoverSource('custom')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível escolher a capa.')
    } finally {
      setCoverBusy(false)
    }
  }, [coverBusy, busy, showToast])

  const handleRemoveCover = useCallback((): void => {
    if (coverBusy || busy) return
    setCoverDataUrl(null)
    setCoverSource('remove')
  }, [coverBusy, busy])

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

      // 2) Capa (se houver troca/remoção): grava em game-covers/ ou marca null.
      let coverPath: string | null | undefined
      if (coverSource === 'custom' && coverDataUrl) {
        const written = await window.api.setGameCover(game.id, coverDataUrl)
        if (!written.success || !written.coverPath) {
          showToast(written.error ?? 'Não foi possível salvar a capa.')
          setSaving(false)
          return
        }
        coverPath = written.coverPath
      } else if (coverSource === 'remove') {
        coverPath = null
      }

      // 3) Persiste nome/executável/ícone/coleções/capa numa única escrita.
      const updated = await window.api.updateGame(game.id, {
        name: trimmedName,
        exePath: exePath.trim(),
        collections: selectedCollections,
        ...(iconPath !== undefined ? { iconPath } : {}),
        ...(coverPath !== undefined ? { coverPath } : {})
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
  }, [
    canSave,
    iconSource,
    customDataUrl,
    exePath,
    game.id,
    selectedCollections,
    coverSource,
    coverDataUrl,
    trimmedName,
    showToast,
    onSaved
  ])

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

        {/* ── Capa do jogo (T6) ─────────────────────── */}
        <div>
          <span className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-tertiary">
            Capa do jogo (2:3)
          </span>
          <div className="flex items-start gap-4">
            <div className="flex aspect-[2/3] w-24 shrink-0 items-center justify-center overflow-hidden rounded-card border border-[var(--border-subtle)] bg-surface-2">
              {previewCover ? (
                <img
                  src={previewCover}
                  alt={`Capa de ${trimmedName || game.name}`}
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              ) : (
                <ImagePlus size={28} aria-hidden="true" className="text-ink-tertiary" />
              )}
            </div>
            <div className="flex min-w-0 flex-col items-start gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handlePickCover()}
                disabled={busy || coverBusy}
              >
                {coverBusy ? (
                  <Loader2 size={14} aria-hidden="true" className="animate-spin" />
                ) : (
                  <ImagePlus size={14} aria-hidden="true" />
                )}
                Escolher capa…
              </Button>
              {previewCover && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRemoveCover}
                  disabled={busy || coverBusy}
                >
                  <Trash2 size={12} aria-hidden="true" />
                  Remover capa
                </Button>
              )}
              <p className="text-[10px] leading-snug text-ink-tertiary">
                PNG, JPG ou WebP até 8 MB. A capa aparece na Biblioteca e no Big Picture; sem capa o
                card segue com o ícone.
              </p>
            </div>
          </div>
        </div>

        {/* ── Coleções (T3) ─────────────────────────── */}
        <div>
          <span className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-tertiary">
            <Tags size={12} aria-hidden="true" />
            Coleções
          </span>
          <p className="mb-2 text-[10px] leading-snug text-ink-tertiary">
            Até 8 coleções por jogo. Marque as existentes ou crie uma nova.
          </p>
          {availableCollections.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {availableCollections.map((collection) => {
                const checked = selectedCollections.some(
                  (item) => item.toLowerCase() === collection.toLowerCase()
                )
                const disabled =
                  busy || collectionBusy || (!checked && selectedCollections.length >= 8)
                return (
                  <button
                    key={collection}
                    type="button"
                    aria-pressed={checked}
                    disabled={disabled}
                    onClick={() => toggleCollection(collection)}
                    className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-1 text-xs font-medium transition-colors duration-1 ease-standard disabled:cursor-not-allowed disabled:opacity-50 ${
                      checked
                        ? 'border-accent-border bg-accent-muted text-ink-primary'
                        : 'border-[var(--border-subtle)] bg-surface-2 text-ink-secondary hover:border-[var(--border-strong)] hover:text-ink-primary'
                    }`}
                  >
                    {checked && <Check size={12} aria-hidden="true" className="text-accent" />}
                    {collection}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-[11px] text-ink-secondary">
              Nenhuma coleção ainda — crie a primeira abaixo.
            </p>
          )}
          <div className="mt-3 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <Input
                type="text"
                value={newCollection}
                maxLength={24}
                disabled={busy || collectionBusy}
                onChange={(event) => setNewCollection(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handleCreateCollection()
                  }
                }}
                placeholder="Nova coleção"
                aria-label="Nome da nova coleção"
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleCreateCollection()}
              disabled={busy || collectionBusy || newCollection.trim().length === 0}
            >
              {collectionBusy ? (
                <Loader2 size={14} aria-hidden="true" className="animate-spin" />
              ) : (
                <Plus size={14} aria-hidden="true" />
              )}
              Criar
            </Button>
          </div>
          {selectedCollections.length >= 8 && (
            <p className="mt-1.5 text-[10px] text-ink-tertiary">
              Limite de 8 coleções por jogo atingido.
            </p>
          )}
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
