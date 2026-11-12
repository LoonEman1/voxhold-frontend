import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { Brand } from '../components/Brand'
import { Icon } from '../components/Icon'
import { humanError } from '../lib/format'
import { useTheme } from '../theme/ThemeContext'
import type { InviteLinkPreview } from '../domain/types'

type Mode = 'login' | 'register'

export function AuthPage({ invite, inviteToken }: { invite?: InviteLinkPreview; inviteToken?: string }) {
  const { login, register } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const registrationAllowed = Boolean(invite?.allow_registration && inviteToken)
  const [mode, setMode] = useState<Mode>(registrationAllowed ? 'register' : 'login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (mode === 'register' && password !== confirmation) {
      setError('Пароли не совпадают')
      return
    }
    setPending(true)
    try {
      if (mode === 'login') await login(username.trim(), password)
      else {
        if (!registrationAllowed || !inviteToken) {
          setError('Регистрация доступна только по действующему приглашению')
          return
        }
        await register(username.trim(), password, confirmation, inviteToken)
      }
    } catch (caught) {
      setError(humanError(caught))
    } finally {
      setPending(false)
    }
  }

  const changeMode = (next: Mode) => {
    setMode(next)
    setError('')
    setConfirmation('')
  }

  return (
    <main className="auth-page">
      <svg className="auth-orbits" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="auth-orbit-color" x1="0" y1="1" x2="1" y2="0">
            <stop stopColor="var(--lime)" stopOpacity=".5" />
            <stop offset=".5" stopColor="var(--violet)" stopOpacity=".26" />
            <stop offset="1" stopColor="var(--violet)" stopOpacity=".68" />
          </linearGradient>
        </defs>
        <g transform="rotate(-28 920 468)" fill="none" stroke="url(#auth-orbit-color)">
          <ellipse cx="920" cy="468" rx="435" ry="217" />
          <ellipse cx="920" cy="468" rx="490" ry="270" />
          <ellipse cx="920" cy="468" rx="555" ry="331" />
          <ellipse cx="920" cy="468" rx="625" ry="398" />
          <circle cx="430" cy="468" r="4" fill="var(--lime)" />
          <circle cx="920" cy="137" r="4" fill="var(--violet)" />
          <circle cx="920" cy="738" r="3" fill="var(--violet)" />
        </g>
      </svg>
      <button className="auth-theme-toggle icon-button" type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'} title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
      <section className="auth-story">
        <header><Brand /></header>
        <div className="auth-story__copy">
          <span className="auth-pill"><i /> Голос. Текст. Свои люди.</span>
          <h1>Место, где<br />разговоры <em>живут.</em></h1>
          <p>Без шума и лишнего. Только ваши комнаты, сообщения и люди, с которыми хочется оставаться на связи.</p>
        </div>
        <div className="auth-preview" aria-hidden="true">
          <div className="auth-preview__rail"><span>V</span><i/><i/><i/></div>
          <div className="auth-preview__channels">
            <b>Design room</b><small>ТЕКСТОВЫЕ КАНАЛЫ</small><span># general</span><span># inspiration</span><small>ГОЛОСОВЫЕ КАНАЛЫ</small><span>◖ coffee break</span>
          </div>
          <div className="auth-preview__chat">
            <div><i className="dot dot--lime"/><p><b>mira</b><small>12:42</small><br/>Собираемся через пять?</p></div>
            <div><i className="dot dot--violet"/><p><b>niko</b><small>12:43</small><br/>Уже здесь. Заходите в coffee break</p></div>
            <span className="typing">mira печатает<span>•••</span></span>
          </div>
        </div>
        <footer><span>© 2026 Voxhold</span><span>Приватность по умолчанию</span></footer>
      </section>

      <section className="auth-form-wrap">
        <div className="auth-form-card">
          <div className="auth-mobile-brand"><Brand /></div>
          <div className="auth-form-heading">
            <span className="eyebrow">{invite ? `ПРИГЛАШЕНИЕ В ${invite.server_name}` : 'ДОБРО ПОЖАЛОВАТЬ'}</span>
            <h2>{mode === 'login' ? 'С возвращением' : 'Создайте аккаунт'}</h2>
            <p>{invite
              ? (mode === 'login' ? `Войдите и присоединитесь к серверу ${invite.server_name}.` : `@${invite.creator_username} приглашает вас создать аккаунт.`)
              : 'Войдите в существующий аккаунт Voxhold.'}</p>
          </div>

          {registrationAllowed && <div className="auth-tabs" role="tablist" aria-label="Авторизация">
            <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => changeMode('login')}>Вход</button>
            <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'is-active' : ''} onClick={() => changeMode('register')}>Регистрация</button>
          </div>}

          <form onSubmit={submit} className="auth-form">
            <label>
              <span>Имя пользователя</span>
              <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="например, neva" minLength={3} maxLength={32} required autoFocus />
              {mode !== 'login' && <small>3–32 символа: буквы, цифры, пробел, «_», «.», «-». Регистр не важен: «Admin» и «admin» — одно имя.</small>}
            </label>
            <label>
              <span>Пароль</span>
              <input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Минимум 8 символов" minLength={8} maxLength={72} required />
            </label>
            {mode === 'register' && (
              <label>
                <span>Повторите пароль</span>
                <input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Ещё раз, для верности" minLength={8} maxLength={72} required />
              </label>
            )}
            {error && <div className="form-error" role="alert"><Icon name="close" size={15}/>{error}</div>}
            <button className="button button--primary button--large" type="submit" disabled={pending}>
              {pending ? <span className="spinner" /> : <>{mode === 'login' ? 'Войти в Voxhold' : 'Создать аккаунт'}<Icon name="chevron" /></>}
            </button>
          </form>
          <p className="auth-terms">Продолжая, вы принимаете правила сообщества и политику конфиденциальности.</p>
        </div>
      </section>
    </main>
  )
}
