import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { generate } from './generate'
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
  format: { kind: 'tap', onsetsSec: [1, 1.5, 2, 3], toleranceSec: 0.1, maxShiftSec: 10, windowSec: 4 },
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

describe('grade：先统一校验题目自身的格式（P-2b spec §14）', () => {
  it('format 与 answer 种类不一致时抛错，消息含两者', () => {
    const broken = {
      format: { kind: 'choice' as const, options: [{ id: 'a' }] },
      answer: { kind: 'sequence' as const, ids: ['a'] },
    }
    expect(() => grade(broken, { kind: 'sequence', ids: ['a'] })).toThrow(/choice.*sequence|sequence.*choice/)
  })

  it('作答种类不一致时的消息把作答种类当作「收到的」', () => {
    expect(() => grade(tap, { kind: 'choice', id: 're' })).toThrow(/作答格式 choice/)
  })
})

describe('grade：打拍边界（P-2b spec §14）', () => {
  // 容差与偏差都取二进制可精确表示的数，避免浮点误差左右边界判定
  const exact: Gradable = {
    format: { kind: 'tap', onsetsSec: [0, 0.5, 1, 1.5], toleranceSec: 0.125, maxShiftSec: 10, windowSec: 2 },
    answer: { kind: 'tap', onsetsSec: [0, 0.5, 1, 1.5] },
  }

  it('偏差恰等于容差：对', () => {
    expect(grade(exact, { kind: 'tap', tapsSec: [0, 0.625, 1, 1.5] }).correct).toBe(true)
  })

  it('偏差刚超过容差：错', () => {
    expect(grade(exact, { kind: 'tap', tapsSec: [0, 0.6251, 1, 1.5] }).correct).toBe(false)
  })

  it('负偏差（抢拍）同样按绝对值判', () => {
    const r = grade(exact, { kind: 'tap', tapsSec: [0, 0.375, 1, 1.5] })
    expect(r.correct).toBe(true)
    if (r.detail.kind !== 'tap') throw new Error('detail 类型错')
    expect(r.detail.offsetsSec[1]).toBeCloseTo(-0.125, 12)
    expect(grade(exact, { kind: 'tap', tapsSec: [0, 0.37, 1, 1.5] }).correct).toBe(false)
  })

  it('多点：错，偏差按目标长度给出', () => {
    const r = grade(exact, { kind: 'tap', tapsSec: [0, 0.5, 1, 1.5, 2] })
    expect(r.correct).toBe(false)
    if (r.detail.kind !== 'tap') throw new Error('detail 类型错')
    expect(r.detail.offsetsSec).toHaveLength(4)
  })

  it('首击晚到、其后每下都偏早：平移后看出节奏错', () => {
    expect(grade(exact, { kind: 'tap', tapsSec: [0.3, 0.6, 1.1, 1.6] }).correct).toBe(false)
  })
})

describe('grade：听写作答比答案长', () => {
  it('整体错，逐位按答案长度给出', () => {
    expect(grade(sequence, { kind: 'sequence', ids: ['do', 'mi', 're', 'fa'] })).toEqual({
      correct: false,
      detail: { kind: 'sequence', positions: [true, true, true] },
    })
  })
})

describe('grade：打拍相位（maxShiftSec）', () => {
  const phased: Gradable = {
    format: { kind: 'tap', onsetsSec: [0, 1, 2, 3], toleranceSec: 0.1, maxShiftSec: 0.5, windowSec: 4 },
    answer: { kind: 'tap', onsetsSec: [0, 1, 2, 3] },
  }
  it('整串偏了恰好一拍、间隔完美：错（不能靠平移蒙混）', () => {
    const r = grade(phased, { kind: 'tap', tapsSec: [1, 2, 3, 4] })
    expect(r.correct).toBe(false)
    if (r.detail.kind !== 'tap') throw new Error('detail 类型错')
    expect(r.detail.offsetsSec).toHaveLength(4)
  })
  it('首击偏 0.4 秒（在 maxShiftSec 内）、间隔完美：对', () => {
    expect(grade(phased, { kind: 'tap', tapsSec: [0.4, 1.4, 2.4, 3.4] }).correct).toBe(true)
  })
  it('首击偏差恰为 maxShiftSec：对；略超：错', () => {
    expect(grade(phased, { kind: 'tap', tapsSec: [0.5, 1.5, 2.5, 3.5] }).correct).toBe(true)
    expect(grade(phased, { kind: 'tap', tapsSec: [-0.51, 0.49, 1.49, 2.49] }).correct).toBe(false)
  })
})

describe('grade：唱模态检测分支（P-4 spec §3.4）', () => {
  const c = buildCurriculum()
  const ex = generate(
    { kpId: 'degree:major:mi', modality: 'sing', track: 'T', contextLevel: 1, variationLevel: 1, difficultyStep: 2, seed: 5, segment: 'focus' },
    c,
  )
  if (ex.answer.kind !== 'pitch') throw new Error('应为唱题')
  const targets = ex.answer.targets

  it('唱准（含低一个八度）判对，detail 带逐音结果', () => {
    const r = grade(ex, { kind: 'pitch', sungHz: targets.map((t) => t.freqHz / 2) })
    expect(r.correct).toBe(true)
    expect(r.detail).toEqual({ kind: 'pitch', perTarget: targets.map(() => true), centsOff: targets.map(() => expect.closeTo(0, 6)) })
  })

  it('有一个音唱偏半音判错', () => {
    const sung = targets.map((t, i) => (i === 0 ? t.freqHz * Math.pow(2, 1 / 12) : t.freqHz))
    const r = grade(ex, { kind: 'pitch', sungHz: sung })
    expect(r.correct).toBe(false)
    if (r.detail.kind !== 'pitch') throw new Error()
    expect(r.detail.perTarget![0]).toBe(false)
  })

  it('自评分支行为不变', () => {
    expect(grade(ex, { kind: 'pitch', selfAssessedCorrect: true })).toEqual({ correct: true, detail: { kind: 'pitch' } })
  })
})
