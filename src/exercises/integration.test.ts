import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { describeSpec, type ExerciseSpec } from '../scheduling/exerciseSpec'
import { runSimulation } from '../simulation/runSimulation'
import { AVERAGE_LEARNER, SLOW_LEARNER } from '../simulation/virtualLearner'
import { answerAsResponse, generate, grade } from './generate'

const c = buildCurriculum()

/**
 * P-2b spec §11 第 4 条：拿仿真 180 天里调度器真实发出的规格（已由运行时写入
 * 阶梯档位）逐道生成。P-2b-H 覆盖 T/H 轨；P-2b-R 放宽到全量。
 */
function collectTrackSpecs(learner: typeof AVERAGE_LEARNER): ExerciseSpec[] {
  const specs: ExerciseSpec[] = []
  runSimulation({
    learner,
    days: 180,
    minutesPerDay: 25,
    seed: 4242,
    trace: (t) => {
      if (t.spec.track === 'T' || t.spec.track === 'H') specs.push(t.spec)
    },
  })
  return specs
}

describe('集成守卫：调度器真实发出的 T/H 轨规格都能生成并判定', () => {
  for (const [name, learner] of [['普通学习者', AVERAGE_LEARNER], ['慢学习者', SLOW_LEARNER]] as const) {
    it(name, () => {
      const specs = collectTrackSpecs(learner)
      expect(specs.length).toBeGreaterThan(500)
      // 运行时契约（主 spec FWD-8）：规格里的档位确实被写进来了
      expect(specs.some((s) => s.difficultyStep > 0)).toBe(true)
      // H 轨确实被覆盖到了，且覆盖面不止一两个知识点
      const hKps = new Set(specs.filter((s) => s.track === 'H').map((s) => s.kpId))
      expect(hKps.size).toBeGreaterThanOrEqual(5)

      const failures: string[] = []
      for (const s of specs) {
        try {
          const ex = generate(s, c)
          if (!grade(ex, answerAsResponse(ex.answer)).correct) {
            failures.push(`答案判错：${describeSpec(s)}`)
          }
        } catch (e) {
          failures.push(`${describeSpec(s)}：${(e as Error).message}`)
        }
      }
      expect(failures).toEqual([])
    })
  }
})
