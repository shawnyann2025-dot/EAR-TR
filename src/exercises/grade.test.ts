import { describe, expect, it } from 'vitest'
import { answerAsResponse, grade } from './grade'
import type { Exercise } from './types'

type Gradable = Pick<Exercise, 'format' | 'answer'>

const choice: Gradable = {
  format: { kind: 'choice', options: [{ id: 'do' }, { id: 're' }] },
  answer: { kind: 'choice', id: 're' },
}
const sequence: Gradable = {
  format: { kind: 'sequence', length: 3, alphabet: [{ id: 'do' }, { id: 're' }, { id: 'mi' }] },
  answer: { kind: 'sequence', ids: ['do', 'mi', 're'] },
}
const pitch: Gradable = {
  format: { kind: 'pitch', targets: [{ degree: 'do', midi: 60, freqHz: 261.63, centsTolerance: 50 }] },
  answer: { kind: 'pitch', targets: [{ degree: 'do', midi: 60, freqHz: 261.63, centsTolerance: 50 }] },
}
const tap: Gradable = {
  format: { kind: 'tap', onsetsSec: [1, 1.5, 2, 3], toleranceSec: 0.1 },
  answer: { kind: 'tap', onsetsSec: [1, 1.5, 2, 3] },
}

describe('grade：choice', () => {
  it('id 相等即对', () => {
    expect(grade(choice, { kind: 'choice', id: 're' })).toEqual({ correct: true, detail: { kind: 'choice' } })
    expect(grade(choice, { kind: 'choice', id: 'do' }).correct).toBe(false)
  })
})

describe('grade：sequence（整串一致才算对，P-2b spec D5）', () => {
  it('全对', () => {
    expect(grade(sequence, { kind: 'sequence', ids: ['do', 'mi', 're'] })).toEqual({
      correct: true,
      detail: { kind: 'sequence', positions: [true, true, true] },
    })
  })

  it('错一位：整体错，逐位标出', () => {
    expect(grade(sequence, { kind: 'sequence', ids: ['do', 're', 're'] })).toEqual({
      correct: false,
      detail: { kind: 'sequence', positions: [true, false, true] },
    })
  })

  it('长度不等：整体错，按答案长度逐位比较，缺的位判错', () => {
    expect(grade(sequence, { kind: 'sequence', ids: ['do'] })).toEqual({
      correct: false,
      detail: { kind: 'sequence', positions: [true, false, false] },
    })
  })
})

describe('grade：pitch（P-2b 阶段取自评）', () => {
  it('自评对即对', () => {
    expect(grade(pitch, { kind: 'pitch', selfAssessedCorrect: true }).correct).toBe(true)
    expect(grade(pitch, { kind: 'pitch', selfAssessedCorrect: false }).correct).toBe(false)
  })
})

describe('grade：tap（首击对齐后逐个比偏差）', () => {
  it('整体延迟 0.3 秒但节奏准确：对（反应延迟被消除）', () => {
    const r = grade(tap, { kind: 'tap', tapsSec: [1.3, 1.8, 2.3, 3.3] })
    expect(r.correct).toBe(true)
    if (r.detail.kind !== 'tap') throw new Error('detail 类型错')
    for (const o of r.detail.offsetsSec) expect(Math.abs(o)).toBeLessThan(1e-9)
  })

  it('某一下偏差超过容差：错，偏差逐个给出', () => {
    const r = grade(tap, { kind: 'tap', tapsSec: [1, 1.5, 2.2, 3] })
    expect(r.correct).toBe(false)
    if (r.detail.kind !== 'tap') throw new Error('detail 类型错')
    expect(r.detail.offsetsSec[2]).toBeCloseTo(0.2, 9)
  })

  it('偏差恰在容差内：对', () => {
    expect(grade(tap, { kind: 'tap', tapsSec: [1, 1.59, 2, 3] }).correct).toBe(true)
  })

  it('点击数不等：错，偏差按较短长度给出', () => {
    const r = grade(tap, { kind: 'tap', tapsSec: [1, 1.5] })
    expect(r.correct).toBe(false)
    if (r.detail.kind !== 'tap') throw new Error('detail 类型错')
    expect(r.detail.offsetsSec).toHaveLength(2)
  })

  it('一下都没点：错', () => {
    expect(grade(tap, { kind: 'tap', tapsSec: [] }).correct).toBe(false)
  })
})

describe('grade：格式不匹配是调用方的 bug', () => {
  it('抛错', () => {
    expect(() => grade(choice, { kind: 'sequence', ids: ['re'] })).toThrow()
    expect(() => grade(tap, { kind: 'choice', id: 're' })).toThrow()
  })
})

describe('answerAsResponse', () => {
  it('完美作答对四种格式都判对', () => {
    for (const ex of [choice, sequence, pitch, tap]) {
      expect(grade(ex, answerAsResponse(ex.answer)).correct).toBe(true)
    }
  })
})
