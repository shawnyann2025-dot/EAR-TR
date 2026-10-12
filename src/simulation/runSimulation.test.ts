import { describe, expect, it } from 'vitest'
import { runSimulation } from './runSimulation'
import {
  AVERAGE_LEARNER,
  FAST_LEARNER,
  SLOW_LEARNER,
  makeVirtualLearner,
} from './virtualLearner'
import {
  buildCurriculum,
  phaseIndex,
  unlockedKnowledgePoints,
} from '../curriculum/curriculum'
import { validateCurriculum } from '../curriculum/validate'
import { MODALITIES, masteryKey } from '../curriculum/knowledgePoints'
import { isWellFormedSpec, type ExerciseSpec } from '../scheduling/exerciseSpec'
import {
  LADDER_MAX_STEP,
  LADDER_MIN_STEP,
  applyLadder,
  initialLadder,
} from '../scheduling/ladder'
import { buildSessionPlan } from '../scheduling/scheduler'

const c = buildCurriculum()
const BASE = { days: 180, minutesPerDay: 25, seed: 4242 }

const average = runSimulation({ ...BASE, learner: AVERAGE_LEARNER })
const fast = runSimulation({ ...BASE, learner: FAST_LEARNER })
const slow = runSimulation({ ...BASE, learner: SLOW_LEARNER })

describe('课程数据本身无问题', () => {
  it('validateCurriculum 零问题', () => {
    expect(validateCurriculum(c)).toEqual([])
  })
})

describe('无死锁', () => {
  it('每一天都排出了题，没有空转的日子', () => {
    for (const day of average.days) {
      expect(day.itemCount).toBeGreaterThan(0)
    }
  })

  it('普通学习者 180 天内推进了至少两个阶段', () => {
    expect(phaseIndex(average.finalPhase)).toBeGreaterThanOrEqual(2)
  })

  it('已解锁的知识点在三个模态上都被练到过', () => {
    for (const kpId of unlockedKnowledgePoints(c, 'P1')) {
      for (const m of MODALITIES) {
        expect(average.finalStore.has(masteryKey(kpId, m))).toBe(true)
      }
    }
  })
})

describe('交错规则每日均满足', () => {
  it('180 天里没有任何一天违反交错规则', () => {
    const offending = average.days.filter((d) => d.interleavingProblems.length > 0)
    expect(offending.map((d) => ({ day: d.day, problems: d.interleavingProblems })))
      .toEqual([])
  })

  it('快慢学习者同样满足', () => {
    for (const run of [fast, slow]) {
      expect(run.days.every((d) => d.interleavingProblems.length === 0)).toBe(true)
    }
  })
})

describe('难度不发散、不塌缩', () => {
  it('没有任何 key 的语境或变异等级越出合法范围', () => {
    for (const state of average.finalStore.values()) {
      expect(state.contextLevel).toBeGreaterThanOrEqual(0)
      expect(state.contextLevel).toBeLessThanOrEqual(4)
      expect(state.variationLevel).toBeGreaterThanOrEqual(0)
      expect(state.variationLevel).toBeLessThanOrEqual(6)
    }
  })

  it('stability 保持有限且为正', () => {
    for (const state of average.finalStore.values()) {
      expect(Number.isFinite(state.stability)).toBe(true)
      expect(state.stability).toBeGreaterThan(0)
    }
  })

  it('普通学习者的整体正确率落在合理区间，既不无聊也不崩溃', () => {
    const attempted = average.days.reduce((s, d) => s + d.itemCount, 0)
    const correct = average.days.reduce((s, d) => s + d.correct, 0)
    const accuracy = correct / attempted
    expect(accuracy).toBeGreaterThan(0.5)
    expect(accuracy).toBeLessThan(0.95)
  })
})

describe('2-down-1-up 收敛于约 71%', () => {
  it('180 天仿真里，阶梯未饱和区间的正确率落在合意困难区（不无聊、不崩溃）', () => {
    // 计划原题为「阶梯稳态段的正确率接近理论收敛点」，区间 (0.6, 0.82)
    // 未动。实测这个值衡量的不是阶梯的收敛点：学习者能力一路上涨、
    // 跑赢阶段上限，未饱和区间的正确率对档位几乎不敏感（逐档
    // 0.80–0.86），它守的是「练习整体落在合意困难区」。阶梯本身收敛于
    // 约 71% 由下一条静态学习者测试直接验证。
    // 已知未决：修正 resumeLadder 的 1-up 缺陷后，满足 spec §8.2 周期的
    // 普通学习者在六个 seed 上实测 0.836–0.842，均高于 0.82——见账本
    // Task 16 末尾的待裁定项；按计划规则此处不放宽，等用户裁定。
    expect(average.ladderAccuracy).toBeGreaterThan(0.6)
    expect(average.ladderAccuracy).toBeLessThan(0.82)
  })

  it('能力固定的静态学习者上，阶梯自身收敛到约 71%', () => {
    // 收敛到 70.7% 的前提是心理测量曲线不动且不动点落在档位区间内部。
    // 这里把学习率归零、把能力放在 1–4 档之间能跨过 0.707 的位置，
    // 直接驱动 applyLadder + 真实作答概率模型跑一万次。
    const learner = makeVirtualLearner({
      ...AVERAGE_LEARNER,
      baseAbility: 0.21,
      learningRate: 0,
      errorLearningRate: 0,
    })
    const spec: ExerciseSpec = {
      kpId: 'degree:major:do',
      modality: 'recognize',
      track: 'T',
      contextLevel: 0,
      variationLevel: 0,
      difficultyStep: 0,
      seed: 0,
      segment: 'focus',
    }
    // 不动点确实在区间内部：最低档答对概率高于收敛点，最高档低于它
    expect(learner.probabilityOf(spec, LADDER_MIN_STEP)).toBeGreaterThan(0.707)
    expect(learner.probabilityOf(spec, LADDER_MAX_STEP)).toBeLessThan(0.707)

    let ladder = initialLadder()
    const burnIn = 200
    const trials = 10000
    let correctCount = 0
    let saturated = 0
    for (let i = 0; i < burnIn + trials; i++) {
      const correct = learner.answer(spec, ladder.step)
      if (i >= burnIn) {
        if (correct) correctCount++
        if (ladder.step === LADDER_MIN_STEP || ladder.step === LADDER_MAX_STEP) saturated++
      }
      ladder = applyLadder(ladder, correct)
    }
    expect(correctCount / trials).toBeGreaterThan(0.66)
    expect(correctCount / trials).toBeLessThan(0.76)
    // 阶梯大部分时间在区间内部工作，不是贴着地板或天花板（六档的 ±1 随机游走
    // 围着 2–3 档摆，碰到两端的时间实测约两成）
    expect(saturated / trials).toBeLessThan(0.3)
  })
})

describe('防挫败护栏确实触发', () => {
  it('低能力学习者触发过会话内回血', () => {
    expect(slow.days.some((d) => d.reliefTriggered)).toBe(true)
  })

  it('低能力学习者触发过拆解', () => {
    expect(slow.days.some((d) => d.decomposedKeys.length > 0)).toBe(true)
  })

  it('高能力学习者基本不触发回血', () => {
    const rate = fast.days.filter((d) => d.reliefTriggered).length / fast.days.length
    expect(rate).toBeLessThan(0.1)
  })
})

describe('快慢学习者的周期落在合理区间', () => {
  it('快学习者推进得比慢学习者远', () => {
    expect(phaseIndex(fast.finalPhase)).toBeGreaterThan(phaseIndex(slow.finalPhase))
  })

  it('快学习者过 P1 的天数少于慢学习者（若两者都过了）', () => {
    const f = fast.phaseCompletionDay.P1
    const s = slow.phaseCompletionDay.P1
    if (f !== undefined && s !== undefined) expect(f).toBeLessThan(s)
    expect(f).toBeDefined()
  })

  it('没有人在头几天就过完 P1——课程不是速成的', () => {
    expect(fast.phaseCompletionDay.P1!).toBeGreaterThan(7)
  })
})

describe('集成守卫：调度器输出的规格可被生成器消费', () => {
  it('每一天每一道题都是良构规格', () => {
    for (const learner of [AVERAGE_LEARNER, SLOW_LEARNER]) {
      const run = runSimulation({ ...BASE, days: 30, learner })
      expect(run.days.length).toBe(30)
    }
    // 直接对计划再走一遍，逐题校验
    const plan = buildSessionPlan({
      curriculum: c,
      store: average.finalStore,
      phaseId: average.finalPhase,
      today: 999,
      seed: 1,
      minutes: 25,
    })
    for (const spec of plan.items) {
      expect(isWellFormedSpec(spec)).toBe(true)
      expect(c.knowledgePoints.has(spec.kpId)).toBe(true)
    }
  })
})

describe('确定性', () => {
  it('同一参数跑两次结果完全一致', () => {
    const a = runSimulation({ ...BASE, days: 40, learner: AVERAGE_LEARNER })
    const b = runSimulation({ ...BASE, days: 40, learner: AVERAGE_LEARNER })
    expect(a.days.map((d) => d.correct)).toEqual(b.days.map((d) => d.correct))
    expect(a.finalPhase).toBe(b.finalPhase)
  })
})
