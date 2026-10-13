import type { Curriculum } from '../curriculum/curriculum'
import type { KnowledgePointId, Modality } from '../curriculum/knowledgePoints'
import { notesToPlan, type NoteSpec } from '../music/playback'
import { tonicMidi } from '../music/register'
import { makeRng } from '../music/rng'
import { describeSpec, type ExerciseSpec } from '../scheduling/exerciseSpec'
import { wrapWithTonalContext } from './context'
import { chordEntry, type ChordFamily } from './data/chords'
import { degreeEntry } from './data/degrees'
import { rhythmEntry, type RhythmFamily } from './data/rhythms'
import { FEEDBACK_ANCHOR_SEC, buildFeedback } from './feedback'
import { FUNCTIONAL_GENERATORS, QUALITY_GENERATORS } from './generators/chord'
import { DEGREE_GENERATORS } from './generators/degree'
import { BASSLINE_GENERATORS, INVERSION_GENERATORS } from './generators/inversion'
import { MODULATION_GENERATORS } from './generators/modulation'
import { ANACRUSIS_GENERATORS, BEAT_ONE_GENERATORS } from './generators/pickup'
import { METER_GENERATORS, MIXED_METER_GENERATORS } from './generators/meter'
import { PATTERN_GENERATORS } from './generators/pattern'
import { barSec } from './generators/rhythmCommon'
import { PROGRESSION_GENERATORS } from './generators/progression'
import { CLICK_TIMBRE, metronomeBarNotes, wrapWithMetronome } from './metronome'
import type { Exercise, Generator, GeneratorEntry } from './types'
import { doMidiFor, resolveVariation } from './variation'

export { answerAsResponse, grade } from './grade'
export type * from './types'

const CHORD_GENERATORS: Record<ChordFamily, Record<Modality, Generator>> = {
  quality: QUALITY_GENERATORS,
  functional: FUNCTIONAL_GENERATORS,
  progression: PROGRESSION_GENERATORS,
  inversion: INVERSION_GENERATORS,
  bassline: BASSLINE_GENERATORS,
}

const RHYTHM_GENERATORS: Record<RhythmFamily, Record<Modality, Generator>> = {
  pattern: PATTERN_GENERATORS,
  meter: METER_GENERATORS,
  'beat-one': BEAT_ONE_GENERATORS,
  anacrusis: ANACRUSIS_GENERATORS,
  'mixed-meter': MIXED_METER_GENERATORS,
}

/**
 * 生成器注册表：知识点 → (调式, 三模态生成器)。
 * 由数据表的行决定分支，不由 kind 字段直接决定（P-2b spec §4）。
 */
export function lookupGenerator(kpId: KnowledgePointId): GeneratorEntry | undefined {
  const degree = degreeEntry(kpId)
  if (degree) {
    return {
      mode: degree.mode,
      context: 'tonal',
      byModality: degree.pool === 'modulation' ? MODULATION_GENERATORS : DEGREE_GENERATORS,
    }
  }
  const chord = chordEntry(kpId)
  if (chord) {
    return { mode: chord.mode, context: 'tonal', byModality: CHORD_GENERATORS[chord.family] }
  }
  const rhythm = rhythmEntry(kpId)
  if (rhythm) {
    // 节奏不需要调中心；调式取默认（P-2b spec §14），音高只用主音
    return { mode: 'major', context: 'metronome', byModality: RHYTHM_GENERATORS[rhythm.family] }
  }
  return undefined
}

/** R 轨节拍器点击比主音高一个八度 */
export const CLICK_OCTAVE = 12

/**
 * 管线本体（P-2b spec §4）：解析变异轴 → 生成内容 → 语境包装 → 反馈。
 *
 * 按 entry.context 分派语境：tonal 用调性语境（主 spec §6.1），反馈锚点是主音；
 * metronome 用节拍器（P-2b spec §7.1），反馈锚点是一小节节拍器（§9）。
 * 纯函数；rng 消耗顺序固定为「变异轴 → 内容 → 选项打乱」。
 * spec.difficultyStep 必须已由调用方写入阶梯档位（主 spec FWD-8），这里不检查。
 */
export function generateWith(
  entry: GeneratorEntry,
  spec: ExerciseSpec,
  curriculum: Curriculum,
): Exercise {
  const rng = makeRng(spec.seed)
  const resolved = resolveVariation(spec.variationLevel, entry.mode, rng)
  const doMidi = doMidiFor(resolved)
  const content = entry.byModality[spec.modality]({ spec, curriculum, resolved, doMidi, rng })
  const contentPlan = notesToPlan(content.notes, resolved.timbreId)
  const tonic = tonicMidi(resolved.key, doMidi)

  let wrapped: { plan: Exercise['plan']; contentStartSec: number }
  let anchor: NoteSpec[]
  let anchorTimbre = resolved.timbreId
  let contentOffsetSec: number | undefined
  if (entry.context === 'tonal') {
    wrapped = wrapWithTonalContext({
      key: resolved.key,
      level: spec.contextLevel,
      timbreId: resolved.timbreId,
      doMidi,
      content: contentPlan,
      contentDurSec: content.durSec,
    })
    anchor = [{ midi: tonic, atSec: 0, durSec: FEEDBACK_ANCHOR_SEC, gain: resolved.velocity }]
  } else {
    if (!content.rhythm) {
      throw new Error(`节拍器语境的生成器必须给出 rhythm：${describeSpec(spec)}`)
    }
    const clickMidi = tonic + CLICK_OCTAVE
    wrapped = wrapWithMetronome({
      bars: content.rhythm.bars,
      bpm: resolved.bpm,
      level: spec.contextLevel,
      mode: content.rhythm.metronome,
      clickMidi,
      timbreId: resolved.timbreId,
      clickTimbreId: CLICK_TIMBRE,
      content: contentPlan,
      contentDurSec: content.durSec,
      startPulse: content.rhythm.startPulse,
    })
    anchor = metronomeBarNotes(content.rhythm.bars[0], resolved.bpm, clickMidi)
    anchorTimbre = CLICK_TIMBRE
    // 内容落在「一小节节拍器 + startPulse 个感知拍」之后，对准脉冲网格
    contentOffsetSec = barSec(content.rhythm.bars[0], resolved.bpm) + ((content.rhythm.startPulse ?? 0) * 60) / resolved.bpm
  }

  const feedback = buildFeedback(content.feedbackNotes, anchor, resolved.timbreId, contentOffsetSec, anchorTimbre)
  return {
    spec,
    resolved,
    plan: wrapped.plan,
    contentStartSec: wrapped.contentStartSec,
    prompt: content.prompt,
    format: content.format,
    answer: content.answer,
    feedback,
  }
}

/** 管线入口：查生成器表，再走 generateWith */
export function generate(spec: ExerciseSpec, curriculum: Curriculum): Exercise {
  const entry = lookupGenerator(spec.kpId)
  if (!entry) throw new Error(`没有可用的生成器：${describeSpec(spec)}`)
  return generateWith(entry, spec, curriculum)
}
