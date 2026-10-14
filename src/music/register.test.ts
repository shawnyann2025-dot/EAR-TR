import { describe, expect, it } from 'vitest'
import { foldPlanToRange, doMidiForKey, degreeToMidi, degreeToMidiFromTonic, tonicMidi } from './register'
import type { PlaybackPlan } from './playback'
import { generateBoss } from '../boss/generate'
import { renderPiece } from '../boss/render'
import { buildCurriculum } from '../curriculum/curriculum'
import { degreeToPitchClass, SCALE_DEGREES, type Key } from './key'

const C_MAJOR: Key = { tonic: 0, mode: 'major' }
const A_MINOR: Key = { tonic: 9, mode: 'minor' }

describe('doMidiForKey', () => {
  it('C 大调、中心 60 → do 落在 MIDI 60', () => {
    expect(doMidiForKey(C_MAJOR, 60)).toBe(60)
  })

  it('A 小调、中心 60 → do 是 C，落在 MIDI 60', () => {
    expect(doMidiForKey(A_MINOR, 60)).toBe(60)
  })

  it('落位的音类始终等于该调的 do', () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const mode of ['major', 'minor'] as const) {
        const key: Key = { tonic, mode }
        const midi = doMidiForKey(key, 60)
        expect(((midi % 12) + 12) % 12).toBe(degreeToPitchClass('do', key))
      }
    }
  })

  it('落位始终在中心音的半个八度以内', () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const center of [48, 60, 72]) {
        const midi = doMidiForKey({ tonic, mode: 'major' }, center)
        expect(Math.abs(midi - center)).toBeLessThanOrEqual(6)
      }
    }
  })
})

describe('degreeToMidi', () => {
  it('C 大调 do=60 时，mi=64、sol=67、ti=71', () => {
    expect(degreeToMidi('mi', 60)).toBe(64)
    expect(degreeToMidi('sol', 60)).toBe(67)
    expect(degreeToMidi('ti', 60)).toBe(71)
  })

  it('产出的 MIDI 音类与 degreeToPitchClass 一致（属性测试）', () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const mode of ['major', 'minor'] as const) {
        const key: Key = { tonic, mode }
        const doMidi = doMidiForKey(key, 60)
        for (const degree of SCALE_DEGREES) {
          const midi = degreeToMidi(degree, doMidi)
          expect(midi % 12).toBe(degreeToPitchClass(degree, key))
        }
      }
    }
  })
})

describe('tonicMidi', () => {
  it('大调主音等于 do', () => {
    expect(tonicMidi(C_MAJOR, 60)).toBe(60)
  })

  it('A 小调、do=60 时主音 la = MIDI 69', () => {
    expect(tonicMidi(A_MINOR, 60)).toBe(69)
  })
})

describe('degreeToMidiFromTonic', () => {
  it('大调与 degreeToMidi 一致', () => {
    for (const d of SCALE_DEGREES) {
      expect(degreeToMidiFromTonic(d, C_MAJOR, 60)).toBe(degreeToMidi(d, 60))
    }
  })

  it('小调：音级落在 [主音, 主音+11]，la=主音，do=主音+3，ti=主音+2', () => {
    const tonic = tonicMidi(A_MINOR, 57)
    for (const d of SCALE_DEGREES) {
      const m = degreeToMidiFromTonic(d, A_MINOR, 57)
      expect(m).toBeGreaterThanOrEqual(tonic)
      expect(m).toBeLessThanOrEqual(tonic + 11)
    }
    expect(degreeToMidiFromTonic('la', A_MINOR, 57)).toBe(tonic)
    expect(degreeToMidiFromTonic('do', A_MINOR, 57)).toBe(tonic + 3)
    expect(degreeToMidiFromTonic('ti', A_MINOR, 57)).toBe(tonic + 2)
    expect(degreeToMidiFromTonic('le', A_MINOR, 57)).toBe(tonic + 11)
  })
})

describe('foldPlanToRange：鼓事件', () => {
  const plan: PlaybackPlan = {
    events: [
      { atSec: 0, freqHz: 0, durSec: 0.1, timbreId: 'piano', gain: 1, drum: 'kick' },
      { atSec: 0, freqHz: 0, durSec: 0.1, timbreId: 'piano', gain: 1 },
      { atSec: 0.5, freqHz: 110, durSec: 0.5, timbreId: 'piano', gain: 1 },
    ],
    totalDurSec: 1,
  }
  it('含鼓（或频率为 0）的计划能折叠完成，鼓事件原样不动', () => {
    const out = foldPlanToRange(plan, 60, 84)
    expect(out.events[0]).toBe(plan.events[0])
    expect(out.events[1]).toBe(plan.events[1])
    expect(out.events[2].freqHz).toBeCloseTo(440)
  })
  it('渲染出的实战关计划穿过 foldPlanToRange 不挂死', { timeout: 2000 }, () => {
    const ch = generateBoss(buildCurriculum(), 'P4', 3)
    const r = renderPiece(ch.piece)
    const out = foldPlanToRange(r.plan, 36, 96)
    expect(out.events).toHaveLength(r.plan.events.length)
    for (const [i, e] of out.events.entries()) if (e.drum) expect(e).toBe(r.plan.events[i])
  })
})
