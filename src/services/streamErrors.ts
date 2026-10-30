export function streamErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Доступ к экрану не предоставлен'
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'Нет доступного экрана или окна для трансляции'
  return error instanceof Error ? error.message : 'Не удалось запустить трансляцию'
}
