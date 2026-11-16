// Barrel dos primitivos de UI do Hub (tarefa 2.0/13.6).
// Exports nomeados apenas — importe sempre de 'components/ui' (ou '../ui'):
//   import { Button, Modal, Toast } from '../ui'
//
// 15 famílias de primitivos + tipos públicos de cada uma.
// Sem lógica de negócio, sem dependências novas; estilo 100% via tokens.
//
// ScrollArea (item 11 do plano 13-13.6) NÃO é um componente JS — é a estilização
// de scrollbar já existente em index.css: `::-webkit-scrollbar` (8 px, track
// --bg-sunken) com thumb --surface-3 que clareia para --accent-muted + borda no
// hover. Usar em qualquer container rolável: `className="overflow-y-auto"`;
// não criar wrapper. Cor/raio/transition já respeitam os tokens e o motion fast.
export { Button } from './Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button'

export { IconButton } from './IconButton'
export type { IconButtonProps } from './IconButton'

export { Input } from './Input'
export type { InputProps } from './Input'

export { SearchInput } from './SearchInput'
export type { SearchInputProps } from './SearchInput'

export { Select } from './Select'
export type { SelectProps } from './Select'

export { Card } from './Card'
export type { CardProps, CardVariant } from './Card'

export { Badge } from './Badge'
export type { BadgeProps, BadgeTone } from './Badge'

export { Modal } from './Modal'
export type { ModalProps } from './Modal'

export { Toast } from './Toast'
export type { ToastProps, ToastKind } from './Toast'

export { Tooltip } from './Tooltip'
export type { TooltipProps } from './Tooltip'

export { Spinner } from './Spinner'
export type { SpinnerProps } from './Spinner'

export { Skeleton } from './Skeleton'
export type { SkeletonProps, SkeletonRounded } from './Skeleton'

export { Switch } from './Switch'
export type { SwitchProps } from './Switch'

export { EmptyState } from './EmptyState'
export type { EmptyStateProps, EmptyStateTone } from './EmptyState'

export { ErrorState } from './ErrorState'
export type { ErrorStateProps } from './ErrorState'

export { LoadingState } from './LoadingState'
export type { LoadingStateProps } from './LoadingState'
