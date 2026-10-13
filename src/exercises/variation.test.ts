import { describe, expect, it } from 'vitest'
import { makeRng } from '../music/rng'
import {
  BPM_MAX,
  BPM_MIN,
  DEFAULT_BPM,
  DEFAULT_CENTER_MIDI,
  DEFAULT_VELOCITY,
  REGISTER_MAX,
  REGISTER_MIN,
  TIMBRES,
  VELOCITY_MAX,
  VELOCITY_MIN,
  defaultKey,
  resolveVariation,
} from './variation'
import type { ResolvedVariation } from './types'

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1)

function varies(level: number, pick: (v: ResolvedVariation) => unknown): boolean {
  const values = SEEDS.map((s) => JSON.stringify(pick(resolveVariation(level, 'major', makeRng(s)))))
  return new Set(values).size > 1
}

const AXES: [string, (v: ResolvedVariation) => unknown][] = [
  ['调', (v) => v.key],
  ['音色', (v) => v.timbreId],
  ['音区', (v) => v.centerMidi],
  ['速度', (v) => v.bpm],
  ['力度', (v) => v.velocity],
  ['呈现方式', (v) => v.presentation],
]

describe('resolveVariation：按主 spec §6.2 的固定顺序逐轴开放', () => {
  for (let level = 0; level <= 6; level++) {
    it(`variationLevel=${level} 时恰好前 ${level} 条轴会变`, () => {
      const pattern = AXES.map(([, pick]) => varies(level, pick))
      expect(pattern).toEqual(AXES.map((_, i) => i < level))
    })
  }

  it('level 0 全部取默认值，且不消耗 rng', () => {
    const rng = makeRng(7)
    const v = resolveVariation(0, 'major', rng)
    expect(v).toEqual({
      key: { tonic: 0, mode: 'major' },
      timbreId: 'piano',
      centerMidi: DEFAULT_CENTER_MIDI,
      bpm: DEFAULT_BPM,
      velocity: DEFAULT_VELOCITY,
      presentation: 'block',
    })
    expect(rng.next()).toBe(makeRng(7).next())
  })

  it('调式由知识点决定，永不随机', () => {
    for (const s of SEEDS) {
      expect(resolveVariation(6, 'minor', makeRng(s)).key.mode).toBe('minor')
      expect(resolveVariation(6, 'major', makeRng(s)).key.mode).toBe('major')
    }
  })

  it('默认调：大调 C、小调 a', () => {
    expect(defaultKey('major')).toEqual({ tonic: 0, mode: 'major' })
    expect(defaultKey('minor')).toEqual({ tonic: 9, mode: 'minor' })
    expect(resolveVariation(0, 'minor', makeRng(1)).key).toEqual({ tonic: 9, mode: 'minor' })
  })

  it('开放后的取值落在 spec 规定的范围内（音区 48–72，P-2b spec D6）', () => {
    for (const s of SEEDS) {
      const v = resolveVariation(6, 'major', makeRng(s))
      expect(Number.isInteger(v.key.tonic)).toBe(true)
      expect(v.key.tonic).toBeGreaterThanOrEqual(0)
      expect(v.key.tonic).toBeLessThan(12)
      expect(TIMBRES).toContain(v.timbreId)
      expect(Number.isInteger(v.centerMidi)).toBe(true)
      expect(v.centerMidi).toBeGreaterThanOrEqual(REGISTER_MIN)
      expect(v.centerMidi).toBeLessThanOrEqual(REGISTER_MAX)
      expect(Number.isInteger(v.bpm)).toBe(true)
      expect(v.bpm).toBeGreaterThanOrEqual(BPM_MIN)
      expect(v.bpm).toBeLessThanOrEqual(BPM_MAX)
      expect(v.velocity).toBeGreaterThanOrEqual(VELOCITY_MIN)
      expect(v.velocity).toBeLessThanOrEqual(VELOCITY_MAX)
      expect(['block', 'arpeggio']).toContain(v.presentation)
    }
  })

  it('同一 seed 结果相同', () => {
    expect(resolveVariation(6, 'major', makeRng(99))).toEqual(
      resolveVariation(6, 'major', makeRng(99)),
    )
  })

  it('四种音色都会出现', () => {
    const seen = new Set(SEEDS.map((s) => resolveVariation(2, 'major', makeRng(s)).timbreId))
    expect(seen.size).toBe(4)
  })
})
