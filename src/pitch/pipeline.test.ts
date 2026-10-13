import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { generate, grade } from '../exercises/generate'
import { pickHeldNote, validateRange } from './rangeTest'
import { fitToRange, VOICE_PRESETS } from './range'
import { segmentSignal } from './segments'
import { concat, noise, silence, tone } from './synth'

const c = buildCurriculum()
const voice = [1, 0.6, 0.4, 0.25, 0.15].map((amp, i) => ({ ratio: i + 1, amp }))

/** 模拟一次演唱：每个音 0.5 s，带 15 音分颤音，音间 0.12 s 停顿，叠加轻噪声 */
function sing(freqs: number[], seed = 3): Float32Array {
  const parts: Float32Array[] = [silence(0.2)]
  for (const f of freqs) parts.push(tone(f, 0.5, { partials: voice, vibratoCents: 15, amp: 0.4 }), silence(0.12))
  const sig = concat(...parts)
  const n = noise(sig.length / 48_000, seed, 0.01)
  for (let i = 0; i < sig.length; i++) sig[i] += n[i]
  return sig
}

describe('端到端：合成歌声 → YIN → 稳定段 → 判定（P-4 spec §5）', () => {
  const ex = fitToRange(
    generate({ kpId: 'degree:major:mi', modality: 'sing', track: 'T', contextLevel: 1, variationLevel: 1, difficultyStep: 3, seed: 11, segment: 'focus' }, c),
    VOICE_PRESETS.tenor,
  )
  if (ex.answer.kind !== 'pitch') throw new Error('应为唱题')
  const targets = ex.answer.targets

  it('男声低一个八度唱准：判对', () => {
    const segs = segmentSignal(sing(targets.map((t) => t.freqHz / 2)), { noiseRms: 0.006 })
    expect(segs).toHaveLength(targets.length)
    expect(grade(ex, { kind: 'pitch', sungHz: segs.map((s) => s.medianHz) }).correct).toBe(true)
  })

  it('有一个音唱高半音：判错，且只错那一个', () => {
    const freqs = targets.map((t, i) => (i === targets.length - 1 ? t.freqHz * Math.pow(2, 1 / 12) : t.freqHz))
    const segs = segmentSignal(sing(freqs), { noiseRms: 0.006 })
    const r = grade(ex, { kind: 'pitch', sungHz: segs.map((s) => s.medianHz) })
    expect(r.correct).toBe(false)
    if (r.detail.kind !== 'pitch') throw new Error()
    expect(r.detail.perTarget).toEqual(targets.map((_, i) => i !== targets.length - 1))
  })

  it('只有噪声：没有稳定段，判错', () => {
    const segs = segmentSignal(noise(2, 9, 0.01), { noiseRms: 0.006 })
    expect(segs).toHaveLength(0)
    expect(grade(ex, { kind: 'pitch', sungHz: [] }).correct).toBe(false)
  })

  it('音域测定：唱住最低音与最高音，得到合格音域', () => {
    const low = pickHeldNote(segmentSignal(sing([110])))
    const high = pickHeldNote(segmentSignal(sing([392])))
    expect(validateRange(low, high)).toEqual({ ok: true, range: { lowMidi: 45, highMidi: 67 } })
  })
})
