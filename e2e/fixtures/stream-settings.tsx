import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { StreamSettingsDialog } from '../../src/components/StreamSettingsDialog'
import { loadStreamPreferences, saveStreamPreferences } from '../../src/services/streamSettings'
import { ThemeProvider } from '../../src/theme/ThemeContext'
import '../../src/styles/global.css'

function Fixture() {
  const [preferences, setPreferences] = useState(loadStreamPreferences)
  const [open, setOpen] = useState(true), [started, setStarted] = useState(0)
  return <ThemeProvider><button onClick={() => setOpen(true)}>Открыть настройки трансляции</button><output aria-label="Битрейт для трансляции">{started}</output>
    <StreamSettingsDialog open={open} busy={false} preferences={preferences} onChange={(next) => { setPreferences(next); saveStreamPreferences(next) }} onClose={() => setOpen(false)} onStart={() => { setStarted(preferences.videoBitrateKbps); setOpen(false) }}/>
  </ThemeProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture/> )
