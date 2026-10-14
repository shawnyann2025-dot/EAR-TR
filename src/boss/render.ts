import { functionalChord } from '../exercises/data/chords'
import { METERS } from '../exercises/data/rhythms'
import { voiceChord } from '../music/chord'
import { DEGREE_SEMITONES, type Key } from '../music/key'
import { freqToMidi, midiToFreq } from '../music/pitch'
import { isPitched, type DrumId, type PlaybackEvent, type PlaybackPlan } from '../music/playback'
import { doMidiForKey } from '../music/register'
import { MELODY_CENTER_MIDI, PHRASE_BARS, type Piece } from './types'

export const CHORD_ROOT_LOW = 48
/** 预备拍的拍数：与拍号无关，只给速度 */
const COUNT_IN_BEATS = 4

export interface RenderedPiece {
  plan: PlaybackPlan
  countInSec: number
  barSec: number
  phrases: { startSec: number; endSec: number }[]
}

const note = (atSec: number, midi: number, durSec: number, timbreId: PlaybackEvent['timbreId'], gain: number): PlaybackEvent => ({
  atSec,
  freqHz: midiToFreq(midi),
  durSec,
  timbreId,
  gain,
})
const drum = (atSec: number, d: DrumId, gain: number): PlaybackEvent => ({ atSec, freqHz: 0, durSec: 0.1, timbreId: 'piano', gain, drum: d })

/** P1：只在小节第 1 拍落底鼓、每拍踩镲，让拍号可听但不被鼓型泄露；其余阶段用完整律动 */
function drumBar(phaseId: Piece['phaseId'], beatsPerBar: number, beatSec: number, at0: number, out: PlaybackEvent[]): void {
  const hatStep = beatsPerBar === 4 && phaseId !== 'P1' ? 0.5 : 1
  for (let b = 0; b < beatsPerBar; b += hatStep) out.push(drum(at0 + b * beatSec, 'hat', 1))
  out.push(drum(at0, 'kick', 1))
  if (phaseId === 'P1') return
  if (beatsPerBar === 4) out.push(drum(at0 + 2 * beatSec, 'kick', 1))
  if (beatsPerBar === 2) out.push(drum(at0 + beatSec, 'snare', 1))
  if (beatsPerBar === 4) out.push(drum(at0 + beatSec, 'snare', 1), drum(at0 + 3 * beatSec, 'snare', 1))
}

function rootMidiInRange(key: Key, chordId: string): { chord: ReturnType<typeof functionalChord>; rootMidi: number } {
  const chord = functionalChord('major', chordId)
  const pc = (key.tonic + DEGREE_SEMITONES[chord.rootDegree]) % 12
  const rootMidi = CHORD_ROOT_LOW + (((pc - CHORD_ROOT_LOW) % 12) + 12) % 12
  return { chord, rootMidi }
}

export function renderPiece(piece: Piece): RenderedPiece {
  const { beatsPerBar } = METERS[piece.meterId]
  const beatSec = 60 / piece.bpm
  const barSec = beatsPerBar * beatSec
  const countInSec = COUNT_IN_BEATS * beatSec
  const events: PlaybackEvent[] = []

  // 预备拍：4 拍等距踩镲，与拍号无关
  for (let b = 0; b < COUNT_IN_BEATS; b++) events.push(drum(b * beatSec, 'hat', 1))

  // 旋律：本位 do + 八度 + 音级半音
  for (const n of piece.melody) {
    const midi = doMidiForKey(piece.keys[n.keyIndex], MELODY_CENTER_MIDI) + 12 * n.octave + DEGREE_SEMITONES[n.degree]
    events.push(note(countInSec + n.atBeat * beatSec, midi, n.durBeats * beatSec * 0.95, 'piano', 0.9))
  }

  for (let bar = 0; bar < piece.bars; bar++) {
    const at0 = countInSec + bar * barSec
    if (piece.chords) {
      const keyIndex = piece.modulationBar !== null && bar >= piece.modulationBar ? 1 : 0
      const { chord, rootMidi } = rootMidiInRange(piece.keys[keyIndex], piece.chords[bar])
      const v = voiceChord({ ...chord, inversion: piece.inversions?.[bar] ?? 0 }, rootMidi)
      for (const m of v.upperMidis) events.push(note(at0, m, barSec, 'strings', 0.22))
      events.push(note(at0, v.bassMidi, barSec / 2, 'piano', 0.7))
      if (beatsPerBar === 4) events.push(note(at0 + 2 * beatSec, v.bassMidi, barSec / 2, 'piano', 0.7))
    }
    if (piece.drums) drumBar(piece.phaseId, beatsPerBar, beatSec, at0, events)
  }

  events.sort((a, b) => a.atSec - b.atSec)
  const phrases = []
  for (let start = 0; start < piece.bars; start += PHRASE_BARS) {
    phrases.push({ startSec: countInSec + start * barSec, endSec: countInSec + Math.min(start + PHRASE_BARS, piece.bars) * barSec })
  }
  return { plan: { events, totalDurSec: countInSec + piece.bars * barSec + 0.5 }, countInSec, barSec, phrases }
}

export function phrasePlan(r: RenderedPiece, i: number): PlaybackPlan {
  const win = r.phrases[i]
  const countIn = r.plan.events.filter((e) => e.drum && e.atSec < r.countInSec - 1e-9)
  const body = r.plan.events
    .filter((e) => e.atSec >= win.startSec - 1e-9 && e.atSec < win.endSec - 1e-9)
    .map((e) => ({ ...e, atSec: e.atSec - win.startSec + r.countInSec }))
  return { events: [...countIn, ...body], totalDurSec: r.countInSec + (win.endSec - win.startSec) + 0.5 }
}

export function allPitchedMidis(plan: PlaybackPlan): number[] {
  return plan.events.filter(isPitched).map((e) => freqToMidi(e.freqHz))
}
