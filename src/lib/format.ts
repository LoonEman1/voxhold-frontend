const rtf = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' })

export function formatTime(unixSeconds: number): string {
  return new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(unixSeconds * 1000),
  )
}

export function formatDate(unixSeconds: number): string {
  return new Intl.DateTimeFormat('ru', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(unixSeconds * 1000))
}

export function relativeTime(unixSeconds: number | null, now = Date.now()): string {
  if (!unixSeconds) return 'не в сети'
  const difference = unixSeconds * 1000 - now
  const minutes = Math.round(difference / 60_000)
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour')
  return rtf.format(Math.round(hours / 24), 'day')
}

/** Live duration as m:ss, or h:mm:ss from the first hour on. */
export function formatDuration(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

export function viewerLabel(count: number): string {
  if (count <= 0) return 'пока без зрителей'
  const mod100 = count % 100
  const mod10 = count % 10
  const word = mod100 >= 11 && mod100 <= 14 ? 'зрителей' : mod10 === 1 ? 'зритель' : mod10 >= 2 && mod10 <= 4 ? 'зрителя' : 'зрителей'
  return `${count} ${word}`
}

export function initials(value: string): string {
  return value.trim().slice(0, 2).toLocaleUpperCase('ru') || 'VX'
}

export function colorFor(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) hash = value.charCodeAt(index) + ((hash << 5) - hash)
  return ['violet', 'lime', 'coral', 'cyan', 'amber'][Math.abs(hash) % 5] ?? 'lime'
}

export function humanError(error: unknown): string {
  if (!(error instanceof Error)) return 'Что-то пошло не так'
  const translations: Record<string, string> = {
    'invalid username or password': 'Неверное имя пользователя или пароль',
    'username is required': 'Введите имя пользователя',
    'password is required': 'Введите пароль',
    'password is too short': 'Пароль слишком короткий',
    'passwords do not match': 'Пароли не совпадают',
    'user not found': 'Пользователь не найден',
    'user is already a server member': 'Пользователь уже на сервере',
    'invitation is already pending': 'Приглашение уже отправлено',
    'server name is required': 'Введите название сервера',
    'channel name is required': 'Введите название канала',
    'message content is required': 'Сообщение не может быть пустым',
    'message content is too long': 'Сообщение слишком длинное',
    'message not found': 'Сообщение не найдено или уже удалено',
    'only the message author can edit it': 'Редактировать сообщение может только его автор',
    'not allowed to delete this message': 'Недостаточно прав для удаления сообщения',
    'not allowed to manage pinned messages': 'Недостаточно прав для управления закрепами',
    'search query is required': 'Введите текст для поиска',
    'search query is too long': 'Поисковый запрос слишком длинный',
    'search query must contain a letter or number': 'Введите хотя бы одну букву или цифру',
    'not allowed to manage server members': 'Недостаточно прав для управления участниками',
    'role must be admin or member': 'Можно выбрать роль администратора или участника',
    'server owner role cannot be changed': 'Роль владельца нельзя изменить',
    'cannot change your own role': 'Нельзя изменить собственную роль',
    'server owner cannot be kicked': 'Владельца нельзя исключить из сервера',
    'cannot kick yourself': 'Нельзя исключить самого себя',
    'invalid or expired session': 'Сессия истекла. Войдите снова',
    'recording not found': 'Запись не найдена или срок её хранения истёк',
    'recording state changed or another recording is active': 'Состояние записи изменилось или в канале уже идёт запись',
    'server recording storage limit reached; the local file is preserved': 'Хранилище записей на сервере заполнено; локальный файл сохранён',
    'recording uploads are busy; try again': 'Сервер занят загрузкой других записей, попробуйте позже',
    'recording downloads are busy; try again': 'Сервер занят выдачей других записей, попробуйте позже',
    'recording operation failed': 'Не удалось выполнить операцию с записью',
    'only the instance owner can manage recording storage': 'Лимит записей может менять только владелец',
    'recording storage must be between 1 and 1024 gib': 'Лимит записей — от 1 до 1024 ГБ',
    'use a jpeg, png, webp or gif image up to 5 mb and 16 megapixels': 'Нужно изображение JPEG, PNG, WebP или GIF до 5 МБ и 16 мегапикселей',
    'avatar upload exceeds 5 mb': 'Максимальный размер аватара — 5 МБ',
    'image processing is busy; try again': 'Сервер обрабатывает другие изображения, попробуйте позже',
    'could not save avatar': 'Не удалось сохранить аватар',
    'could not remove avatar': 'Не удалось удалить аватар',
  }
  return translations[error.message.toLowerCase()] ?? error.message
}
