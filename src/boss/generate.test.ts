import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import type { PhaseId } from '../curriculum/stages'
import { BOSS_BARS, BOSS_PARTS, STABLE_DEGREES, chordTones, generateBoss } from './generate'
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
    for (const phaseId of ['P3', 'P4'] as const) {
      const ch = generateBoss(c, phaseId, 7)
      const barBeats = 4
      for (let bar = 0; bar < ch.piece.bars; bar++) {
        const first = ch.piece.melody.find((n) => n.atBeat >= bar * barBeats && n.atBeat < (bar + 1) * barBeats)!
        const tones = chordTones(ch.piece.chords![bar]).filter((d) => bossMaterial(c, phaseId).melodyDegrees.includes(d))
        const isPhraseEnd = (bar + 1) % 2 === 0 && first === ch.piece.melody.filter((n) => n.atBeat < (bar + 1) * barBeats).at(-1)
        if (tones.length > 0 && !isPhraseEnd) expect(tones).toContain(first.degree)
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
})
