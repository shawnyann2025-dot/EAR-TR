import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { generate, grade } from '../exercises/generate'
import { pickHeldNote, validateRange } from './rangeTest'
import { makeRng } from '../music/rng'
import { judgeSung } from './judge'
import { fitToRange, VOICE_PRESETS } from './range'
import { segmentSignal } from './segments'
import { concat, noise, silence, tone, track } from './synth'

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

/**
 * 评审的真实音符模型：起音 −80 音分滑入（60 ms）、收音 −60 音分下垂（80 ms）、
 * 颤音 40 音分 / 5.5 Hz 在 0.3 s 内渐入、约 ±8 音分的阶跃抖动（每 50 ms 一档）、40/50 ms 起收音包络
 */
function realisticNote(freq: number, dur: number, rng: ReturnType<typeof makeRng>): Float32Array {
  const jitter = Array.from({ length: Math.ceil(dur / 0.05) + 1 }, () => (rng.next() * 2 - 1) * 8)
  const sig = track(
    (t) => {
      const scoop = t < 0.06 ? -80 * (1 - t / 0.06) : 0
      const droop = t > dur - 0.08 ? -60 * ((t - (dur - 0.08)) / 0.08) : 0
      const vib = 40 * Math.min(1, t / 0.3) * Math.sin(2 * Math.PI * 5.5 * t)
      return freq * Math.pow(2, (scoop + droop + vib + jitter[Math.floor(t / 0.05)]) / 1200)
    },
    dur,
    { amp: 0.4 },
  )
  const sr = 48_000
  for (let i = 0; i < sig.length; i++) {
    const t = i / sr
    sig[i] *= Math.min(1, t / 0.04, (dur - t) / 0.05)
  }
  return sig
}

function singRealistic(freqs: number[], noteSec: number, seed = 5): Float32Array {
  const rng = makeRng(seed)
  const parts: Float32Array[] = [silence(0.2)]
  for (const f of freqs) parts.push(realisticNote(f, noteSec, rng), silence(0.15))
  const sig = concat(...parts)
  const n = noise(sig.length / 48_000, seed + 1, 0.01)
  for (let i = 0; i < sig.length; i++) sig[i] += n[i]
  return sig
}

describe('端到端：真实音符模型与短音界限（P-4 spec §3.2 已知局限）', () => {
  const freqs = [261.63, 329.63, 392.0]
  const targets = freqs.map((f, i) => ({ degree: (['do', 'mi', 'sol'] as const)[i], midi: [60, 64, 67][i], freqHz: f, centsTolerance: 50 }))

  it('每音 0.6 s：三个音都检出，且都判对', () => {
    const segs = segmentSignal(singRealistic(freqs, 0.6), { noiseRms: 0.006 })
    expect(segs).toHaveLength(3)
    const j = judgeSung(targets, segs.map((s) => s.medianHz))
    expect(j.perTarget).toEqual([true, true, true])
    expect(j.correct).toBe(true)
  })

  it('每音 0.3 s：段数少于目标数（记录当前界限，约 0.45 s 以下可能整个不成段）', () => {
    const segs = segmentSignal(singRealistic(freqs, 0.3), { noiseRms: 0.006 })
    expect(segs.length).toBeLessThan(targets.length)
  })
})
