import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import type { PhaseId } from '../curriculum/stages'
import { functionalChord } from '../exercises/data/chords'
import { QUALITY_INTERVALS } from '../music/chord'
import { DEGREE_SEMITONES } from '../music/key'
import { freqToMidi } from '../music/pitch'
import { generateBoss } from './generate'
import { allPitchedMidis, phrasePlan, renderPiece } from './render'

const c = buildCurriculum()
const PHASES: PhaseId[] = ['P1', 'P2', 'P3', 'P4', 'P5']

describe('renderPiece（P-5 spec §3.1）', () => {
  it('乐句窗口首尾相接、覆盖全曲、互不重叠', () => {
    for (const phaseId of PHASES) {
      const ch = generateBoss(c, phaseId, 3)
      const r = renderPiece(ch.piece)
      expect(r.phrases).toHaveLength(ch.phrases.length)
      expect(r.phrases[0].startSec).toBeCloseTo(r.countInSec)
      for (let i = 1; i < r.phrases.length; i++) expect(r.phrases[i].startSec).toBeCloseTo(r.phrases[i - 1].endSec)
      expect(r.phrases.at(-1)!.endSec).toBeCloseTo(r.countInSec + ch.piece.bars * r.barSec)
    }
  })

  it('所有有音高的声部在 MIDI 36–96（FWD-4）', () => {
    for (const phaseId of PHASES) {
      for (let seed = 0; seed < 15; seed++) {
        const midis = allPitchedMidis(renderPiece(generateBoss(c, phaseId, seed).piece).plan)
        expect(Math.min(...midis)).toBeGreaterThanOrEqual(36 - 1e-6)
        expect(Math.max(...midis)).toBeLessThanOrEqual(96 + 1e-6)
      }
    }
  })

  it('旋律相邻音程不超过 7 半音，且旋律音都在 MIDI 36–96', () => {
    for (const phaseId of PHASES) {
      for (let seed = 0; seed < 20; seed++) {
        const r = renderPiece(generateBoss(c, phaseId, seed).piece)
        const mel = r.plan.events.filter((e) => !e.drum && e.timbreId === 'piano' && e.gain > 0.85).map((e) => freqToMidi(e.freqHz))
        for (const m of mel) {
          expect(m).toBeGreaterThanOrEqual(36 - 1e-6)
          expect(m).toBeLessThanOrEqual(96 + 1e-6)
        }
        for (let i = 1; i < mel.length; i++) expect(Math.abs(mel[i] - mel[i - 1])).toBeLessThanOrEqual(7 + 1e-6)
      }
    }
  })

  it('旋律音数等于片段旋律音数；有和弦的关卡有和弦与低音事件', () => {
    const ch = generateBoss(c, 'P3', 5)
    const r = renderPiece(ch.piece)
    const melodyEvents = r.plan.events.filter((e) => !e.drum && e.timbreId === 'piano' && e.gain > 0.85)
    expect(melodyEvents).toHaveLength(ch.piece.melody.length)
    expect(r.plan.events.some((e) => e.timbreId === 'strings')).toBe(true)
  })

  it('P4 第一转位的小节，低音是和弦的三音', () => {
    let checked = 0
    for (let seed = 0; seed < 20; seed++) {
      const piece = generateBoss(c, 'P4', seed).piece
      if (!piece.inversions) continue
      const r = renderPiece(piece)
      piece.inversions.forEach((inv, bar) => {
        if (inv !== 1) return
        const at0 = r.countInSec + bar * r.barSec
        const bass = r.plan.events.find((e) => !e.drum && e.timbreId === 'piano' && e.gain < 0.85 && Math.abs(e.atSec - at0) < 1e-9)!
        const chord = functionalChord('major', piece.chords![bar])
        const thirdPc = (piece.keys[0].tonic + DEGREE_SEMITONES[chord.rootDegree] + QUALITY_INTERVALS[chord.quality][1]) % 12
        expect(Math.round(freqToMidi(bass.freqHz)) % 12).toBe(thirdPc)
        checked++
      })
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('鼓点落在拍网格上；预备拍是与拍号无关的 4 拍踩镲', () => {
    const ch = generateBoss(c, 'P4', 2)
    const r = renderPiece(ch.piece)
    const beatSec = r.barSec / 4
    for (const e of r.plan.events.filter((x) => x.drum)) {
      const halfBeats = e.atSec / (beatSec / 2)
      expect(Math.abs(halfBeats - Math.round(halfBeats))).toBeLessThan(1e-6)
    }
    const countIn = r.plan.events.filter((e) => e.drum && e.atSec < r.countInSec - 1e-9)
    expect(countIn.map((e) => e.drum)).toEqual(['hat', 'hat', 'hat', 'hat'])
  })

  it('预备拍对任何拍号都是 4 个等距踩镲，countInSec = 4 × 拍长', () => {
    const seen = new Set<string>()
    for (const seed of [0, 1, 2]) {
      const piece = generateBoss(c, 'P1', seed).piece
      seen.add(piece.meterId)
      const r = renderPiece(piece)
      const beatSec = 60 / piece.bpm
      expect(r.countInSec).toBeCloseTo(4 * beatSec)
      const countIn = r.plan.events.filter((e) => e.drum && e.atSec < r.countInSec - 1e-9)
      expect(countIn.map((e) => e.drum)).toEqual(['hat', 'hat', 'hat', 'hat'])
      countIn.forEach((e, i) => expect(e.atSec).toBeCloseTo(i * beatSec))
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('P1：每小节恰好一个底鼓且在第 1 拍，无军鼓（2/4、3/4、4/4）', () => {
    const meters = ['2/4', '3/4', '4/4']
    for (const [i, seed] of [0, 1, 2].entries()) {
      const piece = generateBoss(c, 'P1', seed).piece
      expect(piece.meterId).toBe(meters[i])
      const r = renderPiece(piece)
      const kicks = r.plan.events.filter((e) => e.drum === 'kick')
      expect(kicks).toHaveLength(piece.bars)
      kicks.forEach((k, bar) => expect(k.atSec).toBeCloseTo(r.countInSec + bar * r.barSec))
      expect(r.plan.events.some((e) => e.drum === 'snare')).toBe(false)
    }
  })

  it('phrasePlan：预备拍 + 该句的事件，平移到预备拍之后', () => {
    const ch = generateBoss(c, 'P2', 4)
    const r = renderPiece(ch.piece)
    const p = phrasePlan(r, 1)
    const win = r.phrases[1]
    const inWin = r.plan.events.filter((e) => e.atSec >= win.startSec - 1e-9 && e.atSec < win.endSec - 1e-9)
    const shifted = p.events.filter((e) => e.atSec >= r.countInSec - 1e-9)
    expect(shifted).toHaveLength(inWin.length)
    expect(shifted[0].atSec).toBeCloseTo(inWin[0].atSec - win.startSec + r.countInSec)
  })
})
