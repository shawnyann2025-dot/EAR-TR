import { describe, expect, it } from 'vitest'
import {
  LADDER_MAX_STEP,
  LADDER_MIN_STEP,
  LADDER_UP_AFTER,
  applyLadder,
  initialLadder,
  resumeLadder,
  type LadderState,
} from './ladder'

describe('initialLadder', () => {
  it('默认从最低档起', () => {
    expect(initialLadder()).toEqual({ step: LADDER_MIN_STEP, consecutiveCorrect: 0 })
  })

  it('起始档被钳制在合法范围内', () => {
    expect(initialLadder(999).step).toBe(LADDER_MAX_STEP)
    expect(initialLadder(-5).step).toBe(LADDER_MIN_STEP)
  })
})

describe('applyLadder', () => {
  it('答对一次不升档，只累计', () => {
    const s = applyLadder(initialLadder(2), true)
    expect(s.step).toBe(2)
    expect(s.consecutiveCorrect).toBe(1)
  })

  it('连对 LADDER_UP_AFTER 次升一档并清零计数', () => {
    let s = initialLadder(2)
    for (let i = 0; i < LADDER_UP_AFTER; i++) s = applyLadder(s, true)
    expect(s.step).toBe(3)
    expect(s.consecutiveCorrect).toBe(0)
  })

  it('答错立即降一档并清零计数', () => {
    let s = applyLadder(initialLadder(3), true)
    s = applyLadder(s, false)
    expect(s.step).toBe(2)
    expect(s.consecutiveCorrect).toBe(0)
  })

  it('答错打断连对计数', () => {
    let s = initialLadder(2)
    s = applyLadder(s, true)
    s = applyLadder(s, false)
    s = applyLadder(s, true)
    expect(s.step).toBe(1) // 降了一次，之后只对了一次
    expect(s.consecutiveCorrect).toBe(1)
  })

  it('档位不越界', () => {
    let high = initialLadder(LADDER_MAX_STEP)
    for (let i = 0; i < 20; i++) high = applyLadder(high, true)
    expect(high.step).toBe(LADDER_MAX_STEP)

    let low = initialLadder(LADDER_MIN_STEP)
    for (let i = 0; i < 20; i++) low = applyLadder(low, false)
    expect(low.step).toBe(LADDER_MIN_STEP)
  })

  it('不修改输入状态', () => {
    const s = initialLadder(2)
    applyLadder(s, true)
    expect(s).toEqual({ step: 2, consecutiveCorrect: 0 })
  })
})

describe('resumeLadder：从尝试记录尾部还原阶梯状态', () => {
  /** 把一串作答按真实阶梯走一遍，记录「答后档位」，返回每一步的真值与记录 */
  function replay(answers: boolean[], start = initialLadder()) {
    const records: { correct: boolean; difficultyStep: number }[] = []
    const truth: LadderState[] = []
    let s = start
    for (const correct of answers) {
      s = applyLadder(s, correct)
      records.push({ correct, difficultyStep: s.step })
      truth.push(s)
    }
    return { records, truth }
  }

  it('空记录等于初始阶梯', () => {
    expect(resumeLadder([])).toEqual(initialLadder())
  })

  it('刚升档的那条记录不计入连对——到达新档位时计数已清零', () => {
    // 对、对 → 升到 1 档（第二条记录写的是答后档位 1，且 cc 已归 0）
    const { records, truth } = replay([true, true])
    expect(truth.at(-1)).toEqual({ step: 1, consecutiveCorrect: 0 })
    expect(resumeLadder(records)).toEqual({ step: 1, consecutiveCorrect: 0 })
  })

  it('升档后再答对一次，连对为 1', () => {
    const { records, truth } = replay([true, true, true])
    expect(truth.at(-1)).toEqual({ step: 1, consecutiveCorrect: 1 })
    expect(resumeLadder(records)).toEqual(truth.at(-1))
  })

  it('答错后连对归零', () => {
    const { records, truth } = replay([true, true, true, false])
    expect(truth.at(-1)).toEqual({ step: 0, consecutiveCorrect: 0 })
    expect(resumeLadder(records)).toEqual(truth.at(-1))
  })

  it('顶档连续答对时按 LADDER_UP_AFTER 取模（到顶后升档是空操作，但计数照常清零）', () => {
    const { records, truth } = replay([true, true, true], initialLadder(LADDER_MAX_STEP - 1))
    // 对对 → 到顶；再对 → cc=1
    expect(truth.at(-1)).toEqual({ step: LADDER_MAX_STEP, consecutiveCorrect: 1 })
    expect(resumeLadder(records)).toEqual(truth.at(-1))
  })

  it('性质：任意作答序列、任意截断点，还原值都等于连续维护的真值', () => {
    // 确定性伪随机，覆盖升降、撞顶、撞底
    let x = 12345
    const next = () => ((x = (x * 1103515245 + 12345) % 2 ** 31), x / 2 ** 31)
    let mismatches = 0
    let checks = 0
    for (let trial = 0; trial < 300; trial++) {
      const p = 0.4 + 0.5 * next()
      const answers = Array.from({ length: 60 }, () => next() < p)
      const { records, truth } = replay(answers)
      for (let k = 1; k <= records.length; k++) {
        // 只看最近 WINDOW 条——与 MasteryState.window 的截断一致
        const window = records.slice(Math.max(0, k - 20), k)
        const resumed = resumeLadder(window)
        checks++
        if (resumed.step !== truth[k - 1].step) mismatches++
        else if (resumed.consecutiveCorrect !== truth[k - 1].consecutiveCorrect) {
          // 唯一允许的歧义：窗口被截断且整窗都是顶档连对——看不到到达顶档的那条，
          // 连对的奇偶无从判断。此时档位反正不能再升，差一次无实际影响。
          const allTopRun = window.every((r) => r.correct && r.difficultyStep === LADDER_MAX_STEP)
          if (!(allTopRun && window.length === 20)) mismatches++
        }
      }
    }
    expect(checks).toBeGreaterThan(10000)
    expect(mismatches).toBe(0)
  })
})
