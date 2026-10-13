import type { Exercise, GradeResult, Response } from '../exercises/generate'
import type { DisplayScheme } from '../music/display'
import { DEGREE_SEMITONES, SCALE_DEGREES, type Mode, type ScaleDegree } from '../music/key'
import { degreeLabel, labelFor } from './labels'

/** 答对后自动进入下一题的延迟（主 spec §6.4：不打断节奏） */
export const CORRECT_ADVANCE_MS = 700

const isDegree = (id: string): id is ScaleDegree => (SCALE_DEGREES as readonly string[]).includes(id)

export function ScaleBar(props: { degrees: string[]; chosen: string | null; correct: string; scheme: DisplayScheme; mode: Mode }) {
  const sorted = props.degrees.filter(isDegree).sort((a, b) => DEGREE_SEMITONES[a] - DEGREE_SEMITONES[b])
  return (
    <div className="scale-bar" aria-label="音阶条">
      {sorted.map((d) => {
        const isChosen = d === props.chosen
        const isCorrect = d === props.correct
        const mark = isChosen && isCorrect ? 'both' : isChosen ? 'chosen' : isCorrect ? 'correct' : undefined
        return (
          <span key={d} className="scale-cell" data-mark={mark}>
            {degreeLabel(d, props.scheme, props.mode)}
          </span>
        )
      })}
    </div>
  )
}

function answerText(ex: Exercise, scheme: DisplayScheme): string {
  const ctx = { scheme, mode: ex.resolved.key.mode, prompt: ex.prompt }
  switch (ex.answer.kind) {
    case 'choice':
      return labelFor(ex.answer.id, ctx)
    case 'sequence':
      return ex.answer.ids.map((id) => labelFor(id, ctx)).join('  ')
    case 'tap':
      return '节奏没对上'
    case 'pitch':
      return ''
  }
}

export function FeedbackPanel(props: {
  exercise: Exercise
  grade: GradeResult
  response: Response | null
  scheme: DisplayScheme
  onSlow: () => void
  onReplay: () => void
  onNext: () => void
}) {
  const { exercise: ex, grade } = props
  if (grade.correct) {
    return (
      <div className="feedback ok">
        <p>答对了</p>
        <button type="button" onClick={props.onNext}>下一题</button>
      </div>
    )
  }
  const chosen = props.response?.kind === 'choice' ? props.response.id : null
  const bar =
    ex.spec.track === 'T' && ex.format.kind === 'choice' && ex.answer.kind === 'choice' && isDegree(ex.answer.id)
      ? { degrees: ex.format.options.map((o) => o.id), correct: ex.answer.id }
      : null
  return (
    <div className="feedback wrong">
      <p>{ex.answer.kind === 'pitch' ? '再听一遍目标音，对照自己唱的' : `正确答案：${answerText(ex, props.scheme)}`}</p>
      {bar && <ScaleBar degrees={bar.degrees} chosen={chosen} correct={bar.correct} scheme={props.scheme} mode={ex.resolved.key.mode} />}
      <div className="row">
        <button type="button" onClick={props.onReplay}>再听一遍</button>
        <button type="button" onClick={props.onSlow}>慢速再听</button>
        <button type="button" className="primary" onClick={props.onNext}>下一题</button>
      </div>
    </div>
  )
}
