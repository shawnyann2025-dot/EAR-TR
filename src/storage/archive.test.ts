import { describe, expect, it } from 'vitest'
import { masteryKey } from '../curriculum/knowledgePoints'
import type { AttemptRecord } from '../session/types'
import { archiveOverflow } from './archive'

const attempt = (kpId: string, correct: boolean, i: number): AttemptRecord => ({
  at: `t${i}`, day: i, sessionNo: 0, kpId, modality: 'recognize',
  spec: { kpId, modality: 'recognize', track: 'T', contextLevel: 0, variationLevel: 0, difficultyStep: 0, seed: i, segment: 'focus' },
  correct, latencyMs: 1, detail: { kind: 'choice' },
})

describe('archiveOverflow（主 spec §10.2）', () => {
  it('未超出上限：原样返回', () => {
    const a = [attempt('degree:major:do', true, 0)]
    expect(archiveOverflow(a, [], 5)).toEqual({ attempts: a, aggregates: [] })
  })

  it('超出部分（最旧的）按 MasteryKey 聚合后删除，保留最新的 cap 条', () => {
    const a = [
      attempt('degree:major:do', true, 0),
      attempt('degree:major:do', false, 1),
      attempt('degree:major:mi', true, 2),
      attempt('degree:major:do', true, 3),
    ]
    const r = archiveOverflow(a, [{ key: masteryKey('degree:major:do', 'recognize'), attempts: 10, correct: 7 }], 1)
    expect(r.attempts).toEqual([a[3]])
    expect(r.aggregates.sort((x, y) => x.key.localeCompare(y.key))).toEqual([
      { key: masteryKey('degree:major:do', 'recognize'), attempts: 12, correct: 8 },
      { key: masteryKey('degree:major:mi', 'recognize'), attempts: 1, correct: 1 },
    ])
  })

  it('cap=0：全部聚合，attempts 为空', () => {
    const a = [attempt('degree:major:do', true, 0), attempt('degree:major:do', false, 1)]
    expect(archiveOverflow(a, [], 0)).toEqual({
      attempts: [],
      aggregates: [{ key: masteryKey('degree:major:do', 'recognize'), attempts: 2, correct: 1 }],
    })
  })

  it('恰好等于 cap：不归档', () => {
    const a = [attempt('degree:major:do', true, 0), attempt('degree:major:mi', true, 1)]
    expect(archiveOverflow(a, [], 2)).toEqual({ attempts: a, aggregates: [] })
  })

  it('不修改输入', () => {
    const a = [attempt('degree:major:do', true, 0), attempt('degree:major:mi', true, 1)]
    const g = [{ key: masteryKey('degree:major:do', 'recognize'), attempts: 1, correct: 1 }]
    const aCopy = structuredClone(a)
    const gCopy = structuredClone(g)
    archiveOverflow(a, g, 1)
    expect(a).toEqual(aCopy)
    expect(g).toEqual(gCopy)
  })
})
