import { describe, expect, it } from 'vitest'
import { TIMBRES, TIMBRE_IDS } from './timbres'

describe('TIMBRES', () => {
  it('提供至少 4 种音色', () => {
    expect(TIMBRE_IDS.length).toBeGreaterThanOrEqual(4)
  })

  it('每个 id 与它的 key 一致', () => {
    for (const id of TIMBRE_IDS) {
      expect(TIMBRES[id].id).toBe(id)
    }
  })

  it('每种音色至少有一个分音，且基频分音存在', () => {
    for (const id of TIMBRE_IDS) {
      const { partials } = TIMBRES[id]
      expect(partials.length).toBeGreaterThan(0)
      expect(partials.some((p) => p.ratio === 1)).toBe(true)
    }
  })

  it('分音增益之和不超过 1，避免叠加后削波', () => {
    for (const id of TIMBRE_IDS) {
      const sum = TIMBRES[id].partials.reduce((s, p) => s + p.gain, 0)
      expect(sum).toBeLessThanOrEqual(1)
    }
  })

  it('包络参数全部非负，sustain 在 0–1 之间', () => {
    for (const id of TIMBRE_IDS) {
      const { env } = TIMBRES[id]
      expect(env.attackSec).toBeGreaterThanOrEqual(0)
      expect(env.decaySec).toBeGreaterThanOrEqual(0)
      expect(env.releaseSec).toBeGreaterThanOrEqual(0)
      expect(env.sustain).toBeGreaterThanOrEqual(0)
      expect(env.sustain).toBeLessThanOrEqual(1)
    }
  })

  it('钢琴类起音快、延音低；弦乐类起音慢、延音高', () => {
    expect(TIMBRES.piano.env.attackSec).toBeLessThan(TIMBRES.strings.env.attackSec)
    expect(TIMBRES.piano.env.sustain).toBeLessThan(TIMBRES.strings.env.sustain)
  })

  it('四种音色的分音结构互不相同（否则变异轴无效）', () => {
    const signatures = TIMBRE_IDS.map((id) =>
      JSON.stringify(TIMBRES[id].partials),
    )
    expect(new Set(signatures).size).toBe(TIMBRE_IDS.length)
  })
})
