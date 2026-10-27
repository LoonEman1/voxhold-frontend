export type ReactionCategory = 'faces' | 'hands' | 'celebrate' | 'nature'
export interface ReactionOption { emoji: string; label: string; category: ReactionCategory }
const groups: Record<ReactionCategory, string> = {
  faces: '😂:Смех|🤣:Хохот|🤔:Думаю|😁:Улыбка|😢:Грустно|😭:Плачу|😮:Удивление|😱:Шок|🤯:Взрыв мозга|🥰:Влюблённость|😍:Восторг|😎:Круто|🤩:Восхищение|🥳:Праздник|😇:Ангел|🙂:Улыбаюсь|🙃:Вверх ногами|😉:Подмигивание|😊:Радость|😋:Вкусно|😘:Поцелуй|😴:Сплю|🤤:Слюнки|🤨:Скепсис|😐:Без эмоций|😑:Без слов|😏:Усмешка|😒:Недовольство|😔:Печаль|😕:Растерянность|🙁:Огорчение|☹️:Хмурюсь|😫:Усталость|😩:Изнеможение|😤:Возмущение|😡:Злость|🤬:Ярость|😳:Смущение|🥺:Пожалуйста|🥹:Тронут|🤗:Обнимаю|🤫:Тише|🤭:Смущённый смех|🫡:Есть|🫠:Таю|🤡:Клоун|💀:Череп|👻:Призрак|👀:Смотрю|🧠:Мозг',
  hands: '👍:Нравится|👎:Не нравится|🤝:Согласие|👏:Аплодисменты|🙌:Ура|👐:Открытые ладони|🤲:Ладони|🙏:Спасибо|💪:Сила|✊:Кулак|👊:Дай кулачок|✌️:Победа|🤞:Удачи|🤟:Люблю|🤘:Рок|👌:Отлично|🤌:Превосходно|🫶:Сердце руками|🫰:Маленькое сердце|👋:Привет',
  celebrate: '❤️:Любовь|🔥:Огонь|💯:Сто процентов|✅:Готово|❌:Нет|⚡:Молния|⭐:Звезда|🌟:Яркая звезда|🎉:Поздравляю|🎊:Конфетти|🎁:Подарок|💎:Бриллиант|🏆:Кубок|🥇:Первое место|🚀:Ракета',
  nature: '🌈:Радуга|☀️:Солнце|🌙:Луна|☕:Кофе|🍿:Попкорн|🍰:Торт|🍕:Пицца|🍓:Клубника|🍉:Арбуз|🌹:Роза|💐:Букет|🦋:Бабочка|🐱:Кот|🐶:Собака|🐸:Лягушка|🦄:Единорог|🐝:Пчела',
}
export const REACTION_CATALOG = (Object.entries(groups) as [ReactionCategory, string][]).flatMap(([category, items]) => items.split('|').map((item) => { const [emoji, label] = item.split(':'); return { emoji: emoji!, label: label!, category } }))
const catalog = new Map(REACTION_CATALOG.map((option, index) => [option.emoji, { ...option, index }]))
export const QUICK_REACTIONS = ['❤️', '😂', '👍', '🔥', '🤔', '👏', '😭']
export const reactionLabel = (emoji: string) => catalog.get(emoji)?.label ?? 'Реакция'
export const reactionOrder = (emoji: string) => catalog.get(emoji)?.index ?? 1_000
const RECENT_KEY = 'voxhold.reactions.recent.v1'
export function recentReactions(): string[] {
  try { const saved: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(saved) ? [...new Set(saved.filter((item): item is string => typeof item === 'string' && catalog.has(item)))].slice(0, 24) : [] } catch { return [] }
}
export function rememberReaction(emoji: string) {
  if (!catalog.has(emoji)) return
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...recentReactions().filter((item) => item !== emoji)].slice(0, 24))) } catch { /* Optional local preference. */ }
}
