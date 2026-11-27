import { memo } from 'react'
import { GAMEPAD_ACTION_LABELS } from '../../lib/gamepad'
import type { GamepadAction } from '../../lib/gamepad'

// Índices 0–15 oferecidos no seletor ("sem botão" é a opção 'none').
const BUTTON_INDEXES = Array.from({ length: 16 }, (_, index) => index)

export interface GamepadMappingRowProps {
  action: GamepadAction
  /** Botão atribuído à ação (`null` = sem botão). */
  buttonIndex: number | null
  /** Linha em modo de escuta ("Pressione o botão…"). */
  listening: boolean
  /** Linha envolvida no conflito atual (destacada em vermelho). */
  conflictHighlight: boolean
  buttonName: (index: number | null) => string
  onAssign: (action: GamepadAction, button: number | null) => void
  onToggleListen: (action: GamepadAction) => void
}

/**
 * Linha de mapeamento do passo "Ajuste manual" (ação → botão).
 * Memoizada: só re-renderiza quando o próprio botão/estado de escuta/conflito
 * da linha muda — notice, saving e dicas do assistente não tocam as 12 linhas.
 */
export const GamepadMappingRow = memo(function GamepadMappingRow({
  action,
  buttonIndex,
  listening,
  conflictHighlight,
  buttonName,
  onAssign,
  onToggleListen
}: GamepadMappingRowProps): JSX.Element {
  const rowTone = conflictHighlight
    ? 'border-red-500/40 bg-red-500/10'
    : listening
      ? 'border-neon-cyan/40 bg-neon-cyan/5'
      : 'border-transparent'

  return (
    <li
      className={`flex flex-wrap items-center gap-3 border-l-4 px-4 py-2.5 transition-colors ${rowTone}`}
    >
      <span className="w-36 shrink-0 text-sm font-semibold text-slate-200">
        {GAMEPAD_ACTION_LABELS[action]}
      </span>

      {listening ? (
        <span className="flex min-w-[9rem] flex-1 items-center justify-center rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-widest text-neon-cyan animate-pulse-slow motion-reduce:animate-none">
          Pressione o botão…
        </span>
      ) : (
        <span
          className={`inline-flex min-w-[9rem] flex-1 justify-center rounded-lg border px-3 py-1.5 font-mono text-[11px] font-semibold ${
            buttonIndex === null
              ? 'border-white/[0.08] bg-white/[0.03] text-slate-400'
              : 'border-neon-cyan/25 bg-neon-cyan/5 text-neon-cyan'
          }`}
        >
          {buttonName(buttonIndex)}
        </span>
      )}

      <div className="flex shrink-0 items-center gap-2">
        <select
          className="input-gamer !w-32 !px-2 !py-1.5 !text-[11px] font-mono"
          value={buttonIndex === null ? 'none' : String(buttonIndex)}
          onChange={(event) => {
            const value = event.target.value
            onAssign(action, value === 'none' ? null : Number(value))
          }}
          aria-label={`Botão para ${GAMEPAD_ACTION_LABELS[action]}`}
        >
          <option value="none">Sem botão</option>
          {BUTTON_INDEXES.map((index) => (
            <option key={index} value={index}>
              Botão {index}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
            listening
              ? 'border-neon-cyan/50 bg-neon-cyan/15 text-neon-cyan'
              : 'border-white/[0.1] bg-white/[0.04] text-slate-300 hover:border-neon-cyan/40 hover:text-neon-cyan'
          }`}
          onClick={() => onToggleListen(action)}
        >
          {listening ? 'Aguardando…' : 'Remapear'}
        </button>
      </div>
    </li>
  )
})
