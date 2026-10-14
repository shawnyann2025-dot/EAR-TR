import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { makeRng } from '../music/rng'
import { generateBoss } from './generate'
import { gradeBoss } from './grade'
import { positionKpIds, simulateBossAttempt } from './answerability'

const c = buildCurriculum()

describe('positionKpIds', () => {
  it('每个作答位置都映射到课程里存在的知识点', () => {
    for (const phaseId of ['P1', 'P2', 'P3', 'P4', 'P5'] as const) {
      for (let seed = 0; seed < 20; seed++) {
        const ids = positionKpIds(generateBoss(c, phaseId, seed))
        const all = [...ids.melody.flat(), ...(ids.chords ?? []), ...(ids.rhythm ?? []), ...(ids.meter ? [ids.meter] : []), ...(ids.newTonic ? [ids.newTonic] : [])]
        for (const id of all) expect(c.knowledgePoints.has(id), `${phaseId} seed ${seed} ${id}`).toBe(true)
      }
    }
  })
})

describe('simulateBossAttempt', () => {
  const ch = generateBoss(c, 'P3', 6)
  it('能力满分的学习者全对、通过', () => {
    const r = simulateBossAttempt(ch, { probabilityOf: () => 1 }, makeRng(1))
    expect(gradeBoss(ch, r).passed).toBe(true)
  })
  it('能力为零的学习者全错，答错的位置不等于正确答案', () => {
    const r = simulateBossAttempt(ch, { probabilityOf: () => 0 }, makeRng(1))
    const g = gradeBoss(ch, r)
    expect(g.passed).toBe(false)
    expect(g.marks.melody.flat().every((x) => !x)).toBe(true)
  })
  it('确定性：同一 rng 种子同一作答', () => {
    const half = { probabilityOf: () => 0.5 }
    expect(simulateBossAttempt(ch, half, makeRng(7))).toEqual(simulateBossAttempt(ch, half, makeRng(7)))
  })
})
