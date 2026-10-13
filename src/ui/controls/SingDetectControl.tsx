import { useEffect, useRef, useState } from 'react'
import type { Response } from '../../exercises/generate'
import { SING_HINT, captureTimeoutSec, type SingMic } from '../singMic'
import { PitchControl } from './PitchControl'

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
  const [failed, setFailed] = useState(false)
  const [done, setDone] = useState(false)
  /** 本题已提交（或已开始提交）；跨 StrictMode 重挂保持 */
  const finished = useRef(false)
  /** 组件仍挂载。只用于丢弃卸载后的 stop 结果；enabled 变 false 不算卸载 */
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const finish = useRef<() => void>(() => {})
  finish.current = () => {
    if (finished.current) return
    finished.current = true
    setDone(true)
    mic.stop().then(
      (segs) => { if (alive.current) onResponse({ kind: 'pitch', sungHz: segs.map((s) => s.medianHz) }) },
      () => { if (alive.current) setFailed(true) },
    )
  }

  useEffect(() => {
    if (!enabled || finished.current) return
    // 以下状态属于“这一次 effect 运行”：StrictMode 的上一轮迟到的 start 失败不能影响下一轮
    let cancelled = false
    let listening = true
    let count = 0
    setHeard(0)
    mic
      .start(() => {
        if (cancelled) return
        count++
        setHeard(count)
        if (count >= targetCount) finish.current()
      })
      .catch(() => {
        if (cancelled) return
        listening = false
        setFailed(true)
      })
    const off = schedule(captureTimeoutSec(targetCount), () => { if (!cancelled) finish.current() })
    return () => {
      cancelled = true
      off()
      if (listening && !finished.current) {
        listening = false
        void mic.stop().catch(() => {})
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
      <p>{enabled ? `正在听… 已听到 ${heard} / ${targetCount} 个音` : '听完语境后开始唱'}</p>
      <button type="button" className="primary" disabled={!enabled || done} onClick={() => finish.current()}>唱完了</button>
    </div>
  )
}
