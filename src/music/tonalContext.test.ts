import { describe, expect, it } from 'vitest'
import { buildTonalContext, cadenceChords, type ContextLevel } from './tonalContext'
import { chordToMidi } from './chord'
import type { Key } from './key'

const C_MAJOR: Key = { tonic: 0, mode: 'major' }
const A_MINOR: Key = { tonic: 9, mode: 'minor' }

const base = { timbreId: 'piano', doMidi: 60, itemDurSec: 4 } as const

describe('cadenceChords', () => {
  it('大调用 ii–V–I', () => {
    const chords = cadenceChords(C_MAJOR)
    expect(chords.map((c) => c.rootDegree)).toEqual(['re', 'sol', 'do'])
    expect(chords.map((c) => c.quality)).toEqual(['min', 'maj', 'maj'])
  })

  it('小调用 iv–V–i，且 V 为大三（和声小调的升 7 级）', () => {
    const chords = cadenceChords(A_MINOR)
    expect(chords.map((c) => c.rootDegree)).toEqual(['re', 'mi', 'la'])
    expect(chords.map((c) => c.quality)).toEqual(['min', 'maj', 'min'])
  })

  it('小调终止式的 V 含升 7 级（G♯ = 音类 8）', () => {
    const v = cadenceChords(A_MINOR)[1]
    const pcs = chordToMidi(v, 60).map((m) => ((m % 12) + 12) % 12)
    expect(pcs).toContain(8)
  })

  it('终止式最后一个和弦落在主音上', () => {
    for (const key of [C_MAJOR, A_MINOR]) {
      const last = cadenceChords(key)
      const rootPc = chordToMidi(last[last.length - 1], 60)[0] % 12
      expect(rootPc).toBe(key.tonic)
    }
  })
})

describe('buildTonalContext', () => {
  it('L0 播三个和弦，leadIn 最长', () => {
    const r = buildTonalContext({ ...base, key: C_MAJOR, level: 0 })
    // 三个三和弦，每个 3 个音
    expect(r.plan.events).toHaveLength(9)
    expect(r.leadInSec).toBeGreaterThan(1.5)
  })

  it('L1 只播两个和弦，leadIn 短于 L0', () => {
    const l0 = buildTonalContext({ ...base, key: C_MAJOR, level: 0 })
    const l1 = buildTonalContext({ ...base, key: C_MAJOR, level: 1 })
    expect(l1.plan.events).toHaveLength(6)
    expect(l1.leadInSec).toBeLessThan(l0.leadInSec)
  })

  it('L2 是单个持续低音，覆盖整道题', () => {
    const r = buildTonalContext({ ...base, key: C_MAJOR, level: 2 })
    expect(r.plan.events).toHaveLength(1)
    expect(r.plan.events[0].durSec).toBeGreaterThanOrEqual(base.itemDurSec)
  })

  it('L3 只在开头给一次主音，且远短于题目时长', () => {
    const r = buildTonalContext({ ...base, key: C_MAJOR, level: 3 })
    expect(r.plan.events).toHaveLength(1)
    expect(r.plan.events[0].durSec).toBeLessThan(base.itemDurSec / 2)
  })

  it('L4 的低音在题目中途撤走', () => {
    const r = buildTonalContext({ ...base, key: C_MAJOR, level: 4 })
    expect(r.plan.events).toHaveLength(1)
    const endSec = r.plan.events[0].atSec + r.plan.events[0].durSec
    const itemEndSec = r.leadInSec + base.itemDurSec
    expect(endSec).toBeGreaterThan(r.leadInSec)
    expect(endSec).toBeLessThan(itemEndSec)
  })

  it('语境提供的音类数量随等级单调不增（属性测试）', () => {
    const levels: ContextLevel[] = [0, 1, 2, 3, 4]
    const counts = levels.map((level) => {
      const r = buildTonalContext({ ...base, key: C_MAJOR, level })
      const pcs = new Set(
        r.plan.events.map((e) => {
          const midi = Math.round(69 + 12 * Math.log2(e.freqHz / 440))
          return ((midi % 12) + 12) % 12
        }),
      )
      return pcs.size
    })
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1])
    }
  })

  it('L4 的低音短于 L2 的低音（同一题目时长下）', () => {
    const l2 = buildTonalContext({ ...base, key: C_MAJOR, level: 2 })
    const l4 = buildTonalContext({ ...base, key: C_MAJOR, level: 4 })
    expect(l4.plan.events[0].durSec).toBeLessThan(l2.plan.events[0].durSec)
  })

  it('所有语境的第一个事件都在 leadIn 之前开始（属性测试）', () => {
    const levels: ContextLevel[] = [0, 1, 2, 3, 4]
    for (const level of levels) {
      for (const key of [C_MAJOR, A_MINOR]) {
        const r = buildTonalContext({ ...base, key, level })
        expect(r.plan.events[0].atSec).toBeLessThan(r.leadInSec)
      }
    }
  })

  it('L2–L4 的低音音高就是该调主音（属性测试）', () => {
    const levels: ContextLevel[] = [2, 3, 4]
    for (const level of levels) {
      for (const key of [C_MAJOR, A_MINOR]) {
        const r = buildTonalContext({ ...base, key, level })
        // 由频率反解 MIDI
        const midi = Math.round(69 + 12 * Math.log2(r.plan.events[0].freqHz / 440))
        expect(((midi % 12) + 12) % 12).toBe(key.tonic)
      }
    }
  })

  it('语境时长随题目时长伸缩（L2）', () => {
    const short = buildTonalContext({ ...base, key: C_MAJOR, level: 2, itemDurSec: 2 })
    const long = buildTonalContext({ ...base, key: C_MAJOR, level: 2, itemDurSec: 8 })
    expect(long.plan.events[0].durSec).toBeGreaterThan(short.plan.events[0].durSec)
  })
})
