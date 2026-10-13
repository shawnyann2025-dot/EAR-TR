import type { Curriculum } from '../../curriculum/curriculum'
import type { KnowledgePointId } from '../../curriculum/knowledgePoints'
import { stageOrderIndex } from '../../curriculum/validate'
import type { NoteSpec } from '../../music/playback'
import { tonicMidi } from '../../music/register'
import { onsetsToNotes, type Meter, type TimedOnset } from '../../music/rhythm'
import type { Rng } from '../../music/rng'
import { PATTERNS, RHYTHM_ENTRIES, type PatternDef, type PatternNote } from '../data/rhythms'
import { pulsesPerBar, unitsPerPulse } from '../metronome'
import { stageOfKnowledgePoint } from '../pools'
import type { GeneratorInput } from '../types'

/** 节奏内容的发声比例：留出空隙，让每个起音清楚 */
export const RHYTHM_LEGATO = 0.85

const EPS = 1e-9

/** 一个记谱单位的秒数：bpm 是感知拍；x/8 的感知拍含 3 个八分（FWD-6） */
export function unitSec(meter: Meter, bpm: number): number {
  return 60 / bpm / unitsPerPulse(meter)
}

export function barSec(meter: Meter, bpm: number): number {
  return meter.beatsPerBar * unitSec(meter, bpm)
}

export function barStartTimes(bars: readonly Meter[], bpm: number): number[] {
  let t = 0
  return bars.map((m) => {
    const start = t
    t += barSec(m, bpm)
    return start
  })
}

export function barsDurSec(bars: readonly Meter[], bpm: number): number {
  return bars.reduce((s, m) => s + barSec(m, bpm), 0)
}

export interface PlacedEvent {
  bar: number
  /** 以该小节拍号的记谱单位计（x/4 是四分音符，6/8 是八分音符） */
  onsetUnits: number
  durUnits: number
  accent: boolean
}

export function placedToOnsets(
  events: readonly PlacedEvent[],
  bars: readonly Meter[],
  bpm: number,
): TimedOnset[] {
  const starts = barStartTimes(bars, bpm)
  return events
    .map((e) => {
      const u = unitSec(bars[e.bar], bpm)
      return { atSec: starts[e.bar] + e.onsetUnits * u, durSec: e.durUnits * u * RHYTHM_LEGATO, accent: e.accent }
    })
    .sort((a, b) => a.atSec - b.atSec)
}

export function contentMidi(input: GeneratorInput): number {
  return tonicMidi(input.resolved.key, input.doMidi)
}

/** 节奏内容一律经 onsetsToNotes 合成（FWD-2：力度轴给 velocity，accent 只给相对系数） */
export function rhythmNotes(onsets: readonly TimedOnset[], input: GeneratorInput): NoteSpec[] {
  return onsetsToNotes(onsets, contentMidi(input), input.resolved.velocity)
}

/** 4/4 四分音符单位的音（可跨小节）→ 放置事件 */
export function notesAsPlacedEvents(
  notes: readonly PatternNote[],
  firstBar: number,
  accentDownbeats: boolean,
): PlacedEvent[] {
  return notes.map((x) => {
    const barOffset = Math.floor(x.onset / 4 + EPS)
    const onsetUnits = x.onset - 4 * barOffset
    return {
      bar: firstBar + barOffset,
      onsetUnits,
      durUnits: x.dur,
      accent: accentDownbeats && Math.abs(onsetUnits) < EPS,
    }
  })
}

/**
 * 一小节的随机填充：每个感知拍要么一个长音（x/4 四分、x/8 附点四分），
 * 要么细分（x/4 两个八分、x/8 三个八分）。只有小节第一拍上的第一个音加重。
 * fromPulse > 0 时前面的感知拍留空（找 beat 1 的片段从小节中间起拍）。
 */
export function randomPulseFill(meter: Meter, bar: number, rng: Rng, fromPulse = 0): PlacedEvent[] {
  const upp = unitsPerPulse(meter)
  const out: PlacedEvent[] = []
  for (let p = fromPulse; p < pulsesPerBar(meter); p++) {
    const start = p * upp
    if (rng.next() < 0.5) {
      out.push({ bar, onsetUnits: start, durUnits: upp, accent: p === 0 })
    } else {
      const parts = upp === 3 ? 3 : 2
      const d = upp / parts
      for (let i = 0; i < parts; i++) {
        out.push({ bar, onsetUnits: start + i * d, durUnits: d, accent: p === 0 && i === 0 })
      }
    }
  }
  return out
}

/** 所在级不晚于该知识点所在级的音型类知识点拥有的全部音型 */
export function patternsUpTo(
  c: Curriculum,
  kpId: KnowledgePointId,
  opts: { singleBarOnly?: boolean } = {},
): PatternDef[] {
  const limit = stageOrderIndex(c, stageOfKnowledgePoint(kpId).id)
  const owners = new Set(
    RHYTHM_ENTRIES.filter(
      (e) => e.family === 'pattern' && stageOrderIndex(c, stageOfKnowledgePoint(e.kpId).id) <= limit,
    ).map((e) => e.kpId),
  )
  return PATTERNS.filter((p) => owners.has(p.ownerKpId) && (!opts.singleBarOnly || p.bars === 1))
}
