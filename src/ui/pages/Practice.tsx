import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Response } from '../../exercises/generate'
import type { AnswerClock } from '../controls/AnswerArea'
import { AnswerArea } from '../controls/AnswerArea'
import { CORRECT_ADVANCE_MS, FeedbackPanel } from '../FeedbackPanel'
import { PROMPT_TEXT } from '../labels'
import { useRuntime, useSnapshot } from '../RuntimeContext'

const schedule = (seconds: number, fn: () => void) => {
  const id = setTimeout(fn, seconds * 1000)
  return () => clearTimeout(id)
}

export function Practice() {
  const { runtime, audio } = useRuntime()
  const snap = useSnapshot()
  const session = snap.session!
  const cur = session.current
  const scheme = snap.profile?.displayScheme ?? 'solfege'
  const [lastResponse, setLastResponse] = useState<Response | null>(null)
  const [error, setError] = useState<string | null>(null)
  const answeringSince = useRef(0)
  const clock = useMemo<AnswerClock>(() => ({ now: () => audio.currentTime, get latencySec() { return audio.latencySec } }), [audio])

  useEffect(() => {
    if (session.phase === 'answering') answeringSince.current = audio.currentTime
  }, [session.phase, audio])

  // 答对：短暂确认后自动下一题；答错：自动播放反馈重放（主 spec §6.4）
  const grade = session.lastGrade
  useEffect(() => {
    if (session.phase !== 'feedback' || !grade || !cur) return
    if (grade.correct) {
      const id = setTimeout(() => void runtime.dispatch({ type: 'next' }), CORRECT_ADVANCE_MS)
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
        <button type="button" onClick={() => void runtime.dispatch({ type: 'endEarly' })}>结束本场</button>
      </header>
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
            onNext={() => void runtime.dispatch({ type: 'next' })}
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
          />
        )}
      </section>
    </main>
  )
}
