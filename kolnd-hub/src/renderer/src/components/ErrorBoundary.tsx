import React from 'react'
import { ErrorState } from './ui'

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
        <div className="flex h-full items-center justify-center px-6">
          <ErrorState
            title="Algo deu errado"
            message={this.state.error?.message ?? 'Não foi possível renderizar o conteúdo.'}
            onRetry={() => this.setState({ hasError: false, error: null })}
            className="w-full max-w-lg"
          />
        </div>
      )
    }
    return this.props.children
  }
}
