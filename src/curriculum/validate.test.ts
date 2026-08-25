import { describe, expect, it } from 'vitest'
import { buildCurriculum } from './curriculum'
import { stageOrderIndex, validateCurriculum } from './validate'
import type { Curriculum } from './curriculum'
import type { KnowledgePoint } from './knowledgePoints'

const c = buildCurriculum()

/** 复制课程并替换一个知识点，用于制造已知错误 */
function withKnowledgePoint(base: Curriculum, kp: KnowledgePoint): Curriculum {
  const kps = new Map(base.knowledgePoints)
  kps.set(kp.id, kp)
  return { ...base, knowledgePoints: kps }
}

describe('validateCurriculum', () => {
  it('真实课程数据零问题', () => {
    expect(validateCurriculum(c)).toEqual([])
  })

  it('抓出前置知识点在更晚的级才引入的情况', () => {
    // do 在 T1 引入；把它的前置改成 T7 才引入的 major:me
    const broken = withKnowledgePoint(c, {
      ...c.knowledgePoints.get('degree:major:do')!,
      prerequisites: ['degree:major:me'],
    })
    const problems = validateCurriculum(broken)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.some((p) => p.code === 'prerequisite-introduced-later')).toBe(true)
    expect(problems[0].message).toContain('degree:major:do')
  })

  it('抓出前置知识点不存在的情况', () => {
    const broken = withKnowledgePoint(c, {
      ...c.knowledgePoints.get('chord:V7')!,
      prerequisites: ['chord:does-not-exist'],
    })
    const problems = validateCurriculum(broken)
    expect(problems.some((p) => p.code === 'prerequisite-missing')).toBe(true)
  })

  it('抓出自引用', () => {
    const broken = withKnowledgePoint(c, {
      ...c.knowledgePoints.get('chord:V7')!,
      prerequisites: ['chord:V7'],
    })
    expect(validateCurriculum(broken).some((p) => p.code === 'self-prerequisite')).toBe(
      true,
    )
  })

  it('允许前置与该知识点在同一级引入', () => {
    // inv-second 的前置 inv-first 同在 H6，这是合法的
    expect(
      validateCurriculum(c).some((p) => p.message.includes('chord:inv-second')),
    ).toBe(false)
  })

  it('抓出未被任何级引入的孤立知识点', () => {
    const kps = new Map(c.knowledgePoints)
    kps.set('degree:orphan', {
      id: 'degree:orphan', kind: 'degree', track: 'T',
      label: '孤儿', prerequisites: [],
    })
    expect(
      validateCurriculum({ ...c, knowledgePoints: kps }).some(
        (p) => p.code === 'orphan-knowledge-point',
      ),
    ).toBe(true)
  })
})

describe('stageOrderIndex', () => {
  it('按阶段优先、同阶段内按级号排序', () => {
    expect(stageOrderIndex(c, 'T1')).toBeLessThan(stageOrderIndex(c, 'T3'))
    // T3 在 P2、H2 在 P1，故 H2 更靠前
    expect(stageOrderIndex(c, 'H2')).toBeLessThan(stageOrderIndex(c, 'T3'))
  })

  it('未知级抛错', () => {
    expect(() => stageOrderIndex(c, 'Z9')).toThrow()
  })
})
