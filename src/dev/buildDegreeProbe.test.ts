import { describe, expect, it } from 'vitest'
import { buildDegreeProbe } from './buildDegreeProbe'
import { MAJOR_SCALE_DEGREES, degreeToPitchClass } from '../music/key'
import type { ContextLevel } from '../music/tonalContext'

const LEVELS: ContextLevel[] = [0, 1, 2, 3, 4]

describe('buildDegreeProbe', () => {
  it('同一 seed 与等级产出完全相同的题目', () => {
    const a = buildDegreeProbe(777, 0)
    const b = buildDegreeProbe(777, 0)
    expect(a).toEqual(b)
  })

  it('不同 seed 通常产出不同的题目', () => {
    const probes = Array.from({ length: 20 }, (_, i) => buildDegreeProbe(i, 0))
    const signatures = probes.map((p) => `${p.key.tonic}-${p.degree}-${p.timbreId}`)
    expect(new Set(signatures).size).toBeGreaterThan(1)
  })

  it('目标音级取自大调音阶', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(MAJOR_SCALE_DEGREES).toContain(buildDegreeProbe(seed, 0).degree)
    }
  })

  it('计划中含语境事件与目标音事件', () => {
    for (const level of LEVELS) {
      const probe = buildDegreeProbe(1, level)
      expect(probe.plan.events.length).toBeGreaterThan(1)
    }
  })

  it('目标音是计划中最后发声的那个音，且音高对应该音级', () => {
    for (let seed = 0; seed < 30; seed++) {
      const probe = buildDegreeProbe(seed, 3)
      const last = probe.plan.events[probe.plan.events.length - 1]
      const midi = Math.round(69 + 12 * Math.log2(last.freqHz / 440))
      expect(((midi % 12) + 12) % 12).toBe(
        degreeToPitchClass(probe.degree, probe.key),
      )
    }
  })

  it('遍历足够多的 seed 能覆盖全部 12 个调', () => {
    const tonics = new Set(
      Array.from({ length: 400 }, (_, i) => buildDegreeProbe(i, 0).key.tonic),
    )
    expect(tonics.size).toBe(12)
  })

  it('遍历足够多的 seed 能覆盖全部 4 种音色', () => {
    const timbres = new Set(
      Array.from({ length: 400 }, (_, i) => buildDegreeProbe(i, 0).timbreId),
    )
    expect(timbres.size).toBe(4)
  })
})
