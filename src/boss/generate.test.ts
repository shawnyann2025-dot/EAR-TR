import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import type { PhaseId } from '../curriculum/stages'
import { DEGREE_SEMITONES, MAJOR_SCALE_DEGREES } from '../music/key'
import {
  BOSS_BARS,
  BOSS_PARTS,
  CHROMATIC_CHORDS,
  MAX_LEAP_ST,
  STABLE_DEGREES,
  chordTones,
  generateBoss,
  keyDoOffset,
  melodyPitch,
  semitoneApart,
} from './generate'
import { bossMaterial } from './material'
import { PHRASE_BARS } from './types'

const c = buildCurriculum()
const PHASES: PhaseId[] = ['P1', 'P2', 'P3', 'P4', 'P5']

describe('generateBoss：结构', () => {
  for (const phaseId of PHASES) {
    it(`${phaseId}：小节数、作答部分、乐句切分、答案与片段一致`, () => {
      for (let seed = 0; seed < 20; seed++) {
        const ch = generateBoss(c, phaseId, seed)
        const p = ch.piece
        expect(p.bars).toBe(BOSS_BARS[phaseId])
        expect(ch.parts).toEqual(BOSS_PARTS[phaseId])
        expect(ch.phrases).toHaveLength(p.bars / PHRASE_BARS)
        expect(ch.phrases.map((ph) => ph.melodyCount)).toEqual(ch.answer.melody.map((m) => m.length))
        expect(ch.answer.melody.flat()).toEqual(p.melody.map((n) => n.degree))
        if (p.chords) expect(p.chords).toHaveLength(p.bars)
        if (ch.parts.includes('rhythm')) expect(ch.answer.rhythm).toHaveLength(p.bars)
      }
    })
  }
})

describe('generateBoss：素材约束（只用已解锁的）', () => {
  for (const phaseId of PHASES) {
    it(`${phaseId}`, () => {
      const m = bossMaterial(c, phaseId)
      for (let seed = 0; seed < 30; seed++) {
        const ch = generateBoss(c, phaseId, seed)
        for (const n of ch.piece.melody) expect(m.melodyDegrees).toContain(n.degree)
        for (const id of ch.piece.chords ?? []) expect(m.chordIds).toContain(id)
        for (const id of ch.piece.rhythm ?? []) expect(m.patternIds).toContain(id)
        expect(m.meters).toContain(ch.piece.meterId)
      }
    })
  }
})

describe('generateBoss：音乐性约束', () => {
  it('每句末音是稳定音级；全曲末音是 do', () => {
    for (const phaseId of PHASES) {
      for (let seed = 0; seed < 20; seed++) {
        const ch = generateBoss(c, phaseId, seed)
        for (const ph of ch.answer.melody) expect(STABLE_DEGREES).toContain(ph.at(-1))
        expect(ch.answer.melody.at(-1)!.at(-1)).toBe('do')
      }
    }
  })
  it('有和弦时每小节第一个音是和弦音（若该和弦音在可用音级内）', () => {
    for (const phaseId of ['P3', 'P4', 'P5'] as const) {
      for (let seed = 0; seed < 20; seed++) {
        const ch = generateBoss(c, phaseId, seed)
        const barBeats = 4
        for (let bar = 0; bar < ch.piece.bars; bar++) {
          const first = ch.piece.melody.find((n) => n.atBeat >= bar * barBeats && n.atBeat < (bar + 1) * barBeats)!
          const tones = chordTones(ch.piece.chords![bar]).filter((d) => bossMaterial(c, phaseId).melodyDegrees.includes(d))
          const isPhraseEnd = (bar + 1) % 2 === 0 && first === ch.piece.melody.filter((n) => n.atBeat < (bar + 1) * barBeats).at(-1)
          if (tones.length > 0 && !isPhraseEnd) expect(tones).toContain(first.degree)
        }
      }
    }
  })
  it('有和弦时句末音优先落在该小节的稳定和弦音上；末小节和弦含 do', () => {
    for (const phaseId of ['P3', 'P4', 'P5'] as const) {
      const degrees = bossMaterial(c, phaseId).melodyDegrees
      for (let seed = 0; seed < 30; seed++) {
        const ch = generateBoss(c, phaseId, seed)
        const chords = ch.piece.chords!
        expect(chordTones(chords.at(-1)!)).toContain('do')
        ch.phrases.forEach((ph, i) => {
          const chord = chords[ph.endBar - 1]
          const last = ch.answer.melody[i].at(-1)!
          const cadence = STABLE_DEGREES.filter((d) => degrees.includes(d) && chordTones(chord).includes(d))
          if (i < ch.phrases.length - 1 && cadence.length > 0) expect(cadence).toContain(last)
        })
      }
    }
  })
  it('P4：倒数第二小节是 V 或 V7，最后一小节是 I', () => {
    for (let seed = 0; seed < 20; seed++) {
      const ch = generateBoss(c, 'P4', seed).piece.chords!
      expect(['V', 'V7']).toContain(ch.at(-2))
      expect(ch.at(-1)).toBe('I')
    }
  })
  it('旋律音域 ≤ 16 半音、相邻音程 ≤ 7 半音（按 octave 与所在调计）', () => {
    for (const phaseId of PHASES) {
      for (let seed = 0; seed < 50; seed++) {
        const p = generateBoss(c, phaseId, seed).piece
        const pitches = p.melody.map((n) => melodyPitch(p, n))
        expect(Math.max(...pitches) - Math.min(...pitches)).toBeLessThanOrEqual(16)
        for (let i = 1; i < pitches.length; i++) expect(Math.abs(pitches[i] - pitches[i - 1])).toBeLessThanOrEqual(MAX_LEAP_ST)
        expect(MAX_LEAP_ST).toBe(7)
      }
    }
  })
  it('半音外色和弦（bVI、bVII、V/V）的小节里，旋律音不与和弦音成小二度', () => {
    let checked = 0
    for (let seed = 0; seed < 50; seed++) {
      const p = generateBoss(c, 'P5', seed).piece
      p.chords!.forEach((chord, bar) => {
        if (!CHROMATIC_CHORDS.includes(chord)) return
        const tones = chordTones(chord)
        for (const n of p.melody.filter((x) => x.atBeat >= bar * 4 && x.atBeat < (bar + 1) * 4)) {
          checked++
          expect(tones.some((t) => semitoneApart(n.degree, t))).toBe(false)
        }
      })
    }
    expect(checked).toBeGreaterThan(0)
  })
  it('每句末小节的最后一个音起在拍上（不是反拍八分音）', () => {
    for (const phaseId of PHASES) {
      for (let seed = 0; seed < 50; seed++) {
        const ch = generateBoss(c, phaseId, seed)
        let at = 0
        for (const ph of ch.phrases) {
          at += ph.melodyCount
          expect(Number.isInteger(ch.piece.melody[at - 1].atBeat)).toBe(true)
        }
      }
    }
  })
  it('P4：和声不在倒数第三、二小节连用属和弦；会用到 ii7、vi7；转位只出现在 P4', () => {
    const seen = new Set<string>()
    let withInversion = 0
    for (let seed = 0; seed < 50; seed++) {
      const p = generateBoss(c, 'P4', seed).piece
      const chords = p.chords!
      expect(['V', 'V7']).not.toContain(chords.at(-3))
      chords.forEach((id) => seen.add(id))
      expect(p.inversions).toHaveLength(p.bars)
      expect(p.inversions![0]).toBe(0)
      expect(p.inversions!.at(-1)).toBe(0)
      if (p.inversions!.includes(1)) withInversion++
    }
    expect(seen.has('ii7')).toBe(true)
    expect(seen.has('vi7')).toBe(true)
    expect(withInversion).toBeGreaterThan(0)
    for (const phaseId of ['P1', 'P2', 'P3'] as const) {
      for (let seed = 0; seed < 50; seed++) expect(generateBoss(c, phaseId, seed).piece.inversions ?? []).not.toContain(1)
    }
  })
  it('P5：新调第 7 小节是 V7；后 4 小节含原调外的音（属调 fi、下属调 te）', () => {
    expect(bossMaterial(c, 'P5').chordIds).toContain('V7')
    const diatonic = new Set(MAJOR_SCALE_DEGREES.map((d) => DEGREE_SEMITONES[d]))
    for (let seed = 0; seed < 50; seed++) {
      const ch = generateBoss(c, 'P5', seed)
      const p = ch.piece
      expect(p.chords![6]).toBe('V7')
      const shift = (((keyDoOffset(p.keys, 1) % 12) + 12) % 12)
      const inOld = (st: number) => (((st + shift) % 12) + 12) % 12
      const pcs = new Set<number>()
      for (let bar = 4; bar < 8; bar++) for (const d of chordTones(p.chords![bar])) pcs.add(inOld(DEGREE_SEMITONES[d]))
      for (const n of p.melody.filter((x) => x.keyIndex === 1)) pcs.add(inOld(DEGREE_SEMITONES[n.degree]))
      expect([...pcs].some((pc) => !diatonic.has(pc))).toBe(true)
      const v7InOld = chordTones('V7').map((d) => inOld(DEGREE_SEMITONES[d]))
      expect(v7InOld).toContain(DEGREE_SEMITONES[ch.answer.newTonic === 'sol' ? 'fi' : 'te'])
    }
  })
  it('P5：第 5 小节转调；新调是属调或下属调，答案一致', () => {
    for (let seed = 0; seed < 20; seed++) {
      const ch = generateBoss(c, 'P5', seed)
      const [k0, k1] = ch.piece.keys
      const up = (k1.tonic - k0.tonic + 12) % 12
      expect(ch.piece.modulationBar).toBe(4)
      expect([5, 7]).toContain(up)
      expect(ch.answer.newTonic).toBe(up === 7 ? 'sol' : 'fa')
      expect(ch.alphabets.newTonic).toEqual(['re', 'fa', 'sol', 'la'])
    }
  })
  it('chordTones', () => {
    expect(chordTones('I')).toEqual(['do', 'mi', 'sol'])
    expect(chordTones('V7')).toEqual(['sol', 'ti', 're', 'fa'])
    expect(chordTones('bVII')).toEqual(['te', 're', 'fa'])
  })
})

describe('generateBoss：确定性与快照', () => {
  it('同一 seed 同一关卡', () => {
    expect(generateBoss(c, 'P3', 42)).toEqual(generateBoss(c, 'P3', 42))
  })
  for (const phaseId of PHASES) {
    it(`${phaseId} seed 1 快照`, () => {
      expect(generateBoss(c, phaseId, 1)).toMatchSnapshot()
    })
  }
  // 覆盖 P1 的三种拍号与 P5 的两种转调方向
  const EXTRA: { phaseId: PhaseId; seed: number; meter?: string; newTonic?: string }[] = [
    { phaseId: 'P1', seed: 0, meter: '2/4' },
    { phaseId: 'P1', seed: 1, meter: '3/4' },
    { phaseId: 'P1', seed: 2, meter: '4/4' },
    { phaseId: 'P5', seed: 0, newTonic: 'sol' },
    { phaseId: 'P5', seed: 5, newTonic: 'fa' },
  ]
  for (const e of EXTRA) {
    it(`${e.phaseId} seed ${e.seed} 快照（${e.meter ?? e.newTonic}）`, () => {
      const ch = generateBoss(c, e.phaseId, e.seed)
      if (e.meter) expect(ch.piece.meterId).toBe(e.meter)
      if (e.newTonic) expect(ch.answer.newTonic).toBe(e.newTonic)
      expect(ch).toMatchSnapshot()
    })
  }
})
