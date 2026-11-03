// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ScheduledMessage } from '../domain/community'
import type { VoxholdApi } from '../services/api'
import { ScheduledMessages } from './ScheduledMessages'

afterEach(cleanup)
const item = (id: number, kind: 'channel' | 'conversation', destination: number, content: string): ScheduledMessage => ({ id, destination: { kind, id: destination }, payload: { content }, status: 'pending', error: '', send_at: Math.floor(Date.now() / 1000) + 3600 })

it('keeps the list in the selected chat when an older server ignores destination filters', async () => {
  const request = vi.fn().mockResolvedValue([item(1, 'channel', 2, 'Этот чат'), item(2, 'conversation', 2, 'Другой тип с тем же ID'), item(3, 'channel', 3, 'Другой канал')])
  const api = { community: { request } } as unknown as VoxholdApi
  render(<ScheduledMessages api={api} token="test" destination={{ kind: 'channel', id: 2 }}/>)
  await screen.findByText('Этот чат')
  expect(screen.queryByText('Другой тип с тем же ID')).not.toBeInTheDocument()
  expect(screen.queryByText('Другой канал')).not.toBeInTheDocument()
  expect(request.mock.calls[0]![1]).toContain('destination_kind=channel&destination_id=2')
})

it('preserves attachments and poll options while updating its question and schedule', async () => {
  const scheduled = item(1, 'conversation', 2, 'Старый вопрос')
  scheduled.payload.attachment_ids = ['attachment']
  scheduled.payload.poll = { question: 'Старый вопрос', options: ['Да', 'Нет'], anonymous: true, multiple: false, closes_at: scheduled.send_at + 86400 }
  const request = vi.fn((_token: string, _path: string, method?: string) => Promise.resolve(method === 'PUT' ? {} : [scheduled]))
  const api = { community: { request } } as unknown as VoxholdApi
  render(<ScheduledMessages api={api} token="test" destination={{ kind: 'conversation', id: 2 }}/>)
  await screen.findByText('Старый вопрос')
  fireEvent.click(screen.getByRole('button', { name: 'Изменить' }))
  fireEvent.change(screen.getByLabelText('Вопрос опроса'), { target: { value: 'Новый вопрос' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('test', '/me/scheduled-messages/1', 'PUT', expect.objectContaining({
    payload: expect.objectContaining({ content: 'Новый вопрос', attachment_ids: ['attachment'], poll: expect.objectContaining({ question: 'Новый вопрос', options: ['Да', 'Нет'], anonymous: true }) }),
  })))
})

it('keeps a near-future send time and allows an attachment without a caption', async () => {
  const scheduled = item(1, 'channel', 2, '')
  scheduled.send_at = Math.floor(Date.now() / 1000) + 300
  scheduled.payload.attachment_ids = ['attachment']
  const request = vi.fn((_token: string, _path: string, method?: string) => Promise.resolve(method === 'PUT' ? {} : [scheduled]))
  const api = { community: { request } } as unknown as VoxholdApi
  render(<ScheduledMessages api={api} token="test" destination={{ kind: 'channel', id: 2 }}/>)
  fireEvent.click(await screen.findByRole('button', { name: 'Изменить' }))
  expect(screen.getByLabelText('Сообщение')).not.toBeRequired()
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('test', '/me/scheduled-messages/1', 'PUT', expect.objectContaining({
    send_at: scheduled.send_at, payload: expect.objectContaining({ content: '', attachment_ids: ['attachment'] }),
  })))
})
