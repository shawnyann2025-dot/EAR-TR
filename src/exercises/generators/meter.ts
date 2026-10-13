import type { Modality } from '../../curriculum/knowledgePoints'
import type { Meter, TimedOnset } from '../../music/rhythm'
import {
  METERS,
  MIXED_COMBOS,
  MIXED_METER_ALPHABET,
  requireRhythmEntry,
  rhythmPoolOf,
  type MeterId,
} from '../data/rhythms'
import { difficultyParams } from '../difficulty'
import { pulsesPerBar } from '../metronome'
import { pickOptions, poolMembers } from '../pools'
import type { ContentResult, Generator, GeneratorInput } from '../types'
import {
  barStartTimes,
  barsDurSec,
  placedToOnsets,
  randomPulseFill,
  rhythmNotes,
  type PlacedEvent,
} from './rhythmCommon'

/** 听辨拍号题的感知拍总数（2、3、4 的公倍数）：总长度不随拍号变，不能靠数总拍数判断拍号 */
export const RECOGNIZE_METER_PULSES = 12

/** 每项一小节：给拍号则随机填满；null 是固定 4/4 的空小节（段间间隔） */
export function filledPassage(
  meterIds: readonly (MeterId | null)[],
  input: GeneratorInput,
): { bars: Meter[]; onsets: TimedOnset[]; durSec: number } {
  const bars: Meter[] = []
  const events: PlacedEvent[] = []
  meterIds.forEach((id, i) => {
    // null：固定 4/4 的空小节——长度与任何拍号无关，免得数间隙里的节拍就知道上一段几拍
    const meter = id === null ? METERS['4/4'] : METERS[id]
    bars.push(meter)
    if (id !== null) events.push(...randomPulseFill(meter, i, input.rng))
  })
  return {
    bars,
    onsets: placedToOnsets(events, bars, input.resolved.bpm),
    durSec: barsDurSec(bars, input.resolved.bpm),
  }
}

function targetMeter(input: GeneratorInput): MeterId {
  const id = requireRhythmEntry(input.spec.kpId).meterId
  if (!id) throw new Error(`${input.spec.kpId} 不是拍号知识点`)
  return id
}

function poolMeters(input: GeneratorInput): MeterId[] {
  return poolMembers(input.curriculum, input.spec.kpId, rhythmPoolOf).map((id) => {
    const m = requireRhythmEntry(id).meterId
    if (!m) throw new Error(`${id} 不是拍号知识点`)
    return m
  })
}

function listened(
  passage: { bars: Meter[]; onsets: TimedOnset[]; durSec: number },
  input: GeneratorInput,
) {
  const notes = rhythmNotes(passage.onsets, input)
  return { notes, feedbackNotes: notes, durSec: passage.durSec }
}

/** 边听边打每小节第一拍（P-2b-R 裁定 3） */
function downbeatTap(
  passage: { bars: Meter[]; onsets: TimedOnset[]; durSec: number },
  input: GeneratorInput,
): ContentResult {
  const onsetsSec = barStartTimes(passage.bars, input.resolved.bpm)
  return {
    ...listened(passage, input),
    prompt: 'tap-downbeats',
    format: { kind: 'tap', onsetsSec, toleranceSec: difficultyParams(input.spec.difficultyStep).tapToleranceSec },
    answer: { kind: 'tap', onsetsSec: [...onsetsSec] },
    rhythm: { bars: passage.bars, metronome: 'neutral' },
  }
}

const recognizeMeter: Generator = (input): ContentResult => {
  const id = targetMeter(input)
  // 固定 12 个感知拍（2、3、4 的公倍数）——总长度不随拍号变，不能靠数总拍数判断拍号
  const nBars = RECOGNIZE_METER_PULSES / pulsesPerBar(METERS[id])
  const passage = filledPassage(Array.from({ length: nBars }, () => id), input)
  const options = pickOptions(id, poolMeters(input), difficultyParams(input.spec.difficultyStep).recognizeOptionCount, input.rng)
  return {
    ...listened(passage, input),
    prompt: 'which-meter',
    format: { kind: 'choice', options: options.map((x) => ({ id: x })) },
    answer: { kind: 'choice', id },
    rhythm: { bars: passage.bars, metronome: 'neutral' },
  }
}

const tapMeterDownbeats: Generator = (input): ContentResult => {
  const id = targetMeter(input)
  const nBars = Math.max(2, difficultyParams(input.spec.difficultyStep).tapBars + 1)
  return downbeatTap(filledPassage(Array.from({ length: nBars }, () => id), input), input)
}

const notateMeters: Generator = (input): ContentResult => {
  const { rng } = input
  const id = targetMeter(input)
  const pool = poolMeters(input)
  const phrases = Math.max(2, difficultyParams(input.spec.difficultyStep).notateRhythmBars)
  const targetPos = rng.int(phrases)
  const meters = Array.from({ length: phrases }, (_, i) => (i === targetPos ? id : rng.pick(pool)))
  // 每段两小节，段间空一小节（P-2b-R 裁定 2）
  const layout: (MeterId | null)[] = meters.flatMap((m, i) => (i < phrases - 1 ? [m, m, null] : [m, m]))
  const passage = filledPassage(layout, input)
  return {
    ...listened(passage, input),
    prompt: 'notate-meters',
    format: { kind: 'sequence', length: phrases, alphabet: pool.map((x) => ({ id: x })) },
    answer: { kind: 'sequence', ids: meters },
    rhythm: { bars: passage.bars, metronome: 'neutral' },
  }
}

function mixedPassage(input: GeneratorInput) {
  const combo = input.rng.pick(MIXED_COMBOS)
  const meters = [...combo.meters, ...combo.meters]
  return { combo, meters, passage: filledPassage(meters, input) }
}

function sameMeters(a: readonly MeterId[], b: readonly MeterId[]): boolean {
  return [...a].sort().join() === [...b].sort().join()
}

const recognizeMixed: Generator = (input): ContentResult => {
  const { combo, passage } = mixedPassage(input)
  // 只在同一组拍号的不同顺序之间选——各选项总长相同，不能靠长度排除
  const options = pickOptions(
    combo.id,
    MIXED_COMBOS.filter((m) => sameMeters(m.meters, combo.meters)).map((m) => m.id),
    difficultyParams(input.spec.difficultyStep).recognizeOptionCount,
    input.rng,
  )
  return {
    ...listened(passage, input),
    prompt: 'which-meter-sequence',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: combo.id },
    rhythm: { bars: passage.bars, metronome: 'neutral' },
  }
}

const tapMixedDownbeats: Generator = (input): ContentResult => downbeatTap(mixedPassage(input).passage, input)

const notateMixed: Generator = (input): ContentResult => {
  const { meters, passage } = mixedPassage(input)
  return {
    ...listened(passage, input),
    prompt: 'notate-meters',
    format: { kind: 'sequence', length: meters.length, alphabet: MIXED_METER_ALPHABET.map((id) => ({ id })) },
    answer: { kind: 'sequence', ids: [...meters] },
    rhythm: { bars: passage.bars, metronome: 'neutral' },
  }
}

export const METER_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeMeter,
  sing: tapMeterDownbeats,
  notate: notateMeters,
}

export const MIXED_METER_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeMixed,
  sing: tapMixedDownbeats,
  notate: notateMixed,
}
