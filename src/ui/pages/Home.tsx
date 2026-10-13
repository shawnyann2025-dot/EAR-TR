import { useCallback, useEffect, useRef, useState } from 'react'
import { buildCurriculum } from '../../curriculum/curriculum'
import { useRuntime, useSnapshot } from '../RuntimeContext'

const curriculum = buildCurriculum()
type Status = 'notStarted' | 'inProgress' | 'mainDone'

export function Home(props: { onOpenSettings: () => void }) {
  const { runtime, audio } = useRuntime()
  const snap = useSnapshot()
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)

  const aliveRef = useRef(true)
  const refresh = useCallback(async () => {
    try {
      const s = await runtime.todayStatus()
      if (aliveRef.current) setStatus(s)
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : String(e))
    }
  }, [runtime])

  useEffect(() => {
    aliveRef.current = true
    void refresh()
    return () => {
      aliveRef.current = false
    }
  }, [refresh, snap.session])

  // 页面隔夜不关：回到前台时重新取今日状态
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

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
    await refresh()
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
