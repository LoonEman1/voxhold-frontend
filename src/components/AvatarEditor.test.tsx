// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AvatarEditor } from './AvatarEditor'

beforeEach(() => {
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() })
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(400)
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn(async () => undefined) })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('edits a crop before sending the original file and selected pixel coordinates', async () => {
  const save = vi.fn(async () => undefined)
  render(<AvatarEditor name="Alice" hasAvatar onSave={save} onBusyChange={vi.fn()}/> )
  fireEvent.click(screen.getByRole('button', { name: 'Изменить аватар' }))
  expect(screen.getByRole('button', { name: 'Выбрать изображение' })).toBeTruthy()
  const file = new File(['original'], 'avatar.png', { type: 'image/png' })
  fireEvent.change(screen.getByLabelText('Файл аватара'), { target: { files: [file] } })
  await screen.findByAltText('Предпросмотр круглого аватара')
  expect(save).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('slider', { name: /Масштаб/ }), { target: { value: '2' } })
  fireEvent.change(screen.getByRole('slider', { name: 'По горизонтали' }), { target: { value: '1' } })
  fireEvent.change(screen.getByRole('slider', { name: 'По вертикали' }), { target: { value: '-1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить аватар' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith(file, { x: 600, y: 0, size: 200 }))
  await waitFor(() => expect(screen.queryByAltText('Предпросмотр круглого аватара')).toBeNull())
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
})

it('removes an avatar through its photo menu', async () => {
  const save = vi.fn(async () => undefined)
  render(<AvatarEditor name="Alice" hasAvatar onSave={save} onBusyChange={vi.fn()}/> )
  fireEvent.click(screen.getByRole('button', { name: 'Изменить аватар' }))
  fireEvent.click(screen.getByRole('button', { name: 'Удалить аватар' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith(null, undefined))
})

it('keeps the selected crop after an upload failure so it can be retried', async () => {
  const save = vi.fn(async () => { throw new Error('Не удалось сохранить аватар') })
  render(<AvatarEditor name="Alice" hasAvatar={false} onSave={save} onBusyChange={vi.fn()}/> )
  fireEvent.change(screen.getByLabelText('Файл аватара'), { target: { files: [new File(['original'], 'a.png', { type: 'image/png' })] } })
  fireEvent.click(await screen.findByRole('button', { name: 'Сохранить аватар' }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByAltText('Предпросмотр круглого аватара')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Сохранить аватар' }) as HTMLButtonElement).disabled).toBe(false)
})
