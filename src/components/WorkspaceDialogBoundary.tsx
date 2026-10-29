import { Component, type ErrorInfo, type ReactNode } from 'react'
import { recordRenderError } from '../services/renderDiagnostics'
import { Modal } from './Modal'

/** Dialog failures must never unmount the owner of an active call or stream. */
export class WorkspaceDialogBoundary extends Component<{ children: ReactNode; resetKey: string; onClose: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { recordRenderError(error, info, 'workspace_dialog') }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey: string; onClose: () => void }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }
  render() {
    if (!this.state.failed) return this.props.children
    return <Modal open title="Не удалось открыть окно" onClose={this.props.onClose}><div className="dialog-form"><p role="alert">Звонок и трансляция продолжаются. Закройте это окно и попробуйте снова. Если приложение недавно обновилось, обновите страницу после завершения звонка.</p><button className="button button--primary" onClick={this.props.onClose}>Вернуться к разговору</button></div></Modal>
  }
}
