import { useEffect, useState } from 'react'
import { buildCurriculum } from '../../curriculum/curriculum'
import { useRuntime, useSnapshot } from '../RuntimeContext'

const curriculum = buildCurriculum()
type Status = 'notStarted' | 'inProgress' | 'mainDone'

export function Home(props: { onOpenSettings: () => void }) {
  const { runtime, audio } = useRuntime()
  const snap = useSnapshot()
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void runtime.todayStatus().then((s) => {
      if (alive) setStatus(s)
    })
    return () => {
      alive = false
    }
  }, [runtime, snap.session])

  const phaseId = snap.profile?.phaseId
  const phaseLabel = curriculum.phases.find((p) => p.id === phaseId)?.label ?? ''

  async function go(extra: boolean) {
    try {
      await audio.unlock()
      if (extra) await runtime.startExtra()
      else await runtime.startToday()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <main className="page home">
      <header className="topbar">
        <span>{phaseId} · {phaseLabel}</span>
        <button type="button" onClick={props.onOpenSettings}>设置</button>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="home-actions">
        {status === 'notStarted' && <button type="button" className="primary big" onClick={() => void go(false)}>开始今天的练习</button>}
        {status === 'inProgress' && <button type="button" className="primary big" onClick={() => void go(false)}>继续今天的练习</button>}
        {status === 'mainDone' && (
          <>
            <p>今天的主线已经练完。</p>
            <button type="button" className="primary big" onClick={() => void go(true)}>再练一场</button>
          </>
        )}
      </div>
    </main>
  )
}
