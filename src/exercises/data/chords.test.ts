import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../../curriculum/curriculum'
import { QUALITY_INTERVALS } from '../../music/chord'
import { degreeAbove } from '../generators/chordCommon'
import {
  BASSLINE_PATTERNS,
  CHORD_ENTRIES,
  INVERSION_CHORD_IDS,
  TONIC_CHORD_ID,
  chordEntry,
  chordPoolOf,
  functionalChord,
  requireChordEntry,
} from './chords'

const c = buildCurriculum()
const H_KPS = [...c.knowledgePoints.values()].filter((kp) => kp.track === 'H').map((kp) => kp.id)

describe('H 轨数据表覆盖', () => {
  it('课程里每个 H 轨知识点恰好有一行，且没有多余的行', () => {
    expect(CHORD_ENTRIES.map((e) => e.kpId).sort()).toEqual([...H_KPS].sort())
  })

  it('共 26 个知识点，kpId 不重复', () => {
    expect(CHORD_ENTRIES).toHaveLength(26)
    expect(new Set(CHORD_ENTRIES.map((e) => e.kpId)).size).toBe(26)
  })

  it('同一池内 answerId 不重复（否则选项 id 会撞）', () => {
    const pools = new Set(CHORD_ENTRIES.map((e) => e.pool))
    for (const pool of pools) {
      const ids = CHORD_ENTRIES.filter((e) => e.pool === pool).map((e) => e.answerId)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

describe('音乐含义', () => {
  const chordOf = (kp: string) => {
    const e = requireChordEntry(kp)
    if (e.family !== 'functional') throw new Error(`${kp} 不是功能和弦`)
    return e.chord
  }

  it('大调功能和弦', () => {
    expect(chordOf('chord:I')).toEqual({ rootDegree: 'do', quality: 'maj', inversion: 0 })
    expect(chordOf('chord:V7')).toEqual({ rootDegree: 'sol', quality: 'dom7', inversion: 0 })
    expect(chordOf('chord:ii7')).toEqual({ rootDegree: 're', quality: 'min7', inversion: 0 })
    expect(chordOf('chord:V-of-V')).toEqual({ rootDegree: 're', quality: 'maj', inversion: 0 })
    expect(chordOf('chord:borrowed-bVI')).toEqual({ rootDegree: 'le', quality: 'maj', inversion: 0 })
    expect(chordOf('chord:borrowed-bVII')).toEqual({ rootDegree: 'te', quality: 'maj', inversion: 0 })
  })

  it('小调功能和弦（la 基）', () => {
    expect(chordOf('chord:i')).toEqual({ rootDegree: 'la', quality: 'min', inversion: 0 })
    expect(chordOf('chord:iv')).toEqual({ rootDegree: 're', quality: 'min', inversion: 0 })
    expect(chordOf('chord:III')).toEqual({ rootDegree: 'do', quality: 'maj', inversion: 0 })
    expect(chordOf('chord:VI')).toEqual({ rootDegree: 'fa', quality: 'maj', inversion: 0 })
    expect(chordOf('chord:VII')).toEqual({ rootDegree: 'sol', quality: 'maj', inversion: 0 })
    for (const kp of ['chord:i', 'chord:iv', 'chord:III', 'chord:VI', 'chord:VII']) {
      expect(requireChordEntry(kp)).toMatchObject({ mode: 'minor', pool: 'minor-functional' })
    }
  })

  it('副属与借用归大调功能池', () => {
    for (const kp of ['chord:V-of-V', 'chord:borrowed-bVI', 'chord:borrowed-bVII']) {
      expect(requireChordEntry(kp)).toMatchObject({ mode: 'major', pool: 'major-functional' })
    }
  })

  it('进行的 answerId 等于和弦 id 用 - 连接，且每个和弦都能在同调式的功能和弦里找到', () => {
    for (const e of CHORD_ENTRIES) {
      if (e.family !== 'progression') continue
      expect(e.answerId).toBe(e.chordIds.join('-'))
      for (const id of e.chordIds) expect(() => functionalChord(e.mode, id)).not.toThrow()
    }
    expect(requireChordEntry('prog:i-VI-III-VII')).toMatchObject({ mode: 'minor', pool: 'minor-progression' })
  })

  it('品质与转位', () => {
    expect(requireChordEntry('chord:quality-min')).toMatchObject({ family: 'quality', quality: 'min', answerId: 'min' })
    expect(requireChordEntry('chord:inv-second')).toMatchObject({ family: 'inversion', inversion: 2, answerId: 'second' })
    expect(requireChordEntry('chord:bassline')).toMatchObject({ family: 'bassline', pool: 'bassline' })
  })

  it('主和弦 id 与转位题用的和弦都存在', () => {
    expect(functionalChord('major', TONIC_CHORD_ID.major).rootDegree).toBe('do')
    expect(functionalChord('minor', TONIC_CHORD_ID.minor).rootDegree).toBe('la')
    for (const id of INVERSION_CHORD_IDS) expect(() => functionalChord('major', id)).not.toThrow()
  })
})

describe('低音线模板', () => {
  it('4 条，id 互不相同，id 等于各步低音音级用 - 连接', () => {
    expect(BASSLINE_PATTERNS).toHaveLength(4)
    expect(new Set(BASSLINE_PATTERNS.map((p) => p.id)).size).toBe(4)
    for (const p of BASSLINE_PATTERNS) {
      const bass = p.steps.map((s) => {
        const ch = functionalChord('major', s.chordId)
        return degreeAbove(ch.rootDegree, QUALITY_INTERVALS[ch.quality][s.inversion])
      })
      expect(bass.join('-')).toBe(p.id)
    }
  })
})

describe('查找', () => {
  it('未知 kpId', () => {
    expect(chordEntry('degree:major:do')).toBeUndefined()
    expect(chordPoolOf('degree:major:do')).toBeUndefined()
    expect(() => requireChordEntry('chord:nope')).toThrow(/chord:nope/)
    expect(() => functionalChord('minor', 'V7')).toThrow(/V7/)
  })
})
