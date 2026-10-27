import { Modal } from './Modal'

/** Dialog-sized loading keeps the workspace and its media mounted and visible. */
export function ModalLoading({ title, eyebrow, onClose }: { title: string; eyebrow?: string; onClose: () => void }) {
  return <Modal open title={title} eyebrow={eyebrow} size="medium" onClose={onClose}>
    <div className="dialog-loading" role="status" aria-live="polite">
      <div className="dialog-loading__caption"><span className="spinner"/><span>Загружаем…</span></div>
      <div className="dialog-loading__rows" aria-hidden="true">{[0, 1, 2].map((index) => <div className="dialog-loading__row" key={index}><i/><span><b/><small/></span></div>)}</div>
    </div>
  </Modal>
}
