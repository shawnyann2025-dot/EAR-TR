# P-4a 音高检测纯算法 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 不碰任何浏览器 API，做完唱模态真判定所需的全部纯算法：YIN 基频、稳定段、逐音判定（含八度折叠）、`grade` 的检测分支、搬入音域、音域测定的取值与校验。

**Architecture:** 新目录 `src/pitch/` 全部是纯函数，用合成音频在 Node 里测透。`src/exercises/` 的作答契约增加 `pitch` 的检测分支，`grade` 调 `src/pitch/judge.ts`。P-4b 再把它们接到麦克风与界面上。

**Tech Stack:** TypeScript、vitest。无新依赖。

**Spec:** `docs/superpowers/specs/2026-10-13-p4-pitch-detection-design.md`（P-4 spec）§3、§5 的 P-4a 测试、§6 第一行；主 spec `docs/superpowers/specs/2026-08-24-ear-training-design.md` §9。

## Global Constraints

- `src/pitch/` 零 IO：不得出现 `window.`、`document.`、`navigator.`、`AudioContext`、`Date.now`、`Math.random`。测试里的噪声用 `makeRng`（`src/music/rng.ts`）。
- 依赖方向：`exercises` → `pitch`（值导入）；`pitch` → `exercises` 只允许 `import type`；`pitch` → `music`（纯）。
- 常量取值（P-4 spec §3）：`SAMPLE_RATE = 48_000`、`FRAME_SIZE = 2048`、`HOP_SIZE = 512`、`YIN_THRESHOLD = 0.15`、`F0_MIN_HZ = 60`、`F0_MAX_HZ = 1100`、`VOICED_RMS_FACTOR = 2`、`SEGMENT_JUMP_CENTS = 80`、`SEGMENT_JITTER_CENTS = 30`、`MIN_SEGMENT_SEC = 0.15`、`GAP_SEC = 0.06`、`MIN_RANGE_SEMITONES = 7`；判定容差取 `PitchTarget.centsTolerance`（生成器给 50）。
- 八度折叠：`foldCents(c) = ((c + 600) mod 1200) − 600`，结果在 [−600, 600)。
- 多目标音按顺序一一对应，全对才算对（P-4 spec D2）。
- 自评分支 `{ kind: 'pitch'; selfAssessedCorrect: boolean }` 保持可用，行为不变。
- 测试命令：`npx vitest run <path>`；全量 `npx vitest run`；类型 `npx tsc --noEmit`；构建 `npx vite build`。
- 每个任务结束提交一次，提交信息以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾；不要提交 `.superpowers/` 下的任何文件，不要 `git add -f`。

## File Structure

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/pitch/yin.ts` | 单帧 YIN | 1 |
| `src/pitch/synth.ts` | 测试与验收用的合成信号（纯函数，非测试文件，供后续任务与 P-4b 复用） | 1 |
| `src/pitch/segments.ts` | 有声判定、增量稳定段 | 2 |
| `src/pitch/judge.ts` | 音分、八度折叠、逐音判定 | 3 |
| `src/exercises/types.ts`、`grade.ts`（改） | 检测分支 | 3 |
| `src/pitch/range.ts` | 搬入音域、声部预设 | 4 |
| `src/pitch/rangeTest.ts` | 音域测定取值与校验 | 5 |
| `src/pitch/pipeline.test.ts` | 端到端：合成歌声 → YIN → 稳定段 → 判定 | 5 |

---

### Task 1: YIN 单帧基频与合成信号

**Files:**
- Create: `src/pitch/yin.ts`、`src/pitch/synth.ts`
- Test: `src/pitch/yin.test.ts`

**Interfaces:**
- Produces（`yin.ts`）：`SAMPLE_RATE`、`FRAME_SIZE`、`HOP_SIZE`、`YIN_THRESHOLD`、`F0_MIN_HZ`、`F0_MAX_HZ`；`export interface PitchFrame { f0Hz: number | null; aperiodicity: number; rms: number }`；`export function yinFrame(samples: Float32Array, sampleRate?: number): PitchFrame`
- Produces（`synth.ts`）：
  - `export interface Harmonic { ratio: number; amp: number }`
  - `export function tone(freqHz: number, durSec: number, opts?: { sampleRate?: number; partials?: Harmonic[]; amp?: number; vibratoCents?: number; vibratoHz?: number }): Float32Array`（相位连续；颤音为正弦调频，峰值 `vibratoCents`）
  - `export function silence(durSec: number, sampleRate?: number): Float32Array`
  - `export function noise(durSec: number, seed: number, amp?: number, sampleRate?: number): Float32Array`（`makeRng`）
  - `export function concat(...parts: Float32Array[]): Float32Array`
  - `export function framesOf(signal: Float32Array, sampleRate?: number): { atSec: number; frame: Float32Array }[]`（每 `HOP_SIZE` 取一帧 `FRAME_SIZE`，`atSec` 为帧起点秒数，不足一帧的尾部丢弃）

- [ ] **Step 1: 写失败的测试**

`src/pitch/yin.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { FRAME_SIZE, SAMPLE_RATE, yinFrame } from './yin'
import { noise, silence, tone } from './synth'

const cents = (a: number, b: number) => 1200 * Math.log2(a / b)
const frameOf = (sig: Float32Array) => sig.subarray(0, FRAME_SIZE)

describe('yinFrame（主 spec §9.1）', () => {
  it.each([80, 110, 196, 262, 440, 660, 880, 1000])('正弦 %d Hz：误差 ≤ ±5 音分', (hz) => {
    const f = yinFrame(frameOf(tone(hz, 0.1)), SAMPLE_RATE)
    expect(f.f0Hz).not.toBeNull()
    expect(Math.abs(cents(f.f0Hz!, hz))).toBeLessThanOrEqual(5)
    expect(f.aperiodicity).toBeLessThan(0.15)
  })

  it.each([98, 147, 220, 523])('富泛音音 %d Hz：不报错八度，误差 ≤ ±5 音分', (hz) => {
    const partials = [1, 0.8, 0.6, 0.5, 0.4, 0.3].map((amp, i) => ({ ratio: i + 1, amp }))
    const f = yinFrame(frameOf(tone(hz, 0.1, { partials })), SAMPLE_RATE)
    expect(Math.abs(cents(f.f0Hz!, hz))).toBeLessThanOrEqual(5)
  })

  it('缺基频（只有 2、3、4 次泛音）：仍报基频，不报高八度', () => {
    const partials = [2, 3, 4].map((ratio) => ({ ratio, amp: 1 }))
    const f = yinFrame(frameOf(tone(150, 0.1, { partials })), SAMPLE_RATE)
    expect(Math.abs(cents(f.f0Hz!, 150))).toBeLessThanOrEqual(50)
  })

  it('白噪声与静音判无声', () => {
    expect(yinFrame(frameOf(noise(0.1, 7, 0.5)), SAMPLE_RATE).f0Hz).toBeNull()
    const s = yinFrame(frameOf(silence(0.1)), SAMPLE_RATE)
    expect(s.f0Hz).toBeNull()
    expect(s.rms).toBe(0)
  })

  it('rms 正确：振幅 a 的正弦 rms ≈ a/√2', () => {
    const f = yinFrame(frameOf(tone(440, 0.1, { amp: 0.5 })), SAMPLE_RATE)
    expect(f.rms).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/pitch/yin.test.ts`
Expected: FAIL —— 无法解析模块

- [ ] **Step 3: 写实现**

`src/pitch/synth.ts`：

```ts
import { makeRng } from '../music/rng'
import { FRAME_SIZE, HOP_SIZE, SAMPLE_RATE } from './yin'

/** 合成信号：测试与验收用。纯函数，确定性 */
export interface Harmonic {
  ratio: number
  amp: number
}

export function tone(
  freqHz: number,
  durSec: number,
  opts: { sampleRate?: number; partials?: Harmonic[]; amp?: number; vibratoCents?: number; vibratoHz?: number } = {},
): Float32Array {
  const sr = opts.sampleRate ?? SAMPLE_RATE
  const partials = opts.partials ?? [{ ratio: 1, amp: 1 }]
  const amp = opts.amp ?? 0.5
  const vibCents = opts.vibratoCents ?? 0
  const vibHz = opts.vibratoHz ?? 5.5
  const total = partials.reduce((s, p) => s + p.amp, 0)
  const n = Math.round(durSec * sr)
  const out = new Float32Array(n)
  let phase = 0 // 基频相位（周期数）
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const f = freqHz * Math.pow(2, (vibCents * Math.sin(2 * Math.PI * vibHz * t)) / 1200)
    phase += f / sr
    let v = 0
    for (const p of partials) v += p.amp * Math.sin(2 * Math.PI * p.ratio * phase)
    out[i] = (amp * v) / total
  }
  return out
}

export function silence(durSec: number, sampleRate: number = SAMPLE_RATE): Float32Array {
  return new Float32Array(Math.round(durSec * sampleRate))
}

export function noise(durSec: number, seed: number, amp = 0.3, sampleRate: number = SAMPLE_RATE): Float32Array {
  const rng = makeRng(seed)
  const out = new Float32Array(Math.round(durSec * sampleRate))
  for (let i = 0; i < out.length; i++) out[i] = amp * (rng.next() * 2 - 1)
  return out
}

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** 每 HOP_SIZE 取一帧 FRAME_SIZE；atSec 为帧起点 */
export function framesOf(signal: Float32Array, sampleRate: number = SAMPLE_RATE): { atSec: number; frame: Float32Array }[] {
  const out: { atSec: number; frame: Float32Array }[] = []
  for (let start = 0; start + FRAME_SIZE <= signal.length; start += HOP_SIZE) {
    out.push({ atSec: start / sampleRate, frame: signal.subarray(start, start + FRAME_SIZE) })
  }
  return out
}
```

`src/pitch/yin.ts`：

```ts
/**
 * YIN 基频估计（de Cheveigné & Kawahara 2002），单帧。纯函数，零 IO。
 * 参数见主 spec §9.1：48 kHz / 帧长 2048 / hop 512。
 */
export const SAMPLE_RATE = 48_000
export const FRAME_SIZE = 2048
export const HOP_SIZE = 512
/** 累积均值归一化差分的绝对阈值 */
export const YIN_THRESHOLD = 0.15
export const F0_MIN_HZ = 60
export const F0_MAX_HZ = 1100

export interface PitchFrame {
  /** 无声或不可信时为 null */
  f0Hz: number | null
  /** 所选周期处的 d′ 值；越小越周期 */
  aperiodicity: number
  rms: number
}

export function yinFrame(samples: Float32Array, sampleRate: number = SAMPLE_RATE): PitchFrame {
  const n = samples.length
  let sumSq = 0
  for (let i = 0; i < n; i++) sumSq += samples[i] * samples[i]
  const rms = n > 0 ? Math.sqrt(sumSq / n) : 0

  const tauMin = Math.max(2, Math.floor(sampleRate / F0_MAX_HZ))
  const tauMax = Math.min(Math.floor(n / 2), Math.ceil(sampleRate / F0_MIN_HZ))
  if (tauMax <= tauMin + 1) return { f0Hz: null, aperiodicity: 1, rms }
  const w = n - tauMax

  // 1. 差分函数
  const d = new Float64Array(tauMax + 1)
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0
    for (let j = 0; j < w; j++) {
      const diff = samples[j] - samples[j + tau]
      s += diff * diff
    }
    d[tau] = s
  }

  // 2. 累积均值归一化
  const cmnd = new Float64Array(tauMax + 1)
  cmnd[0] = 1
  let running = 0
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau]
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1
  }

  // 3. 绝对阈值：第一个低于阈值的谷，取该谷的局部极小
  let tauEst = -1
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmnd[tau] < YIN_THRESHOLD) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++
      tauEst = tau
      break
    }
  }
  if (tauEst < 0) {
    let best = tauMin
    for (let tau = tauMin + 1; tau <= tauMax; tau++) if (cmnd[tau] < cmnd[best]) best = tau
    return { f0Hz: null, aperiodicity: cmnd[best], rms }
  }

  // 4. 抛物线插值（在原始差分函数上，精度更好）
  let refined = tauEst
  if (tauEst > 1 && tauEst < tauMax) {
    const s0 = d[tauEst - 1]
    const s1 = d[tauEst]
    const s2 = d[tauEst + 1]
    const denom = s0 + s2 - 2 * s1
    if (denom > 0) refined = tauEst + (s0 - s2) / (2 * denom)
  }
  return { f0Hz: sampleRate / refined, aperiodicity: cmnd[tauEst], rms }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/pitch && npx tsc --noEmit`
Expected: PASS。若高频（880、1000 Hz）误差超过 5 音分，先检查插值（可改为在 `cmnd` 上插值或对相邻三点做二次拟合），**不要放宽 5 音分**；若缺基频用例报了 300 Hz，检查阈值循环是否从 `tauMin` 开始且取第一个谷。

- [ ] **Step 5: 提交**

```bash
git add src/pitch/yin.ts src/pitch/synth.ts src/pitch/yin.test.ts
git commit -m "feat(pitch): YIN 单帧基频与合成信号" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 有声判定与增量稳定段

**Files:**
- Create: `src/pitch/segments.ts`
- Test: `src/pitch/segments.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `PitchFrame`、`HOP_SIZE`、`SAMPLE_RATE`、`yinFrame`、`synth.ts`
- Produces:
  - 常量 `VOICED_RMS_FACTOR = 2`、`SEGMENT_JUMP_CENTS = 80`、`SEGMENT_JITTER_CENTS = 30`、`MIN_SEGMENT_SEC = 0.15`、`GAP_SEC = 0.06`、`STABLE_FRACTION = 0.8`
  - `export interface Segment { startSec: number; endSec: number; medianHz: number }`
  - `export function isVoiced(f: PitchFrame, noiseRms: number): boolean`（`f0Hz !== null && aperiodicity ≤ YIN_THRESHOLD && rms ≥ VOICED_RMS_FACTOR × noiseRms`）
  - `export interface Segmenter { push(frame: PitchFrame, atSec: number): Segment | null; flush(): Segment | null; segments(): Segment[] }`——`push`/`flush` 在一段收尾且合格时返回该段，否则 null；`segments()` 返回迄今全部合格段
  - `export function createSegmenter(opts?: { noiseRms?: number; hopSec?: number }): Segmenter`
  - `export function segmentSignal(signal: Float32Array, opts?: { noiseRms?: number }): Segment[]`（`framesOf` → `yinFrame` → segmenter → flush；测试与 P-4b 验收用）

规则（P-4 spec §3.2）：
- 当前段收尾：遇到无声帧且距上一个有声帧 ≥ `GAP_SEC`；或有声帧相对当前段中位数偏离 > `SEGMENT_JUMP_CENTS`（此帧开新段）；或 `flush()`。
- 段合格：段内距段中位数 ≤ `SEGMENT_JITTER_CENTS` 的帧占比 ≥ `STABLE_FRACTION`，且这些帧数 × `hopSec` ≥ `MIN_SEGMENT_SEC`；`medianHz` 取这些帧的中位数；`startSec`/`endSec` 取段首帧时刻与末帧时刻 + `hopSec`。
- 滑音被「偏离中位数 > 80」切碎成短段而不合格；平稳部分保留——这样连唱（do 滑到 mi）也能分出两个音。

- [ ] **Step 1: 写失败的测试**

`src/pitch/segments.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { concat, silence, tone } from './synth'
import { createSegmenter, isVoiced, segmentSignal, SEGMENT_JITTER_CENTS } from './segments'
import { YIN_THRESHOLD } from './yin'

const cents = (a: number, b: number) => 1200 * Math.log2(a / b)

describe('isVoiced', () => {
  it('需要有 f0、周期性够、能量高于噪声基线两倍', () => {
    expect(isVoiced({ f0Hz: 220, aperiodicity: 0.05, rms: 0.1 }, 0.01)).toBe(true)
    expect(isVoiced({ f0Hz: null, aperiodicity: 0.05, rms: 0.1 }, 0.01)).toBe(false)
    expect(isVoiced({ f0Hz: 220, aperiodicity: YIN_THRESHOLD + 0.01, rms: 0.1 }, 0.01)).toBe(false)
    expect(isVoiced({ f0Hz: 220, aperiodicity: 0.05, rms: 0.015 }, 0.01)).toBe(false)
  })
})

describe('稳定段（主 spec §9.2、P-4 spec §3.2）', () => {
  it('持续 0.5 s 的音：一个段，中位数准', () => {
    const segs = segmentSignal(tone(220, 0.5))
    expect(segs).toHaveLength(1)
    expect(Math.abs(cents(segs[0].medianHz, 220))).toBeLessThan(5)
  })

  it('短于 150 ms 的音不成段', () => {
    expect(segmentSignal(concat(silence(0.1), tone(330, 0.1), silence(0.2)))).toHaveLength(0)
  })

  it('静音间隙把两个音分开', () => {
    const segs = segmentSignal(concat(tone(262, 0.4), silence(0.15), tone(330, 0.4)))
    expect(segs.map((s) => Math.round(s.medianHz))).toEqual([262, 330])
  })

  it('连唱不停顿（音高直接跳 4 个半音）也能分成两段', () => {
    const segs = segmentSignal(concat(tone(262, 0.4), tone(330, 0.4)))
    expect(segs).toHaveLength(2)
  })

  it(`${SEGMENT_JITTER_CENTS} 音分以内的颤音仍是一个段，中位数接近中心`, () => {
    const segs = segmentSignal(tone(294, 0.8, { vibratoCents: 20 }))
    expect(segs).toHaveLength(1)
    expect(Math.abs(cents(segs[0].medianHz, 294))).toBeLessThan(10)
  })

  it('缓慢滑音（一秒滑一个大三度）不形成稳定段', () => {
    // 逐段拼出滑音：每 20 ms 升 8 音分
    const parts: Float32Array[] = []
    for (let i = 0; i < 50; i++) parts.push(tone(262 * Math.pow(2, (i * 8) / 1200), 0.02))
    expect(segmentSignal(concat(...parts))).toHaveLength(0)
  })

  it('噪声基线：低于两倍基线的弱音不算有声', () => {
    expect(segmentSignal(tone(220, 0.5, { amp: 0.01 }), { noiseRms: 0.02 })).toHaveLength(0)
  })

  it('增量 push 与一次性 segmentSignal 结果一致；push 在段收尾时返回该段', () => {
    const seg = createSegmenter()
    const closed = []
    for (let i = 0; i < 40; i++) {
      const r = seg.push({ f0Hz: 220, aperiodicity: 0.05, rms: 0.1 }, i * 0.01)
      if (r) closed.push(r)
    }
    for (let i = 40; i < 50; i++) {
      const r = seg.push({ f0Hz: null, aperiodicity: 1, rms: 0 }, i * 0.01)
      if (r) closed.push(r)
    }
    expect(closed).toHaveLength(1)
    expect(seg.segments()).toEqual(closed)
    expect(seg.flush()).toBeNull()
  })
})
```

（`'缓慢滑音'` 用例里分段拼接的 tone 相位不连续，会带来轻微咔哒；YIN 对此稳健。若该用例因帧落在拼接点而产生零星短段，那些段不会达到 150 ms——断言不变。）

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/pitch/segments.test.ts`
Expected: FAIL —— 无法解析模块

- [ ] **Step 3: 写实现**

`src/pitch/segments.ts`：

```ts
import { framesOf } from './synth'
import { HOP_SIZE, SAMPLE_RATE, YIN_THRESHOLD, yinFrame, type PitchFrame } from './yin'

export const VOICED_RMS_FACTOR = 2
export const SEGMENT_JUMP_CENTS = 80
export const SEGMENT_JITTER_CENTS = 30
export const MIN_SEGMENT_SEC = 0.15
export const GAP_SEC = 0.06
/** 段内落在中位数 ±SEGMENT_JITTER_CENTS 内的帧至少占这么多 */
export const STABLE_FRACTION = 0.8

export interface Segment {
  startSec: number
  endSec: number
  medianHz: number
}

export function isVoiced(f: PitchFrame, noiseRms: number): boolean {
  return f.f0Hz !== null && f.aperiodicity <= YIN_THRESHOLD && f.rms >= VOICED_RMS_FACTOR * noiseRms
}

const cents = (a: number, b: number) => 1200 * Math.log2(a / b)

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface Segmenter {
  push(frame: PitchFrame, atSec: number): Segment | null
  flush(): Segment | null
  segments(): Segment[]
}

export function createSegmenter(opts: { noiseRms?: number; hopSec?: number } = {}): Segmenter {
  const noiseRms = opts.noiseRms ?? 0
  const hopSec = opts.hopSec ?? HOP_SIZE / SAMPLE_RATE
  let run: { atSec: number; hz: number }[] = []
  let lastVoicedAt = -Infinity
  const done: Segment[] = []

  const close = (): Segment | null => {
    const frames = run
    run = []
    if (frames.length === 0) return null
    const m = median(frames.map((f) => f.hz))
    const stable = frames.filter((f) => Math.abs(cents(f.hz, m)) <= SEGMENT_JITTER_CENTS)
    if (stable.length < STABLE_FRACTION * frames.length) return null
    if (stable.length * hopSec < MIN_SEGMENT_SEC - 1e-9) return null
    const seg: Segment = {
      startSec: frames[0].atSec,
      endSec: frames[frames.length - 1].atSec + hopSec,
      medianHz: median(stable.map((f) => f.hz)),
    }
    done.push(seg)
    return seg
  }

  return {
    push(frame, atSec) {
      if (!isVoiced(frame, noiseRms)) {
        if (run.length > 0 && atSec - lastVoicedAt >= GAP_SEC - 1e-9) return close()
        return null
      }
      const hz = frame.f0Hz as number
      let closed: Segment | null = null
      if (run.length > 0) {
        const m = median(run.map((f) => f.hz))
        if (Math.abs(cents(hz, m)) > SEGMENT_JUMP_CENTS || atSec - lastVoicedAt >= GAP_SEC - 1e-9) closed = close()
      }
      run.push({ atSec, hz })
      lastVoicedAt = atSec
      return closed
    },
    flush: close,
    segments: () => [...done],
  }
}

export function segmentSignal(signal: Float32Array, opts: { noiseRms?: number } = {}): Segment[] {
  const seg = createSegmenter({ noiseRms: opts.noiseRms })
  for (const { atSec, frame } of framesOf(signal)) seg.push(yinFrame(frame), atSec)
  seg.flush()
  return seg.segments()
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/pitch && npx tsc --noEmit`
Expected: PASS。若「连唱」只出一段：确认偏离判据用的是**当前段中位数**而非上一帧；若颤音被拆段：确认 `SEGMENT_JUMP_CENTS = 80` 是对中位数的偏离。不要改常量。

- [ ] **Step 5: 提交**

```bash
git add src/pitch/segments.ts src/pitch/segments.test.ts
git commit -m "feat(pitch): 有声判定与增量稳定段" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 逐音判定与 `grade` 的检测分支

**Files:**
- Create: `src/pitch/judge.ts`
- Modify: `src/exercises/types.ts`、`src/exercises/grade.ts`
- Test: `src/pitch/judge.test.ts`、`src/exercises/grade.test.ts`（末尾追加）

**Interfaces:**
- Consumes: `PitchTarget`（exercises/types，`import type`）
- Produces（`judge.ts`）：
  - `export function centsBetween(hz: number, targetHz: number): number`
  - `export function foldCents(c: number): number`
  - `export interface SungJudgement { correct: boolean; perTarget: boolean[]; centsOff: (number | null)[] }`
  - `export function judgeSung(targets: readonly PitchTarget[], sungHz: readonly number[]): SungJudgement`
- Produces（`types.ts`）：
  - `Response` 的 pitch 分支变为两支：`| { kind: 'pitch'; selfAssessedCorrect: boolean } | { kind: 'pitch'; sungHz: number[] }`
  - `GradeResult.detail` 的 pitch 变为 `{ kind: 'pitch'; perTarget?: boolean[]; centsOff?: (number | null)[] }`

- [ ] **Step 1: 写失败的测试**

`src/pitch/judge.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import type { PitchTarget } from '../exercises/types'
import { midiToFreq } from '../music/pitch'
import { centsBetween, foldCents, judgeSung } from './judge'

const target = (midi: number): PitchTarget => ({ degree: 'do', midi, freqHz: midiToFreq(midi), centsTolerance: 50 })
const at = (midi: number, cents = 0) => midiToFreq(midi) * Math.pow(2, cents / 1200)

describe('foldCents（主 spec §9.3）', () => {
  it('结果在 [-600, 600)，整八度折到 0', () => {
    expect(foldCents(0)).toBe(0)
    expect(foldCents(1200)).toBe(0)
    expect(foldCents(-2400)).toBe(0)
    expect(foldCents(1230)).toBeCloseTo(30)
    expect(foldCents(-1170)).toBeCloseTo(30)
    expect(foldCents(600)).toBe(-600)
  })
  it('centsBetween', () => {
    expect(centsBetween(880, 440)).toBeCloseTo(1200)
  })
})

describe('judgeSung（P-4 spec D2）', () => {
  const ts = [target(60), target(64), target(67)]

  it('全部在 ±50 音分内才对', () => {
    const r = judgeSung(ts, [at(60, 10), at(64, -49), at(67, 49)])
    expect(r.correct).toBe(true)
    expect(r.perTarget).toEqual([true, true, true])
    expect(r.centsOff[1]).toBeCloseTo(-49, 5)
  })

  it('偏 51 音分判错', () => {
    const r = judgeSung(ts, [at(60), at(64, 51), at(67)])
    expect(r.correct).toBe(false)
    expect(r.perTarget).toEqual([true, false, true])
  })

  it('八度折叠：低一个、两个八度，高一个八度都判对', () => {
    expect(judgeSung(ts, [at(48), at(52), at(55)]).correct).toBe(true)
    expect(judgeSung(ts, [at(36), at(40), at(43)]).correct).toBe(true)
    expect(judgeSung(ts, [at(72), at(76), at(79)]).correct).toBe(true)
  })

  it('段数不足：缺的记错、centsOff 为 null', () => {
    const r = judgeSung(ts, [at(60), at(64)])
    expect(r.correct).toBe(false)
    expect(r.perTarget).toEqual([true, true, false])
    expect(r.centsOff[2]).toBeNull()
  })

  it('多唱的段忽略；顺序错了判错', () => {
    expect(judgeSung(ts, [at(60), at(64), at(67), at(72)]).correct).toBe(true)
    expect(judgeSung(ts, [at(64), at(60), at(67)]).correct).toBe(false)
  })

  it('什么都没唱：全错', () => {
    const r = judgeSung(ts, [])
    expect(r).toEqual({ correct: false, perTarget: [false, false, false], centsOff: [null, null, null] })
  })
})
```

在 `src/exercises/grade.test.ts` 末尾追加（文件已 import `grade`；如未 import `buildCurriculum`、`generate`，按下面补齐并与已有 import 合并）：

```ts
import { buildCurriculum as buildCurriculumForPitch } from '../curriculum/curriculum'
import { generate as generateForPitch } from './generate'

describe('grade：唱模态检测分支（P-4 spec §3.4）', () => {
  const c = buildCurriculumForPitch()
  const ex = generateForPitch(
    { kpId: 'degree:major:mi', modality: 'sing', track: 'T', contextLevel: 1, variationLevel: 1, difficultyStep: 2, seed: 5, segment: 'focus' },
    c,
  )
  if (ex.answer.kind !== 'pitch') throw new Error('应为唱题')
  const targets = ex.answer.targets

  it('唱准（含低一个八度）判对，detail 带逐音结果', () => {
    const r = grade(ex, { kind: 'pitch', sungHz: targets.map((t) => t.freqHz / 2) })
    expect(r.correct).toBe(true)
    expect(r.detail).toEqual({ kind: 'pitch', perTarget: targets.map(() => true), centsOff: targets.map(() => expect.closeTo(0, 6)) })
  })

  it('有一个音唱偏半音判错', () => {
    const sung = targets.map((t, i) => (i === 0 ? t.freqHz * Math.pow(2, 1 / 12) : t.freqHz))
    const r = grade(ex, { kind: 'pitch', sungHz: sung })
    expect(r.correct).toBe(false)
    if (r.detail.kind !== 'pitch') throw new Error()
    expect(r.detail.perTarget![0]).toBe(false)
  })

  it('自评分支行为不变', () => {
    expect(grade(ex, { kind: 'pitch', selfAssessedCorrect: true })).toEqual({ correct: true, detail: { kind: 'pitch' } })
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/pitch/judge.test.ts src/exercises/grade.test.ts`
Expected: FAIL —— `./judge` 不存在；`sungHz` 不是合法的 Response

- [ ] **Step 3: 写实现**

`src/pitch/judge.ts`：

```ts
import type { PitchTarget } from '../exercises/types'

/** hz 相对 targetHz 的音分差 */
export function centsBetween(hz: number, targetHz: number): number {
  return 1200 * Math.log2(hz / targetHz)
}

/** 八度折叠（主 spec §9.3、P-2b §14）：结果在 [-600, 600) */
export function foldCents(c: number): number {
  return ((((c + 600) % 1200) + 1200) % 1200) - 600
}

export interface SungJudgement {
  correct: boolean
  perTarget: boolean[]
  centsOff: (number | null)[]
}

/**
 * 逐音判定（P-4 spec D2）：第 i 个目标对应第 i 个稳定段；缺的记错，多唱的忽略；
 * 每个都在容差内（八度折叠后）才算对，全对才 correct。
 */
export function judgeSung(targets: readonly PitchTarget[], sungHz: readonly number[]): SungJudgement {
  const centsOff = targets.map((t, i) => (i < sungHz.length ? foldCents(centsBetween(sungHz[i], t.freqHz)) : null))
  const perTarget = centsOff.map((c, i) => c !== null && Math.abs(c) <= targets[i].centsTolerance)
  return { correct: targets.length > 0 && perTarget.every(Boolean), perTarget, centsOff }
}
```

`src/exercises/types.ts`：

```ts
export type Response =
  | { kind: 'choice'; id: string }
  | { kind: 'sequence'; ids: string[] }
  /** P-3：自评 */
  | { kind: 'pitch'; selfAssessedCorrect: boolean }
  /** P-4：检测到的各稳定段中位数（Hz），按唱的先后 */
  | { kind: 'pitch'; sungHz: number[] }
  | { kind: 'tap'; tapsSec: number[] }
```

`GradeResult.detail` 的 pitch 行改为：

```ts
    | { kind: 'pitch'; perTarget?: boolean[]; centsOff?: (number | null)[] }
```

`src/exercises/grade.ts`：`import { judgeSung } from '../pitch/judge'`；`pitch` 分支改为：

```ts
    case 'pitch': {
      if (response.kind !== 'pitch') return responseMismatch('pitch', response.kind)
      if ('sungHz' in response) {
        const j = judgeSung(answer.targets, response.sungHz)
        return { correct: j.correct, detail: { kind: 'pitch', perTarget: j.perTarget, centsOff: j.centsOff } }
      }
      return { correct: response.selfAssessedCorrect, detail: { kind: 'pitch' } }
    }
```

（若别处对 `Response` 的 pitch 分支做了穷举——例如 `src/ui` 里构造 `selfAssessedCorrect`——不受影响；`tsc` 会指出需要收窄的地方，用 `'selfAssessedCorrect' in r` / `'sungHz' in r` 收窄。）

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS（仿真特征快照不受影响：仿真不走 `grade` 的唱分支）

- [ ] **Step 5: 提交**

```bash
git add src/pitch/judge.ts src/pitch/judge.test.ts src/exercises/types.ts src/exercises/grade.ts src/exercises/grade.test.ts
git commit -m "feat(pitch): 逐音判定与八度折叠；grade 增加唱模态检测分支" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 搬入音域与声部预设

**Files:**
- Create: `src/pitch/range.ts`
- Test: `src/pitch/range.test.ts`

**Interfaces:**
- Consumes: `Exercise`（exercises/types，`import type`）、`PlaybackPlan`（music/playback，`import type`）
- Produces:
  - `export interface VocalRange { lowMidi: number; highMidi: number }`
  - `export type VoicePreset = 'bass' | 'tenor' | 'alto' | 'soprano'`
  - `export const VOICE_PRESETS: Record<VoicePreset, VocalRange & { label: string }>`：`bass` 男低 41–62、`tenor` 男高 48–69、`alto` 女低 53–74、`soprano` 女高 60–81
  - `export function octaveShiftFor(targetMidis: readonly number[], range: VocalRange): number`（整数 k：使目标中点 + 12k 最接近音域中点；中点相等时取 0）
  - `export function fitToRange(exercise: Exercise, range: VocalRange | null): Exercise`（只对 `format.kind === 'pitch'` 生效；k = 0 或 range 为 null 时返回原对象；否则返回新对象：`plan`、`feedback.replay`、`feedback.slow` 的事件 `freqHz × 2^k`，`format.targets` 与 `answer.targets` 的 `midi + 12k`、`freqHz × 2^k`，`resolved.centerMidi + 12k`；不修改输入）

- [ ] **Step 1: 写失败的测试**

`src/pitch/range.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { generate, type Exercise } from '../exercises/generate'
import { VOICE_PRESETS, fitToRange, octaveShiftFor } from './range'

const c = buildCurriculum()
const sing = (seed: number): Exercise =>
  generate({ kpId: 'degree:major:sol', modality: 'sing', track: 'T', contextLevel: 1, variationLevel: 1, difficultyStep: 2, seed, segment: 'focus' }, c)
const recognize = generate({ kpId: 'degree:major:sol', modality: 'recognize', track: 'T', contextLevel: 1, variationLevel: 1, difficultyStep: 2, seed: 1, segment: 'focus' }, c)

describe('VOICE_PRESETS（P-4 spec §3.5）', () => {
  it('四个声部的 MIDI 范围', () => {
    expect(VOICE_PRESETS.bass).toMatchObject({ lowMidi: 41, highMidi: 62 })
    expect(VOICE_PRESETS.tenor).toMatchObject({ lowMidi: 48, highMidi: 69 })
    expect(VOICE_PRESETS.alto).toMatchObject({ lowMidi: 53, highMidi: 74 })
    expect(VOICE_PRESETS.soprano).toMatchObject({ lowMidi: 60, highMidi: 81 })
  })
})

describe('octaveShiftFor', () => {
  it('取使目标中点最接近音域中点的整八度', () => {
    expect(octaveShiftFor([72, 76], { lowMidi: 41, highMidi: 62 })).toBe(-2)
    expect(octaveShiftFor([60, 64], { lowMidi: 53, highMidi: 74 })).toBe(0)
    expect(octaveShiftFor([48], { lowMidi: 60, highMidi: 81 })).toBe(2)
  })
})

describe('fitToRange（P-4 spec D4）', () => {
  it('无音域或非唱题：原样返回同一对象', () => {
    const ex = sing(1)
    expect(fitToRange(ex, null)).toBe(ex)
    expect(fitToRange(recognize, VOICE_PRESETS.bass)).toBe(recognize)
  })

  it('整题按整八度移动：目标、播放、反馈一起移，时间不变；不修改输入', () => {
    for (let seed = 0; seed < 10; seed++) {
      const ex = sing(seed)
      if (ex.answer.kind !== 'pitch' || ex.format.kind !== 'pitch') throw new Error('应为唱题')
      const before = JSON.stringify(ex)
      const range = VOICE_PRESETS.bass
      const out = fitToRange(ex, range)
      expect(JSON.stringify(ex)).toBe(before)
      if (out.answer.kind !== 'pitch' || out.format.kind !== 'pitch') throw new Error()
      const k = octaveShiftFor(ex.answer.targets.map((t) => t.midi), range)
      const ratio = Math.pow(2, k)
      out.answer.targets.forEach((t, i) => {
        expect(t.midi).toBe((ex.answer as { targets: { midi: number }[] }).targets[i].midi + 12 * k)
        expect(t.freqHz).toBeCloseTo((ex.answer as { targets: { freqHz: number }[] }).targets[i].freqHz * ratio, 6)
      })
      expect(out.format.targets).toEqual(out.answer.targets)
      for (const [a, b] of [[out.plan, ex.plan], [out.feedback.replay, ex.feedback.replay], [out.feedback.slow, ex.feedback.slow]] as const) {
        expect(a.events.map((e) => e.atSec)).toEqual(b.events.map((e) => e.atSec))
        a.events.forEach((e, i) => expect(e.freqHz).toBeCloseTo(b.events[i].freqHz * ratio, 6))
      }
      // 目标中点落在音域内
      const mids = out.answer.targets.map((t) => t.midi)
      const mid = (Math.min(...mids) + Math.max(...mids)) / 2
      expect(mid).toBeGreaterThanOrEqual(range.lowMidi - 6)
      expect(mid).toBeLessThanOrEqual(range.highMidi + 6)
    }
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/pitch/range.test.ts`
Expected: FAIL —— 无法解析模块

- [ ] **Step 3: 写实现**

`src/pitch/range.ts`：

```ts
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
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/pitch && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/pitch/range.ts src/pitch/range.test.ts
git commit -m "feat(pitch): 整题按八度搬进音域与声部预设" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 音域测定取值、端到端管线测试、写回

**Files:**
- Create: `src/pitch/rangeTest.ts`、`src/pitch/pipeline.test.ts`
- Test: `src/pitch/rangeTest.test.ts`
- Modify: `docs/superpowers/specs/2026-08-24-ear-training-design.md`（§9 状态）

**Interfaces:**
- Consumes: Task 1–4 的全部导出；`freqToMidi`（music/pitch）
- Produces:
  - `export const MIN_RANGE_SEMITONES = 7`
  - `export function pickHeldNote(segments: readonly Segment[]): number | null`（最长段的 `medianHz` 转 MIDI 并取整；无段为 null）
  - `export type RangeCheck = { ok: true; range: VocalRange } | { ok: false; reason: string }`
  - `export function validateRange(lowMidi: number | null, highMidi: number | null): RangeCheck`（任一为 null → 「没听到声音，请再唱一次」；`high − low < 7` → 「音域太窄，请再试一次：最低音尽量低、最高音尽量高」；low > high 时交换后再判）

- [ ] **Step 1: 写失败的测试**

`src/pitch/rangeTest.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { midiToFreq } from '../music/pitch'
import { MIN_RANGE_SEMITONES, pickHeldNote, validateRange } from './rangeTest'

describe('pickHeldNote', () => {
  it('取最长的稳定段，转成最近的 MIDI', () => {
    const segs = [
      { startSec: 0, endSec: 0.3, medianHz: midiToFreq(50) },
      { startSec: 0.5, endSec: 1.5, medianHz: midiToFreq(45) * Math.pow(2, 20 / 1200) },
    ]
    expect(pickHeldNote(segs)).toBe(45)
    expect(pickHeldNote([])).toBeNull()
  })
})

describe('validateRange', () => {
  it(`跨度 ≥ ${MIN_RANGE_SEMITONES} 半音才通过；顺序颠倒自动交换`, () => {
    expect(validateRange(45, 64)).toEqual({ ok: true, range: { lowMidi: 45, highMidi: 64 } })
    expect(validateRange(64, 45)).toEqual({ ok: true, range: { lowMidi: 45, highMidi: 64 } })
    expect(validateRange(50, 56).ok).toBe(false)
    expect(validateRange(null, 60)).toMatchObject({ ok: false, reason: expect.stringMatching(/没听到/) })
  })
})
```

`src/pitch/pipeline.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/pitch`
Expected: FAIL —— `./rangeTest` 不存在

- [ ] **Step 3: 写实现**

`src/pitch/rangeTest.ts`：

```ts
import { freqToMidi } from '../music/pitch'
import type { VocalRange } from './range'
import type { Segment } from './segments'

export const MIN_RANGE_SEMITONES = 7

/** 音域测定：取最长的稳定段作为「唱住的那个音」 */
export function pickHeldNote(segments: readonly Segment[]): number | null {
  if (segments.length === 0) return null
  const longest = segments.reduce((a, b) => (b.endSec - b.startSec > a.endSec - a.startSec ? b : a))
  return Math.round(freqToMidi(longest.medianHz))
}

export type RangeCheck = { ok: true; range: VocalRange } | { ok: false; reason: string }

export function validateRange(lowMidi: number | null, highMidi: number | null): RangeCheck {
  if (lowMidi === null || highMidi === null) return { ok: false, reason: '没听到声音，请再唱一次' }
  const lo = Math.min(lowMidi, highMidi)
  const hi = Math.max(lowMidi, highMidi)
  if (hi - lo < MIN_RANGE_SEMITONES) return { ok: false, reason: '音域太窄，请再试一次：最低音尽量低、最高音尽量高' }
  return { ok: true, range: { lowMidi: lo, highMidi: hi } }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/pitch && npx tsc --noEmit`
Expected: PASS。若端到端用例里段数多于目标数（噪声或颤音产生零星段），检查 `noiseRms` 与 `isVoiced`，不要放宽断言。

- [ ] **Step 5: 写回主 spec**

在主 spec §9.2 末尾追加：

```
**状态（P-4a）**：稳定段参数为 YIN 阈值 0.15、能量 ≥ 2 × 噪声基线、段内偏差 ≤ 30 音分且占比 ≥ 80%、至少 150 ms、间隙 60 ms 或偏离段中位数 > 80 音分即分段（`src/pitch/segments.ts`）。多目标音按顺序逐个比对、全对才算对（`src/pitch/judge.ts`）。唱题生成后整体按整八度搬进学习者音域（`src/pitch/range.ts`），生成器不变。
```

- [ ] **Step 6: 完成检查**

```bash
npx vitest run
npx tsc --noEmit
npx vite build
grep -rn "window\.\|document\.\|navigator\.\|AudioContext\|Date.now\|Math.random" src/pitch --include=*.ts | grep -v "\.test\.ts" || echo "OK: src/pitch 零 IO"
grep -rn "^import {[^}]*} from '../exercises" src/pitch --include=*.ts | grep -v "\.test\.ts" || echo "OK: pitch 对 exercises 只有类型导入"
```

Expected: 全部 PASS；构建成功；两条 grep 输出 OK。

- [ ] **Step 7: 提交**

```bash
git add src/pitch/rangeTest.ts src/pitch/rangeTest.test.ts src/pitch/pipeline.test.ts docs/superpowers/specs/2026-08-24-ear-training-design.md
git commit -m "feat(pitch): 音域测定取值、端到端管线测试；写回主 spec §9" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 完成标准

1. `npx vitest run` 全绿；`npx tsc --noEmit` 无输出；`npx vite build` 成功
2. YIN 在 80–1000 Hz 的正弦与富泛音音上误差 ≤ ±5 音分；噪声与静音判无声
3. 稳定段、逐音判定、八度折叠、搬入音域、音域测定都有单测；端到端管线测试通过
4. `src/pitch/` 零 IO；对 `exercises` 只有类型导入
5. 主 spec §9 已写回

## 下一步

P-4b：AudioWorklet 收音、噪声基线、唱题控件（自动收音、逐音反馈）、音域测定页、判定方式设置与回落；随 P-3b 一起做真机验收。
