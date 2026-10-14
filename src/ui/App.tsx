import { useEffect, useState } from 'react'
import { DevHarness } from './DevHarness'
import { StorageProblem } from './pages/StorageProblem'
import { requestPersistence } from './persistence'
import { NO_UPDATES, UpdateProvider, type UpdatePort } from './pwa'
import { boot, type BootResult } from './platform'
import { RuntimeProvider } from './RuntimeContext'
import { Shell } from './Shell'

const isDev = () => location.hash === '#dev'

export function App(props: { updates?: UpdatePort }) {
  const [result, setResult] = useState<BootResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isDev()) return
    boot().then(setResult, (e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => {
    if (result?.kind === 'ready') void requestPersistence()
  }, [result])

  if (isDev()) return <DevHarness />
  if (error) return <main className="page"><p className="error">启动失败：{error}</p></main>
  if (!result) return <main className="page">加载中…</main>
  if (result.kind === 'corrupt') return <StorageProblem result={result} onRebuilt={setResult} />
  return (
    <UpdateProvider port={props.updates ?? NO_UPDATES}>
      <RuntimeProvider runtime={result.runtime} audio={result.audio} mic={result.mic}>
        <Shell storageWarning={result.storageWarning} />
      </RuntimeProvider>
    </UpdateProvider>
  )
}
