import type { BossGrade } from '../boss/grade'
import type { BossChallenge, BossResponse, PartId } from '../boss/types'
import type { DisplayScheme } from '../music/display'
import { labelFor, type LabelContext } from './labels'

const PART_NAME: Record<PartId, string> = { melody: '旋律', chords: '和弦', rhythm: '节奏', meter: '拍号', newTonic: '新调主音' }
const PROMPT: Record<'melody' | 'chords' | 'rhythm', LabelContext['prompt']> = { melody: 'notate-melody', chords: 'notate-chords', rhythm: 'notate-patterns' }

function Row(props: { scheme: DisplayScheme; prompt: LabelContext['prompt']; mine: string[]; right: string[]; marks: boolean[] }) {
  const lab = (id: string | undefined) => (id ? labelFor(id, { scheme: props.scheme, mode: 'major', prompt: props.prompt }) : '—')
  return (
    <div className="scale-bar">
      {props.right.map((r, i) => (
        <span key={i} className="scale-cell" data-mark={props.marks[i] ? 'correct' : 'chosen'} title={`正确：${lab(r)}`}>
          {lab(props.mine[i])}
          {!props.marks[i] && <small>（{lab(r)}）</small>}
        </span>
      ))}
    </div>
  )
}

export function BossResult(props: { challenge: BossChallenge; response: BossResponse; grade: BossGrade; scheme: DisplayScheme }) {
  const { challenge: ch, response: r, grade: g, scheme } = props
  return (
    <section className="boss-result">
      <ul>
        {ch.parts.map((p) => (
          <li key={p}>
            {PART_NAME[p]}：{Math.round((g.parts[p] ?? 0) * 100)}%
          </li>
        ))}
      </ul>
      {ch.phrases.map((ph, i) => (
        <div key={i} className="phrase-review">
          <p>第 {i + 1} 句</p>
          <Row scheme={scheme} prompt={PROMPT.melody} mine={r.melody[i] ?? []} right={ch.answer.melody[i]} marks={g.marks.melody[i]} />
          {ch.answer.chords && g.marks.chords && (
            <Row scheme={scheme} prompt={PROMPT.chords} mine={(r.chords ?? []).slice(ph.startBar, ph.endBar)} right={ch.answer.chords.slice(ph.startBar, ph.endBar)} marks={g.marks.chords.slice(ph.startBar, ph.endBar)} />
          )}
          {ch.answer.rhythm && g.marks.rhythm && (
            <Row scheme={scheme} prompt={PROMPT.rhythm} mine={(r.rhythm ?? []).slice(ph.startBar, ph.endBar)} right={ch.answer.rhythm.slice(ph.startBar, ph.endBar)} marks={g.marks.rhythm.slice(ph.startBar, ph.endBar)} />
          )}
        </div>
      ))}
    </section>
  )
}
