import type { Modality } from '../../curriculum/knowledgePoints'
import type { Meter, TimedOnset } from '../../music/rhythm'
import { METERS, PATTERNS, patternsOf, type PatternDef } from '../data/rhythms'
import { difficultyParams } from '../difficulty'
import { pickOptions } from '../pools'
import type { ContentResult, Generator, GeneratorInput } from '../types'
import {
  barsDurSec,
  notesAsPlacedEvents,
  patternsUpTo,
  placedToOnsets,
  rhythmNotes,
  type PlacedEvent,
} from './rhythmCommon'

const M44 = METERS['4/4']

function ownPatterns(input: GeneratorInput): PatternDef[] {
  const own = patternsOf(input.spec.kpId)
  if (own.length === 0) throw new Error(`${input.spec.kpId} 没有音型`)
  return own
}

/** 依次排列音型（全部 4/4），每小节第一拍加重 */
export function patternPassage(
  patterns: readonly PatternDef[],
  input: GeneratorInput,
): { bars: Meter[]; onsets: TimedOnset[]; durSec: number } {
  const events: PlacedEvent[] = []
  let bar = 0
  for (const p of patterns) {
    events.push(...notesAsPlacedEvents(p.notes, bar, true))
    bar += p.bars
  }
  const bars = Array.from({ length: bar }, () => M44)
  return {
    bars,
    onsets: placedToOnsets(events, bars, input.resolved.bpm),
    durSec: barsDurSec(bars, input.resolved.bpm),
  }
}

const recognizePattern: Generator = (input): ContentResult => {
  // 听辨时对比音型也可作答案——否则两小节题的答案恒为连线音型，不听也能答对
  const all = PATTERNS.filter((x) => x.ownerKpId === input.spec.kpId)
  if (all.length === 0) throw new Error(`${input.spec.kpId} 没有音型`)
  const p = input.rng.pick(all)
  const passage = patternPassage([p], input)
  const notes = rhythmNotes(passage.onsets, input)
  const pool = patternsUpTo(input.curriculum, input.spec.kpId)
    .filter((x) => x.bars === p.bars)
    .map((x) => x.id)
  const options = pickOptions(p.id, pool, difficultyParams(input.spec.difficultyStep).recognizeOptionCount, input.rng)
  return {
    notes,
    feedbackNotes: notes,
    durSec: passage.durSec,
    prompt: 'which-pattern',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: p.id },
    rhythm: { bars: passage.bars, metronome: 'metered' },
  }
}

const tapPattern: Generator = (input): ContentResult => {
  const p = input.rng.pick(ownPatterns(input))
  const params = difficultyParams(input.spec.difficultyStep)
  const reps = Math.max(1, Math.floor(params.tapBars / p.bars))
  const passage = patternPassage(Array.from({ length: reps }, () => p), input)
  const onsetsSec = passage.onsets.map((o) => o.atSec)
  return {
    // 「打出给定音型」：题目不放内容，屏幕显示音型，学习者跟节拍器打（P-2b-R 裁定 3）
    notes: [],
    feedbackNotes: rhythmNotes(passage.onsets, input),
    durSec: passage.durSec,
    prompt: 'tap-pattern',
    format: {
      kind: 'tap',
      onsetsSec,
      toleranceSec: params.tapToleranceSec,
      maxShiftSec: 30 / input.resolved.bpm,
      windowSec: passage.durSec,
      patternIds: Array.from({ length: reps }, () => p.id),
    },
    answer: { kind: 'tap', onsetsSec: [...onsetsSec] },
    rhythm: { bars: passage.bars, metronome: 'metered' },
  }
}

const notatePatterns: Generator = (input): ContentResult => {
  const { rng } = input
  const count = difficultyParams(input.spec.difficultyStep).notateRhythmBars
  const own = ownPatterns(input)
  const pool = patternsUpTo(input.curriculum, input.spec.kpId)
  const targetPos = rng.int(count)
  const chosen = Array.from({ length: count }, (_, i) => (i === targetPos ? rng.pick(own) : rng.pick(pool)))
  const passage = patternPassage(chosen, input)
  const notes = rhythmNotes(passage.onsets, input)
  return {
    notes,
    feedbackNotes: notes,
    durSec: passage.durSec,
    prompt: 'notate-patterns',
    format: { kind: 'sequence', length: count, alphabet: pool.map((x) => ({ id: x.id })) },
    answer: { kind: 'sequence', ids: chosen.map((x) => x.id) },
    rhythm: { bars: passage.bars, metronome: 'metered' },
  }
}

export const PATTERN_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizePattern,
  sing: tapPattern,
  notate: notatePatterns,
}
