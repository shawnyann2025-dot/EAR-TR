import { useCallback, useMemo, useRef, useState } from 'react'
import { buildCurriculum } from '../../curriculum/curriculum'
import type { PhaseId } from '../../curriculum/stages'
import { generate, grade, type Exercise, type Response } from '../../exercises/generate'
import { initialPlacement, nextProbe, placementResult, recordProbe, type PlacementState } from '../../scheduling/placement'
import { AnswerArea, type AnswerClock } from '../controls/AnswerArea'
import { PROMPT_TEXT } from '../labels'
import { probeSeed, probeSpec } from '../placementProbe'
import { useRuntime, useSnapshot } from '../RuntimeContext'

const curriculum = buildCurriculum()

const schedule = (seconds: number, fn: () => void) => {
  const id = setTimeout(fn, seconds * 1000)
  return () => clearTimeout(id)
}

type Step =
  | { kind: 'intro' }
  | { kind: 'probe'; state: PlacementState; exercise: Exercise; playback: { startSec: number; contentStartSec: number }; listening: boolean }
  | { kind: 'result'; phaseId: PhaseId }

export function Onboarding() {
  const { runtime, audio } = useRuntime()
  const snap = useSnapshot()
  const profileId = snap.profile!.id
  const scheme = snap.profile!.displayScheme
  const [step, setStep] = useState<Step>({ kind: 'intro' })
  const [error, setError] = useState<string | null>(null)
  const [retryState, setRetryState] = useState<PlacementState | null>(null)
  const busy = useRef(false)
  const clock = useMemo<AnswerClock>(() => ({ now: () => audio.currentTime, get latencySec() { return audio.latencySec } }), [audio])

  const present = useCallback(
    (state: PlacementState): Step => {
      const kp = nextProbe(state)
      if (!kp) return { kind: 'result', phaseId: placementResult(curriculum, state) }
      const exercise = generate(probeSpec(curriculum, kp, probeSeed(profileId, state.results.length)), curriculum)
      audio.stopAll()
      const { startSec } = audio.play(exercise.plan, { cutContextAtSec: exercise.contentStartSec })
      return { kind: 'probe', state, exercise, playback: { startSec, contentStartSec: exercise.contentStartSec }, listening: true }
    },
    [audio, profileId],
  )

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  // 展示下一状态；失败则留在当前屏，显示错误并记下待重试的状态
  const go = useCallback(
    (state: PlacementState) => {
      try {
        const next = present(state)
        if (next.kind === 'result') audio.stopAll()
        setStep(next)
        setError(null)
        setRetryState(null)
      } catch (e) {
        setError(msg(e))
        setRetryState(state)
      }
    },
    [present, audio],
  )

  const answer = useCallback(
    (r: Response) => {
      if (step.kind !== 'probe') return
      // 副作用（播放下一题）不放进 setState 的更新函数里：StrictMode 下更新函数可能执行两次
      go(recordProbe(step.state, grade(step.exercise, r).correct))
    },
    [go, step],
  )

  const playTarget = useCallback(() => {
    if (step.kind !== 'probe') return
    try {
      audio.stopAll()
      audio.play(step.exercise.feedback.replay)
    } catch (e) {
      setError(msg(e))
    }
  }, [audio, step])

  async function start() {
    if (busy.current) return
    busy.current = true
    try {
      await audio.unlock()
      go(initialPlacement(curriculum))
    } catch (e) {
      setError(msg(e))
    } finally {
      busy.current = false
    }
  }

  async function finish(phaseId: PhaseId) {
    try {
      await runtime.updateProfile({ phaseId, placement: { done: true, startPhase: phaseId } })
    } catch (e) {
      setError(msg(e))
    }
  }

  if (step.kind === 'intro') {
    return (
      <main className="page onboarding">
        <h1>欢迎</h1>
        <p>这套练习按三条线（音级、和声、节奏）循序渐进。每天约 25 分钟，完整走完通常需要 6–9 个月。</p>
        <p>建议戴耳机练习。</p>
        <p>先做一个约 5 分钟的分级测试，找到适合你的起点。</p>
        {error && <p className="error">{error}</p>}
        <button type="button" className="primary big" onClick={() => void start()}>开始分级测试</button>
        <button type="button" onClick={() => { setError(null); setStep({ kind: 'result', phaseId: 'P1' }) }}>跳过，从头开始</button>
      </main>
    )
  }

  if (step.kind === 'result') {
    const label = curriculum.phases.find((p) => p.id === step.phaseId)?.label ?? ''
    return (
      <main className="page onboarding">
        <h1>分级完成</h1>
        <p>从 {step.phaseId}（{label}）开始。</p>
        <p>音域测定将在后续版本加入。</p>
        {error && <p className="error">{error}</p>}
        <button
          type="button"
          className="primary big"
          onClick={() => void finish(step.phaseId)}
        >
          开始练习
        </button>
      </main>
    )
  }

  return (
    <main className="page practice">
      <header className="topbar"><span>分级测试 · 第 {step.state.results.length + 1} 题</span></header>
      <section className="prompt">
        <p className="prompt-text">{PROMPT_TEXT[step.exercise.prompt]}</p>
        {step.listening ? (
          <button type="button" onClick={() => setStep({ ...step, listening: false })}>我听完了</button>
        ) : (
          <button
            type="button"
            onClick={() => {
              try {
                audio.stopAll()
                audio.play(step.exercise.plan, { cutContextAtSec: step.exercise.contentStartSec })
              } catch (e) {
                setError(msg(e))
              }
            }}
          >
            重听
          </button>
        )}
      </section>
      {error && (
        <div>
          <p className="error">{error}</p>
          {retryState && <button type="button" onClick={() => go(retryState)}>重试</button>}
        </div>
      )}
      <section className="answer-zone">
        <AnswerArea
          key={step.state.results.length}
          exercise={step.exercise}
          scheme={scheme}
          phase={step.listening ? 'presenting' : 'answering'}
          playback={step.playback}
          clock={clock}
          schedule={schedule}
          onPlayTarget={playTarget}
          onResponse={answer}
        />
      </section>
    </main>
  )
}
