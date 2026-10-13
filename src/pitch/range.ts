import type { Exercise, PitchTarget } from '../exercises/types'
import type { PlaybackPlan } from '../music/playback'

export interface VocalRange {
  lowMidi: number
  highMidi: number
}

export type VoicePreset = 'bass' | 'tenor' | 'alto' | 'soprano'

/** 无麦克风时的声部预设（P-4 spec §3.5） */
export const VOICE_PRESETS: Record<VoicePreset, VocalRange & { label: string }> = {
  bass: { lowMidi: 41, highMidi: 62, label: '男低' },
  tenor: { lowMidi: 48, highMidi: 69, label: '男高' },
  alto: { lowMidi: 53, highMidi: 74, label: '女低' },
  soprano: { lowMidi: 60, highMidi: 81, label: '女高' },
}

export function octaveShiftFor(targetMidis: readonly number[], range: VocalRange): number {
  if (targetMidis.length === 0) return 0
  const mid = (Math.min(...targetMidis) + Math.max(...targetMidis)) / 2
  const rangeMid = (range.lowMidi + range.highMidi) / 2
  const k = Math.round((rangeMid - mid) / 12)
  return Object.is(k, -0) ? 0 : k
}

const shiftPlan = (plan: PlaybackPlan, ratio: number): PlaybackPlan => ({
  ...plan,
  events: plan.events.map((e) => ({ ...e, freqHz: e.freqHz * ratio })),
})

const shiftTargets = (targets: readonly PitchTarget[], k: number, ratio: number): PitchTarget[] =>
  targets.map((t) => ({ ...t, midi: t.midi + 12 * k, freqHz: t.freqHz * ratio }))

/**
 * 整题按整八度搬进音域（P-4 spec D4）：只移八度，不改调、不改内容、不改时间。
 * 只对唱题生效；纯函数，不修改输入。
 */
export function fitToRange(exercise: Exercise, range: VocalRange | null): Exercise {
  if (!range || exercise.format.kind !== 'pitch' || exercise.answer.kind !== 'pitch') return exercise
  const k = octaveShiftFor(exercise.answer.targets.map((t) => t.midi), range)
  if (k === 0) return exercise
  const ratio = Math.pow(2, k)
  return {
    ...exercise,
    resolved: { ...exercise.resolved, centerMidi: exercise.resolved.centerMidi + 12 * k },
    plan: shiftPlan(exercise.plan, ratio),
    format: { ...exercise.format, targets: shiftTargets(exercise.format.targets, k, ratio) },
    answer: { ...exercise.answer, targets: shiftTargets(exercise.answer.targets, k, ratio) },
    feedback: { replay: shiftPlan(exercise.feedback.replay, ratio), slow: shiftPlan(exercise.feedback.slow, ratio) },
  }
}
