// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCurriculum } from '../../curriculum/curriculum'
import { MODALITIES } from '../../curriculum/knowledgePoints'
import { ALL_KNOWLEDGE_POINTS } from '../../curriculum/tracks'
import { generate, type Exercise } from '../../exercises/generate'
import { degreeLabel } from '../labels'
import { AnswerArea } from './AnswerArea'
import { ChoiceControl } from './ChoiceControl'
import { PitchControl } from './PitchControl'
import { SequenceControl } from './SequenceControl'

afterEach(cleanup)
const c = buildCurriculum()
const label = (id: string) => `L:${id}`

describe('ChoiceControl', () => {
  it('按文案显示；禁用时点不动；可用时回调 id', () => {
    const onAnswer = vi.fn()
    const { rerender } = render(<ChoiceControl ids={['do', 'mi']} label={label} enabled={false} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: 'L:mi' }))
    expect(onAnswer).not.toHaveBeenCalled()
    rerender(<ChoiceControl ids={['do', 'mi']} label={label} enabled onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: 'L:mi' }))
    expect(onAnswer).toHaveBeenCalledWith('mi')
  })
})

describe('SequenceControl', () => {
  it('填槽、删除、填满后才能提交', () => {
    const onSubmit = vi.fn()
    render(<SequenceControl length={2} alphabet={['do', 're']} label={label} enabled onSubmit={onSubmit} />)
    const submit = screen.getByRole('button', { name: '提交' })
    expect(submit).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: 'L:re' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.click(screen.getByRole('button', { name: 'L:do' }))
    fireEvent.click(screen.getByRole('button', { name: 'L:re' }))
    expect(submit).toHaveProperty('disabled', false)
    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledWith(['do', 're'])
  })
})

describe('PitchControl', () => {
  it('先听目标，自评按钮才可用', () => {
    const onAssess = vi.fn()
    const onPlayTarget = vi.fn()
    render(<PitchControl targetsText="mi" enabled onPlayTarget={onPlayTarget} onAssess={onAssess} />)
    fireEvent.click(screen.getByRole('button', { name: '唱对了' }))
    expect(onAssess).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '听目标' }))
    expect(onPlayTarget).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '没唱对' }))
    expect(onAssess).toHaveBeenCalledWith(false)
    expect(screen.getByText('mi')).toBeTruthy()
  })
})

/** 在课程里找一道指定格式的题 */
function findExercise(match: (ex: Exercise) => boolean, what: string): Exercise {
  for (const kp of ALL_KNOWLEDGE_POINTS)
    for (const modality of MODALITIES)
      for (let seed = 0; seed < 5; seed++) {
        try {
          const ex = generate({ kpId: kp.id, modality, track: kp.track, contextLevel: 1, variationLevel: 1, difficultyStep: 1, seed, segment: 'focus' }, c)
          if (match(ex)) return ex
        } catch {
          // 该组合不在课程范围内
        }
      }
  throw new Error(`找不到 ${what} 题`)
}
const exerciseOf = (kind: Exercise['format']['kind']) => findExercise((ex) => ex.format.kind === kind, kind)

describe('AnswerArea：打拍', () => {
  it('presenting 时就收点击；窗口到点且已进入 answering 时提交相对内容起点的时刻，只提交一次', () => {
    const ex = exerciseOf('tap')
    if (ex.format.kind !== 'tap') throw new Error()
    let now = 0
    const timers: { fn: () => void }[] = []
    const schedule = (_s: number, fn: () => void) => {
      const t = { fn }
      timers.push(t)
      return () => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1) }
    }
    const onResponse = vi.fn()
    const playback = { startSec: 1, contentStartSec: ex.contentStartSec }
    const props = { exercise: ex, scheme: 'solfege' as const, playback, clock: { now: () => now, latencySec: 0 }, schedule, onPlayTarget: vi.fn(), onResponse }
    const { rerender } = render(<AnswerArea {...props} phase="presenting" />)
    now = 1 + ex.contentStartSec + 0.5
    fireEvent.pointerDown(screen.getByRole('button', { name: /点击/ }))
    // 窗口到点但仍在 presenting：先不提交
    act(() => timers.splice(0).forEach((t) => t.fn()))
    expect(onResponse).not.toHaveBeenCalled()
    rerender(<AnswerArea {...props} phase="answering" />)
    expect(onResponse).toHaveBeenCalledTimes(1)
    const r = onResponse.mock.calls[0][0]
    expect(r.kind).toBe('tap')
    expect(r.tapsSec[0]).toBeCloseTo(0.5)
    rerender(<AnswerArea {...props} phase="answering" />)
    expect(onResponse).toHaveBeenCalledTimes(1)
  })
})

describe('AnswerArea：打拍窗口与提交边界', () => {
  function setup(startPhase: 'presenting' | 'answering' | 'other') {
    const ex = exerciseOf('tap')
    if (ex.format.kind !== 'tap') throw new Error()
    let now = 0
    const timers: { fn: () => void }[] = []
    const schedule = (_s: number, fn: () => void) => {
      const t = { fn }
      timers.push(t)
      return () => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1) }
    }
    const fire = () => act(() => timers.splice(0).forEach((t) => t.fn()))
    const onResponse = vi.fn()
    const clock = { now: () => now, latencySec: 0 }
    const mk = (startSec: number) => ({ exercise: ex, scheme: 'solfege' as const, playback: { startSec, contentStartSec: ex.contentStartSec }, clock, schedule, onPlayTarget: vi.fn(), onResponse })
    const props = mk(1)
    const utils = render(<AnswerArea {...props} phase={startPhase} />)
    const pad = () => screen.getByRole('button', { name: /点击/ })
    const windowEnd = (startSec: number) => startSec + ex.contentStartSec + (ex.format.kind === 'tap' ? ex.format.windowSec : 0) + 0.3
    return { ex, props, mk, utils, pad, fire, onResponse, windowEnd, setNow: (n: number) => { now = n } }
  }

  it('已在 answering 时窗口到点，立即提交；提交后点击垫禁用', () => {
    const t = setup('answering')
    t.setNow(1 + t.ex.contentStartSec + 0.5)
    fireEvent.pointerDown(t.pad())
    t.fire()
    expect(t.onResponse).toHaveBeenCalledTimes(1)
    expect(t.onResponse.mock.calls[0][0].tapsSec).toHaveLength(1)
    expect(t.pad()).toHaveProperty('disabled', true)
  })

  it('窗口结束之后的点击不计入', () => {
    const t = setup('answering')
    t.setNow(1 + t.ex.contentStartSec + 0.5)
    fireEvent.pointerDown(t.pad())
    t.setNow(t.windowEnd(1) + 1)
    fireEvent.pointerDown(t.pad())
    t.fire()
    expect(t.onResponse.mock.calls[0][0].tapsSec).toHaveLength(1)
    expect(t.onResponse.mock.calls[0][0].tapsSec[0]).toBeCloseTo(0.5)
  })

  it('窗口已结束后播放信息变化：重新计时，进入 answering 不会提前提交', () => {
    const t = setup('presenting')
    t.fire() // 旧播放的窗口到点
    const next = t.mk(10)
    const { rerender } = t.utils
    rerender(<AnswerArea {...next} phase="presenting" />)
    rerender(<AnswerArea {...next} phase="answering" />)
    expect(t.onResponse).not.toHaveBeenCalled()
    t.fire() // 新播放的窗口到点
    expect(t.onResponse).toHaveBeenCalledTimes(1)
  })

  it('phase 为 other 时点击垫禁用', () => {
    const t = setup('other')
    expect(t.pad()).toHaveProperty('disabled', true)
  })
})

describe('AnswerArea：选择题只在 answering 可用', () => {
  it('presenting 时按钮禁用，answering 时回调选项 id', () => {
    const ex = exerciseOf('choice')
    if (ex.format.kind !== 'choice') throw new Error()
    const onResponse = vi.fn()
    const props = { exercise: ex, scheme: 'solfege' as const, playback: null, clock: { now: () => 0, latencySec: 0 }, schedule: () => () => {}, onPlayTarget: vi.fn(), onResponse }
    const { rerender } = render(<AnswerArea {...props} phase="presenting" />)
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(onResponse).not.toHaveBeenCalled()
    rerender(<AnswerArea {...props} phase="answering" />)
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(onResponse).toHaveBeenCalledWith({ kind: 'choice', id: ex.format.options[0].id })
  })
})

describe('AnswerArea：唱模态目标音级显示', () => {
  const baseProps = { scheme: 'solfege' as const, phase: 'answering' as const, playback: null, clock: { now: () => 0, latencySec: 0 }, schedule: () => () => {}, onPlayTarget: vi.fn(), onResponse: vi.fn() }

  it('sing-new-tonic 题不显示任何目标音级', () => {
    const ex = findExercise((e) => e.format.kind === 'pitch' && e.prompt === 'sing-new-tonic', 'sing-new-tonic')
    const { container } = render(<AnswerArea {...baseProps} exercise={ex} />)
    expect(container.querySelector('.targets')).toBeNull()
    if (ex.format.kind !== 'pitch') throw new Error()
    for (const tg of ex.format.targets) {
      const text = degreeLabel(tg.degree, 'solfege', ex.resolved.key.mode)
      expect(container.textContent).not.toContain(text)
    }
  })

  it('sing-degrees 题显示目标音级', () => {
    const ex = findExercise((e) => e.format.kind === 'pitch' && e.prompt === 'sing-degrees', 'sing-degrees')
    if (ex.format.kind !== 'pitch') throw new Error()
    const expected = ex.format.targets.map((t) => degreeLabel(t.degree, 'solfege', ex.resolved.key.mode)).join(' ')
    const { container } = render(<AnswerArea {...baseProps} exercise={ex} />)
    expect(expected.length).toBeGreaterThan(0)
    expect(container.querySelector('.targets')?.textContent).toBe(expected)
  })
})
