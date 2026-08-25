import { phaseIndex, type Curriculum } from './curriculum'
import { ALL_STAGES, type StageId } from './stages'

export interface CurriculumProblem {
  code: string
  message: string
}

/**
 * 级在全课程中的绝对顺序：先按所属阶段，同阶段内按级号。
 * 三条轨道并行推进，所以「顺序」只在跨阶段时严格，同阶段内的级视为并列。
 */
export function stageOrderIndex(c: Curriculum, stageId: StageId): number {
  const phase = c.phaseOfStage.get(stageId)
  if (!phase) throw new Error(`未知的级 ${stageId}`)
  return phaseIndex(phase) * 100 + Number(stageId.slice(1))
}

export function validateCurriculum(c: Curriculum): CurriculumProblem[] {
  const problems: CurriculumProblem[] = []

  // 每个知识点由哪一级引入
  const introducedBy = new Map<string, StageId>()
  for (const stage of ALL_STAGES) {
    for (const id of stage.introduces) introducedBy.set(id, stage.id)
  }

  for (const kp of c.knowledgePoints.values()) {
    const ownStage = introducedBy.get(kp.id)
    if (!ownStage) {
      problems.push({
        code: 'orphan-knowledge-point',
        message: `知识点 ${kp.id} 未被任何级引入，将永远不会被调度到`,
      })
      continue
    }
    const ownOrder = stageOrderIndex(c, ownStage)

    for (const pre of kp.prerequisites) {
      if (pre === kp.id) {
        problems.push({
          code: 'self-prerequisite',
          message: `知识点 ${kp.id} 把自己列为前置`,
        })
        continue
      }
      if (!c.knowledgePoints.has(pre)) {
        problems.push({
          code: 'prerequisite-missing',
          message: `知识点 ${kp.id} 的前置 ${pre} 不存在`,
        })
        continue
      }
      const preStage = introducedBy.get(pre)
      if (!preStage) {
        problems.push({
          code: 'prerequisite-missing',
          message: `知识点 ${kp.id} 的前置 ${pre} 未被任何级引入`,
        })
        continue
      }
      // 允许同一级（如 H6 的 inv-first → inv-second），禁止更晚
      if (stageOrderIndex(c, preStage) > ownOrder) {
        problems.push({
          code: 'prerequisite-introduced-later',
          message:
            `知识点 ${kp.id}（${ownStage}）的前置 ${pre} 在更晚的 ${preStage} 才引入`,
        })
      }
    }
  }

  return problems
}
