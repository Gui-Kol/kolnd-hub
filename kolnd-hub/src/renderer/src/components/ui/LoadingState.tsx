// LoadingState — estado de carregamento único do Hub (tarefa 2.0/13.19).
//
// Vocabulário visual único para "esperando dados": <Spinner/> com texto de
// contexto (obrigatório — nunca spinner solto sem contexto em telas cheias)
// e, opcionalmente, um hint curto e/ou children (ex.: grade-fantasma de
// <Skeleton/> no layout final da tela).
//
// NÃO renderiza Card — quem quiser o cartão embrulha (<Card><LoadingState/>).
//
// Uso: <LoadingState label="Carregando sua biblioteca…" />
//      <LoadingState label="Verificando atualizações…" hint="Isso pode levar alguns segundos." />
import type { ReactNode } from 'react'
import { Spinner } from './Spinner'

export interface LoadingStateProps {
  /** Texto de contexto; também vira o nome acessível do spinner. Padrão: 'Carregando…'. */
  label?: string
  /** Detalhe curto abaixo do texto (ex.: aviso de latência). */
  hint?: string
  /** Tamanho do spinner. Padrão: 32. */
  size?: number
  /** Conteúdo abaixo do texto (ex.: grade fantasma de <Skeleton/>). */
  children?: ReactNode
  /** Classes extras do container. */
  className?: string
}

export function LoadingState({
  label = 'Carregando…',
  hint,
  size = 32,
  children,
  className = ''
}: LoadingStateProps): JSX.Element {
  return (
    <div
      aria-busy="true"
      className={`flex flex-col items-center justify-center gap-3 py-10 text-ink-secondary ${className}`.trim()}
    >
      <Spinner size={size} label={label} />
      <p className="text-sm text-ink-secondary">{label}</p>
      {hint != null && <p className="-mt-1.5 text-xs text-ink-tertiary">{hint}</p>}
      {children}
    </div>
  )
}
