import { describe, expect, it } from 'vitest'
import type { PlaybackPlan } from '../music/playback'
import { MIN_TAIL_SEC, planToVoices, trimContextTails } from './voices'
import { TIMBRES } from './timbres'

const ev = (atSec: number, durSec: number) => ({ atSec, durSec, freqHz: 440, timbreId: 'strings' as const, gain: 0.5 })
const plan: PlaybackPlan = {
  events: [ev(0, 1.65), ev(0, 4), ev(2.0, 0.5)], // 终止式末和弦、持续低音、目标音
  totalDurSec: 4,
}

describe('trimContextTails（FWD-5）', () => {
  it('cut 之前本该结束的声部：释音截到 cut；持续低音与目标音不动', () => {
    const start = 10
    const voices = planToVoices(plan, start)
    const out = trimContextTails(voices, start + 2.0)
    expect(voices[0].stopSec).toBeCloseTo(start + 1.65 + TIMBRES.strings.env.releaseSec)
    expect(out[0].stopSec).toBeCloseTo(start + 2.0)
    expect(out[1]).toEqual(voices[1])
    expect(out[2]).toEqual(voices[2])
  })

  it('事件恰在 cut 处结束：至少保留 MIN_TAIL_SEC 的尾巴，避免爆音', () => {
    const voices = planToVoices({ events: [ev(0, 2)], totalDurSec: 2 }, 0)
    expect(trimContextTails(voices, 2)[0].stopSec).toBeCloseTo(2 + MIN_TAIL_SEC)
  })

  it('不修改输入', () => {
    const voices = planToVoices(plan, 0)
    const before = voices.map((v) => v.stopSec)
    trimContextTails(voices, 2)
    expect(voices.map((v) => v.stopSec)).toEqual(before)
  })
})
