// SearchInput — Input pré-montado para busca (tarefa 2.0/13.6).
//
// Lupa à esquerda sempre presente; botão "X" (limpar) aparece somente quando há texto.
// Props idênticas ao <input> nativo, exceto `icon` (sempre a lupa).
//   onClear   — chamado ao clicar no X (ou Esc com texto). Se omitido, dispara onChange
//               com value "" (target/currentTarget.value === '').
//   value     — texto atual (o botão limpar só aparece com value não-vazio).
//   aria-label — padrão "Buscar" quando omitido.
//
// Uso: <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" />
import { forwardRef, useRef } from 'react'
import type { ChangeEvent, KeyboardEvent, MutableRefObject, Ref } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from './Input'
import type { InputProps } from './Input'

export interface SearchInputProps extends Omit<InputProps, 'icon'> {
  /** Chamado ao clicar no botão limpar. Sem ele, cai para onChange com value "". */
  onClear?: () => void
}

export const SearchInput = forwardRef(function SearchInput(
  {
    value,
    onChange,
    onClear,
    onKeyDown,
    'aria-label': ariaLabel,
    className = '',
    type = 'text',
    ...rest
  }: SearchInputProps,
  ref: Ref<HTMLInputElement>
): JSX.Element {
  const innerRef = useRef<HTMLInputElement | null>(null)
  const hasText =
    typeof value === 'string' || Array.isArray(value) ? value.length > 0 : value != null

  const setRef = (node: HTMLInputElement | null): void => {
    innerRef.current = node
    if (typeof ref === 'function') {
      ref(node)
    } else if (ref) {
      ;(ref as MutableRefObject<HTMLInputElement | null>).current = node
    }
  }

  const handleClear = (): void => {
    if (onClear) {
      onClear()
    } else if (onChange) {
      // Sintetiza um evento mínimo com value "" para consumidores onChange padrão.
      onChange({
        target: { value: '' },
        currentTarget: { value: '' }
      } as unknown as ChangeEvent<HTMLInputElement>)
    }
    innerRef.current?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    // Esc limpa o campo quando há texto (atalho comum de busca).
    if (event.key === 'Escape' && hasText) {
      event.stopPropagation()
      handleClear()
    }
    onKeyDown?.(event)
  }

  return (
    <div className="relative w-full">
      <Input
        ref={setRef}
        type={type}
        icon={Search}
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel ?? 'Buscar'}
        className={[hasText ? 'pr-10' : '', className].filter(Boolean).join(' ')}
        {...rest}
      />
      {hasText && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Limpar busca"
          className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-sm text-ink-tertiary transition-colors duration-1 ease-standard hover:bg-surface-2 hover:text-ink-primary"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  )
})
