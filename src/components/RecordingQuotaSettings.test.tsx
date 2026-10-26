// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RecordingStorage, Server } from '../domain/types'
import { ServerSettingsDialog } from './WorkspaceDialogs'

const GIB = 2 ** 30
const storage: RecordingStorage = { quota_bytes: 6 * GIB, used_bytes: 1.5 * GIB, default_quota_bytes: 6 * GIB, min_quota_bytes: GIB, max_quota_bytes: 1024 * GIB, max_file_bytes: 2 * GIB, retention_seconds: 86_400 }
const server = (role: Server['role']): Server => ({ id: 1, name: 'Voxhold', created_by: 1, created_at: 1, role, joined_at: 1 })
const renderDialog = (role: Server['role'], onSaveRecordingQuota = vi.fn(async () => undefined)) => render(<ServerSettingsDialog open onClose={() => undefined} server={server(role)} corsOrigins={[]} corsOriginsLoading={false} onRename={async () => undefined} onDeleteAccount={async () => undefined} onDownloadDiagnostics={async () => undefined} onSaveCorsOrigins={async (origins) => origins} recordingStorage={storage} onSaveRecordingQuota={onSaveRecordingQuota}/>)

describe('recording storage settings', () => {
  afterEach(() => { cleanup(); document.body.classList.remove('modal-open') })

  it('shows usage and saves the owner quota in whole gigabytes', async () => {
    const save = vi.fn(async () => undefined)
    const view = renderDialog('owner', save)
    const input = view.getByLabelText('Лимит, ГБ') as HTMLInputElement
    expect(input.value).toBe('6')
    expect(view.getByText(/Занято 1,5 из 6 ГБ/)).toBeTruthy()
    fireEvent.change(input, { target: { value: '0' } })
    // Native min/max validation would block the button; check the dialog's own guard.
    fireEvent.submit(input.closest('form')!)
    expect(view.getByRole('alert').textContent).toContain('от 1 до 1024 ГБ')
    expect(save).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '12' } })
    fireEvent.click(view.getByRole('button', { name: 'Сохранить лимит' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(12 * GIB))
  })

  it('is hidden from admins and members', () => {
    expect(renderDialog('admin').queryByLabelText('Лимит, ГБ')).toBeNull()
  })
})
