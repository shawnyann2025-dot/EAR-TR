import {
  MAJOR_SCALE_DEGREES,
  type Key,
  type ScaleDegree,
} from '../music/key'
import {
  mergePlans,
  notesToPlan,
  type PlaybackPlan,
  type TimbreId,
} from '../music/playback'
import { makeRng } from '../music/rng'
import { degreeToMidi, doMidiForKey } from '../music/register'
import { buildTonalContext, type ContextLevel } from '../music/tonalContext'
import { TIMBRE_IDS } from '../audio/timbres'

export interface DegreeProbe {
  plan: PlaybackPlan
  key: Key
  degree: ScaleDegree
  timbreId: TimbreId
  level: ContextLevel
}

const TARGET_DUR_SEC = 1.2
const CENTER_MIDI = 60

/**
 * 开发验证用的音级题：建立调性语境，然后播一个目标音级。
 * 正式的题目生成器在 P-2 计划里实现，这里只为了能用耳朵验收音频层。
 */
export function buildDegreeProbe(seed: number, level: ContextLevel): DegreeProbe {
  const rng = makeRng(seed)

  const key: Key = { tonic: rng.int(12), mode: 'major' }
  const timbreId = rng.pick(TIMBRE_IDS)
  const degree = rng.pick(MAJOR_SCALE_DEGREES)

  const doMidi = doMidiForKey(key, CENTER_MIDI)
  const context = buildTonalContext({
    key,
    level,
    timbreId,
    doMidi,
    itemDurSec: TARGET_DUR_SEC,
  })

  const target = notesToPlan(
    [
      {
        midi: degreeToMidi(degree, doMidi),
        atSec: context.leadInSec,
        durSec: TARGET_DUR_SEC,
      },
    ],
    timbreId,
  )

  return { plan: mergePlans(context.plan, target), key, degree, timbreId, level }
}
