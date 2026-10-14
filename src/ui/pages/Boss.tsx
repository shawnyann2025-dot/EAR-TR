import { useEffect, useMemo, useRef, useState } from 'react'
import { BOSS_PARTS } from '../../boss/generate'
import { gradeBoss, type BossGrade } from '../../boss/grade'
import { phrasePlan, renderPiece } from '../../boss/render'
import type { BossChallenge, BossResponse } from '../../boss/types'
import type { PhaseId } from '../../curriculum/stages'
import { BossResult, PART_NAME } from '../BossResult'
import { ChoiceControl } from '../controls/ChoiceControl'
import { SequenceControl } from '../controls/SequenceControl'
import { labelFor, type LabelContext } from '../labels'
import { useWakeLock } from '../mobile'
import { useRuntime, useSnapshot } from '../RuntimeContext'

export const FULL_REPLAYS = 3

type Step =
  | { kind: 'intro' }
  | { kind: 'listen' }
  | { kind: 'meter' }
  | { kind: 'phrase'; i: number }
  | { kind: 'newTonic' }
  | { kind: 'result'; grade: BossGrade; advancedTo: PhaseId | null; remaining: number }

export function Boss(props: { onExit: () => void }) {
  const { runtime, audio } = useRuntime()
  const scheme = useSnapshot().profile?.displayScheme ?? 'solfege'
  const lab = (prompt: LabelContext['prompt']) => (id: string) => labelFor(id, { scheme, mode: 'major', prompt })
  const [step, setStep] = useState<Step>({ kind: 'intro' })
  const [ch, setCh] = useState<BossChallenge | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [replays, setReplays] = useState(FULL_REPLAYS)
  const [resp, setResp] = useState<BossResponse>({ melody: [] })
  const [played, setPlayed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)
  const [phraseDone, setPhraseDone] = useState<Record<string, boolean>>({})
  const rendered = useMemo(() => (ch ? renderPiece(ch.piece) : null), [ch])
  const phaseId = useSnapshot().profile?.phaseId
  const active = step.kind !== 'intro' && step.kind !== 'result'
  useWakeLock(active)

  useEffect(() => {
    void runtime.bossStatus().then((s) => setRemaining(s.remainingToday), () => {})
    return () => audio.stopAll()
  }, [runtime, audio])

  const play = (plan: Parameters<typeof audio.play>[0]) => {
    audio.stopAll()
    audio.play(plan)
  }

  async function begin() {
    audio.stopAll()
    setError(null)
    try {
      await audio.unlock()
      const c = await runtime.newBossChallenge()
      setCh(c)
      setResp({ melody: c.phrases.map(() => []) })
      setPhraseDone({})
      setReplays(FULL_REPLAYS)
      setPlayed(false)
      setStep({ kind: 'listen' })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function submit(final: BossResponse) {
    if (!ch || inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    const grade = gradeBoss(ch, final)
    try {
      const r = await runtime.recordBossAttempt(ch, grade)
      const s = await runtime.bossStatus()
      setRemaining(s.remainingToday)
      audio.stopAll()
      setStep({ kind: 'result', grade, advancedTo: r.advancedTo, remaining: s.remainingToday })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  const errorLine = error && <p className="error">{error}</p>
  const afterPhrases = () => (ch!.parts.includes('newTonic') ? setStep({ kind: 'newTonic' }) : void submit(resp))

  if (step.kind === 'intro') {
    return (
      <main className="page boss">
        <h1>实战关</h1>
        <p>先听一遍整曲，再一句一句写出来。每句可以无限重听；整曲开场听一次后最多再听 {FULL_REPLAYS} 次。</p>
        <p>每个部分 ≥ 90% 才算通过（和弦、节奏可以错 1 个）。</p>
        {phaseId && <p>本关包括：{BOSS_PARTS[phaseId].map((p) => PART_NAME[p]).join('、')}。</p>}
        {remaining !== null && <p>今天还能挑战 {remaining} 次。</p>}
        {errorLine}
        <button type="button" className="primary big" disabled={remaining === 0} onClick={() => void begin()}>开始</button>
        <button type="button" onClick={props.onExit}>返回</button>
      </main>
    )
  }

  if (!ch || !rendered) return <main className="page boss" />

  if (step.kind === 'result') {
    return (
      <main className="page boss">
        <h1>{step.grade.passed ? '通过！' : '这次没过'}</h1>
        {step.grade.passed && ch.piece.phaseId === 'P5' && <p className="good">全部阶段完成！</p>}
        {step.grade.passed && ch.piece.phaseId !== 'P5' && step.advancedTo && <p className="good">升入 {step.advancedTo}！</p>}
        {errorLine}
        <BossResult challenge={ch} response={resp} grade={step.grade} scheme={scheme} />
        {!step.grade.passed &&
          (step.remaining > 0 ? (
            <button type="button" className="primary" onClick={() => void begin()}>换一段再试（今天还剩 {step.remaining} 次）</button>
          ) : (
            <p>今天的次数用完了，明天再来。</p>
          ))}
        <button type="button" onClick={props.onExit}>回首页</button>
      </main>
    )
  }

  const fullReplay = (
    <button type="button" disabled={replays <= 0} onClick={() => { setReplays((k) => k - 1); play(rendered.plan) }}>
      重听整曲（剩 {replays} 次）
    </button>
  )

  if (step.kind === 'listen') {
    return (
      <main className="page boss">
        <p>先完整听一遍。</p>
        <button type="button" className="primary big" disabled={played} onClick={() => { setPlayed(true); play(rendered.plan) }}>播放整曲</button>
        {errorLine}
        <button type="button" disabled={!played} onClick={() => setStep(ch.parts.includes('meter') ? { kind: 'meter' } : { kind: 'phrase', i: 0 })}>开始作答</button>
      </main>
    )
  }

  if (step.kind === 'meter') {
    return (
      <main className="page boss">
        <p className="prompt-text">这首曲子是几拍子？（答后不能修改）</p>
        {fullReplay}
        {errorLine}
        <section className="answer-zone">
          <ChoiceControl
            ids={ch.alphabets.meter!}
            label={lab('which-meter')}
            enabled
            onAnswer={(id) => { setResp((r) => ({ ...r, meter: id })); setStep({ kind: 'phrase', i: 0 }) }}
          />
        </section>
      </main>
    )
  }

  if (step.kind === 'newTonic') {
    return (
      <main className="page boss">
        <p className="prompt-text">新调的主音是原调的哪个音级？</p>
        {errorLine}
        <section className="answer-zone">
          <ChoiceControl
            ids={ch.alphabets.newTonic!}
            label={lab('new-tonic-degree')}
            enabled={!submitting}
            onAnswer={(id) => { const final = { ...resp, newTonic: id }; setResp(final); void submit(final) }}
          />
        </section>
      </main>
    )
  }

  // 乐句页
  const i = step.i
  const ph = ch.phrases[i]
  const bars = ph.endBar - ph.startBar
  const last = i === ch.phrases.length - 1
  const groups: ('melody' | 'chords' | 'rhythm')[] = ['melody', ...(ch.answer.chords ? (['chords'] as const) : []), ...(ch.answer.rhythm ? (['rhythm'] as const) : [])]
  const done = (g: string) => phraseDone[`${i}:${g}`]
  const allDone = groups.every(done)
  const setPart = (g: 'melody' | 'chords' | 'rhythm', ids: string[]) => {
    setResp((r) => {
      if (g === 'melody') {
        const melody = r.melody.slice()
        melody[i] = ids
        return { ...r, melody }
      }
      const arr = (r[g] ?? Array(ch.piece.bars).fill('')).slice()
      ids.forEach((id, k) => { arr[ph.startBar + k] = id })
      return { ...r, [g]: arr }
    })
    setPhraseDone((d) => ({ ...d, [`${i}:${g}`]: true }))
  }
  const newKey = ch.piece.modulationBar !== null && ph.startBar >= ch.piece.modulationBar

  return (
    <main className="page boss">
      <header className="topbar"><span>第 {i + 1} / {ch.phrases.length} 句</span></header>
      <div className="row">
        <button type="button" onClick={() => play(phrasePlan(rendered, i))}>重听本句</button>
        {fullReplay}
      </div>
      {errorLine}
      {newKey && <p className="small">第 5–8 小节按新调标注</p>}
      <section className="answer-zone">
        {groups.map((g) =>
          done(g) ? (
            <p key={g} className="small">已提交</p>
          ) : (
            <SequenceControl
              key={`${i}:${g}`}
              length={g === 'melody' ? ph.melodyCount : bars}
              alphabet={g === 'melody' ? ch.alphabets.melody : g === 'chords' ? ch.alphabets.chords! : ch.alphabets.rhythm!}
              label={lab(g === 'melody' ? 'notate-melody' : g === 'chords' ? 'notate-chords' : 'notate-patterns')}
              enabled
              onSubmit={(ids) => setPart(g, ids)}
            />
          ),
        )}
        <button
          type="button"
          className="primary"
          disabled={!allDone || submitting}
          onClick={() => (last ? afterPhrases() : setStep({ kind: 'phrase', i: i + 1 }))}
        >
          {last && !ch.parts.includes('newTonic') ? '提交关卡' : '下一句'}
        </button>
      </section>
    </main>
  )
}
