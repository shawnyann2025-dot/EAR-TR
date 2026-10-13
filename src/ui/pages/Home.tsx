import { useCallback, useEffect, useRef, useState } from 'react'
import { MicError } from '../../audio/micCapture'
import { buildCurriculum } from '../../curriculum/curriculum'
import { useRuntime, useSnapshot } from '../RuntimeContext'

const curriculum = buildCurriculum()
type Status = 'notStarted' | 'inProgress' | 'mainDone'

export function Home(props: { onOpenSettings: () => void }) {
  const { runtime, audio, mic, pushNotice } = useRuntime()
  const snap = useSnapshot()
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

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
      if ((snap.profile?.singMode ?? 'detect') === 'detect') {
        setBusy('请在弹窗中允许使用麦克风…')
        try {
          await mic.ensure({ onCalibrating: () => setBusy('请保持安静 3 秒，正在校准环境噪声…') })
        } catch (e) {
          if (e instanceof MicError && (e.reason === 'denied' || e.reason === 'unsupported')) {
            await runtime.updateProfile({ singMode: 'self', micFallbackReason: e.reason })
            pushNotice(e.reason === 'denied' ? '没有麦克风权限，唱题改为自评' : '此浏览器不支持收音，唱题改为自评')
          } else {
            pushNotice(`麦克风暂时不可用：${e instanceof Error ? e.message : String(e)}`)
          }
        } finally {
          setBusy(null)
        }
      }
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
      {busy && <p>{busy}</p>}
      <div className="home-actions">
        {status === 'notStarted' && <button type="button" className="primary big" disabled={busy !== null} onClick={() => void go(false)}>开始今天的练习</button>}
        {status === 'inProgress' && <button type="button" className="primary big" disabled={busy !== null} onClick={() => void go(false)}>继续今天的练习</button>}
        {status === 'mainDone' && (
          <>
            <p>今天的主线已经练完。</p>
            <button type="button" className="primary big" disabled={busy !== null} onClick={() => void go(true)}>再练一场</button>
          </>
        )}
      </div>
    </main>
  )
}
