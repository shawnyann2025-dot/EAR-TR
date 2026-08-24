import { describe, expect, it } from 'vitest'
import { doMidiForKey, degreeToMidi, tonicMidi } from './register'
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
