import { useEffect, useRef, useState } from 'react'
import type { Exercise, Response } from '../../exercises/generate'
import type { DisplayScheme } from '../../music/display'
import { degreeLabel, labelFor, patternLabel, showsSingTargets } from '../labels'
import { tapWindowEndCtxSec, tapsRelativeToContent, type TapClock } from '../tapTiming'
import { ChoiceControl } from './ChoiceControl'
import type { SingMic } from '../singMic'
import { PitchControl } from './PitchControl'
import { SequenceControl } from './SequenceControl'
import { SingDetectControl } from './SingDetectControl'
import { TapControl } from './TapControl'

export interface AnswerClock {
  /** AudioContext.currentTime */
  now(): number
  latencySec: number
}

export interface AnswerAreaProps {
  exercise: Exercise
  scheme: DisplayScheme
  phase: 'presenting' | 'answering' | 'other'
  playback: { startSec: number; contentStartSec: number } | null
  clock: AnswerClock
  schedule: (seconds: number, fn: () => void) => () => void
  onPlayTarget: () => void
  onResponse: (r: Response) => void
  sing?: { mode: 'detect' | 'self'; mic: SingMic | null }
}

export function AnswerArea(props: AnswerAreaProps) {
  const { exercise, scheme, phase } = props
  const ctx = { scheme, mode: exercise.resolved.key.mode, prompt: exercise.prompt }
  const label = (id: string) => labelFor(id, ctx)
  const answering = phase === 'answering'
  const f = exercise.format

  switch (f.kind) {
    case 'choice':
      return <ChoiceControl ids={f.options.map((o) => o.id)} label={label} enabled={answering} onAnswer={(id) => props.onResponse({ kind: 'choice', id })} />
    case 'sequence':
      return <SequenceControl length={f.length} alphabet={f.alphabet.map((o) => o.id)} label={label} enabled={answering} onSubmit={(ids) => props.onResponse({ kind: 'sequence', ids })} />
    case 'pitch': {
      const text = showsSingTargets(exercise.prompt) ? f.targets.map((t) => degreeLabel(t.degree, scheme, ctx.mode)).join(' ') : null
      if (props.sing?.mode === 'detect' && props.sing.mic) {
        return (
          <SingDetectControl
            targetsText={text}
            targetCount={f.targets.length}
            enabled={answering}
            mic={props.sing.mic}
            schedule={props.schedule}
            onPlayTarget={props.onPlayTarget}
            onResponse={props.onResponse}
          />
        )
      }
      return <PitchControl targetsText={text} enabled={answering} onPlayTarget={props.onPlayTarget} onAssess={(ok) => props.onResponse({ kind: 'pitch', selfAssessedCorrect: ok })} />
    }
    case 'tap':
      return <TapArea {...props} windowSec={f.windowSec} patternText={f.patternIds ? f.patternIds.map(patternLabel).join('  ') : null} />
  }
}

function TapArea(props: AnswerAreaProps & { windowSec: number; patternText: string | null }) {
  const taps = useRef<number[]>([])
  const submitted = useRef(false)
  const [count, setCount] = useState(0)
  const [windowOver, setWindowOver] = useState(false)
  const [done, setDone] = useState(false)
  const { playback, clock, schedule, windowSec, phase, onResponse } = props
  const startSec = playback?.startSec
  const contentStartSec = playback?.contentStartSec

  // 窗口结束定时（P-3 spec §6.5）。播放信息变了就重新计时，不沿用上一份播放算出的“已结束”
  useEffect(() => {
    setWindowOver(false)
    if (startSec === undefined || contentStartSec === undefined) return
    const end = tapWindowEndCtxSec({ playStartSec: startSec, contentStartSec, latencySec: clock.latencySec }, windowSec)
    return schedule(Math.max(0, end - clock.now()), () => setWindowOver(true))
  }, [startSec, contentStartSec, windowSec, clock, schedule])

  // 窗口已过且进入 answering：提交一次（窗口结束之后的点击不计入）
  useEffect(() => {
    if (!windowOver || phase !== 'answering' || submitted.current) return
    if (startSec === undefined || contentStartSec === undefined) return
    submitted.current = true
    setDone(true)
    const tc: TapClock = { playStartSec: startSec, contentStartSec, latencySec: clock.latencySec }
    const end = tapWindowEndCtxSec(tc, windowSec)
    onResponse({ kind: 'tap', tapsSec: tapsRelativeToContent(taps.current.filter((t) => t <= end), tc) })
  }, [windowOver, phase, startSec, contentStartSec, windowSec, clock, onResponse])

  const collecting = (phase === 'presenting' || phase === 'answering') && !done
  return (
    <TapControl
      patternText={props.patternText}
      enabled={collecting}
      tapCount={count}
      onTap={() => { taps.current.push(clock.now()); setCount((n) => n + 1) }}
    />
  )
}
