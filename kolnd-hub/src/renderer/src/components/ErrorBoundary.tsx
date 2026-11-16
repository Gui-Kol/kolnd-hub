import React from 'react'
import { AlertTriangle } from 'lucide-react'

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }
      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center h-full text-center px-6"
        >
          <div className="w-12 h-12 mb-4 rounded-card bg-danger-bg border border-danger-border flex items-center justify-center">
            <AlertTriangle size={22} className="text-danger" aria-hidden="true" />
          </div>
          <h2 className="text-ink-primary text-lg font-semibold mb-2">Algo deu errado</h2>
          <p className="text-sm text-ink-secondary mb-4 max-w-md">
            {this.state.error?.message ?? 'Não foi possível renderizar o conteúdo.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 rounded-control bg-surface-2 border border-[var(--border-strong)] text-xs font-medium text-ink-secondary hover:text-ink-primary hover:bg-surface-3 transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
