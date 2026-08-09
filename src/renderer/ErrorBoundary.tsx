import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info)
  }

  handleReset = () => {
    this.setState({ hasError: false, message: '' })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            background: 'var(--bg-app)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-ui)',
            padding: 24,
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: 28 }}>⚠</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Something went wrong</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 360 }}>
            {this.state.message}
          </div>
          <button
            type="button"
            onClick={this.handleReset}
            style={{
              marginTop: 8,
              padding: '6px 16px',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
              fontSize: 12
            }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
