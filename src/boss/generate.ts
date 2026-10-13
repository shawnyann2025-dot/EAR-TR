import { unlockedKnowledgePoints, type Curriculum } from '../curriculum/curriculum'
import type { PhaseId } from '../curriculum/stages'
import { functionalChord } from '../exercises/data/chords'
import { METERS, patternById, type MeterId } from '../exercises/data/rhythms'
import { QUALITY_INTERVALS } from '../music/chord'
import { DEGREE_SEMITONES, SCALE_DEGREES, type Key, type ScaleDegree } from '../music/key'
import { doMidiForKey } from '../music/register'
import { makeRng, type Rng } from '../music/rng'
import { bossMaterial } from './material'
import {
  MELODY_CENTER_MIDI,
  PHRASE_BARS,
  type BossChallenge,
  type MelodyNote,
  type PartId,
  type Phrase,
  type Piece,
} from './types'

export const BOSS_BARS: Record<PhaseId, number> = { P1: 8, P2: 16, P3: 8, P4: 8, P5: 8 }
export const BOSS_PARTS: Record<PhaseId, PartId[]> = {
  P1: ['melody', 'meter'],
  P2: ['melody'],
  P3: ['chords', 'melody'],
  P4: ['chords', 'melody', 'rhythm'],
  P5: ['chords', 'melody', 'newTonic'],
}
export const STABLE_DEGREES: ScaleDegree[] = ['do', 'mi', 'sol']

/** 旋律音域（相对原调本位 do 的半音）：低音 sol 到 ti，共 16 半音（十度） */
export const MELODY_LOW_ST = -5
export const MELODY_HIGH_ST = 11
/** 相邻两音的最大音程（半音）：纯五度 */
export const MAX_LEAP_ST = 7
/** 半音外色和弦：这些小节的旋律避开与和弦音成小二度的音级 */
export const CHROMATIC_CHORDS = ['bVI', 'bVII', 'V/V']
/** P4 中（首尾以外）和弦取第一转位的概率 */
const INVERSION_P = 0.3
const INV_FIRST_KP = 'chord:inv-first'

const NEW_TONIC_ALPHABET = ['re', 'fa', 'sol', 'la']
const P4_NEXT: Record<string, string[]> = {
  I: ['IV', 'V', 'vi', 'ii', 'Imaj7', 'vi7', 'ii7'],
  Imaj7: ['IV', 'vi'],
  ii: ['V', 'V7'],
  ii7: ['V', 'V7'],
  IV: ['V', 'I', 'ii', 'ii7'],
  V: ['I', 'vi'],
  V7: ['I', 'vi'],
  vi: ['IV', 'ii'],
  vi7: ['IV', 'ii', 'ii7'],
}
const DOMINANTS = ['V', 'V7']

const degreeOfSemitone = (st: number): ScaleDegree =>
  SCALE_DEGREES.find((d) => DEGREE_SEMITONES[d] === ((st % 12) + 12) % 12)!

/** 大调本地级数 id 的和弦音（以 do 为参照的音级） */
export function chordTones(chordId: string): ScaleDegree[] {
  const ch = functionalChord('major', chordId)
  const root = DEGREE_SEMITONES[ch.rootDegree]
  return QUALITY_INTERVALS[ch.quality].map((i) => degreeOfSemitone(root + i))
}

/** 两音级是否相距小二度（1 或 11 个半音） */
export function semitoneApart(a: ScaleDegree, b: ScaleDegree): boolean {
  const d = (((DEGREE_SEMITONES[a] - DEGREE_SEMITONES[b]) % 12) + 12) % 12
  return d === 1 || d === 11
}

/** 第 keyIndex 个调的本位 do 相对原调本位 do 的半音数（本位 do = 离 MELODY_CENTER_MIDI 最近的 do） */
export function keyDoOffset(keys: readonly Key[], keyIndex: number): number {
  return doMidiForKey(keys[keyIndex], MELODY_CENTER_MIDI) - doMidiForKey(keys[0], MELODY_CENTER_MIDI)
}

/** 旋律音相对原调本位 do 的半音数（含八度与转调） */
export function melodyPitch(piece: Piece, note: MelodyNote): number {
  return keyDoOffset(piece.keys, note.keyIndex) + 12 * note.octave + DEGREE_SEMITONES[note.degree]
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
    const next = (id: string) => (P4_NEXT[id] ?? ['I']).filter(has)
    const nonDominant = (ids: string[]) => ids.filter((id) => !DOMINANTS.includes(id))
    const out = ['I']
    const last = bars - 3 // 倒数第三小节不能是 V/V7（避免与倒数第二小节的属和弦重复，也避免 V7→V 不解决）
    for (let i = 1; i <= last; i++) {
      let options = next(out[i - 1])
      if (i === last) options = nonDominant(options)
      // 再前一小节：只选之后还能走到非属和弦的（ii 之后只有 V/V7，不选）
      else if (i === last - 1) options = options.filter((id) => nonDominant(next(id)).length > 0)
      out.push(pickFrom(rng, options, 'I'))
    }
    out.push(has('V7') && rng.next() < 0.5 ? 'V7' : 'V')
    out.push('I')
    return out
  }
  // P5：前 4 小节原调，后 4 小节新调；新调的属和弦用 V7（带出新调的 fi 或 te，确立新调）
  const color = ['IV', 'vi', 'ii', 'bVI', 'bVII'].filter(has)
  const x = pickFrom(rng, color, 'IV')
  const y = pickFrom(rng, [...color, ...(has('V/V') ? ['V/V'] : [])], 'IV')
  const z = pickFrom(rng, ['IV', 'vi', 'ii'].filter(has), 'IV')
  return ['I', x, y, 'V', 'I', z, 'V7', 'I']
}

interface BarRhythm {
  notes: { onset: number; dur: number }[]
  patternId: string | null
}

const endsOnBeat = (notes: readonly { onset: number }[]) => Number.isInteger(notes[notes.length - 1].onset)

function barRhythm(
  rng: Rng,
  beatsPerBar: number,
  usePatterns: boolean,
  patternIds: string[],
  wholeBar: boolean,
  phraseEnd: boolean,
): BarRhythm {
  if (wholeBar) return { notes: [{ onset: 0, dur: beatsPerBar }], patternId: null }
  if (usePatterns && patternIds.length > 0) {
    // 句末小节：最后一个音落在拍上（不以反拍八分音收句）
    const onBeat = patternIds.filter((id) => endsOnBeat(patternById(id).notes))
    const pool = phraseEnd && onBeat.length > 0 ? onBeat : patternIds
    const id = rng.pick(pool)
    return { notes: patternById(id).notes.map((n) => ({ onset: n.onset, dur: n.dur })), patternId: id }
  }
  const notes: { onset: number; dur: number }[] = []
  for (let b = 0; b < beatsPerBar; b++) {
    const lastBeatOfPhrase = phraseEnd && b === beatsPerBar - 1
    if (!lastBeatOfPhrase && rng.next() < 0.35) notes.push({ onset: b, dur: 0.5 }, { onset: b + 0.5, dur: 0.5 })
    else notes.push({ onset: b, dur: 1 })
  }
  return { notes, patternId: null }
}

interface Cand {
  /** 相对原调本位 do 的半音数 */
  pitch: number
  degree: ScaleDegree
  octave: number
}

interface Slot {
  bar: number
  keyIndex: 0 | 1
  onset: number
  dur: number
  /** 音域内、满足本位置约束的音高 */
  targets: Cand[]
  /** 有约束（和弦音、句末稳定音、末音 do）时取最近的合法音，否则随机游走 */
  forced: boolean
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
  const inversions: (0 | 1)[] | null =
    phaseId === 'P4' && chords && unlockedKnowledgePoints(c, phaseId).includes(INV_FIRST_KP)
      ? chords.map((_, i) => (i > 0 && i < bars - 1 && rng.next() < INVERSION_P ? 1 : 0))
      : null

  const parts = BOSS_PARTS[phaseId]
  const gradedRhythm = parts.includes('rhythm')
  const usePatterns = meterId === '4/4' && phaseId !== 'P1'
  const rhythmIds: string[] = []
  const degrees = m.melodyDegrees
  const stable = STABLE_DEGREES.filter((d) => degrees.includes(d))
  const offsets = keys.map((_, k) => keyDoOffset(keys, k))

  /** 某调中这些音级落在音域内的全部音高，升序 */
  const candidates = (keyIndex: number, allowed: readonly ScaleDegree[]): Cand[] => {
    const out: Cand[] = []
    for (let octave = -2; octave <= 2; octave++) {
      for (const degree of allowed) {
        const pitch = offsets[keyIndex] + 12 * octave + DEGREE_SEMITONES[degree]
        if (pitch >= MELODY_LOW_ST && pitch <= MELODY_HIGH_ST) out.push({ pitch, degree, octave })
      }
    }
    return out.sort((a, b) => a.pitch - b.pitch)
  }

  // 1. 节奏，与每个音的约束
  const slots: Slot[] = []
  for (let bar = 0; bar < bars; bar++) {
    const isLastBar = bar === bars - 1
    const phraseEndBar = (bar + 1) % PHRASE_BARS === 0
    const r = barRhythm(rng, beatsPerBar, usePatterns, m.patternIds, isLastBar && phaseId !== 'P4', phraseEndBar)
    if (gradedRhythm && r.patternId) rhythmIds.push(r.patternId)
    const keyIndex: 0 | 1 = modulationBar !== null && bar >= modulationBar ? 1 : 0
    const chord = chords?.[bar]
    const chordDegs = chord ? chordTones(chord) : []
    // 半音外色和弦的小节：去掉与和弦音成小二度的音级（如 bVI 上不唱 mi、la、ti）
    const allowed =
      chord && CHROMATIC_CHORDS.includes(chord)
        ? degrees.filter((d) => !chordDegs.some((t) => semitoneApart(d, t)))
        : degrees
    const tones = chordDegs.filter((d) => allowed.includes(d))
    // 句末音：稳定音级里优先取该小节的和弦音（如 V 上收 sol），没有才退回全部稳定音级
    const stableOk = stable.filter((d) => allowed.includes(d))
    const stableInChord = stableOk.filter((d) => tones.includes(d))
    const cadence = stableInChord.length > 0 ? stableInChord : stableOk
    r.notes.forEach((note, i) => {
      const isLast = i === r.notes.length - 1
      let want: readonly ScaleDegree[] | null = null
      if (isLastBar && isLast) want = ['do']
      else if (phraseEndBar && isLast) want = cadence
      else if (i === 0 && tones.length > 0) want = tones
      slots.push({
        bar,
        keyIndex,
        onset: note.onset,
        dur: note.dur,
        targets: candidates(keyIndex, want ?? allowed),
        forced: want !== null,
      })
    })
  }

  // 2. 从后往前：每个位置上「之后的约束仍都能满足」的音高（相邻音程 ≤ MAX_LEAP_ST）
  const feasible: Cand[][] = new Array<Cand[]>(slots.length)
  for (let i = slots.length - 1; i >= 0; i--) {
    const after = feasible[i + 1]
    feasible[i] = after
      ? slots[i].targets.filter((p) => after.some((q) => Math.abs(p.pitch - q.pitch) <= MAX_LEAP_ST))
      : slots[i].targets
    if (feasible[i].length === 0) throw new Error(`实战关旋律无解：${phaseId} seed ${seed} 第 ${i} 音`)
  }

  // 3. 从前往后：受约束的音取离上一音最近的合法音；其余在可选音上按音阶步随机游走
  const melody: MelodyNote[] = []
  let prev = 0
  slots.forEach((slot, i) => {
    const options = feasible[i].filter((p) => Math.abs(p.pitch - prev) <= MAX_LEAP_ST)
    const nearest = options.reduce((bi, p, j) => (Math.abs(p.pitch - prev) < Math.abs(options[bi].pitch - prev) ? j : bi), 0)
    let pick: Cand
    if (slot.forced) pick = options[nearest]
    else {
      const delta = rng.next() < 0.1 ? (rng.next() < 0.5 ? -3 : 3) : rng.pick([-2, -1, -1, 0, 1, 1, 2])
      pick = options[Math.max(0, Math.min(options.length - 1, nearest + delta))]
    }
    prev = pick.pitch
    melody.push({
      degree: pick.degree,
      octave: pick.octave,
      keyIndex: slot.keyIndex,
      atBeat: slot.bar * beatsPerBar + slot.onset,
      durBeats: slot.dur,
    })
  })

  const phrases: Phrase[] = []
  for (let start = 0; start < bars; start += PHRASE_BARS) {
    const end = start + PHRASE_BARS
    const count = melody.filter((x) => x.atBeat >= start * beatsPerBar && x.atBeat < end * beatsPerBar).length
    phrases.push({ index: phrases.length, startBar: start, endBar: end, melodyCount: count })
  }

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
    rhythm: gradedRhythm ? rhythmIds : null,
    inversions,
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
      ...(gradedRhythm ? { rhythm: [...rhythmIds] } : {}),
      ...(parts.includes('meter') ? { meter: meterId } : {}),
      ...(parts.includes('newTonic') && newTonic ? { newTonic } : {}),
    },
    alphabets: {
      melody: [...degrees],
      ...(parts.includes('chords') ? { chords: [...m.chordIds] } : {}),
      ...(gradedRhythm ? { rhythm: [...m.patternIds] } : {}),
      ...(parts.includes('meter') ? { meter: [...m.meters] } : {}),
      ...(parts.includes('newTonic') ? { newTonic: [...NEW_TONIC_ALPHABET] } : {}),
    },
  }
}
