import type { Curriculum } from '../curriculum/curriculum'
import type { PhaseId } from '../curriculum/stages'
import { functionalChord } from '../exercises/data/chords'
import { METERS, patternById, type MeterId } from '../exercises/data/rhythms'
import { QUALITY_INTERVALS } from '../music/chord'
import { DEGREE_SEMITONES, SCALE_DEGREES, type Key, type ScaleDegree } from '../music/key'
import { makeRng, type Rng } from '../music/rng'
import { bossMaterial } from './material'
import { PHRASE_BARS, type BossChallenge, type MelodyNote, type PartId, type Phrase, type Piece } from './types'

export const BOSS_BARS: Record<PhaseId, number> = { P1: 8, P2: 16, P3: 8, P4: 8, P5: 8 }
export const BOSS_PARTS: Record<PhaseId, PartId[]> = {
  P1: ['melody', 'meter'],
  P2: ['melody'],
  P3: ['chords', 'melody'],
  P4: ['chords', 'melody', 'rhythm'],
  P5: ['chords', 'melody', 'newTonic'],
}
export const STABLE_DEGREES: ScaleDegree[] = ['do', 'mi', 'sol']

const NEW_TONIC_ALPHABET = ['re', 'fa', 'sol', 'la']
const P4_NEXT: Record<string, string[]> = {
  I: ['IV', 'V', 'vi', 'ii', 'Imaj7'],
  Imaj7: ['IV', 'vi'],
  ii: ['V', 'V7'],
  ii7: ['V', 'V7'],
  IV: ['V', 'I', 'ii'],
  V: ['I', 'vi'],
  V7: ['I', 'vi'],
  vi: ['IV', 'ii'],
  vi7: ['IV', 'ii'],
}

const degreeOfSemitone = (st: number): ScaleDegree =>
  SCALE_DEGREES.find((d) => DEGREE_SEMITONES[d] === ((st % 12) + 12) % 12)!

/** 大调本地级数 id 的和弦音（以 do 为参照的音级） */
export function chordTones(chordId: string): ScaleDegree[] {
  const ch = functionalChord('major', chordId)
  const root = DEGREE_SEMITONES[ch.rootDegree]
  return QUALITY_INTERVALS[ch.quality].map((i) => degreeOfSemitone(root + i))
}

function pickFrom<T>(rng: Rng, items: readonly T[], fallback: T): T {
  return items.length > 0 ? rng.pick(items) : fallback
}

function makeChords(phaseId: PhaseId, rng: Rng, chordIds: string[], progressions: string[][], bars: number): string[] | null {
  const has = (id: string) => chordIds.includes(id)
  if (phaseId === 'P1' || phaseId === 'P2') return null
  if (phaseId === 'P3') {
    const prog = pickFrom(rng, progressions, ['I', 'IV', 'V', 'I'])
    const out = Array.from({ length: bars }, (_, i) => prog[i % prog.length])
    // 全曲收于 do：若循环的最后一个和弦不含 do（如 …-IV-V），末小节改为 I，避免 do 长音压在 V 上
    if (!chordTones(out[bars - 1]).includes('do')) out[bars - 1] = 'I'
    return out
  }
  if (phaseId === 'P4') {
    const out = ['I']
    for (let i = 1; i < bars - 2; i++) {
      const options = (P4_NEXT[out[i - 1]] ?? ['I']).filter(has)
      out.push(pickFrom(rng, options, 'I'))
    }
    out.push(has('V7') && rng.next() < 0.5 ? 'V7' : 'V')
    out.push('I')
    return out
  }
  // P5：前 4 小节原调，后 4 小节新调
  const color = ['IV', 'vi', 'ii', 'bVI', 'bVII'].filter(has)
  const x = pickFrom(rng, color, 'IV')
  const y = pickFrom(rng, [...color, ...(has('V/V') ? ['V/V'] : [])], 'IV')
  const z = pickFrom(rng, ['IV', 'vi', 'ii'].filter(has), 'IV')
  return ['I', x, y, 'V', 'I', z, 'V', 'I']
}

interface BarRhythm {
  notes: { onset: number; dur: number }[]
  patternId: string | null
}

function barRhythm(rng: Rng, beatsPerBar: number, usePatterns: boolean, patternIds: string[], wholeBar: boolean): BarRhythm {
  if (wholeBar) return { notes: [{ onset: 0, dur: beatsPerBar }], patternId: null }
  if (usePatterns && patternIds.length > 0) {
    const id = rng.pick(patternIds)
    return { notes: patternById(id).notes.map((n) => ({ onset: n.onset, dur: n.dur })), patternId: id }
  }
  const notes: { onset: number; dur: number }[] = []
  for (let b = 0; b < beatsPerBar; b++) {
    if (rng.next() < 0.35) notes.push({ onset: b, dur: 0.5 }, { onset: b + 0.5, dur: 0.5 })
    else notes.push({ onset: b, dur: 1 })
  }
  return { notes, patternId: null }
}

export function generateBoss(c: Curriculum, phaseId: PhaseId, seed: number): BossChallenge {
  const rng = makeRng(seed)
  const m = bossMaterial(c, phaseId)
  const bars = BOSS_BARS[phaseId]
  const meterId: MeterId = phaseId === 'P1' ? rng.pick(m.meters) : '4/4'
  const beatsPerBar = METERS[meterId].beatsPerBar
  const tonic = rng.int(12)
  const keys: Key[] = [{ tonic, mode: 'major' }]
  let modulationBar: number | null = null
  let newTonic: string | undefined
  if (phaseId === 'P5') {
    const up = rng.next() < 0.5 ? 7 : 5
    keys.push({ tonic: (tonic + up) % 12, mode: 'major' })
    modulationBar = 4
    newTonic = up === 7 ? 'sol' : 'fa'
  }
  const chords = makeChords(phaseId, rng, m.chordIds, m.progressions, bars)

  const usePatterns = meterId === '4/4' && phaseId !== 'P1'
  const rhythmIds: string[] = []
  const degrees = m.melodyDegrees
  const n = degrees.length
  const stable = STABLE_DEGREES.filter((d) => degrees.includes(d))
  let step = degrees.indexOf('do')
  const degreeAt = (s: number) => degrees[((s % n) + n) % n]
  const nearestStep = (from: number, ok: (d: ScaleDegree) => boolean) => {
    for (let d = 0; d <= n; d++) {
      for (const s of [from - d, from + d]) if (s >= -n && s < 2 * n && ok(degreeAt(s))) return s
    }
    return from
  }

  const melody: MelodyNote[] = []
  const phrases: Phrase[] = []
  for (let bar = 0; bar < bars; bar++) {
    const isLastBar = bar === bars - 1
    const wholeBar = isLastBar && phaseId !== 'P4'
    const r = barRhythm(rng, beatsPerBar, usePatterns, m.patternIds, wholeBar)
    if (usePatterns) rhythmIds.push(r.patternId ?? 'whole')
    const keyIndex: 0 | 1 = modulationBar !== null && bar >= modulationBar ? 1 : 0
    const tones = chords ? chordTones(chords[bar]).filter((d) => degrees.includes(d)) : []
    // 句末音：稳定音级里优先取该小节的和弦音（如 V 上收 sol），没有才退回全部稳定音级
    const stableInChord = stable.filter((d) => tones.includes(d))
    const cadence = stableInChord.length > 0 ? stableInChord : stable
    const phraseEndBar = (bar + 1) % PHRASE_BARS === 0
    r.notes.forEach((note, i) => {
      const isFirst = i === 0
      const isPhraseLast = phraseEndBar && i === r.notes.length - 1
      if (isLastBar && i === r.notes.length - 1) step = nearestStep(step, (d) => d === 'do')
      else if (isPhraseLast) step = nearestStep(step, (d) => cadence.includes(d))
      else if (isFirst && tones.length > 0) step = nearestStep(step, (d) => tones.includes(d))
      else {
        const delta = rng.next() < 0.1 ? (rng.next() < 0.5 ? -3 : 3) : rng.pick([-2, -1, -1, 0, 1, 1, 2])
        step = Math.max(-n, Math.min(2 * n - 1, step + delta))
      }
      melody.push({ degree: degreeAt(step), keyIndex, atBeat: bar * beatsPerBar + note.onset, durBeats: note.dur })
    })
    if (phraseEndBar) {
      const start = bar + 1 - PHRASE_BARS
      const count = melody.filter((x) => x.atBeat >= start * beatsPerBar && x.atBeat < (bar + 1) * beatsPerBar).length
      phrases.push({ index: phrases.length, startBar: start, endBar: bar + 1, melodyCount: count })
    }
  }

  const parts = BOSS_PARTS[phaseId]
  const piece: Piece = {
    phaseId,
    seed,
    keys,
    modulationBar,
    bpm: phaseId === 'P1' ? 80 : 90,
    meterId,
    bars,
    melody,
    chords,
    rhythm: parts.includes('rhythm') ? rhythmIds : null,
    drums: true,
  }
  let at = 0
  const melodyByPhrase = phrases.map((ph) => {
    const slice = melody.slice(at, at + ph.melodyCount).map((x) => x.degree)
    at += ph.melodyCount
    return slice
  })
  return {
    piece,
    parts,
    phrases,
    answer: {
      melody: melodyByPhrase,
      ...(parts.includes('chords') && chords ? { chords: [...chords] } : {}),
      ...(parts.includes('rhythm') ? { rhythm: [...rhythmIds] } : {}),
      ...(parts.includes('meter') ? { meter: meterId } : {}),
      ...(parts.includes('newTonic') && newTonic ? { newTonic } : {}),
    },
    alphabets: {
      melody: [...degrees],
      ...(parts.includes('chords') ? { chords: [...m.chordIds] } : {}),
      ...(parts.includes('rhythm') ? { rhythm: [...m.patternIds] } : {}),
      ...(parts.includes('meter') ? { meter: [...m.meters] } : {}),
      ...(parts.includes('newTonic') ? { newTonic: [...NEW_TONIC_ALPHABET] } : {}),
    },
  }
}
