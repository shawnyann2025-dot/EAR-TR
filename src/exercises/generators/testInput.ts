import { buildCurriculum } from '../../curriculum/curriculum'
import { parseKpId, trackOfKind, type Modality } from '../../curriculum/knowledgePoints'
import type { Mode } from '../../music/key'
import { doMidiForKey } from '../../music/register'
import { makeRng } from '../../music/rng'
import type { ExerciseSpec } from '../../scheduling/exerciseSpec'
import type { VariationLevel } from '../../curriculum/stages'
import type { GeneratorInput } from '../types'
import { resolveVariation } from '../variation'

const curriculum = buildCurriculum()

/** 按管线第 1 步的同一顺序构造生成器输入（只供测试） */
export function generatorInput(
  kpId: string,
  modality: Modality,
  opts: { step?: number; seed?: number; variationLevel?: number; mode?: Mode } = {},
): GeneratorInput {
  const spec: ExerciseSpec = {
    kpId,
    modality,
    track: trackOfKind(parseKpId(kpId).kind),
    contextLevel: 0,
    variationLevel: (opts.variationLevel ?? 0) as VariationLevel,
    difficultyStep: opts.step ?? 0,
    seed: opts.seed ?? 1,
    segment: 'focus',
  }
  const rng = makeRng(spec.seed)
  const resolved = resolveVariation(spec.variationLevel, opts.mode ?? 'major', rng)
  return {
    spec,
    curriculum,
    resolved,
    doMidi: doMidiForKey(resolved.key, resolved.centerMidi),
    rng,
  }
}
