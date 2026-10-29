import { Component, type ErrorInfo, type ReactNode } from 'react'
import { recordRenderError } from '../services/renderDiagnostics'
import { Icon } from './Icon'

/** Media ownership stays in WorkspacePage when a presentational subtree fails. */
export class WorkspaceContentBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { recordRenderError(error, info, 'workspace_content') }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }
  render() {
    if (!this.state.failed) return this.props.children
    return <section className="workspace-content-error" role="alert"><span><Icon name="monitor" size={32}/></span><h2>Не удалось отобразить эту область</h2><p>Попробуйте восстановить интерфейс без перезагрузки страницы. Управление звонком остаётся слева.</p><button className="button button--primary" onClick={() => this.setState({ failed: false })}>Восстановить интерфейс</button></section>
  }
}
