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

export function relativeTime(unixSeconds: number | null): string {
  if (!unixSeconds) return 'не в сети'
  const difference = unixSeconds * 1000 - Date.now()
  const minutes = Math.round(difference / 60_000)
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour')
  return rtf.format(Math.round(hours / 24), 'day')
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
  }
  return translations[error.message.toLowerCase()] ?? error.message
}
