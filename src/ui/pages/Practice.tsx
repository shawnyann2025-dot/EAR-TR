import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Response } from '../../exercises/generate'
import type { AnswerClock } from '../controls/AnswerArea'
import { AnswerArea } from '../controls/AnswerArea'
import { CORRECT_ADVANCE_MS, FeedbackPanel } from '../FeedbackPanel'
import { useInterruptions, useWakeLock } from '../mobile'
import { PROMPT_TEXT } from '../labels'
import { useRuntime, useSnapshot } from '../RuntimeContext'

const schedule = (seconds: number, fn: () => void) => {
  const id = setTimeout(fn, seconds * 1000)
  return () => clearTimeout(id)
}

/** 两步确认：首次点击变为「确定结束本场？」，4 秒内再点才结束 */
const END_CONFIRM_MS = 4000
function EndSessionButton(props: { onEnd: () => void }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return (
    <button
      type="button"
      className={armed ? 'danger' : undefined}
      onClick={() => {
        if (!armed) {
          setArmed(true)
          timer.current = setTimeout(() => setArmed(false), END_CONFIRM_MS)
          return
        }
        if (timer.current) clearTimeout(timer.current)
        setArmed(false)
        props.onEnd()
      }}
    >
      {armed ? '确定结束本场？' : '结束本场'}
    </button>
  )
}

export function Practice() {
  const { runtime, audio, mic } = useRuntime()
  const snap = useSnapshot()
  const session = snap.session!
  const cur = session.current
  const scheme = snap.profile?.displayScheme ?? 'solfege'
  const [lastResponse, setLastResponse] = useState<Response | null>(null)
  const [error, setError] = useState<string | null>(null)
  const answeringSince = useRef(0)
  // 错误只在出错的那道题上显示：换题时清掉本地错误，并记下当时的 runtime 错误作为基线
  const itemKey = cur ? `${session.day}:${session.sessionNo}:${cur.planIndex}` : ''
  const lastErrorAtItemStart = useRef(snap.lastError)
  useEffect(() => {
    lastErrorAtItemStart.current = snap.lastError
    setError(null)
  }, [itemKey])
  const runtimeError = snap.lastError !== lastErrorAtItemStart.current ? snap.lastError : null
  const phaseRef = useRef(session.phase)
  phaseRef.current = session.phase
  // 本场结束或离开练习页：释放麦克风
  useEffect(() => () => mic.close(), [mic])
  const endEarly = () => { audio.stopAll(); void runtime.dispatch({ type: 'endEarly' }) }
  const clock = useMemo<AnswerClock>(() => ({ now: () => audio.currentTime, get latencySec() { return audio.latencySec } }), [audio])

  const singMode = snap.profile?.singMode ?? 'detect'
  const sing = useMemo(() => ({ mode: singMode, mic }), [singMode, mic])

  const live = session.phase === 'presenting' || session.phase === 'answering'
  useWakeLock(live || session.phase === 'feedback')
  useInterruptions({ active: live, audio, onInterrupt: () => void runtime.dispatch({ type: 'interrupted' }) })

  useEffect(() => {
    if (session.phase === 'answering') answeringSince.current = audio.currentTime
  }, [session.phase, audio])

  // 答对：短暂确认后自动下一题；答错：自动播放反馈重放（主 spec §6.4）
  const grade = session.lastGrade
  useEffect(() => {
    if (session.phase !== 'feedback' || !grade || !cur) return
    if (grade.correct) {
      const id = setTimeout(() => {
        // 页面已隐藏：不自动进入下一题，回来后由用户点「下一题」
        if (document.visibilityState === 'hidden') return
        void (async () => {
          try { await audio.unlock() } catch { /* 自动前进时忽略 */ }
          await runtime.dispatch({ type: 'next' })
        })()
      }, CORRECT_ADVANCE_MS)
      return () => clearTimeout(id)
    }
    try {
      audio.stopAll()
      audio.play(cur.exercise.feedback.replay)
    } catch {
      // 音频未就绪时忽略
    }
  }, [session.phase, grade, cur, runtime, audio])

  const respond = useCallback(
    (r: Response) => {
      if (phaseRef.current !== 'answering') return
      phaseRef.current = 'feedback'
      setLastResponse(r)
      const latencyMs = Math.max(0, (audio.currentTime - answeringSince.current) * 1000)
      void runtime.dispatch({ type: 'answer', response: r, latencyMs })
    },
    [audio, runtime],
  )

  const playTarget = useCallback(() => {
    if (!cur) return
    audio.stopAll()
    audio.play(cur.exercise.feedback.replay)
  }, [audio, cur])

  if (session.phase === 'idle') {
    return (
      <main className="page practice">
        <div className="overlay">
          <p>练习暂停了。</p>
          {error && <p className="error">{error}</p>}
          <button
            type="button"
            className="primary big"
            onClick={async () => {
              try {
                await audio.unlock()
                await runtime.dispatch({ type: 'start' })
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            继续
          </button>
          <div className="overlay-end"><EndSessionButton onEnd={endEarly} /></div>
        </div>
      </main>
    )
  }
  if (!cur) return <main className="page practice" />

  const ex = cur.exercise
  const total = session.plan.items.length
  const phase = session.phase === 'presenting' || session.phase === 'answering' ? session.phase : 'other'

  return (
    <main className="page practice">
      <header className="topbar">
        <span>第 {cur.planIndex + 1} / {total} 题</span>
        <EndSessionButton onEnd={endEarly} />
      </header>
      {(error || runtimeError) && <p className="error small">{error ?? runtimeError}</p>}
      <section className="prompt">
        <p className="prompt-text">{PROMPT_TEXT[ex.prompt]}</p>
        {ex.format.kind !== 'tap' && (
          <button
            type="button"
            disabled={session.phase !== 'answering'}
            onClick={() => {
              audio.stopAll()
              audio.play(ex.plan, { cutContextAtSec: ex.contentStartSec })
            }}
          >
            重听
          </button>
        )}
      </section>
      <section className="answer-zone">
        {session.phase === 'feedback' && grade ? (
          <FeedbackPanel
            exercise={ex}
            grade={grade}
            response={lastResponse}
            scheme={scheme}
            onReplay={() => { audio.stopAll(); audio.play(ex.feedback.replay) }}
            onSlow={() => { audio.stopAll(); audio.play(ex.feedback.slow) }}
            onNext={async () => {
              try {
                await audio.unlock()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
                return
              }
              setError(null)
              await runtime.dispatch({ type: 'next' })
            }}
          />
        ) : (
          <AnswerArea
            key={`${session.day}:${session.sessionNo}:${cur.planIndex}:${ex.spec.seed}`}
            exercise={ex}
            scheme={scheme}
            phase={phase}
            playback={snap.playback}
            clock={clock}
            schedule={schedule}
            onPlayTarget={playTarget}
            onResponse={respond}
            sing={sing}
          />
        )}
      </section>
    </main>
  )
}
