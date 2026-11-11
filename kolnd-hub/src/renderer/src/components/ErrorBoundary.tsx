import React from 'react'

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
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
        <div className="flex flex-col items-center justify-center h-full text-slate-400">
          <h2 className="text-white font-bold mb-2">Erro ao carregar a página</h2>
          <p className="text-sm mb-4">
            {this.state.error?.message ?? 'Não foi possível renderizar o conteúdo.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.1] transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
