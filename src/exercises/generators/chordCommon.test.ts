import { describe, expect, it } from 'vitest'
import type { Chord } from '../../music/chord'
import type { Key } from '../../music/key'
import { midiToFreq } from '../../music/pitch'
import { SING_NOTE_SEC } from './degree'
import {
  ARPEGGIO_STEP_SEC,
  chordMidis,
  chordNotes,
  chordRootMidi,
  chordSlotSec,
  degreeAbove,
  fitItem,
  pitchTargets,
  sungSequence,
} from './chordCommon'

const C: Key = { tonic: 0, mode: 'major' }
const Am: Key = { tonic: 9, mode: 'minor' }
const chord = (rootDegree: Chord['rootDegree'], quality: Chord['quality'] = 'maj'): Chord => ({
  rootDegree, quality, inversion: 0,
})

describe('chordRootMidi / chordMidis：根音以主音为锚', () => {
  it('C 大调 doMidi=60：V 的根音 G 落在 67（主音之上），原位密集', () => {
    expect(chordRootMidi(chord('sol'), C, 60)).toBe(67)
    expect(chordMidis(chord('sol'), C, 60)).toEqual([67, 71, 74])
  })

  it('a 小调 doMidi=48（主音 la=57）：i 的根音落在 57，iv 的根音 re 落在 62', () => {
    expect(chordMidis(chord('la', 'min'), Am, 48)).toEqual([57, 60, 64])
    expect(chordRootMidi(chord('re', 'min'), Am, 48)).toBe(62)
  })

  it('根音总在 [主音, 主音+11]', () => {
    for (const d of ['do', 're', 'mi', 'fa', 'sol', 'la', 'ti', 'te', 'le'] as const) {
      const r = chordRootMidi(chord(d), C, 60)
      expect(r).toBeGreaterThanOrEqual(60)
      expect(r).toBeLessThanOrEqual(71)
    }
  })
})

describe('degreeAbove', () => {
  it('按半音数求上方音级', () => {
    expect(degreeAbove('do', 4)).toBe('mi')
    expect(degreeAbove('sol', 4)).toBe('ti')
    expect(degreeAbove('la', 3)).toBe('do')
    expect(degreeAbove('ti', 2)).toBe('ra')
  })
})

describe('chordNotes', () => {
  it('block：同时起音、同时值、同 gain', () => {
    const notes = chordNotes([60, 64, 67], 1, 0.8, 0.7, 'block', 90)
    expect(notes.map((n) => n.atSec)).toEqual([1, 1, 1])
    expect(notes.every((n) => n.durSec === 0.8 && n.gain === 0.7)).toBe(true)
  })

  it('arpeggio：依次起音，步长随速度缩放，全部在同一时刻结束', () => {
    const notes = chordNotes([60, 64, 67], 0, 0.9, 0.7, 'arpeggio', 90)
    expect(notes.map((n) => n.atSec)).toEqual([0, ARPEGGIO_STEP_SEC, 2 * ARPEGGIO_STEP_SEC])
    for (const n of notes) expect(n.atSec + n.durSec).toBeCloseTo(0.9, 12)
  })

  it('chordSlotSec：两拍', () => {
    expect(chordSlotSec(120)).toBeCloseTo(1, 12)
  })
})

describe('fitItem：三组音高整体移同一个八度', () => {
  it('低音区的题整体上移，组内与组间音程不变', () => {
    const item = {
      notes: [{ midi: 25, atSec: 0, durSec: 1 }, { midi: 60, atSec: 0, durSec: 1 }],
      feedbackNotes: [{ midi: 30, atSec: 0, durSec: 1 }],
      targetMidis: [40],
    }
    const fit = fitItem(item)
    expect(fit.notes.map((n) => n.midi)).toEqual([37, 72])
    expect(fit.feedbackNotes.map((n) => n.midi)).toEqual([42])
    expect(fit.targetMidis).toEqual([52])
  })

  it('已在区间内则原样返回，且不修改输入', () => {
    const item = { notes: [{ midi: 60, atSec: 0, durSec: 1 }], feedbackNotes: [], targetMidis: [] }
    expect(fitItem(item)).toEqual(item)
    expect(item.notes[0].midi).toBe(60)
  })
})

describe('pitchTargets / sungSequence', () => {
  it('目标音带频率与 50 音分容差', () => {
    expect(pitchTargets(['do', 'mi'], [60, 64])).toEqual([
      { degree: 'do', midi: 60, freqHz: midiToFreq(60), centsTolerance: 50 },
      { degree: 'mi', midi: 64, freqHz: midiToFreq(64), centsTolerance: 50 },
    ])
  })

  it('长度不一致时抛错', () => {
    expect(() => pitchTargets(['do'], [60, 64])).toThrow()
  })

  it('依次排开，每个音 SING_NOTE_SEC', () => {
    const seq = sungSequence([60, 64], 0.8, 2)
    expect(seq).toEqual([
      { midi: 60, atSec: 2, durSec: SING_NOTE_SEC, gain: 0.8 },
      { midi: 64, atSec: 2 + SING_NOTE_SEC, durSec: SING_NOTE_SEC, gain: 0.8 },
    ])
  })
})
