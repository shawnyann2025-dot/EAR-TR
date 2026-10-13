import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../../curriculum/curriculum'
import {
  METERS,
  MIXED_COMBOS,
  PATTERNS,
  PICKUPS,
  RHYTHM_ENTRIES,
  patternById,
  patternsOf,
  requireRhythmEntry,
  rhythmEntry,
  rhythmPoolOf,
} from './rhythms'

const c = buildCurriculum()
const R_KPS = [...c.knowledgePoints.values()].filter((kp) => kp.track === 'R').map((kp) => kp.id)

describe('R 轨数据表覆盖', () => {
  it('课程里每个 R 轨知识点恰好有一行，且没有多余的行', () => {
    expect(RHYTHM_ENTRIES.map((e) => e.kpId).sort()).toEqual([...R_KPS].sort())
  })

  it('共 15 个，kpId 不重复；家族与池一致', () => {
    expect(RHYTHM_ENTRIES).toHaveLength(15)
    expect(new Set(RHYTHM_ENTRIES.map((e) => e.kpId)).size).toBe(15)
    for (const e of RHYTHM_ENTRIES) expect(e.pool).toBe(e.family)
  })

  it('家族划分（P-2b spec §7.4）', () => {
    const fam = (f: string) => RHYTHM_ENTRIES.filter((e) => e.family === f).map((e) => e.kpId).sort()
    expect(fam('pattern')).toHaveLength(9)
    expect(fam('meter')).toEqual(['rhythm:meter-2-4', 'rhythm:meter-3-4', 'rhythm:meter-6-8'])
    expect(fam('beat-one')).toEqual(['rhythm:beat-one'])
    expect(fam('anacrusis')).toEqual(['rhythm:anacrusis'])
    expect(fam('mixed-meter')).toEqual(['rhythm:mixed-meter'])
  })

  it('拍号类带 meterId；6/8 按记谱拍数填写（FWD-6）', () => {
    expect(requireRhythmEntry('rhythm:meter-3-4').meterId).toBe('3/4')
    expect(requireRhythmEntry('rhythm:meter-6-8').meterId).toBe('6/8')
    expect(METERS['6/8']).toEqual({ beatsPerBar: 6, beatUnit: 8 })
  })
})

describe('音型库', () => {
  it('id 唯一；每个音型的起音集合互不相同（打拍题靠起音判定）', () => {
    expect(new Set(PATTERNS.map((p) => p.id)).size).toBe(PATTERNS.length)
    const onsetKeys = PATTERNS.map((p) => p.notes.map((n) => n.onset.toFixed(4)).join(','))
    expect(new Set(onsetKeys).size).toBe(PATTERNS.length)
  })

  it('每个音型类知识点至少拥有 1 个音型；音型的主人都是音型类知识点', () => {
    for (const e of RHYTHM_ENTRIES.filter((x) => x.family === 'pattern')) {
      expect(patternsOf(e.kpId).length).toBeGreaterThanOrEqual(1)
    }
    for (const p of PATTERNS) expect(rhythmEntry(p.ownerKpId)?.family).toBe('pattern')
  })

  it('每个音型：起音升序、从 0 开始、时值为正、不越出自己的小节数，相邻音不重叠', () => {
    for (const p of PATTERNS) {
      expect(p.notes[0].onset).toBe(0)
      for (let i = 0; i < p.notes.length; i++) {
        const n = p.notes[i]
        expect(n.dur).toBeGreaterThan(0)
        expect(n.onset + n.dur).toBeLessThanOrEqual(p.bars * 4 + 1e-9)
        if (i > 0) expect(n.onset).toBeGreaterThanOrEqual(p.notes[i - 1].onset + p.notes[i - 1].dur - 1e-9)
      }
    }
  })

  it('两小节音型恰好两个，都属于跨小节连线；可作目标的没有第二小节第一拍起音，对比用的有', () => {
    const two = PATTERNS.filter((p) => p.bars === 2)
    expect(two).toHaveLength(2)
    expect(two.every((p) => p.ownerKpId === 'rhythm:tie-across-bar')).toBe(true)
    const target = two.filter((p) => p.targetable !== false)
    const contrast = two.filter((p) => p.targetable === false)
    expect(target).toHaveLength(1)
    expect(contrast).toHaveLength(1)
    expect(target[0].notes.some((n) => Math.abs(n.onset - 4) < 1e-9)).toBe(false)
    expect(target[0].notes.some((n) => n.onset < 4 && n.onset + n.dur > 4)).toBe(true)
    expect(contrast[0].notes.some((n) => Math.abs(n.onset - 4) < 1e-9)).toBe(true)
    expect(patternsOf('rhythm:tie-across-bar')).toEqual(target)
  })

  it('每个对比用音型所属的知识点，至少还拥有一个可作目标的音型', () => {
    for (const p of PATTERNS.filter((x) => x.targetable === false)) {
      expect(
        PATTERNS.some((q) => q.ownerKpId === p.ownerKpId && q.targetable !== false),
      ).toBe(true)
    }
  })

  it('patternById 找不到抛错', () => {
    expect(() => patternById('nope')).toThrow(/nope/)
  })
})

describe('弱起与混合拍子', () => {
  it('弱起：none 无音；half 是第四拍后半；one 是第四拍', () => {
    expect(PICKUPS.none).toEqual([])
    expect(PICKUPS.half).toEqual([{ onset: 3.5, dur: 0.5 }])
    expect(PICKUPS.one).toEqual([{ onset: 3, dur: 1 }])
  })

  it('混合拍子组合：id 等于拍号用 + 连接，互不相同，至少两种不同拍号', () => {
    expect(new Set(MIXED_COMBOS.map((m) => m.id)).size).toBe(MIXED_COMBOS.length)
    for (const m of MIXED_COMBOS) {
      expect(m.id).toBe(m.meters.join('+'))
      expect(new Set(m.meters).size).toBeGreaterThan(1)
    }
  })
})

describe('查找', () => {
  it('未知 kpId', () => {
    expect(rhythmEntry('chord:I')).toBeUndefined()
    expect(rhythmPoolOf('chord:I')).toBeUndefined()
    expect(() => requireRhythmEntry('rhythm:nope')).toThrow(/rhythm:nope/)
  })
})
