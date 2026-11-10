export const MUTE_VOICE = 32
export const MOVE_VOICE = 64
export const KICK_VOICE = 128

export const rolePermissions = [
  [1, 'Читать каналы'],
  [2, 'Публиковать сообщения'],
  [4, 'Участвовать в голосе'],
  [8, 'Запускать трансляции'],
  [16, 'Управлять сообщениями'],
  [MUTE_VOICE, 'Заглушать микрофон на сервере'],
  [MOVE_VOICE, 'Перемещать участников между голосовыми каналами'],
  [KICK_VOICE, 'Отключать участников от голосового канала'],
] as const
