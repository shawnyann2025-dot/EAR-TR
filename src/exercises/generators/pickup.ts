import type { Modality } from '../../curriculum/knowledgePoints'
import type { Meter, TimedOnset } from '../../music/rhythm'
import {
  BEAT_ONE_METERS,
  METERS,
  PICKUPS,
  PICKUP_IDS,
  type PatternDef,
  type PickupId,
} from '../data/rhythms'
import { difficultyParams } from '../difficulty'
import { pulsesPerBar } from '../metronome'
import { pickOptions } from '../pools'
import type { ContentResult, Generator, GeneratorInput } from '../types'
import {
  barStartTimes,
  barsDurSec,
  notesAsPlacedEvents,
  patternsUpTo,
  placedToOnsets,
  randomPulseFill,
  rhythmNotes,
  type PlacedEvent,
} from './rhythmCommon'

export const BEAT_ONE_MAX_CANDIDATES = 8

export interface BeatOnePassage {
  bars: Meter[]
  onsets: TimedOnset[]
  durSec: number
  /** 第 0 小节起拍的感知拍序号 */
  startPulse: number
  /** 第 1 小节第一个音的序号（1 起） */
  answerIndex: number
  /** 候选序号 '2'…（不含 '1'：答案恒 ≥ 2），最多到第 8 个音 */
  candidates: string[]
}

/** 从小节中间起拍的片段：第 0 小节从某个非第一拍的感知拍开始，后接 fullBars 个满小节 */
export function beatOnePassage(input: GeneratorInput, fullBars: number): BeatOnePassage {
  const { rng } = input
  const meter = METERS[rng.pick(BEAT_ONE_METERS)]
  const startPulse = 1 + rng.int(pulsesPerBar(meter) - 1)
  const bars = Array.from({ length: 1 + fullBars }, () => meter)
  const events: PlacedEvent[] = [...randomPulseFill(meter, 0, rng, startPulse)]
  for (let b = 1; b <= fullBars; b++) events.push(...randomPulseFill(meter, b, rng))
  const onsets = placedToOnsets(events, bars, input.resolved.bpm)
  const inBar0 = events.filter((e) => e.bar === 0).length
  const last = Math.min(onsets.length, BEAT_ONE_MAX_CANDIDATES)
  // 第 0 小节至少有一个音，答案序号恒 ≥ 2：候选不含 '1'，否则它一眼就是错的
  const candidates = Array.from({ length: Math.max(0, last - 1) }, (_, i) => String(i + 2))
  if (candidates.length < 2 || !candidates.includes(String(inBar0 + 1))) {
    throw new Error(`找 beat 1 的候选不足或不含答案：音数 ${onsets.length}，答案 ${inBar0 + 1}`)
  }
  return {
    bars,
    onsets,
    durSec: barsDurSec(bars, input.resolved.bpm),
    startPulse,
    answerIndex: inBar0 + 1,
    candidates,
  }
}

/** 弱起题（中性节拍器）去掉的前导空拍数：none 整个第 0 小节为空，half/one 从第四拍开始 */
export const PICKUP_START_PULSE: Record<PickupId, number> = { none: 4, half: 3, one: 3 }

function shifted(onsets: readonly TimedOnset[], sec: number): TimedOnset[] {
  return onsets.map((o) => ({ ...o, atSec: Math.max(0, o.atSec - sec) }))
}

function listenedNotes(onsets: readonly TimedOnset[], input: GeneratorInput) {
  const notes = rhythmNotes(onsets, input)
  return { notes, feedbackNotes: notes }
}

const recognizeBeatOne: Generator = (input): ContentResult => {
  const p = beatOnePassage(input, 2)
  const shift = (p.startPulse * 60) / input.resolved.bpm
  const answerId = String(p.answerIndex)
  const options = pickOptions(answerId, p.candidates, difficultyParams(input.spec.difficultyStep).recognizeOptionCount, input.rng)
  return {
    ...listenedNotes(shifted(p.onsets, shift), input),
    durSec: p.durSec - shift,
    prompt: 'which-onset-is-beat-one',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: answerId },
    rhythm: { bars: p.bars, metronome: 'neutral', startPulse: p.startPulse },
  }
}

const tapBeatOne: Generator = (input): ContentResult => {
  const params = difficultyParams(input.spec.difficultyStep)
  const p = beatOnePassage(input, Math.max(2, params.tapBars + 1))
  const shift = (p.startPulse * 60) / input.resolved.bpm
  const onsetsSec = barStartTimes(p.bars, input.resolved.bpm)
    .slice(1)
    .map((t) => t - shift)
  return {
    ...listenedNotes(shifted(p.onsets, shift), input),
    durSec: p.durSec - shift,
    prompt: 'tap-downbeats',
    format: { kind: 'tap', onsetsSec, toleranceSec: params.tapToleranceSec },
    answer: { kind: 'tap', onsetsSec: [...onsetsSec] },
    rhythm: { bars: p.bars, metronome: 'neutral', startPulse: p.startPulse },
  }
}

const notateBeatOne: Generator = (input): ContentResult => {
  const p = beatOnePassage(input, 2)
  const shift = (p.startPulse * 60) / input.resolved.bpm
  return {
    ...listenedNotes(shifted(p.onsets, shift), input),
    durSec: p.durSec - shift,
    prompt: 'which-onset-is-beat-one',
    format: { kind: 'sequence', length: 1, alphabet: p.candidates.map((id) => ({ id })) },
    answer: { kind: 'sequence', ids: [String(p.answerIndex)] },
    rhythm: { bars: p.bars, metronome: 'neutral', startPulse: p.startPulse },
  }
}

export interface AnacrusisPassage {
  pickupId: PickupId
  patterns: PatternDef[]
  bars: Meter[]
  onsets: TimedOnset[]
  durSec: number
}

/** 第 0 小节只有弱起（不加重）；第 1、2 小节各一个单小节音型（强拍加重） */
export function anacrusisPassage(input: GeneratorInput): AnacrusisPassage {
  const { rng } = input
  const body = patternsUpTo(input.curriculum, input.spec.kpId, { singleBarOnly: true })
  if (body.length === 0) throw new Error(`${input.spec.kpId} 之前没有可用的单小节音型`)
  const pickupId = rng.pick(PICKUP_IDS)
  const patterns = [rng.pick(body), rng.pick(body)]
  const bars = [METERS['4/4'], METERS['4/4'], METERS['4/4']]
  const events: PlacedEvent[] = [
    ...notesAsPlacedEvents(PICKUPS[pickupId], 0, false),
    ...notesAsPlacedEvents(patterns[0].notes, 1, true),
    ...notesAsPlacedEvents(patterns[1].notes, 2, true),
  ]
  return {
    pickupId,
    patterns,
    bars,
    onsets: placedToOnsets(events, bars, input.resolved.bpm),
    durSec: barsDurSec(bars, input.resolved.bpm),
  }
}

const recognizeAnacrusis: Generator = (input): ContentResult => {
  const p = anacrusisPassage(input)
  const start = PICKUP_START_PULSE[p.pickupId]
  const shift = (start * 60) / input.resolved.bpm
  const options = pickOptions(p.pickupId, PICKUP_IDS, difficultyParams(input.spec.difficultyStep).recognizeOptionCount, input.rng)
  return {
    ...listenedNotes(shifted(p.onsets, shift), input),
    durSec: p.durSec - shift,
    prompt: 'which-pickup',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: p.pickupId },
    rhythm: { bars: p.bars, metronome: 'neutral', startPulse: start },
  }
}

const tapAnacrusis: Generator = (input): ContentResult => {
  const p = anacrusisPassage(input)
  const onsetsSec = p.onsets.map((o) => o.atSec)
  return {
    // 「打出给定音型」：不放内容，屏幕显示弱起与音型（P-2b-R 裁定 3）
    notes: [],
    feedbackNotes: rhythmNotes(p.onsets, input),
    durSec: p.durSec,
    prompt: 'tap-pattern',
    format: {
      kind: 'tap',
      onsetsSec,
      toleranceSec: difficultyParams(input.spec.difficultyStep).tapToleranceSec,
      patternIds: [p.pickupId, ...p.patterns.map((x) => x.id)],
    },
    answer: { kind: 'tap', onsetsSec: [...onsetsSec] },
    rhythm: { bars: p.bars, metronome: 'metered' },
  }
}

const notateAnacrusis: Generator = (input): ContentResult => {
  const p = anacrusisPassage(input)
  const start = PICKUP_START_PULSE[p.pickupId]
  const shift = (start * 60) / input.resolved.bpm
  const body = patternsUpTo(input.curriculum, input.spec.kpId, { singleBarOnly: true })
  return {
    ...listenedNotes(shifted(p.onsets, shift), input),
    durSec: p.durSec - shift,
    prompt: 'notate-patterns',
    format: {
      kind: 'sequence',
      length: 3,
      alphabet: [...PICKUP_IDS, ...body.map((x) => x.id)].map((id) => ({ id })),
    },
    answer: { kind: 'sequence', ids: [p.pickupId, ...p.patterns.map((x) => x.id)] },
    rhythm: { bars: p.bars, metronome: 'neutral', startPulse: start },
  }
}

export const BEAT_ONE_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeBeatOne,
  sing: tapBeatOne,
  notate: notateBeatOne,
}

export const ANACRUSIS_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeAnacrusis,
  sing: tapAnacrusis,
  notate: notateAnacrusis,
}
