# P-5a 实战关片段与判定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出实战关的全部纯逻辑：鼓音色、按阶段素材生成多轨短曲与答案、渲染成可播放计划与乐句窗口、分部分判定；并把仿真的实战关从能力阈值换成「真实关卡可答性」。

**Architecture:** 新目录 `src/boss/` 全部是纯函数（零 IO）：`material.ts` 由课程推导各阶段可用素材，`generate.ts` 用 `makeRng(seed)` 生成 `BossChallenge`（片段 + 乐句 + 答案 + 字母表），`render.ts` 把片段排成 `PlaybackPlan`，`grade.ts` 逐部分判定，`answerability.ts` 让虚拟学习者逐位作答。音频层增加三种鼓（`PlaybackEvent.drum`），走独立的合成路径，不进音色变异轴。

**Tech Stack:** TypeScript、vitest。无新依赖。

**Spec:** `docs/superpowers/specs/2026-10-13-p5-boss-design.md`（P-5 spec）§3、§5 的 P-5a 测试、§6 第一行；主 spec `docs/superpowers/specs/2026-08-24-ear-training-design.md` §8.2–§8.4、§13.1；FWD-3（`voiceChord`）、FWD-4（音区 MIDI 36–96）。

## Global Constraints

- `src/boss/` 零 IO：不得出现 `Math.random`、`Date.now`、`window.`、`document.`；随机只来自 `makeRng(seed)`（`src/music/rng.ts`）。
- 通过标准：每个部分 ≥ `BOSS_PASS_RATIO = 0.9`（P-5 spec D2）。
- 乐句：每句 2 小节（`PHRASE_BARS = 2`）。
- 各阶段片段（P-5 spec §3.3）：P1 8 小节、五声（do re mi sol la）、拍号 2/4、3/4、4/4 之一，作答旋律 + 拍号；P2 16 小节大调旋律，作答旋律；P3 8 小节 4 和弦循环 + 旋律，作答和弦 + 旋律；P4 8 小节，作答和弦 + 旋律 + 每小节节奏型；P5 8 小节转调（前 4 小节原调、后 4 小节新调，新调为原调的属调或下属调），作答和弦 + 旋律 + 新调主音在原调中的音级。
- 素材只来自该阶段（含之前阶段）已解锁的知识点。
- 音区：所有声部在 MIDI 36–96 内（FWD-4）。和弦用 `voiceChord`（FWD-3）。
- 鼓不进音色变异轴：`TimbreId` 不变，鼓用 `PlaybackEvent.drum?: DrumId`。
- 仿真：去掉 `BOSS_ABILITY_THRESHOLD`；掌握度达标（阻塞项为 0）后每天最多 3 次真实关卡尝试。若仿真节奏断言（`runSimulation.test.ts` 的阶段推进断言）失败，或普通学习者 P1 完成天数超出 28–42 天、P2 完成天数超出 P1 之后 42–56 天，**停下报告实测数据，交用户裁定，不调参数**。
- 测试命令：`npx vitest run <path>`；全量 `npx vitest run`；类型 `npx tsc --noEmit`；构建 `npx vite build`。
- 每个任务结束提交一次，提交信息以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾；不要提交 `.superpowers/` 下的任何文件，不要 `git add -f`。

## File Structure

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/music/playback.ts`（改） | `DrumId`、`PlaybackEvent.drum` | 1 |
| `src/audio/drums.ts`、`AudioEngine.ts`、`voices.ts`（改） | 鼓合成 | 1 |
| `src/boss/types.ts` | 类型与常量 | 2 |
| `src/boss/material.ts` | 各阶段素材 | 2 |
| `src/boss/generate.ts` | 五个阶段的关卡生成 | 3 |
| `src/boss/render.ts` | 片段 → 播放计划、乐句窗口、单句计划 | 4 |
| `src/boss/grade.ts` | 分部分判定 | 5 |
| `src/boss/answerability.ts`、`src/simulation/runSimulation.ts`（改） | 仿真可答性 | 6 |

---

### Task 1: 鼓——事件字段与合成路径

**Files:**
- Modify: `src/music/playback.ts`、`src/audio/voices.ts`、`src/audio/AudioEngine.ts`
- Create: `src/audio/drums.ts`
- Test: `src/audio/drums.test.ts`

**Interfaces:**
- Produces:
  - `src/music/playback.ts`：`export type DrumId = 'kick' | 'snare' | 'hat'`；`PlaybackEvent` 增加可选 `drum?: DrumId`（有它时 `freqHz` 与 `timbreId` 被忽略）
  - `src/audio/drums.ts`：`export interface DrumDef { kind: 'tone' | 'noise'; startHz?: number; endHz?: number; dropSec?: number; filter?: { type: BiquadFilterType; hz: number }; decaySec: number; peak: number }`；`export const DRUMS: Record<DrumId, DrumDef>`（`kick`: tone 150→50 Hz、dropSec 0.08、decaySec 0.3、peak 0.9；`snare`: noise、bandpass 1800 Hz、decaySec 0.15、peak 0.5；`hat`: noise、highpass 7000 Hz、decaySec 0.05、peak 0.3）
  - `planToVoices` 忽略 `drum` 事件；`AudioEngine.play` 对 `drum` 事件走 `spawnDrum`，`endSec` 计入鼓事件的 `atSec + DRUMS[drum].decaySec`

- [ ] **Step 1: 写失败的测试**

`src/audio/drums.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import type { PlaybackPlan } from '../music/playback'
import { AudioEngine } from './AudioEngine'
import { DRUMS } from './drums'
import { planToVoices } from './voices'

function fakeCtx() {
  const created = { osc: [] as any[], gain: [] as any[], src: [] as any[], filter: [] as any[], buffers: 0 }
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() })
  const node = () => ({ connect: vi.fn(function (this: unknown, n: unknown) { return n }), disconnect: vi.fn() })
  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    state: 'running',
    destination: {},
    createOscillator: vi.fn(() => { const o = { ...node(), type: 'sine', frequency: param(), start: vi.fn(), stop: vi.fn(), onended: null }; created.osc.push(o); return o }),
    createGain: vi.fn(() => { const g = { ...node(), gain: param() }; created.gain.push(g); return g }),
    createBufferSource: vi.fn(() => { const s = { ...node(), buffer: null, start: vi.fn(), stop: vi.fn(), onended: null }; created.src.push(s); return s }),
    createBiquadFilter: vi.fn(() => { const f = { ...node(), type: 'lowpass', frequency: param() }; created.filter.push(f); return f }),
    createBuffer: vi.fn((_ch: number, len: number) => { created.buffers++; const data = new Float32Array(len); return { getChannelData: () => data } }),
  }
  return { ctx, created }
}

const plan = (events: PlaybackPlan['events']): PlaybackPlan => ({ events, totalDurSec: 1 })
const drumEv = (drum: 'kick' | 'snare' | 'hat', atSec: number) => ({ atSec, freqHz: 0, durSec: 0.1, timbreId: 'piano' as const, gain: 1, drum })

describe('鼓（P-5 spec §3.2）', () => {
  it('planToVoices 不把鼓当作有音高的声部', () => {
    expect(planToVoices(plan([drumEv('kick', 0)]), 0)).toEqual([])
  })

  it('底鼓：正弦，音高从 150 下滑到 50 Hz', () => {
    const { ctx, created } = fakeCtx()
    new AudioEngine(ctx as unknown as AudioContext).play(plan([drumEv('kick', 0.5)]), 0)
    expect(created.osc).toHaveLength(1)
    const f = created.osc[0].frequency
    expect(f.setValueAtTime).toHaveBeenCalledWith(150, 0.5)
    expect(f.exponentialRampToValueAtTime).toHaveBeenCalledWith(50, 0.5 + DRUMS.kick.dropSec!)
    expect(created.osc[0].stop).toHaveBeenCalledWith(0.5 + DRUMS.kick.decaySec)
  })

  it('军鼓与踩镲：噪声源 → 滤波 → 包络；噪声缓冲只创建一次', () => {
    const { ctx, created } = fakeCtx()
    const engine = new AudioEngine(ctx as unknown as AudioContext)
    engine.play(plan([drumEv('snare', 0), drumEv('hat', 0.25), drumEv('hat', 0.5)]), 0)
    expect(created.src).toHaveLength(3)
    expect(created.buffers).toBe(1)
    expect(created.filter.map((f) => f.type)).toEqual(['bandpass', 'highpass', 'highpass'])
    expect(created.filter[1].frequency.setValueAtTime).toHaveBeenCalledWith(7000, 0.25)
  })

  it('endSec 计入鼓的衰减', () => {
    const { ctx } = fakeCtx()
    const r = new AudioEngine(ctx as unknown as AudioContext).play(plan([drumEv('kick', 1)]), 0)
    expect(r.endSec).toBeCloseTo(1 + DRUMS.kick.decaySec)
  })

  it('stopAll 也停掉鼓', () => {
    const { ctx, created } = fakeCtx()
    const engine = new AudioEngine(ctx as unknown as AudioContext)
    engine.play(plan([drumEv('snare', 0)]), 0)
    engine.stopAll()
    expect(created.src[0].disconnect).toHaveBeenCalled()
    expect(engine.activeCount).toBe(0)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/audio/drums.test.ts`
Expected: FAIL —— `./drums` 不存在；`drum` 字段未定义

- [ ] **Step 3: 写实现**

`src/music/playback.ts`：在 `TimbreId` 之后加

```ts
/** 鼓（P-5）：不进音色变异轴；有 drum 的事件忽略 freqHz 与 timbreId */
export type DrumId = 'kick' | 'snare' | 'hat'
```

`PlaybackEvent` 增加：

```ts
  /** 鼓事件（P-5）；有它时 freqHz 与 timbreId 无意义 */
  drum?: DrumId
```

`src/audio/drums.ts`：

```ts
import type { DrumId } from '../music/playback'

export interface DrumDef {
  kind: 'tone' | 'noise'
  startHz?: number
  endHz?: number
  dropSec?: number
  filter?: { type: BiquadFilterType; hz: number }
  decaySec: number
  peak: number
}

/** 简易鼓（P-5 spec §3.2）：底鼓是下滑正弦，军鼓与踩镲是滤波噪声 */
export const DRUMS: Record<DrumId, DrumDef> = {
  kick: { kind: 'tone', startHz: 150, endHz: 50, dropSec: 0.08, decaySec: 0.3, peak: 0.9 },
  snare: { kind: 'noise', filter: { type: 'bandpass', hz: 1800 }, decaySec: 0.15, peak: 0.5 },
  hat: { kind: 'noise', filter: { type: 'highpass', hz: 7000 }, decaySec: 0.05, peak: 0.3 },
}
```

`src/audio/voices.ts` 的 `planToVoices` 第一行改为过滤鼓：

```ts
  return plan.events.filter((e) => e.drum === undefined).map((e) => {
```

`src/audio/AudioEngine.ts`：
- `import { DRUMS } from './drums'`；`import type { DrumId, PlaybackPlan, PlayOptions } from '../music/playback'`
- 类里加：

```ts
  private noise: AudioBuffer | null = null

  /** 1 秒白噪声，确定性（LCG），全引擎共享 */
  private noiseBuffer(): AudioBuffer {
    if (this.noise) return this.noise
    const sr = this.ctx.sampleRate || 48000
    const buf = this.ctx.createBuffer(1, sr, sr)
    const data = buf.getChannelData(0)
    let s = 12345
    for (let i = 0; i < data.length; i++) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0
      data[i] = (s / 0xffffffff) * 2 - 1
    }
    this.noise = buf
    return buf
  }

  private spawnDrum(drum: DrumId, atSec: number, gain: number): void {
    const def = DRUMS[drum]
    const end = atSec + def.decaySec
    const amp = this.ctx.createGain()
    amp.connect(this.ctx.destination)
    amp.gain.setValueAtTime(def.peak * gain * MASTER_GAIN, atSec)
    amp.gain.linearRampToValueAtTime(0, end)
    const nodes: { disconnect(): void }[] = [amp]
    let source: AudioScheduledSourceNode
    if (def.kind === 'tone') {
      const osc = this.ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(def.startHz!, atSec)
      osc.frequency.exponentialRampToValueAtTime(def.endHz!, atSec + def.dropSec!)
      osc.connect(amp)
      source = osc
    } else {
      const src = this.ctx.createBufferSource()
      src.buffer = this.noiseBuffer()
      const filter = this.ctx.createBiquadFilter()
      filter.type = def.filter!.type
      filter.frequency.setValueAtTime(def.filter!.hz, atSec)
      src.connect(filter)
      filter.connect(amp)
      nodes.push(filter)
      source = src
    }
    nodes.push(source)
    this.active.push(...nodes)
    source.onended = () => this.release(nodes)
    source.start(atSec)
    source.stop(end)
  }
```

- `play` 里，在生成 voices 之后、返回之前：

```ts
    let endSec = voices.reduce((max, v) => Math.max(max, v.stopSec), startSec)
    for (const e of plan.events) {
      if (!e.drum) continue
      const at = startSec + e.atSec
      this.spawnDrum(e.drum, at, e.gain)
      endSec = Math.max(endSec, at + DRUMS[e.drum].decaySec)
    }
    return { startSec, endSec }
```

（把原来的 `return { startSec, endSec: voices.reduce(...) }` 替换掉。）

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/audio && npx tsc --noEmit`
Expected: PASS（既有音频测试不受影响）

- [ ] **Step 5: 提交**

```bash
git add src/music/playback.ts src/audio/
git commit -m "feat(audio): 简易鼓——底鼓、军鼓、踩镲（独立于音色变异轴）" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 关卡类型与各阶段素材

**Files:**
- Create: `src/boss/types.ts`、`src/boss/material.ts`
- Test: `src/boss/material.test.ts`

**Interfaces:**
- Consumes: `unlockedKnowledgePoints`、`Curriculum`（curriculum）；`MAJOR_SCALE_DEGREES`、`ScaleDegree`、`Key`（music/key）；`CHORD_ENTRIES`（exercises/data/chords）；`PATTERNS`、`MeterId`（exercises/data/rhythms）；`PhaseId`
- Produces（`types.ts`）：
  - 常量 `BOSS_PASS_RATIO = 0.9`、`PHRASE_BARS = 2`、`BOSS_ATTEMPTS_PER_DAY = 3`
  - `export type PartId = 'melody' | 'chords' | 'rhythm' | 'meter' | 'newTonic'`
  - `export interface MelodyNote { degree: ScaleDegree; keyIndex: 0 | 1; atBeat: number; durBeats: number }`（`atBeat` 为从片段第一小节起的四分音符拍数）
  - `export interface Piece { phaseId: PhaseId; seed: number; keys: Key[]; modulationBar: number | null; bpm: number; meterId: MeterId; bars: number; melody: MelodyNote[]; chords: string[] | null; rhythm: string[] | null; drums: boolean }`（`chords` 每小节一个本地级数 id；`rhythm` 每小节一个音型 id，只有 4/4 且用音型库时不为 null）
  - `export interface Phrase { index: number; startBar: number; endBar: number; melodyCount: number }`（`endBar` 不含）
  - `export interface BossAnswer { melody: string[][]; chords?: string[]; rhythm?: string[]; meter?: string; newTonic?: string }`；`export type BossResponse = BossAnswer`
  - `export interface BossChallenge { piece: Piece; parts: PartId[]; phrases: Phrase[]; answer: BossAnswer; alphabets: { melody: string[]; chords?: string[]; rhythm?: string[]; meter?: string[]; newTonic?: string[] } }`
- Produces（`material.ts`）：
  - `export interface BossMaterial { melodyDegrees: ScaleDegree[]; meters: MeterId[]; progressions: string[][]; chordIds: string[]; patternIds: string[] }`
  - `export function bossMaterial(c: Curriculum, phaseId: PhaseId): BossMaterial`：
    - `melodyDegrees`：已解锁的 `degree:major:X` 中 X ∈ 大调七个音级，按 `MAJOR_SCALE_DEGREES` 顺序
    - `meters`：`'4/4'` 加上已解锁的 `rhythm:meter-2-4` → `'2/4'`、`rhythm:meter-3-4` → `'3/4'`（排序 `['2/4','3/4','4/4']` 内的子集）
    - `progressions`：已解锁的大调进行（`family === 'progression' && mode === 'major'`）的 `chordIds`
    - `chordIds`：已解锁的大调功能和弦（`family === 'functional' && mode === 'major'`）的 `answerId`
    - `patternIds`：1 小节、`targetable !== false`、`ownerKpId` 已解锁的音型 id

- [ ] **Step 1: 写失败的测试**

`src/boss/material.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { bossMaterial } from './material'

const c = buildCurriculum()

describe('bossMaterial（P-5 spec §3.3：素材由课程静态推导）', () => {
  it('P1：五声音级；拍号 2/4、3/4、4/4；无和弦与进行', () => {
    const m = bossMaterial(c, 'P1')
    expect(m.melodyDegrees).toEqual(['do', 're', 'mi', 'sol', 'la'])
    expect(m.meters).toEqual(['2/4', '3/4', '4/4'])
    expect(m.progressions).toEqual([])
  })
  it('P2：大调七个音级', () => {
    expect(bossMaterial(c, 'P2').melodyDegrees).toEqual(['do', 're', 'mi', 'fa', 'sol', 'la', 'ti'])
  })
  it('P3：有大调进行与功能和弦', () => {
    const m = bossMaterial(c, 'P3')
    expect(m.progressions.length).toBeGreaterThan(0)
    for (const p of m.progressions) for (const id of p) expect(m.chordIds).toContain(id)
  })
  it('P5：含借用和弦与副属和弦', () => {
    const m = bossMaterial(c, 'P5')
    for (const id of ['V/V', 'bVI', 'bVII']) expect(m.chordIds).toContain(id)
  })
  it('音型只来自已解锁知识点，且都是 1 小节', () => {
    const p1 = bossMaterial(c, 'P1').patternIds
    const p5 = bossMaterial(c, 'P5').patternIds
    expect(p1.length).toBeGreaterThan(0)
    expect(p5.length).toBeGreaterThan(p1.length)
    expect(p5).not.toContain('q-q-q-e~q-q-q')
  })
  it('后一阶段的素材包含前一阶段', () => {
    const phases = ['P1', 'P2', 'P3', 'P4', 'P5'] as const
    for (let i = 1; i < phases.length; i++) {
      const a = bossMaterial(c, phases[i - 1])
      const b = bossMaterial(c, phases[i])
      for (const d of a.melodyDegrees) expect(b.melodyDegrees).toContain(d)
      for (const id of a.chordIds) expect(b.chordIds).toContain(id)
    }
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/boss`
Expected: FAIL —— 无法解析模块

- [ ] **Step 3: 写实现**

`src/boss/types.ts`：

```ts
import type { PhaseId } from '../curriculum/stages'
import type { MeterId } from '../exercises/data/rhythms'
import type { Key, ScaleDegree } from '../music/key'

/** 每个部分都 ≥ 此比例才算通过（P-5 spec D2） */
export const BOSS_PASS_RATIO = 0.9
/** 每句小节数（P-5 spec D3） */
export const PHRASE_BARS = 2
/** 每天最多尝试次数（P-5 spec D2） */
export const BOSS_ATTEMPTS_PER_DAY = 3

export type PartId = 'melody' | 'chords' | 'rhythm' | 'meter' | 'newTonic'

export interface MelodyNote {
  degree: ScaleDegree
  /** 所在调：0 = 原调，1 = 转调后（仅 P5） */
  keyIndex: 0 | 1
  /** 从第一小节起的四分音符拍数 */
  atBeat: number
  durBeats: number
}

export interface Piece {
  phaseId: PhaseId
  seed: number
  /** keys[0] 原调；P5 有 keys[1] 新调 */
  keys: Key[]
  /** 新调开始的小节（0 起）；无转调为 null */
  modulationBar: number | null
  bpm: number
  meterId: MeterId
  bars: number
  melody: MelodyNote[]
  /** 每小节一个和弦（所在调的级数 id）；无和声为 null */
  chords: string[] | null
  /** 每小节一个音型 id（仅 4/4 用音型库时）；否则 null */
  rhythm: string[] | null
  drums: boolean
}

export interface Phrase {
  index: number
  startBar: number
  /** 不含 */
  endBar: number
  melodyCount: number
}

export interface BossAnswer {
  /** 按乐句分组的旋律音级 id */
  melody: string[][]
  chords?: string[]
  rhythm?: string[]
  meter?: string
  newTonic?: string
}

export type BossResponse = BossAnswer

export interface BossChallenge {
  piece: Piece
  parts: PartId[]
  phrases: Phrase[]
  answer: BossAnswer
  alphabets: { melody: string[]; chords?: string[]; rhythm?: string[]; meter?: string[]; newTonic?: string[] }
}
```

`src/boss/material.ts`：

```ts
import { unlockedKnowledgePoints, type Curriculum } from '../curriculum/curriculum'
import type { PhaseId } from '../curriculum/stages'
import { CHORD_ENTRIES } from '../exercises/data/chords'
import { PATTERNS, type MeterId } from '../exercises/data/rhythms'
import { MAJOR_SCALE_DEGREES, type ScaleDegree } from '../music/key'

export interface BossMaterial {
  melodyDegrees: ScaleDegree[]
  meters: MeterId[]
  progressions: string[][]
  chordIds: string[]
  patternIds: string[]
}

const METER_KP: Partial<Record<MeterId, string>> = {
  '2/4': 'rhythm:meter-2-4',
  '3/4': 'rhythm:meter-3-4',
}

/** 该阶段（含之前阶段）已解锁的素材（P-5 spec §3.3） */
export function bossMaterial(c: Curriculum, phaseId: PhaseId): BossMaterial {
  const unlocked = new Set(unlockedKnowledgePoints(c, phaseId))
  const melodyDegrees = MAJOR_SCALE_DEGREES.filter((d) => unlocked.has(`degree:major:${d}`))
  const meters = (['2/4', '3/4', '4/4'] as MeterId[]).filter((m) => m === '4/4' || unlocked.has(METER_KP[m] ?? ''))
  const progressions: string[][] = []
  const chordIds: string[] = []
  for (const e of CHORD_ENTRIES) {
    if (!unlocked.has(e.kpId) || e.mode !== 'major') continue
    if (e.family === 'progression') progressions.push([...e.chordIds])
    if (e.family === 'functional') chordIds.push(e.answerId)
  }
  const patternIds = PATTERNS.filter((p) => p.bars === 1 && p.targetable !== false && unlocked.has(p.ownerKpId)).map((p) => p.id)
  return { melodyDegrees: [...melodyDegrees], meters, progressions, chordIds, patternIds }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/boss && npx tsc --noEmit`
Expected: PASS。若 P3 的进行里含有未解锁的和弦 id（课程数据问题），报告而不是放宽测试。

- [ ] **Step 5: 提交**

```bash
git add src/boss/
git commit -m "feat(boss): 关卡类型与各阶段素材" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 五个阶段的关卡生成

**Files:**
- Create: `src/boss/generate.ts`
- Test: `src/boss/generate.test.ts`

**Interfaces:**
- Consumes: Task 2 的全部；`makeRng`；`functionalChord`（exercises/data/chords）；`QUALITY_INTERVALS`（music/chord）；`DEGREE_SEMITONES`、`SCALE_DEGREES`
- Produces:
  - `export const BOSS_BARS: Record<PhaseId, number>`（P1 8、P2 16、P3 8、P4 8、P5 8）
  - `export const BOSS_PARTS: Record<PhaseId, PartId[]>`（P1 `['melody','meter']`、P2 `['melody']`、P3 `['chords','melody']`、P4 `['chords','melody','rhythm']`、P5 `['chords','melody','newTonic']`）
  - `export const STABLE_DEGREES: ScaleDegree[] = ['do', 'mi', 'sol']`
  - `export function chordTones(chordId: string): ScaleDegree[]`（大调本地级数 id → 和弦音音级；用 `functionalChord('major', id)` 与 `QUALITY_INTERVALS`）
  - `export function generateBoss(c: Curriculum, phaseId: PhaseId, seed: number): BossChallenge`

生成规则：
- 原调：`{ tonic: rng.int(12), mode: 'major' }`；bpm：P1 80，其余 90。
- 拍号：P1 从 `material.meters` 随机；其余 `'4/4'`。
- 和弦（每小节一个）：P1/P2 为 null；P3 取一条 `progressions` 循环到 8 小节；P4 按下面的转移表随机游走，第 1 小节 `I`、倒数第 2 小节 `V`（有 `V7` 时 50% 用 `V7`）、最后一小节 `I`，只用 `chordIds` 里的：`I→[IV,V,vi,ii,Imaj7]`、`Imaj7→[IV,vi]`、`ii→[V,V7]`、`ii7→[V,V7]`、`IV→[V,I,ii]`、`V→[I,vi]`、`V7→[I,vi]`、`vi→[IV,ii]`、`vi7→[IV,ii]`（若转移目标全被过滤掉，退回 `I`）；P5 前 4 小节原调 `['I', X, Y, 'V']`（X、Y 从 `['IV','vi','ii','bVI','bVII','V/V']` ∩ `chordIds` 随机，`V/V` 只放在 Y），后 4 小节新调 `['I', Z, 'V', 'I']`（Z 从 `['IV','vi','ii']` ∩ `chordIds`）。
- P5 新调：50% 属调（原调主音 +7，`newTonic` 答案 `'sol'`）、50% 下属调（+5，答案 `'fa'`）；`modulationBar = 4`；`newTonic` 字母表 `['re','fa','sol','la']`。
- 每小节节奏：4/4 且 `phaseId ≠ 'P1'` 时从 `patternIds` 随机一个音型（`piece.rhythm` 记录 id）；否则每拍随机 `q`（1 个四分）或 `ee`（2 个八分），`piece.rhythm = null`。P1、P2、P3、P5 的最后一小节改为一个全小节长音（P4 不改，因为节奏型要作答）。
- 旋律音级：在 `melodyDegrees` 上做「音阶步」随机游走（步长从 `[-2,-1,-1,0,1,1,2]` 抽，10% 概率改为 ±3），步号限制在 `[-n, 2n)`（n 为音级数）；每小节第一个音若有和弦，就取离当前步最近、音级属于该和弦音的步；每句最后一个音取离当前步最近的稳定音级（`STABLE_DEGREES` ∩ `melodyDegrees`）；全曲最后一个音取最近的 `do`。P5 的音级按所在调计（`keyIndex`）。
- 乐句：每 `PHRASE_BARS` 小节一句；`melodyCount` 为该句旋律音数。
- 答案：`melody` 按句分组的音级 id；`chords` 为 `piece.chords`；`rhythm` 为 `piece.rhythm`（只在 P4 作答）；`meter` 为 P1 的拍号；`newTonic` 为 P5 的答案。
- 字母表：`melody` = `melodyDegrees`；`chords` = `chordIds`；`rhythm` = `patternIds`；`meter` = `meters`；`newTonic` 如上。

- [ ] **Step 1: 写失败的测试**

`src/boss/generate.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import type { PhaseId } from '../curriculum/stages'
import { BOSS_BARS, BOSS_PARTS, STABLE_DEGREES, chordTones, generateBoss } from './generate'
import { bossMaterial } from './material'
import { PHRASE_BARS } from './types'

const c = buildCurriculum()
const PHASES: PhaseId[] = ['P1', 'P2', 'P3', 'P4', 'P5']

describe('generateBoss：结构', () => {
  for (const phaseId of PHASES) {
    it(`${phaseId}：小节数、作答部分、乐句切分、答案与片段一致`, () => {
      for (let seed = 0; seed < 20; seed++) {
        const ch = generateBoss(c, phaseId, seed)
        const p = ch.piece
        expect(p.bars).toBe(BOSS_BARS[phaseId])
        expect(ch.parts).toEqual(BOSS_PARTS[phaseId])
        expect(ch.phrases).toHaveLength(p.bars / PHRASE_BARS)
        expect(ch.phrases.map((ph) => ph.melodyCount)).toEqual(ch.answer.melody.map((m) => m.length))
        expect(ch.answer.melody.flat()).toEqual(p.melody.map((n) => n.degree))
        if (p.chords) expect(p.chords).toHaveLength(p.bars)
        if (ch.parts.includes('rhythm')) expect(ch.answer.rhythm).toHaveLength(p.bars)
      }
    })
  }
})

describe('generateBoss：素材约束（只用已解锁的）', () => {
  for (const phaseId of PHASES) {
    it(`${phaseId}`, () => {
      const m = bossMaterial(c, phaseId)
      for (let seed = 0; seed < 30; seed++) {
        const ch = generateBoss(c, phaseId, seed)
        for (const n of ch.piece.melody) expect(m.melodyDegrees).toContain(n.degree)
        for (const id of ch.piece.chords ?? []) expect(m.chordIds).toContain(id)
        for (const id of ch.piece.rhythm ?? []) expect(m.patternIds).toContain(id)
        expect(m.meters).toContain(ch.piece.meterId)
      }
    })
  }
})

describe('generateBoss：音乐性约束', () => {
  it('每句末音是稳定音级；全曲末音是 do', () => {
    for (const phaseId of PHASES) {
      for (let seed = 0; seed < 20; seed++) {
        const ch = generateBoss(c, phaseId, seed)
        for (const ph of ch.answer.melody) expect(STABLE_DEGREES).toContain(ph.at(-1))
        expect(ch.answer.melody.at(-1)!.at(-1)).toBe('do')
      }
    }
  })
  it('有和弦时每小节第一个音是和弦音（若该和弦音在可用音级内）', () => {
    for (const phaseId of ['P3', 'P4'] as const) {
      const ch = generateBoss(c, phaseId, 7)
      const barBeats = 4
      for (let bar = 0; bar < ch.piece.bars; bar++) {
        const first = ch.piece.melody.find((n) => n.atBeat >= bar * barBeats && n.atBeat < (bar + 1) * barBeats)!
        const tones = chordTones(ch.piece.chords![bar]).filter((d) => bossMaterial(c, phaseId).melodyDegrees.includes(d))
        const isPhraseEnd = (bar + 1) % 2 === 0 && first === ch.piece.melody.filter((n) => n.atBeat < (bar + 1) * barBeats).at(-1)
        if (tones.length > 0 && !isPhraseEnd) expect(tones).toContain(first.degree)
      }
    }
  })
  it('P4：倒数第二小节是 V 或 V7，最后一小节是 I', () => {
    for (let seed = 0; seed < 20; seed++) {
      const ch = generateBoss(c, 'P4', seed).piece.chords!
      expect(['V', 'V7']).toContain(ch.at(-2))
      expect(ch.at(-1)).toBe('I')
    }
  })
  it('P5：第 5 小节转调；新调是属调或下属调，答案一致', () => {
    for (let seed = 0; seed < 20; seed++) {
      const ch = generateBoss(c, 'P5', seed)
      const [k0, k1] = ch.piece.keys
      const up = (k1.tonic - k0.tonic + 12) % 12
      expect(ch.piece.modulationBar).toBe(4)
      expect([5, 7]).toContain(up)
      expect(ch.answer.newTonic).toBe(up === 7 ? 'sol' : 'fa')
      expect(ch.alphabets.newTonic).toEqual(['re', 'fa', 'sol', 'la'])
    }
  })
  it('chordTones', () => {
    expect(chordTones('I')).toEqual(['do', 'mi', 'sol'])
    expect(chordTones('V7')).toEqual(['sol', 'ti', 're', 'fa'])
    expect(chordTones('bVII')).toEqual(['te', 're', 'fa'])
  })
})

describe('generateBoss：确定性与快照', () => {
  it('同一 seed 同一关卡', () => {
    expect(generateBoss(c, 'P3', 42)).toEqual(generateBoss(c, 'P3', 42))
  })
  for (const phaseId of PHASES) {
    it(`${phaseId} seed 1 快照`, () => {
      expect(generateBoss(c, phaseId, 1)).toMatchSnapshot()
    })
  }
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/boss/generate.test.ts`
Expected: FAIL —— 无法解析模块

- [ ] **Step 3: 写实现**

`src/boss/generate.ts`：

```ts
import type { Curriculum } from '../curriculum/curriculum'
import type { PhaseId } from '../curriculum/stages'
import { functionalChord } from '../exercises/data/chords'
import { METERS, patternById, type MeterId } from '../exercises/data/rhythms'
import { QUALITY_INTERVALS } from '../music/chord'
import { DEGREE_SEMITONES, SCALE_DEGREES, type Key, type ScaleDegree } from '../music/key'
import { makeRng, type Rng } from '../music/rng'
import { bossMaterial } from './material'
import { PHRASE_BARS, type BossChallenge, type MelodyNote, type PartId, type Phrase, type Piece } from './types'

export const BOSS_BARS: Record<PhaseId, number> = { P1: 8, P2: 16, P3: 8, P4: 8, P5: 8 }
export const BOSS_PARTS: Record<PhaseId, PartId[]> = {
  P1: ['melody', 'meter'],
  P2: ['melody'],
  P3: ['chords', 'melody'],
  P4: ['chords', 'melody', 'rhythm'],
  P5: ['chords', 'melody', 'newTonic'],
}
export const STABLE_DEGREES: ScaleDegree[] = ['do', 'mi', 'sol']

const NEW_TONIC_ALPHABET = ['re', 'fa', 'sol', 'la']
const P4_NEXT: Record<string, string[]> = {
  I: ['IV', 'V', 'vi', 'ii', 'Imaj7'],
  Imaj7: ['IV', 'vi'],
  ii: ['V', 'V7'],
  ii7: ['V', 'V7'],
  IV: ['V', 'I', 'ii'],
  V: ['I', 'vi'],
  V7: ['I', 'vi'],
  vi: ['IV', 'ii'],
  vi7: ['IV', 'ii'],
}

const degreeOfSemitone = (st: number): ScaleDegree =>
  SCALE_DEGREES.find((d) => DEGREE_SEMITONES[d] === ((st % 12) + 12) % 12)!

/** 大调本地级数 id 的和弦音（以 do 为参照的音级） */
export function chordTones(chordId: string): ScaleDegree[] {
  const ch = functionalChord('major', chordId)
  const root = DEGREE_SEMITONES[ch.rootDegree]
  return QUALITY_INTERVALS[ch.quality].map((i) => degreeOfSemitone(root + i))
}

function pickFrom<T>(rng: Rng, items: readonly T[], fallback: T): T {
  return items.length > 0 ? rng.pick(items) : fallback
}

function makeChords(phaseId: PhaseId, rng: Rng, chordIds: string[], progressions: string[][], bars: number): string[] | null {
  const has = (id: string) => chordIds.includes(id)
  if (phaseId === 'P1' || phaseId === 'P2') return null
  if (phaseId === 'P3') {
    const prog = pickFrom(rng, progressions, ['I', 'IV', 'V', 'I'])
    return Array.from({ length: bars }, (_, i) => prog[i % prog.length])
  }
  if (phaseId === 'P4') {
    const out = ['I']
    for (let i = 1; i < bars - 2; i++) {
      const options = (P4_NEXT[out[i - 1]] ?? ['I']).filter(has)
      out.push(pickFrom(rng, options, 'I'))
    }
    out.push(has('V7') && rng.next() < 0.5 ? 'V7' : 'V')
    out.push('I')
    return out
  }
  // P5：前 4 小节原调，后 4 小节新调
  const color = ['IV', 'vi', 'ii', 'bVI', 'bVII'].filter(has)
  const x = pickFrom(rng, color, 'IV')
  const y = pickFrom(rng, [...color, ...(has('V/V') ? ['V/V'] : [])], 'IV')
  const z = pickFrom(rng, ['IV', 'vi', 'ii'].filter(has), 'IV')
  return ['I', x, y, 'V', 'I', z, 'V', 'I']
}

interface BarRhythm {
  notes: { onset: number; dur: number }[]
  patternId: string | null
}

function barRhythm(rng: Rng, beatsPerBar: number, usePatterns: boolean, patternIds: string[], wholeBar: boolean): BarRhythm {
  if (wholeBar) return { notes: [{ onset: 0, dur: beatsPerBar }], patternId: null }
  if (usePatterns && patternIds.length > 0) {
    const id = rng.pick(patternIds)
    return { notes: patternById(id).notes.map((n) => ({ onset: n.onset, dur: n.dur })), patternId: id }
  }
  const notes: { onset: number; dur: number }[] = []
  for (let b = 0; b < beatsPerBar; b++) {
    if (rng.next() < 0.35) notes.push({ onset: b, dur: 0.5 }, { onset: b + 0.5, dur: 0.5 })
    else notes.push({ onset: b, dur: 1 })
  }
  return { notes, patternId: null }
}

export function generateBoss(c: Curriculum, phaseId: PhaseId, seed: number): BossChallenge {
  const rng = makeRng(seed)
  const m = bossMaterial(c, phaseId)
  const bars = BOSS_BARS[phaseId]
  const meterId: MeterId = phaseId === 'P1' ? rng.pick(m.meters) : '4/4'
  const beatsPerBar = METERS[meterId].beatsPerBar
  const tonic = rng.int(12)
  const keys: Key[] = [{ tonic, mode: 'major' }]
  let modulationBar: number | null = null
  let newTonic: string | undefined
  if (phaseId === 'P5') {
    const up = rng.next() < 0.5 ? 7 : 5
    keys.push({ tonic: (tonic + up) % 12, mode: 'major' })
    modulationBar = 4
    newTonic = up === 7 ? 'sol' : 'fa'
  }
  const chords = makeChords(phaseId, rng, m.chordIds, m.progressions, bars)

  const usePatterns = meterId === '4/4' && phaseId !== 'P1'
  const rhythmIds: string[] = []
  const degrees = m.melodyDegrees
  const n = degrees.length
  const stable = STABLE_DEGREES.filter((d) => degrees.includes(d))
  let step = degrees.indexOf('do')
  const degreeAt = (s: number) => degrees[((s % n) + n) % n]
  const nearestStep = (from: number, ok: (d: ScaleDegree) => boolean) => {
    for (let d = 0; d <= n; d++) {
      for (const s of [from - d, from + d]) if (s >= -n && s < 2 * n && ok(degreeAt(s))) return s
    }
    return from
  }

  const melody: MelodyNote[] = []
  const phrases: Phrase[] = []
  for (let bar = 0; bar < bars; bar++) {
    const isLastBar = bar === bars - 1
    const wholeBar = isLastBar && phaseId !== 'P4'
    const r = barRhythm(rng, beatsPerBar, usePatterns, m.patternIds, wholeBar)
    if (usePatterns) rhythmIds.push(r.patternId ?? 'whole')
    const keyIndex: 0 | 1 = modulationBar !== null && bar >= modulationBar ? 1 : 0
    const tones = chords ? chordTones(chords[bar]).filter((d) => degrees.includes(d)) : []
    const phraseEndBar = (bar + 1) % PHRASE_BARS === 0
    r.notes.forEach((note, i) => {
      const isFirst = i === 0
      const isPhraseLast = phraseEndBar && i === r.notes.length - 1
      if (isLastBar && i === r.notes.length - 1) step = nearestStep(step, (d) => d === 'do')
      else if (isPhraseLast) step = nearestStep(step, (d) => stable.includes(d))
      else if (isFirst && tones.length > 0) step = nearestStep(step, (d) => tones.includes(d))
      else {
        const delta = rng.next() < 0.1 ? (rng.next() < 0.5 ? -3 : 3) : rng.pick([-2, -1, -1, 0, 1, 1, 2])
        step = Math.max(-n, Math.min(2 * n - 1, step + delta))
      }
      melody.push({ degree: degreeAt(step), keyIndex, atBeat: bar * beatsPerBar + note.onset, durBeats: note.dur })
    })
    if (phraseEndBar) {
      const start = bar + 1 - PHRASE_BARS
      const count = melody.filter((x) => x.atBeat >= start * beatsPerBar && x.atBeat < (bar + 1) * beatsPerBar).length
      phrases.push({ index: phrases.length, startBar: start, endBar: bar + 1, melodyCount: count })
    }
  }

  const parts = BOSS_PARTS[phaseId]
  const piece: Piece = {
    phaseId,
    seed,
    keys,
    modulationBar,
    bpm: phaseId === 'P1' ? 80 : 90,
    meterId,
    bars,
    melody,
    chords,
    rhythm: parts.includes('rhythm') ? rhythmIds : null,
    drums: true,
  }
  let at = 0
  const melodyByPhrase = phrases.map((ph) => {
    const slice = melody.slice(at, at + ph.melodyCount).map((x) => x.degree)
    at += ph.melodyCount
    return slice
  })
  return {
    piece,
    parts,
    phrases,
    answer: {
      melody: melodyByPhrase,
      ...(parts.includes('chords') && chords ? { chords: [...chords] } : {}),
      ...(parts.includes('rhythm') ? { rhythm: [...rhythmIds] } : {}),
      ...(parts.includes('meter') ? { meter: meterId } : {}),
      ...(parts.includes('newTonic') && newTonic ? { newTonic } : {}),
    },
    alphabets: {
      melody: [...degrees],
      ...(parts.includes('chords') ? { chords: [...m.chordIds] } : {}),
      ...(parts.includes('rhythm') ? { rhythm: [...m.patternIds] } : {}),
      ...(parts.includes('meter') ? { meter: [...m.meters] } : {}),
      ...(parts.includes('newTonic') ? { newTonic: [...NEW_TONIC_ALPHABET] } : {}),
    },
  }
}
```

（`functionalChord('major', id)` 对 `'V/V'`、`'bVI'`、`'bVII'` 应返回对应和弦；若它要求的 id 写法不同——例如 `V-of-V`——以 `CHORD_ENTRIES` 的 `answerId` 为准，`chordTones` 的测试用 `answerId`。）

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/boss && npx tsc --noEmit`
Expected: PASS，写出 5 个快照。若「每小节第一个音是和弦音」在个别 seed 上失败，检查 `isFirst` 分支与乐句末音分支的优先级（乐句末音优先），不要删断言。

- [ ] **Step 5: 提交**

```bash
git add src/boss/generate.ts src/boss/generate.test.ts src/boss/__snapshots__/
git commit -m "feat(boss): 五个阶段的实战关生成器" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 渲染——多轨播放计划、乐句窗口、单句计划

**Files:**
- Create: `src/boss/render.ts`
- Test: `src/boss/render.test.ts`

**Interfaces:**
- Consumes: Task 2/3 的 `Piece`、`BossChallenge`；`doMidiForKey`、`degreeToMidi`（music/register）；`midiToFreq`；`voiceChord`；`functionalChord`；`METERS`；`PlaybackPlan`、`PlaybackEvent`、`DrumId`
- Produces:
  - 常量 `MELODY_CENTER_MIDI = 67`、`CHORD_ROOT_LOW = 48`（根音落在 48–59）
  - `export interface RenderedPiece { plan: PlaybackPlan; countInSec: number; barSec: number; phrases: { startSec: number; endSec: number }[] }`
  - `export function renderPiece(piece: Piece): RenderedPiece`：
    - 先一小节预备拍（每拍一个 `hat`），`countInSec = barSec`
    - 旋律：`piano`，gain 0.9；音高按 `keys[keyIndex]` 的 do（`doMidiForKey(key, MELODY_CENTER_MIDI)`）+ 音级半音，再按上一音选最近八度（同音级在 ±6 半音内取最近），夹在 MIDI 55–84
    - 和弦（有时）：每小节 `strings`，上方声部每音 gain 0.22，时长一整小节；根音 MIDI 落在 48–59（`keys[k]` 下的根音音类）；`voiceChord` 的低音以 `piano` 在每小节第 1 拍（4/4 再加第 3 拍）各一下，gain 0.7，时长半小节
    - 鼓：底鼓每小节第 1 拍（4/4 再加第 3 拍）；军鼓 2/4 第 2 拍、4/4 第 2、4 拍、3/4 无；踩镲每拍（4/4 每半拍）
    - 乐句窗口：第 i 句 `[countInSec + startBar × barSec, countInSec + endBar × barSec)`
    - `totalDurSec = countInSec + bars × barSec + 0.5`
  - `export function phrasePlan(r: RenderedPiece, i: number): PlaybackPlan`：一小节预备拍 + 该窗口内的事件（按 `atSec ∈ [start, end)` 选取，平移到预备拍之后）
  - `export function allPitchedMidis(plan: PlaybackPlan): number[]`（测试用：所有非鼓事件的 MIDI）

- [ ] **Step 1: 写失败的测试**

`src/boss/render.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import type { PhaseId } from '../curriculum/stages'
import { generateBoss } from './generate'
import { allPitchedMidis, phrasePlan, renderPiece } from './render'

const c = buildCurriculum()
const PHASES: PhaseId[] = ['P1', 'P2', 'P3', 'P4', 'P5']

describe('renderPiece（P-5 spec §3.1）', () => {
  it('乐句窗口首尾相接、覆盖全曲、互不重叠', () => {
    for (const phaseId of PHASES) {
      const ch = generateBoss(c, phaseId, 3)
      const r = renderPiece(ch.piece)
      expect(r.phrases).toHaveLength(ch.phrases.length)
      expect(r.phrases[0].startSec).toBeCloseTo(r.countInSec)
      for (let i = 1; i < r.phrases.length; i++) expect(r.phrases[i].startSec).toBeCloseTo(r.phrases[i - 1].endSec)
      expect(r.phrases.at(-1)!.endSec).toBeCloseTo(r.countInSec + ch.piece.bars * r.barSec)
    }
  })

  it('所有有音高的声部在 MIDI 36–96（FWD-4）', () => {
    for (const phaseId of PHASES) {
      for (let seed = 0; seed < 15; seed++) {
        const midis = allPitchedMidis(renderPiece(generateBoss(c, phaseId, seed).piece).plan)
        expect(Math.min(...midis)).toBeGreaterThanOrEqual(36 - 1e-6)
        expect(Math.max(...midis)).toBeLessThanOrEqual(96 + 1e-6)
      }
    }
  })

  it('旋律音数等于片段旋律音数；有和弦的关卡有和弦与低音事件', () => {
    const ch = generateBoss(c, 'P3', 5)
    const r = renderPiece(ch.piece)
    const melodyEvents = r.plan.events.filter((e) => !e.drum && e.timbreId === 'piano' && e.gain > 0.85)
    expect(melodyEvents).toHaveLength(ch.piece.melody.length)
    expect(r.plan.events.some((e) => e.timbreId === 'strings')).toBe(true)
  })

  it('鼓点落在拍网格上；预备拍一小节', () => {
    const ch = generateBoss(c, 'P4', 2)
    const r = renderPiece(ch.piece)
    const beatSec = r.barSec / 4
    for (const e of r.plan.events.filter((x) => x.drum)) {
      const halfBeats = e.atSec / (beatSec / 2)
      expect(Math.abs(halfBeats - Math.round(halfBeats))).toBeLessThan(1e-6)
    }
    const countIn = r.plan.events.filter((e) => e.drum && e.atSec < r.countInSec - 1e-9)
    expect(countIn.map((e) => e.drum)).toEqual(['hat', 'hat', 'hat', 'hat'])
  })

  it('phrasePlan：预备拍 + 该句的事件，平移到预备拍之后', () => {
    const ch = generateBoss(c, 'P2', 4)
    const r = renderPiece(ch.piece)
    const p = phrasePlan(r, 1)
    const win = r.phrases[1]
    const inWin = r.plan.events.filter((e) => e.atSec >= win.startSec - 1e-9 && e.atSec < win.endSec - 1e-9)
    const shifted = p.events.filter((e) => e.atSec >= r.countInSec - 1e-9)
    expect(shifted).toHaveLength(inWin.length)
    expect(shifted[0].atSec).toBeCloseTo(inWin[0].atSec - win.startSec + r.countInSec)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/boss/render.test.ts`
Expected: FAIL —— 无法解析模块

- [ ] **Step 3: 写实现**

`src/boss/render.ts`：

```ts
import { functionalChord } from '../exercises/data/chords'
import { METERS } from '../exercises/data/rhythms'
import { voiceChord } from '../music/chord'
import { DEGREE_SEMITONES, type Key } from '../music/key'
import { freqToMidi, midiToFreq } from '../music/pitch'
import type { DrumId, PlaybackEvent, PlaybackPlan } from '../music/playback'
import { doMidiForKey } from '../music/register'
import type { Piece } from './types'

export const MELODY_CENTER_MIDI = 67
export const CHORD_ROOT_LOW = 48
const MELODY_LOW = 55
const MELODY_HIGH = 84

export interface RenderedPiece {
  plan: PlaybackPlan
  countInSec: number
  barSec: number
  phrases: { startSec: number; endSec: number }[]
}

const note = (atSec: number, midi: number, durSec: number, timbreId: PlaybackEvent['timbreId'], gain: number): PlaybackEvent => ({
  atSec,
  freqHz: midiToFreq(midi),
  durSec,
  timbreId,
  gain,
})
const drum = (atSec: number, d: DrumId, gain: number): PlaybackEvent => ({ atSec, freqHz: 0, durSec: 0.1, timbreId: 'piano', gain, drum: d })

function drumBar(beatsPerBar: number, beatSec: number, at0: number, out: PlaybackEvent[], hatsOnly = false): void {
  const hatStep = beatsPerBar === 4 ? 0.5 : 1
  for (let b = 0; b < beatsPerBar; b += hatStep) out.push(drum(at0 + b * beatSec, 'hat', 1))
  if (hatsOnly) return
  out.push(drum(at0, 'kick', 1))
  if (beatsPerBar === 4) out.push(drum(at0 + 2 * beatSec, 'kick', 1))
  if (beatsPerBar === 2) out.push(drum(at0 + beatSec, 'snare', 1))
  if (beatsPerBar === 4) out.push(drum(at0 + beatSec, 'snare', 1), drum(at0 + 3 * beatSec, 'snare', 1))
}

function rootMidiInRange(key: Key, chordId: string): { chord: ReturnType<typeof functionalChord>; rootMidi: number } {
  const chord = functionalChord('major', chordId)
  const pc = (key.tonic + DEGREE_SEMITONES[chord.rootDegree]) % 12
  const rootMidi = CHORD_ROOT_LOW + ((pc - CHORD_ROOT_LOW) % 12 + 12) % 12
  return { chord, rootMidi }
}

export function renderPiece(piece: Piece): RenderedPiece {
  const { beatsPerBar } = METERS[piece.meterId]
  const beatSec = 60 / piece.bpm
  const barSec = beatsPerBar * beatSec
  const countInSec = barSec
  const events: PlaybackEvent[] = []

  // 预备拍：一小节踩镲，每拍一下
  for (let b = 0; b < beatsPerBar; b++) events.push(drum(b * beatSec, 'hat', 1))

  // 旋律
  let prev: number | null = null
  for (const n of piece.melody) {
    const key = piece.keys[n.keyIndex]
    const doMidi = doMidiForKey(key, MELODY_CENTER_MIDI)
    let midi = doMidi + DEGREE_SEMITONES[n.degree]
    if (prev !== null) {
      while (midi - prev > 6) midi -= 12
      while (prev - midi > 6) midi += 12
    }
    while (midi < MELODY_LOW) midi += 12
    while (midi > MELODY_HIGH) midi -= 12
    prev = midi
    events.push(note(countInSec + n.atBeat * beatSec, midi, n.durBeats * beatSec * 0.95, 'piano', 0.9))
  }

  for (let bar = 0; bar < piece.bars; bar++) {
    const at0 = countInSec + bar * barSec
    // 和弦与低音
    if (piece.chords) {
      const keyIndex = piece.modulationBar !== null && bar >= piece.modulationBar ? 1 : 0
      const { chord, rootMidi } = rootMidiInRange(piece.keys[keyIndex], piece.chords[bar])
      const v = voiceChord(chord, rootMidi)
      for (const m of v.upperMidis) events.push(note(at0, m, barSec, 'strings', 0.22))
      events.push(note(at0, v.bassMidi, barSec / 2, 'piano', 0.7))
      if (beatsPerBar === 4) events.push(note(at0 + 2 * beatSec, v.bassMidi, barSec / 2, 'piano', 0.7))
    }
    if (piece.drums) drumBar(beatsPerBar, beatSec, at0, events)
  }

  events.sort((a, b) => a.atSec - b.atSec)
  const phrases = []
  for (let start = 0; start < piece.bars; start += 2) {
    phrases.push({ startSec: countInSec + start * barSec, endSec: countInSec + Math.min(start + 2, piece.bars) * barSec })
  }
  return { plan: { events, totalDurSec: countInSec + piece.bars * barSec + 0.5 }, countInSec, barSec, phrases }
}

export function phrasePlan(r: RenderedPiece, i: number): PlaybackPlan {
  const win = r.phrases[i]
  const countIn = r.plan.events.filter((e) => e.drum && e.atSec < r.countInSec - 1e-9)
  const body = r.plan.events
    .filter((e) => e.atSec >= win.startSec - 1e-9 && e.atSec < win.endSec - 1e-9)
    .map((e) => ({ ...e, atSec: e.atSec - win.startSec + r.countInSec }))
  return { events: [...countIn, ...body], totalDurSec: r.countInSec + (win.endSec - win.startSec) + 0.5 }
}

export function allPitchedMidis(plan: PlaybackPlan): number[] {
  return plan.events.filter((e) => !e.drum).map((e) => freqToMidi(e.freqHz))
}
```

（`drumBar` 的 `hatsOnly` 参数未用到时删掉，免得 `noUnusedParameters` 报错；`phrases` 用 `PHRASE_BARS` 常量替换字面量 2，`import { PHRASE_BARS } from './types'`。）

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/boss && npx tsc --noEmit`
Expected: PASS。若低音声部低于 36（根音 48 时 `voiceChord` 低音为 36 + 转位音程 − 12，原位为 36），检查 `CHORD_ROOT_LOW`；不要放宽 36 的下限。

- [ ] **Step 5: 提交**

```bash
git add src/boss/render.ts src/boss/render.test.ts
git commit -m "feat(boss): 片段渲染——多轨计划、预备拍、乐句窗口与单句计划" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 分部分判定

**Files:**
- Create: `src/boss/grade.ts`
- Test: `src/boss/grade.test.ts`

**Interfaces:**
- Consumes: `BossChallenge`、`BossResponse`、`PartId`、`BOSS_PASS_RATIO`
- Produces:
  - `export interface BossGrade { parts: Partial<Record<PartId, number>>; passed: boolean; marks: { melody: boolean[][]; chords?: boolean[]; rhythm?: boolean[]; meter?: boolean; newTonic?: boolean } }`
  - `export function gradeBoss(ch: BossChallenge, r: BossResponse): BossGrade`：
    - 旋律：逐句逐位比对（作答不足的位置记错、多余的忽略），比例 = 对的音数 / 总音数
    - 和弦、节奏：逐小节比对，比例同上
    - 拍号、新调主音：对 1、错 0（缺答记错）
    - 只计 `ch.parts` 里的部分；`passed` = 每个部分 ≥ `BOSS_PASS_RATIO`

- [ ] **Step 1: 写失败的测试**

`src/boss/grade.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { generateBoss } from './generate'
import { gradeBoss } from './grade'
import type { BossChallenge, BossResponse } from './types'

const c = buildCurriculum()
const perfect = (ch: BossChallenge): BossResponse => JSON.parse(JSON.stringify(ch.answer))

/** 把旋律的前 k 个音改错 */
function spoilMelody(ch: BossChallenge, k: number): BossResponse {
  const r = perfect(ch)
  let left = k
  for (const ph of r.melody) for (let i = 0; i < ph.length && left > 0; i++, left--) ph[i] = ph[i] === 'do' ? 're' : 'do'
  return r
}

describe('gradeBoss（P-5 spec §3.4）', () => {
  it('完美作答：每部分 1、通过', () => {
    for (const phaseId of ['P1', 'P2', 'P3', 'P4', 'P5'] as const) {
      const ch = generateBoss(c, phaseId, 9)
      const g = gradeBoss(ch, perfect(ch))
      expect(g.passed).toBe(true)
      for (const p of ch.parts) expect(g.parts[p]).toBe(1)
    }
  })

  it('旋律恰好 90% 通过，低于 90% 不通过', () => {
    const ch = generateBoss(c, 'P2', 3)
    const total = ch.answer.melody.flat().length
    const okWrong = Math.floor(total * 0.1)
    const atNinety = gradeBoss(ch, spoilMelody(ch, okWrong))
    expect(atNinety.parts.melody).toBeGreaterThanOrEqual(0.9)
    expect(atNinety.passed).toBe(true)
    const below = gradeBoss(ch, spoilMelody(ch, okWrong + 1))
    expect(below.parts.melody).toBeLessThan(0.9)
    expect(below.passed).toBe(false)
  })

  it('任一部分不过，整体不过（P1 拍号错）', () => {
    const ch = generateBoss(c, 'P1', 5)
    const r = perfect(ch)
    r.meter = r.meter === '2/4' ? '3/4' : '2/4'
    const g = gradeBoss(ch, r)
    expect(g.parts.melody).toBe(1)
    expect(g.parts.meter).toBe(0)
    expect(g.passed).toBe(false)
  })

  it('缺答记错：少写一句旋律、没选和弦', () => {
    const ch = generateBoss(c, 'P3', 2)
    const r = perfect(ch)
    r.melody[0] = []
    r.chords = r.chords!.slice(0, -1)
    const g = gradeBoss(ch, r)
    expect(g.marks.melody[0].every((x) => !x)).toBe(true)
    expect(g.marks.chords!.at(-1)).toBe(false)
    expect(g.parts.chords).toBeCloseTo(7 / 8)
  })

  it('逐位标记与答案对齐', () => {
    const ch = generateBoss(c, 'P4', 1)
    const g = gradeBoss(ch, perfect(ch))
    expect(g.marks.melody.map((m) => m.length)).toEqual(ch.answer.melody.map((m) => m.length))
    expect(g.marks.rhythm).toHaveLength(ch.piece.bars)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/boss/grade.test.ts`
Expected: FAIL —— 无法解析模块

- [ ] **Step 3: 写实现**

`src/boss/grade.ts`：

```ts
import { BOSS_PASS_RATIO, type BossChallenge, type BossResponse, type PartId } from './types'

export interface BossGrade {
  parts: Partial<Record<PartId, number>>
  passed: boolean
  marks: { melody: boolean[][]; chords?: boolean[]; rhythm?: boolean[]; meter?: boolean; newTonic?: boolean }
}

const compare = (expected: readonly string[], got: readonly string[] | undefined) => expected.map((e, i) => got?.[i] === e)
const ratio = (marks: boolean[]) => (marks.length === 0 ? 1 : marks.filter(Boolean).length / marks.length)

/** 分部分判定（P-5 spec §3.4）：每部分 ≥ 0.9 才通过 */
export function gradeBoss(ch: BossChallenge, r: BossResponse): BossGrade {
  const a = ch.answer
  const parts: Partial<Record<PartId, number>> = {}
  const marks: BossGrade['marks'] = { melody: a.melody.map((ph, i) => compare(ph, r.melody?.[i])) }
  for (const part of ch.parts) {
    switch (part) {
      case 'melody':
        parts.melody = ratio(marks.melody.flat())
        break
      case 'chords':
        marks.chords = compare(a.chords ?? [], r.chords)
        parts.chords = ratio(marks.chords)
        break
      case 'rhythm':
        marks.rhythm = compare(a.rhythm ?? [], r.rhythm)
        parts.rhythm = ratio(marks.rhythm)
        break
      case 'meter':
        marks.meter = r.meter === a.meter
        parts.meter = marks.meter ? 1 : 0
        break
      case 'newTonic':
        marks.newTonic = r.newTonic === a.newTonic
        parts.newTonic = marks.newTonic ? 1 : 0
        break
    }
  }
  const passed = ch.parts.every((p) => (parts[p] ?? 0) >= BOSS_PASS_RATIO - 1e-12)
  return { parts, passed, marks }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/boss && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/boss/grade.ts src/boss/grade.test.ts
git commit -m "feat(boss): 分部分判定（各部分 ≥ 90%）" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 仿真改用真实关卡可答性；写回

**Files:**
- Create: `src/boss/answerability.ts`
- Modify: `src/simulation/runSimulation.ts`、`src/simulation/__snapshots__/characterization.test.ts.snap`（**仅在节奏检查通过后**）
- Test: `src/boss/answerability.test.ts`
- Docs: `docs/superpowers/specs/2026-08-24-ear-training-design.md`（§8.3、§13.1）、`docs/superpowers/specs/2026-10-13-p3-session-storage-ui-design.md`（D3 注明将由 P-5b 替换）

**Interfaces:**
- Consumes: Task 3/5；`VirtualLearner`（simulation/virtualLearner）；`ExerciseSpec`；`CHORD_ENTRIES`；`PATTERNS`；`masteryKey`
- Produces:
  - `export const BOSS_SPEC_LEVEL = { contextLevel: 1, variationLevel: 1, difficultyStep: 1 } as const`（虚拟学习者作答关卡时每个位置所用的题目难度）
  - `export function positionKpIds(ch: BossChallenge): { melody: string[][]; chords?: string[]; rhythm?: string[]; meter?: string; newTonic?: string }`：旋律音级 → `degree:major:<d>`；和弦 id → `CHORD_ENTRIES` 里 `answerId` 相同的大调功能和弦的 `kpId`；节奏型 → `PATTERNS` 的 `ownerKpId`；拍号 `'2/4'` → `rhythm:meter-2-4`、`'3/4'` → `rhythm:meter-3-4`、`'4/4'` → `rhythm:beat-one`；新调主音 → `degree:modulation:shift`
  - `export function simulateBossAttempt(ch: BossChallenge, learner: Pick<VirtualLearner, 'probabilityOf'>, rng: Rng): BossResponse`：每个位置以 `learner.probabilityOf({ kpId, modality: 'notate', track, ...BOSS_SPEC_LEVEL, seed: 0, segment: 'boss' }, BOSS_SPEC_LEVEL.difficultyStep)` 的概率答对，答错时从字母表里取一个不同的 id
  - `runSimulation`：删除 `BOSS_ABILITY_THRESHOLD` 与 `bossPasses`；每天在掌握度达标（`evaluateGate(..., true).blockingKeys.length === 0`）时，最多尝试 `BOSS_ATTEMPTS_PER_DAY` 次真实关卡（seed 由 `(params.seed, day, attempt)` 派生，rng 用独立的 `makeRng`），任一次 `gradeBoss(...).passed` 即过关升阶段

- [ ] **Step 1: 写失败的测试**

`src/boss/answerability.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { makeRng } from '../music/rng'
import { generateBoss } from './generate'
import { gradeBoss } from './grade'
import { positionKpIds, simulateBossAttempt } from './answerability'

const c = buildCurriculum()

describe('positionKpIds', () => {
  it('每个作答位置都映射到课程里存在的知识点', () => {
    for (const phaseId of ['P1', 'P2', 'P3', 'P4', 'P5'] as const) {
      const ids = positionKpIds(generateBoss(c, phaseId, 4))
      const all = [...ids.melody.flat(), ...(ids.chords ?? []), ...(ids.rhythm ?? []), ...(ids.meter ? [ids.meter] : []), ...(ids.newTonic ? [ids.newTonic] : [])]
      for (const id of all) expect(c.knowledgePoints.has(id), id).toBe(true)
    }
  })
})

describe('simulateBossAttempt', () => {
  const ch = generateBoss(c, 'P3', 6)
  it('能力满分的学习者全对、通过', () => {
    const r = simulateBossAttempt(ch, { probabilityOf: () => 1 }, makeRng(1))
    expect(gradeBoss(ch, r).passed).toBe(true)
  })
  it('能力为零的学习者全错，答错的位置不等于正确答案', () => {
    const r = simulateBossAttempt(ch, { probabilityOf: () => 0 }, makeRng(1))
    const g = gradeBoss(ch, r)
    expect(g.passed).toBe(false)
    expect(g.marks.melody.flat().every((x) => !x)).toBe(true)
  })
  it('确定性：同一 rng 种子同一作答', () => {
    const half = { probabilityOf: () => 0.5 }
    expect(simulateBossAttempt(ch, half, makeRng(7))).toEqual(simulateBossAttempt(ch, half, makeRng(7)))
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/boss/answerability.test.ts`
Expected: FAIL —— 无法解析模块

- [ ] **Step 3: 写实现**

`src/boss/answerability.ts`：

```ts
import { trackOfKind, type KnowledgePointId } from '../curriculum/knowledgePoints'
import { CHORD_ENTRIES } from '../exercises/data/chords'
import { PATTERNS } from '../exercises/data/rhythms'
import type { Rng } from '../music/rng'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'
import type { VirtualLearner } from '../simulation/virtualLearner'
import type { BossChallenge, BossResponse } from './types'

/** 虚拟学习者作答实战关时，每个位置按这个难度的听写题计概率 */
export const BOSS_SPEC_LEVEL = { contextLevel: 1, variationLevel: 1, difficultyStep: 1 } as const

const METER_KP: Record<string, KnowledgePointId> = {
  '2/4': 'rhythm:meter-2-4',
  '3/4': 'rhythm:meter-3-4',
  '4/4': 'rhythm:beat-one',
}

const chordKp = (id: string): KnowledgePointId => {
  const e = CHORD_ENTRIES.find((x) => x.family === 'functional' && x.mode === 'major' && x.answerId === id)
  if (!e) throw new Error(`没有和弦 ${id} 的知识点`)
  return e.kpId
}
const patternKp = (id: string): KnowledgePointId => {
  const p = PATTERNS.find((x) => x.id === id)
  if (!p) throw new Error(`没有音型 ${id}`)
  return p.ownerKpId
}

export function positionKpIds(ch: BossChallenge) {
  const a = ch.answer
  return {
    melody: a.melody.map((ph) => ph.map((d) => `degree:major:${d}`)),
    ...(a.chords ? { chords: a.chords.map(chordKp) } : {}),
    ...(a.rhythm ? { rhythm: a.rhythm.map(patternKp) } : {}),
    ...(a.meter ? { meter: METER_KP[a.meter] } : {}),
    ...(a.newTonic ? { newTonic: 'degree:modulation:shift' } : {}),
  }
}

const kindOf = (kpId: KnowledgePointId) => kpId.slice(0, kpId.indexOf(':')) as Parameters<typeof trackOfKind>[0]

export function simulateBossAttempt(ch: BossChallenge, learner: Pick<VirtualLearner, 'probabilityOf'>, rng: Rng): BossResponse {
  const ids = positionKpIds(ch)
  const answerOne = (kpId: KnowledgePointId, correct: string, alphabet: readonly string[]): string => {
    const spec: ExerciseSpec = { kpId, modality: 'notate', track: trackOfKind(kindOf(kpId)), ...BOSS_SPEC_LEVEL, seed: 0, segment: 'boss' }
    if (rng.next() < learner.probabilityOf(spec, BOSS_SPEC_LEVEL.difficultyStep)) return correct
    const wrong = alphabet.filter((x) => x !== correct)
    return wrong.length > 0 ? rng.pick(wrong) : correct
  }
  const a = ch.answer
  return {
    melody: a.melody.map((ph, i) => ph.map((d, j) => answerOne(ids.melody[i][j], d, ch.alphabets.melody))),
    ...(a.chords ? { chords: a.chords.map((x, i) => answerOne(ids.chords![i], x, ch.alphabets.chords ?? [])) } : {}),
    ...(a.rhythm ? { rhythm: a.rhythm.map((x, i) => answerOne(ids.rhythm![i], x, ch.alphabets.rhythm ?? [])) } : {}),
    ...(a.meter ? { meter: answerOne(ids.meter!, a.meter, ch.alphabets.meter ?? []) } : {}),
    ...(a.newTonic ? { newTonic: answerOne(ids.newTonic!, a.newTonic, ch.alphabets.newTonic ?? []) } : {}),
  }
}
```

（`trackOfKind` 的参数类型以 `knowledgePoints.ts` 为准；`kpId` 的前缀 `degree` / `chord` / `prog` / `rhythm` 就是 kind。`src/boss` 引用 `simulation/virtualLearner` 只用 `import type`，不形成运行时依赖。）

`src/simulation/runSimulation.ts`：
- 删除 `BOSS_ABILITY_THRESHOLD` 与 `bossPasses`（以及只被它们用到的 import）。
- import：`generateBoss`、`gradeBoss`、`simulateBossAttempt`、`BOSS_ATTEMPTS_PER_DAY`（`../boss/...`）、`makeRng`。
- 把「关卡判定」那段替换为：

```ts
    // 关卡判定（P-5 spec §3.5）：掌握度达标后，当天最多 BOSS_ATTEMPTS_PER_DAY 次真实关卡
    const mastery = evaluateGate(curriculum, store, phaseId, true)
    if (mastery.blockingKeys.length === 0 && phaseCompletionDay[phaseId] === undefined) {
      let passed = false
      for (let attempt = 0; attempt < BOSS_ATTEMPTS_PER_DAY && !passed; attempt++) {
        const bossSeed = (Math.imul(params.seed ^ 0x5bd1e995, 31) + day * 7 + attempt) >>> 0
        const challenge = generateBoss(curriculum, phaseId, bossSeed)
        const response = simulateBossAttempt(challenge, learner, makeRng(bossSeed ^ 0x9e3779b9))
        passed = gradeBoss(challenge, response).passed
      }
      if (passed) {
        phaseCompletionDay[phaseId] = day
        const next = nextPhase(phaseId)
        if (next) phaseId = next
      }
    }
```

- [ ] **Step 4: 运行 boss 与仿真测试，做节奏检查**

Run: `npx vitest run src/boss src/simulation/runSimulation.test.ts src/simulation/diagnostics.test.ts && npx tsc --noEmit`

然后单独打印节奏：在 `src/simulation/` 下临时建 `zz_pace.test.ts`（运行后删除，不提交）：

```ts
import { it } from 'vitest'
import { runSimulation } from './runSimulation'
import { AVERAGE_LEARNER, SLOW_LEARNER } from './virtualLearner'
it('pace', () => {
  for (const [name, learner] of [['average', AVERAGE_LEARNER], ['slow', SLOW_LEARNER]] as const) {
    for (const seed of [4242, 1, 2, 3]) {
      const r = runSimulation({ learner, days: 180, minutesPerDay: 25, seed })
      console.log(name, seed, JSON.stringify(r.phaseCompletionDay), r.finalPhase)
    }
  }
})
```

Run: `npx vitest run src/simulation/zz_pace.test.ts`，记下输出，然后删除该文件。

**判定：**
- 若 `runSimulation.test.ts` 的全部断言通过，**且**普通学习者（四个 seed）的 P1 完成天数都在 28–42 天、P2 完成天数都在 P1 完成后 42–56 天内：继续 Step 5。
- **否则停止**：不改任何参数（包括 `BOSS_SPEC_LEVEL`、通过比例、生成规则），在报告里给出上面的实测输出与失败断言，状态报 `BLOCKED`，交控制者转用户裁定。

- [ ] **Step 5: 更新特征快照（节奏检查通过之后）**

特征快照里含 `phaseCompletionDay` 与按天的阶段，换成真实关卡后必然变化——这是预期的行为变更。

Run: `npx vitest run src/simulation/characterization.test.ts -u`

确认 diff 只涉及阶段推进相关字段（`finalPhase`、`phaseCompletionDay`、`days` 的 `phaseId` 与随之变化的 itemCount/correct、`store` 里因阶段不同而不同的项）。

- [ ] **Step 6: 写回**

主 spec §8.3 末尾追加：

```
**状态（P-5a）**：实战关为真实的多轨合成片段（`src/boss/`），每个作答部分 ≥ 90% 才算通过；每天最多 3 次，每次换新片段。P-5b 接入界面之前，应用里的关卡仍由 P-3 的替身判定。
```

主 spec §13.1 末尾追加：

```
**状态（P-5a）**：仿真的实战关改为「真实关卡可答性」：掌握度达标后每天最多 3 次，虚拟学习者对每个作答位置按对应知识点的听写能力逐位作答（`src/boss/answerability.ts`），再用 `gradeBoss` 判定。`BOSS_ABILITY_THRESHOLD` 已删除。
```

P-3 spec「D3」那一行之后加一行：

```
（P-5a 起：实战关的真题与判定已实现于 `src/boss/`；P-5b 接入界面时删除本替身。）
```

- [ ] **Step 7: 完成检查与提交**

```bash
npx vitest run
npx tsc --noEmit
npx vite build
grep -rn "Math.random\|Date.now\|window\.\|document\." src/boss --include=*.ts | grep -v "\.test\.ts" || echo "OK: src/boss 零 IO"
grep -rn "BOSS_ABILITY_THRESHOLD" src || echo "OK: 能力阈值已删除"
git status --short
```

Expected: 全部 PASS；两条 grep 输出 OK；没有残留的 `zz_pace.test.ts`。

```bash
git add src/boss/answerability.ts src/boss/answerability.test.ts src/simulation/ docs/superpowers/specs/
git commit -m "feat(simulation): 实战关改用真实关卡可答性；写回 spec" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 完成标准

1. `npx vitest run` 全绿；`npx tsc --noEmit` 无输出；`npx vite build` 成功
2. 鼓、素材、五个生成器（含快照）、渲染、判定、仿真可答性都有测试
3. `src/boss/` 零 IO；`BOSS_ABILITY_THRESHOLD` 已删除
4. 仿真节奏在目标内，或已由用户裁定
5. 主 spec §8.3、§13.1 与 P-3 spec D3 已写回

## 下一步

P-5b：解锁条件、关卡页（分句作答、重听限制）、`bossAttempts` 存储与 IndexedDB v2 迁移、升阶段、删除替身；真机验收。
