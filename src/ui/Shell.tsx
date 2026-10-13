import { useEffect, useState } from 'react'
import type { SessionState } from '../session/types'
import { Home } from './pages/Home'
import { Practice } from './pages/Practice'
import { Settings } from './pages/Settings'
import { Summary } from './pages/Summary'
import { useRuntime, useSnapshot } from './RuntimeContext'

export function Shell(props: { storageWarning: string | null }) {
  const { runtime } = useRuntime()
  const snap = useSnapshot()
  const [settings, setSettings] = useState(false)
  const [dismissed, setDismissed] = useState<SessionState | null>(null)

  useEffect(() => {
    void runtime.ensureProfile()
  }, [runtime])

  const s = snap.session
  let page
  if (!snap.profile) page = <main className="page">加载中…</main>
  else if (settings) page = <Settings onBack={() => setSettings(false)} />
  else if (s && s.phase !== 'done') page = <Practice />
  else if (s && s.phase === 'done' && dismissed !== s) page = <Summary onHome={() => setDismissed(s)} />
  else page = <Home onOpenSettings={() => setSettings(true)} />

  return (
    <>
      {props.storageWarning && <div className="banner warn">{props.storageWarning}</div>}
      {snap.storageError && <div className="banner warn">{snap.storageError}</div>}
      {page}
    </>
  )
}
