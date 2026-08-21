import { useState } from 'react'
import type { InviteLinkPreview } from '../domain/types'
import { Brand } from './Brand'
import { Icon } from './Icon'

export function InviteAppPrompt({ invite, nativeURL, onStayInBrowser }: {
  invite: InviteLinkPreview
  nativeURL: string
  onStayInBrowser: () => void
}) {
  const [launchAttempted, setLaunchAttempted] = useState(false)

  return (
    <div className="invite-app-backdrop" role="presentation">
      <section className="invite-app-prompt" role="dialog" aria-modal="true" aria-labelledby="invite-app-title">
        <header><Brand/><span className="invite-app-prompt__mark"><Icon name="monitor" size={26}/></span></header>
        <span className="eyebrow">ПРИГЛАШЕНИЕ В {invite.server_name}</span>
        <h2 id="invite-app-title">Где открыть Voxhold?</h2>
        <p><b>@{invite.creator_username}</b> приглашает вас на сервер. Если desktop-клиент установлен, можно продолжить в нём — или войти и зарегистрироваться прямо на сайте.</p>
        <div className="invite-app-prompt__actions">
          <a className="button button--primary button--large" href={nativeURL} onClick={() => setLaunchAttempted(true)}><Icon name="monitor"/>Открыть приложение</a>
          <button className="button button--secondary button--large" type="button" onClick={onStayInBrowser}>Остаться на сайте</button>
        </div>
        <small>{launchAttempted ? 'Если приложение не открылось, вероятно, оно не установлено. Оставайтесь на этой странице и продолжайте в браузере.' : 'Браузер не раскрывает сайтам список установленных приложений, поэтому запуск выполняется только после вашего нажатия.'}</small>
      </section>
    </div>
  )
}
