import { Icon } from './Icon'
export function CallControls({ selfMute, selfDeaf, recording, recordBusy, canRecord, canShare, chatOpen, onMute, onDeaf, onRecord, onRecordings, onChat, onShare, onLeave, connecting = false }: {
  selfMute: boolean; selfDeaf: boolean; recording: boolean; recordBusy: boolean; canRecord: boolean; canShare: boolean; chatOpen: boolean
  connecting?: boolean
  onMute: () => void; onDeaf: () => void; onRecord: () => void; onRecordings: () => void; onChat: () => void; onShare: () => void; onLeave: () => void
}) {
  return <div className="call-controls" aria-label="Управление звонком">
    <button className={selfMute ? 'is-muted' : ''} disabled={connecting} onClick={onMute} title={selfMute ? 'Включить микрофон' : 'Выключить микрофон'} aria-label={selfMute ? 'Включить микрофон' : 'Выключить микрофон'}><Icon name={selfMute ? 'micOff' : 'mic'}/><small>Микрофон</small></button>
    <button className={selfDeaf ? 'is-muted' : ''} disabled={connecting} onClick={onDeaf} title={selfDeaf ? 'Включить звук' : 'Выключить звук'} aria-label={selfDeaf ? 'Включить звук' : 'Выключить звук'}><Icon name={selfDeaf ? 'headphonesOff' : 'headphones'}/><small>Звук</small></button>
    {canShare && <button onClick={onShare} title="Поделиться экраном" aria-label="Поделиться экраном"><Icon name="monitor"/><small>Экран</small></button>}
    <button className={recording ? 'is-recording' : ''} disabled={recordBusy || !canRecord} onClick={onRecord} aria-busy={recordBusy} aria-pressed={recording} title={recording ? 'Остановить запись и скачать' : 'Записать экран и голоса · 720p'} aria-label={recording ? 'Остановить запись и скачать' : 'Начать запись'}><Icon name={recording ? 'recordStop' : 'record'}/><small>{recordBusy ? 'Ждите…' : recording ? 'Стоп' : 'Запись'}</small></button>
    <button onClick={onRecordings} title="Список записей" aria-label="Список записей"><Icon name="recordings"/><small>Записи</small></button>
    <button className={chatOpen ? 'is-active' : ''} onClick={onChat} title="Чат канала" aria-label="Чат канала" aria-pressed={chatOpen}><Icon name="chat"/><small>Чат</small></button>
    <button className="is-leave" onClick={onLeave} title="Отключиться" aria-label="Отключиться от звонка"><Icon name="logout"/><small>Выйти</small></button>
  </div>
}
