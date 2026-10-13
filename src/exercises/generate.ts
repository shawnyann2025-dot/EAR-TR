import type { Curriculum } from '../curriculum/curriculum'
import type { KnowledgePointId } from '../curriculum/knowledgePoints'
import { notesToPlan } from '../music/playback'
import { doMidiForKey, tonicMidi } from '../music/register'
import { makeRng } from '../music/rng'
import { describeSpec, type ExerciseSpec } from '../scheduling/exerciseSpec'
import { wrapWithTonalContext } from './context'
import { degreeEntry } from './data/degrees'
import { FEEDBACK_ANCHOR_SEC, buildFeedback } from './feedback'
import { DEGREE_GENERATORS } from './generators/degree'
import { MODULATION_GENERATORS } from './generators/modulation'
import type { Exercise, GeneratorEntry } from './types'
import { resolveVariation } from './variation'

export { answerAsResponse, grade } from './grade'
export type * from './types'

/**
 * 生成器注册表：知识点 → (调式, 三模态生成器)。
 * 由数据表的行决定分支，不由 kind 字段直接决定（P-2b spec §4）。
 * P-2b-H / P-2b-R 在此追加 H/R 轨的查找。
 */
export function lookupGenerator(kpId: KnowledgePointId): GeneratorEntry | undefined {
  const degree = degreeEntry(kpId)
  if (degree) {
    return {
      mode: degree.mode,
      byModality: degree.pool === 'modulation' ? MODULATION_GENERATORS : DEGREE_GENERATORS,
    }
  }
  return undefined
}

/**
 * 管线入口（P-2b spec §4）：解析变异轴 → 生成内容 → 语境包装 → 反馈。
 *
 * 纯函数；rng 消耗顺序固定为「变异轴 → 内容 → 选项打乱」。
 * spec.difficultyStep 必须已由调用方写入阶梯档位（主 spec FWD-8），这里不检查。
 */
export function generate(spec: ExerciseSpec, curriculum: Curriculum): Exercise {
  const entry = lookupGenerator(spec.kpId)
  if (!entry) throw new Error(`没有可用的生成器：${describeSpec(spec)}`)

  const rng = makeRng(spec.seed)
  const resolved = resolveVariation(spec.variationLevel, entry.mode, rng)
  const doMidi = doMidiForKey(resolved.key, resolved.centerMidi)
  const content = entry.byModality[spec.modality]({ spec, curriculum, resolved, doMidi, rng })

  const { plan, contentStartSec } = wrapWithTonalContext({
    key: resolved.key,
    level: spec.contextLevel,
    timbreId: resolved.timbreId,
    doMidi,
    content: notesToPlan(content.notes, resolved.timbreId),
    contentDurSec: content.durSec,
  })

  const anchor = [
    {
      midi: tonicMidi(resolved.key, doMidi),
      atSec: 0,
      durSec: FEEDBACK_ANCHOR_SEC,
      gain: resolved.velocity,
    },
  ]
  const feedback = buildFeedback(content.feedbackNotes, anchor, resolved.timbreId)

  return {
    spec,
    resolved,
    plan,
    contentStartSec,
    prompt: content.prompt,
    format: content.format,
    answer: content.answer,
    feedback,
  }
}
