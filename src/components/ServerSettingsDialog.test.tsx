// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Server } from '../domain/types'
import { ServerSettingsDialog } from './WorkspaceDialogs'

const owner: Server = {
  id: 1,
  name: 'Voxhold',
  created_by: 1,
  created_at: 1,
  role: 'owner',
  joined_at: 1,
}

describe('ServerSettingsDialog CORS settings', () => {
  afterEach(() => {
    cleanup()
    document.body.classList.remove('modal-open')
  })

  it('lets the owner replace origins one per line', async () => {
    const onSaveCorsOrigins = vi.fn(async (origins: string[]) => origins)
    const view = render(
      <ServerSettingsDialog
        open
        onClose={() => undefined}
        server={owner}
        corsOrigins={['https://first.example.com']}
        corsOriginsLoading={false}
        onRename={async () => undefined}
        onDeleteAccount={async () => undefined}
        onDownloadDiagnostics={async () => undefined}
        onSaveCorsOrigins={onSaveCorsOrigins}
      />,
    )

    const input = view.getByLabelText('Разрешённые origin')
    fireEvent.change(input, {
      target: { value: 'https://client.example.com\n\n http://localhost:5173 ' },
    })
    fireEvent.click(view.getByRole('button', { name: 'Сохранить CORS' }))

    await waitFor(() => expect(onSaveCorsOrigins).toHaveBeenCalledWith([
      'https://client.example.com',
      'http://localhost:5173',
    ]))
  })

  it('hides CORS controls from non-owners', () => {
    const view = render(
      <ServerSettingsDialog
        open
        onClose={() => undefined}
        server={{ ...owner, role: 'admin' }}
        corsOrigins={[]}
        corsOriginsLoading={false}
        onRename={async () => undefined}
        onDeleteAccount={async () => undefined}
        onDownloadDiagnostics={async () => undefined}
        onSaveCorsOrigins={async () => []}
      />,
    )

    expect(view.queryByLabelText('Разрешённые origin')).toBeNull()
  })
})
