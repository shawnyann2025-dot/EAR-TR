import { useEffect, useRef, useState } from 'react'
import type { Response } from '../../exercises/generate'
import { SING_HINT, captureTimeoutSec, type SingMic } from '../singMic'
import { PitchControl } from './PitchControl'

/** stop() 超过这个秒数仍未落定：本题改为自评 */
export const STOP_WATCHDOG_SEC = 3
/** start() 超过这个秒数仍未落定（含打开与校准 CALIBRATE_SEC = 3，再加 5 秒余量）：本题改为自评 */
export const START_WATCHDOG_SEC = 8

export function SingDetectControl(props: {
  targetsText: string | null
  targetCount: number
  enabled: boolean
  mic: SingMic
  schedule: (seconds: number, fn: () => void) => () => void
  onPlayTarget: () => void
  onResponse: (r: Response) => void
}) {
  const { enabled, mic, schedule, targetCount, onResponse } = props
  const [heard, setHeard] = useState(0)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [done, setDone] = useState(false)
  /** 本题已提交（或已开始提交）；跨 StrictMode 重挂保持 */
  const finished = useRef(false)
  /** 已改为自评；此后不再提交检测结果 */
  const failedRef = useRef(false)
  /** 组件仍挂载。只用于丢弃卸载后的 stop 结果；enabled 变 false 不算卸载 */
  const alive = useRef(true)
  /** 当前这一轮的 start 落定 promise（resolve 成功与否） */
  const startP = useRef<Promise<boolean> | null>(null)
  /** 上一轮 cleanup 的 stop 已发出（不等其落定）；下一轮 start 要等它，免得 stop 排在新一轮 start 之后 */
  const stopGate = useRef<Promise<void>>(Promise.resolve())
  const cancelTimer = useRef<() => void>(() => {})

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const fail = useRef<() => void>(() => {})
  fail.current = () => {
    if (failedRef.current) return
    failedRef.current = true
    cancelTimer.current()
    setFailed(true)
  }

  const finish = useRef<() => void>(() => {})
  finish.current = () => {
    if (finished.current || failedRef.current) return
    finished.current = true
    cancelTimer.current()
    setDone(true)
    const sp = startP.current ?? Promise.resolve(true)
    let settled = false
    const stopWatchdog = schedule(STOP_WATCHDOG_SEC, () => {
      if (settled) return
      settled = true
      if (alive.current) fail.current()
    })
    void sp.then((ok) => {
      if (!ok) { settled = true; stopWatchdog(); return }
      return mic.stop().then(
        (segs) => {
          if (settled) return
          settled = true
          stopWatchdog()
          if (alive.current && !failedRef.current) onResponse({ kind: 'pitch', sungHz: segs.map((s) => s.medianHz) })
        },
        () => {
          if (settled) return
          settled = true
          stopWatchdog()
          if (alive.current) fail.current()
        },
      )
    })
  }

  useEffect(() => {
    if (!enabled || finished.current || failedRef.current) return
    // 以下状态属于“这一次 effect 运行”：StrictMode 的上一轮不能影响下一轮
    let cancelled = false
    let count = 0
    let startSettled = false
    let timedOut = false
    setHeard(0)
    setReady(false)
    const p = stopGate.current.then(() =>
      mic.start(() => {
        if (cancelled) return
        count++
        setHeard(count)
        if (count >= targetCount) finish.current()
      }),
    ).then(() => true, () => false)
    startP.current = p
    const cancelStartWatchdog = schedule(START_WATCHDOG_SEC, () => {
      if (cancelled || startSettled) return
      timedOut = true
      fail.current()
    })
    void p.then((ok) => {
      startSettled = true
      cancelStartWatchdog()
      // 迟到的 start：看门狗已让本题改为自评，把刚开始的收音停掉，结果忽略
      if (timedOut && ok) void mic.stop().catch(() => {})
    })
    void p.then((ok) => {
      if (cancelled || timedOut) return
      if (!ok) { fail.current(); return }
      setReady(true)
      // 超时从真正开始收音起算
      cancelTimer.current = schedule(captureTimeoutSec(targetCount), () => { if (!cancelled) finish.current() })
    })
    return () => {
      cancelled = true
      cancelStartWatchdog()
      cancelTimer.current()
      cancelTimer.current = () => {}
      if (!finished.current) {
        // start 落定之后才可 stop；失败则无需 stop；看门狗超时的那一轮已由迟到处理停过。只等 stop 发出，不等其落定
        stopGate.current = p.then((ok) => { if (ok && !timedOut) void mic.stop().catch(() => {}) })
      }
    }
  }, [enabled, mic, schedule, targetCount])

  if (failed) {
    return (
      <div>
        <p className="error small">收音出错，本题改为自评</p>
        <PitchControl
          targetsText={props.targetsText}
          enabled={enabled}
          onPlayTarget={props.onPlayTarget}
          onAssess={(ok) => onResponse({ kind: 'pitch', selfAssessedCorrect: ok })}
        />
      </div>
    )
  }

  return (
    <div className="pitch detect">
      <p className="hint">{SING_HINT}</p>
      {props.targetsText && <p className="targets">{props.targetsText}</p>}
      <p>{!enabled ? '听完语境后开始唱' : ready ? `正在听… 已听到 ${heard} / ${targetCount} 个音` : '准备收音…'}</p>
      <button type="button" className="primary" disabled={!enabled || !ready || done} onClick={() => finish.current()}>唱完了</button>
    </div>
  )
}
