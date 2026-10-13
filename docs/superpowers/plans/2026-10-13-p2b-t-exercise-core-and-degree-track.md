# P-2b-T 题目生成器共享层与 T 轨 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把调度器产出的 T 轨 `ExerciseSpec` 渲染成可播放、可作答、可判定的 `Exercise`，并落地全部共享层，供 P-2b-H / P-2b-R 直接复用。

**Architecture:** 新建 `src/exercises/`。每道题走固定四步管线：解析变异轴 → 按 (生成器类别, 模态) 生成内容 → 语境包装 + 音区八度折叠 → 反馈。知识点的音乐含义放在数据表里，生成器只负责「内容」一步。全部为纯函数，随机性只来自 `makeRng(spec.seed)`。

**Tech Stack:** TypeScript、vitest。无新依赖。

**Spec:** `docs/superpowers/specs/2026-10-13-p2b-exercise-generators-design.md`（下称「P-2b spec」）。主 spec：`docs/superpowers/specs/2026-08-24-ear-training-design.md`。

## Global Constraints

- `src/exercises/` 只依赖 `src/music/`、`src/curriculum/`、`src/scheduling/exerciseSpec.ts`；不得依赖 `src/audio/`、`src/scheduling/` 的其他文件、`src/simulation/`（测试文件除外）。
- 零 IO：不得出现 `Math.random`、`Date.now`、`window.`、`document.`。随机性只来自 `makeRng(spec.seed)`。
- rng 消耗顺序固定为「变异轴 → 内容 → 选项打乱」（P-2b spec §4）。
- 整份 plan（语境、内容、反馈）的音高必须落在 MIDI 36–96（P-2b spec §5，FWD-4）。
- 力度规则：`gain = velocity × (accent ? 1.0 : 0.75)`（P-2b spec D9，FWD-2）。旋律内容的每个音视为 `accent = true`。
- 音区随机范围 MIDI 48–72（P-2b spec D6）。
- 唱模态音高容差固定 50 音分（主 spec §9）。
- `SLOW_FACTOR = 0.6`（P-2b spec §6）。
- 调度器产出的 `spec.difficultyStep` 恒为 0；调用方负责写入阶梯档位，`generate` 不检查（P-2b spec §3 运行时契约）。
- 测试命令：`npx vitest run <path>`；全量：`npx vitest run`；类型：`npx tsc --noEmit`；构建：`npx vite build`。
- 每个任务结束提交一次，提交信息以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾。

## File Structure

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/music/rhythm.ts`（改） | `onsetsToNotes`、`ACCENT_OFF_FACTOR`（FWD-2） | 1 |
| `src/music/pitch.ts`（改） | `freqToMidi` | 1 |
| `src/music/register.ts`（改） | `foldPlanToRange`（FWD-4） | 1 |
| `src/exercises/types.ts` | 全部共享类型 | 2 |
| `src/exercises/difficulty.ts` | `difficultyStep` → 题内参数 | 2 |
| `src/exercises/variation.ts` | 变异轴解析 | 3 |
| `src/exercises/data/degrees.ts` | T 轨知识点数据表 | 4 |
| `src/exercises/pools.ts` | 干扰池、选项抽取、`shuffle` | 5 |
| `src/exercises/context.ts` | T/H 语境包装 + 折叠 | 6 |
| `src/exercises/feedback.ts` | replay / slow 反馈 | 7 |
| `src/exercises/grade.ts` | 判定 | 8 |
| `src/exercises/generators/degree.ts` | 普通音级三模态 | 9 |
| `src/exercises/generators/modulation.ts` | 转调三模态 | 10 |
| `src/exercises/generate.ts` | 管线入口与生成器注册表 | 11 |
| `src/exercises/integration.test.ts` | 集成守卫 | 12 |

---

### Task 1: music 层前置——力度桥接（FWD-2）与音区八度折叠（FWD-4）

**Files:**
- Modify: `src/music/rhythm.ts`（文件末尾追加）
- Modify: `src/music/pitch.ts`（文件末尾追加）
- Modify: `src/music/register.ts`（文件末尾追加，并在顶部补 import）
- Test: `src/music/onsetsToNotes.test.ts`（新建）
- Test: `src/music/foldPlanToRange.test.ts`（新建）

**Interfaces:**
- Consumes: `TimedOnset`（rhythm.ts）、`NoteSpec`/`PlaybackPlan`（playback.ts）、`midiToFreq`（pitch.ts）
- Produces:
  - `export const ACCENT_OFF_FACTOR = 0.75`
  - `export function onsetsToNotes(onsets: readonly TimedOnset[], midi: number, velocity: number): NoteSpec[]`
  - `export function freqToMidi(freqHz: number): number`
  - `export function foldPlanToRange(plan: PlaybackPlan, loMidi: number, hiMidi: number): PlaybackPlan`

- [ ] **Step 1: 写失败的测试**

`src/music/onsetsToNotes.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { ACCENT_OFF_FACTOR, onsetsToNotes, type TimedOnset } from './rhythm'

const onsets: TimedOnset[] = [
  { atSec: 0, durSec: 0.5, accent: true },
  { atSec: 0.5, durSec: 0.25, accent: false },
  { atSec: 0.75, durSec: 0.25, accent: true },
]

describe('onsetsToNotes（FWD-2：accent 与力度轴的合成规则）', () => {
  it('ACCENT_OFF_FACTOR 为 0.75（P-2b spec D9）', () => {
    expect(ACCENT_OFF_FACTOR).toBe(0.75)
  })

  it('重音 gain = velocity，非重音 gain = velocity × ACCENT_OFF_FACTOR', () => {
    const notes = onsetsToNotes(onsets, 60, 0.8)
    expect(notes[0].gain).toBeCloseTo(0.8, 12)
    expect(notes[1].gain).toBeCloseTo(0.8 * ACCENT_OFF_FACTOR, 12)
    expect(notes[2].gain).toBeCloseTo(0.8, 12)
  })

  it('保留时刻与时值，全部落在同一音高', () => {
    const notes = onsetsToNotes(onsets, 67, 1)
    expect(notes.map((n) => n.atSec)).toEqual([0, 0.5, 0.75])
    expect(notes.map((n) => n.durSec)).toEqual([0.5, 0.25, 0.25])
    expect(notes.every((n) => n.midi === 67)).toBe(true)
  })

  it('空输入返回空数组', () => {
    expect(onsetsToNotes([], 60, 0.8)).toEqual([])
  })
})
```

`src/music/foldPlanToRange.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { freqToMidi, midiToFreq } from './pitch'
import { notesToPlan } from './playback'
import { foldPlanToRange } from './register'

const planOf = (...midis: number[]) =>
  notesToPlan(
    midis.map((midi, i) => ({ midi, atSec: i, durSec: 0.5 })),
    'piano',
  )

describe('freqToMidi', () => {
  it('是 midiToFreq 的反函数', () => {
    for (const m of [21, 36, 60, 69, 96, 108]) {
      expect(freqToMidi(midiToFreq(m))).toBeCloseTo(m, 9)
    }
  })
})

describe('foldPlanToRange（FWD-4：整份 plan 的八度折叠）', () => {
  it('低于下限的音按八度上移，直到落入区间', () => {
    const folded = foldPlanToRange(planOf(18), 36, 96)
    expect(freqToMidi(folded.events[0].freqHz)).toBeCloseTo(42, 9)
  })

  it('高于上限的音按八度下移', () => {
    const folded = foldPlanToRange(planOf(100), 36, 96)
    expect(freqToMidi(folded.events[0].freqHz)).toBeCloseTo(88, 9)
  })

  it('区间内的音与边界上的音不动', () => {
    const plan = planOf(36, 60, 96)
    const folded = foldPlanToRange(plan, 36, 96)
    expect(folded.events.map((e) => e.freqHz)).toEqual(plan.events.map((e) => e.freqHz))
  })

  it('只改频率，时刻、时值、音色、gain、totalDurSec 不变', () => {
    const plan = planOf(18, 100)
    const folded = foldPlanToRange(plan, 36, 96)
    expect(folded.totalDurSec).toBe(plan.totalDurSec)
    for (let i = 0; i < plan.events.length; i++) {
      expect(folded.events[i].atSec).toBe(plan.events[i].atSec)
      expect(folded.events[i].durSec).toBe(plan.events[i].durSec)
      expect(folded.events[i].timbreId).toBe(plan.events[i].timbreId)
      expect(folded.events[i].gain).toBe(plan.events[i].gain)
    }
  })

  it('不修改输入', () => {
    const plan = planOf(18)
    const before = plan.events[0].freqHz
    foldPlanToRange(plan, 36, 96)
    expect(plan.events[0].freqHz).toBe(before)
  })

  it('区间窄于一个八度时抛错（否则可能无解）', () => {
    expect(() => foldPlanToRange(planOf(60), 60, 70)).toThrow()
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/music/onsetsToNotes.test.ts src/music/foldPlanToRange.test.ts`
Expected: FAIL —— `onsetsToNotes`、`ACCENT_OFF_FACTOR`、`freqToMidi`、`foldPlanToRange` 不是导出成员

- [ ] **Step 3: 写实现**

`src/music/rhythm.ts` 顶部补 import（若已有从 `./playback` 的 import 则合并）：

```ts
import type { NoteSpec } from './playback'
```

`src/music/rhythm.ts` 末尾追加：

```ts
/** 非重音相对重音的力度系数（P-2b spec D9） */
export const ACCENT_OFF_FACTOR = 0.75

/**
 * TimedOnset → NoteSpec 的桥接（FWD-2）。
 *
 * 合成规则：gain = velocity × (accent ? 1 : ACCENT_OFF_FACTOR)。
 * 力度变异轴只决定 velocity，accent 只决定相对系数——两者不再争同一个字段。
 */
export function onsetsToNotes(
  onsets: readonly TimedOnset[],
  midi: number,
  velocity: number,
): NoteSpec[] {
  return onsets.map((o) => ({
    midi,
    atSec: o.atSec,
    durSec: o.durSec,
    gain: velocity * (o.accent ? 1 : ACCENT_OFF_FACTOR),
  }))
}
```

`src/music/pitch.ts` 末尾追加：

```ts
/** midiToFreq 的反函数，结果为浮点 MIDI 号 */
export function freqToMidi(freqHz: number): number {
  return 69 + 12 * Math.log2(freqHz / 440)
}
```

`src/music/register.ts` 顶部补 import：

```ts
import { freqToMidi } from './pitch'
import type { PlaybackPlan } from './playback'
```

`src/music/register.ts` 末尾追加：

```ts
const FOLD_EPSILON = 1e-9

/**
 * 整份 plan 的八度折叠（FWD-4）：越界事件按八度挪回 [loMidi, hiMidi]。
 *
 * 只动频率，不动时刻、时值、音色与 gain。挪八度保留音级身份，
 * 对练耳题的语义无损；比直接丢弃或钳成同一音高安全。
 */
export function foldPlanToRange(
  plan: PlaybackPlan,
  loMidi: number,
  hiMidi: number,
): PlaybackPlan {
  if (hiMidi - loMidi < 12) {
    throw new Error(`折叠区间必须至少一个八度，收到 ${loMidi}–${hiMidi}`)
  }
  const events = plan.events.map((e) => {
    let freqHz = e.freqHz
    let midi = freqToMidi(freqHz)
    while (midi < loMidi - FOLD_EPSILON) {
      freqHz *= 2
      midi += 12
    }
    while (midi > hiMidi + FOLD_EPSILON) {
      freqHz /= 2
      midi -= 12
    }
    return freqHz === e.freqHz ? e : { ...e, freqHz }
  })
  return { events, totalDurSec: plan.totalDurSec }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/music/`
Expected: PASS（含既有 music 测试）

- [ ] **Step 5: 提交**

```bash
git add src/music/
git commit -m "feat(music): 力度桥接 onsetsToNotes（FWD-2）与音区八度折叠（FWD-4）" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 共享类型与 `difficultyStep` 映射表

**Files:**
- Create: `src/exercises/types.ts`
- Create: `src/exercises/difficulty.ts`
- Test: `src/exercises/difficulty.test.ts`

**Interfaces:**
- Consumes: `ExerciseSpec`（scheduling/exerciseSpec）、`Curriculum`（curriculum/curriculum）、`Key`/`ScaleDegree`/`Mode`（music/key）、`PlaybackPlan`/`NoteSpec`/`TimbreId`（music/playback）、`Rng`（music/rng）、`Modality`（curriculum/knowledgePoints）
- Produces（`types.ts`）：`AnswerOption`、`PitchTarget`、`AnswerFormat`、`Answer`、`Response`、`ResolvedVariation`、`FeedbackPlan`、`PromptId`、`Exercise`、`GradeResult`、`GeneratorInput`、`ContentResult`、`Generator`、`GeneratorEntry`
- Produces（`difficulty.ts`）：
  - `export const DIFFICULTY_TABLE`（见下）
  - `export interface DifficultyParams { recognizeOptionCount; recognizeNoteSec; notateMelodyLength; notateChordCount; notateRhythmBars; singTargetCount; tapToleranceSec; tapBars }`（全部 `number`）
  - `export function clampDifficultyStep(step: number): number`
  - `export function difficultyParams(step: number): DifficultyParams`
  - `export const SING_CENTS_TOLERANCE = 50`
  - `export const SLOW_FACTOR = 0.6`
  - `export const BASE_BPM = 90`

- [ ] **Step 1: 写类型文件**（纯类型，无需先写测试；Step 2 的测试会通过 import 编译它）

`src/exercises/types.ts`：

```ts
import type { Curriculum } from '../curriculum/curriculum'
import type { Modality } from '../curriculum/knowledgePoints'
import type { Key, Mode, ScaleDegree } from '../music/key'
import type { NoteSpec, PlaybackPlan, TimbreId } from '../music/playback'
import type { Rng } from '../music/rng'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'

/** 选项。id 是语义 id（'re'、'V'、'q-ee-q-q'、'shift'），显示文案由显示层换皮 */
export interface AnswerOption {
  id: string
}

export interface PitchTarget {
  degree: ScaleDegree
  midi: number
  freqHz: number
  /** 主 spec §9：±50 音分 */
  centsTolerance: number
}

export type AnswerFormat =
  | { kind: 'choice'; options: AnswerOption[] }
  | { kind: 'sequence'; length: number; alphabet: AnswerOption[] }
  | { kind: 'pitch'; targets: PitchTarget[] }
  | { kind: 'tap'; onsetsSec: number[]; toleranceSec: number }

export type Answer =
  | { kind: 'choice'; id: string }
  | { kind: 'sequence'; ids: string[] }
  | { kind: 'pitch'; targets: PitchTarget[] }
  | { kind: 'tap'; onsetsSec: number[] }

export type Response =
  | { kind: 'choice'; id: string }
  | { kind: 'sequence'; ids: string[] }
  /** P-2b / P-3：自评。P-4 增加检测结果分支 */
  | { kind: 'pitch'; selfAssessedCorrect: boolean }
  | { kind: 'tap'; tapsSec: number[] }

export interface ResolvedVariation {
  key: Key
  timbreId: TimbreId
  centerMidi: number
  bpm: number
  velocity: number
  presentation: 'block' | 'arpeggio'
}

export interface FeedbackPlan {
  /** 主 spec §6.4 第 1 条：锚点（主音 / 节拍器）→ 题目内容 */
  replay: PlaybackPlan
  /** 主 spec §6.4 第 3 条：同一内容按 SLOW_FACTOR 放慢 */
  slow: PlaybackPlan
}

export type PromptId =
  | 'which-degree' | 'sing-degrees' | 'notate-melody'
  | 'did-it-modulate' | 'sing-new-tonic' | 'new-tonic-degree'
  | 'which-quality' | 'which-chord' | 'sing-arpeggio' | 'notate-chords'
  | 'which-progression' | 'sing-bassline' | 'notate-progression'
  | 'which-inversion' | 'which-bass-contour' | 'notate-bassline'
  | 'which-pattern' | 'tap-pattern' | 'notate-patterns'
  | 'which-meter' | 'tap-downbeats' | 'which-onset-is-beat-one'
  | 'which-pickup' | 'which-meter-sequence' | 'notate-meters'

export interface Exercise {
  spec: ExerciseSpec
  resolved: ResolvedVariation
  /** 语境 + 题目内容，可直接交给 AudioEngine */
  plan: PlaybackPlan
  /** 题目内容在 plan 中的起点 */
  contentStartSec: number
  prompt: PromptId
  format: AnswerFormat
  answer: Answer
  feedback: FeedbackPlan
}

export interface GradeResult {
  correct: boolean
  detail:
    | { kind: 'choice' }
    | { kind: 'sequence'; positions: boolean[] }
    | { kind: 'pitch' }
    | { kind: 'tap'; offsetsSec: number[] }
}

export interface GeneratorInput {
  spec: ExerciseSpec
  curriculum: Curriculum
  resolved: ResolvedVariation
  /** doMidiForKey(resolved.key, resolved.centerMidi) */
  doMidi: number
  rng: Rng
}

/** 管线第 2 步的产出。时刻全部相对题目内容起点（0） */
export interface ContentResult {
  /** 题目里实际播放的内容（唱模态可为空） */
  notes: NoteSpec[]
  /** 反馈重放用的内容（唱模态为目标音，其余与 notes 相同） */
  feedbackNotes: NoteSpec[]
  /** 题目内容时长，供语境伸缩（L2/L4 的持续低音要覆盖它） */
  durSec: number
  prompt: PromptId
  format: AnswerFormat
  answer: Answer
}

export type Generator = (input: GeneratorInput) => ContentResult

export interface GeneratorEntry {
  mode: Mode
  byModality: Record<Modality, Generator>
}
```

- [ ] **Step 2: 写失败的测试**

`src/exercises/difficulty.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  BASE_BPM,
  DIFFICULTY_TABLE,
  SING_CENTS_TOLERANCE,
  SLOW_FACTOR,
  clampDifficultyStep,
  difficultyParams,
} from './difficulty'
import type { Exercise } from './types'

describe('DIFFICULTY_TABLE（P-2b spec §6）', () => {
  it('每一行恰好 6 档', () => {
    for (const row of Object.values(DIFFICULTY_TABLE)) {
      expect(row).toHaveLength(6)
    }
  })

  it('数值与 spec 表一致', () => {
    expect(DIFFICULTY_TABLE.recognizeOptionCount).toEqual([2, 3, 4, 5, 6, Infinity])
    expect(DIFFICULTY_TABLE.recognizeNoteSec).toEqual([1.0, 0.9, 0.8, 0.7, 0.6, 0.5])
    expect(DIFFICULTY_TABLE.notateMelodyLength).toEqual([3, 4, 5, 6, 7, 8])
    expect(DIFFICULTY_TABLE.notateChordCount).toEqual([2, 3, 3, 4, 4, 5])
    expect(DIFFICULTY_TABLE.notateRhythmBars).toEqual([1, 1, 2, 2, 2, 4])
    expect(DIFFICULTY_TABLE.singTargetCount).toEqual([1, 1, 2, 2, 3, 3])
    expect(DIFFICULTY_TABLE.tapToleranceSec).toEqual([0.12, 0.11, 0.1, 0.08, 0.07, 0.06])
    expect(DIFFICULTY_TABLE.tapBars).toEqual([1, 1, 1, 2, 2, 2])
  })

  it('越难越难：选项不减、时长不增、长度不减、容差不增', () => {
    const nonDecreasing = (xs: readonly number[]) => xs.every((x, i) => i === 0 || x >= xs[i - 1])
    const nonIncreasing = (xs: readonly number[]) => xs.every((x, i) => i === 0 || x <= xs[i - 1])
    expect(nonDecreasing(DIFFICULTY_TABLE.recognizeOptionCount)).toBe(true)
    expect(nonIncreasing(DIFFICULTY_TABLE.recognizeNoteSec)).toBe(true)
    expect(nonDecreasing(DIFFICULTY_TABLE.notateMelodyLength)).toBe(true)
    expect(nonDecreasing(DIFFICULTY_TABLE.singTargetCount)).toBe(true)
    expect(nonIncreasing(DIFFICULTY_TABLE.tapToleranceSec)).toBe(true)
  })
})

describe('clampDifficultyStep / difficultyParams', () => {
  it('越界档位钳到 0–5，小数四舍五入', () => {
    expect(clampDifficultyStep(-3)).toBe(0)
    expect(clampDifficultyStep(9)).toBe(5)
    expect(clampDifficultyStep(2.4)).toBe(2)
    expect(clampDifficultyStep(2.6)).toBe(3)
  })

  it('按档位取出同一列', () => {
    const p = difficultyParams(3)
    expect(p.recognizeOptionCount).toBe(5)
    expect(p.notateMelodyLength).toBe(6)
    expect(p.singTargetCount).toBe(2)
    expect(p.tapToleranceSec).toBe(0.08)
  })

  it('越界档位与钳制后的档位取值相同', () => {
    expect(difficultyParams(42)).toEqual(difficultyParams(5))
    expect(difficultyParams(-1)).toEqual(difficultyParams(0))
  })
})

describe('常量', () => {
  it('与 spec 一致', () => {
    expect(SING_CENTS_TOLERANCE).toBe(50)
    expect(SLOW_FACTOR).toBe(0.6)
    expect(BASE_BPM).toBe(90)
  })

  it('types.ts 可被编译期引用', () => {
    const shape: Pick<Exercise, 'prompt'> = { prompt: 'which-degree' }
    expect(shape.prompt).toBe('which-degree')
  })
})
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `npx vitest run src/exercises/difficulty.test.ts`
Expected: FAIL —— 无法解析模块 `./difficulty`

- [ ] **Step 4: 写实现**

`src/exercises/difficulty.ts`：

```ts
/**
 * difficultyStep（快机制，0 最易、5 最难）→ 题内参数（P-2b spec §6）。
 *
 * 只调单题内参数，不碰语境强度与变异轴——那是慢机制的职责（主 spec §7.4.1）。
 */
export const DIFFICULTY_TABLE = {
  /** 听辨选项个数。Infinity = 池里全部；实际个数另受池大小限制，至少 2 */
  recognizeOptionCount: [2, 3, 4, 5, 6, Infinity],
  /** 听辨目标音 / 和弦时长（秒），以 BASE_BPM 为基准，随速度缩放 */
  recognizeNoteSec: [1.0, 0.9, 0.8, 0.7, 0.6, 0.5],
  /** T 轨听写旋律音数（主 spec §6.3：3–8 音） */
  notateMelodyLength: [3, 4, 5, 6, 7, 8],
  /** H 轨听写和弦个数 */
  notateChordCount: [2, 3, 3, 4, 4, 5],
  /** R 轨听写小节数 */
  notateRhythmBars: [1, 1, 2, 2, 2, 4],
  /** T/H 唱模态目标音个数 */
  singTargetCount: [1, 1, 2, 2, 3, 3],
  /** R 轨打拍容差（秒） */
  tapToleranceSec: [0.12, 0.11, 0.1, 0.08, 0.07, 0.06],
  /** R 轨打拍小节数 */
  tapBars: [1, 1, 1, 2, 2, 2],
} as const satisfies Record<string, readonly number[]>

export type DifficultyParams = { [K in keyof typeof DIFFICULTY_TABLE]: number }

export const MIN_DIFFICULTY_STEP = 0
export const MAX_DIFFICULTY_STEP = 5

/** 唱模态音高容差（音分），固定不随档位变（主 spec §9） */
export const SING_CENTS_TOLERANCE = 50

/** 慢速反馈：bpm × SLOW_FACTOR，时值 ÷ SLOW_FACTOR（P-2b spec §6） */
export const SLOW_FACTOR = 0.6

/** recognizeNoteSec 的速度基准 */
export const BASE_BPM = 90

export function clampDifficultyStep(step: number): number {
  return Math.min(MAX_DIFFICULTY_STEP, Math.max(MIN_DIFFICULTY_STEP, Math.round(step)))
}

export function difficultyParams(step: number): DifficultyParams {
  const i = clampDifficultyStep(step)
  const out = {} as DifficultyParams
  for (const name of Object.keys(DIFFICULTY_TABLE) as (keyof typeof DIFFICULTY_TABLE)[]) {
    out[name] = DIFFICULTY_TABLE[name][i]
  }
  return out
}
```

- [ ] **Step 5: 运行测试与类型检查，确认通过**

Run: `npx vitest run src/exercises/difficulty.test.ts && npx tsc --noEmit`
Expected: PASS，tsc 无输出

- [ ] **Step 6: 提交**

```bash
git add src/exercises/
git commit -m "feat(exercises): 共享类型与 difficultyStep 映射表" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 变异轴解析

**Files:**
- Create: `src/exercises/variation.ts`
- Test: `src/exercises/variation.test.ts`

**Interfaces:**
- Consumes: `ResolvedVariation`（Task 2）、`Rng`/`makeRng`（music/rng）、`Mode`/`Key`（music/key）、`TimbreId`（music/playback）
- Produces:
  - `export const TIMBRES: readonly TimbreId[]`（`['piano','strings','voice','electronic']`）
  - 常量 `DEFAULT_CENTER_MIDI = 60`、`REGISTER_MIN = 48`、`REGISTER_MAX = 72`、`DEFAULT_BPM = 90`、`BPM_MIN = 70`、`BPM_MAX = 110`、`DEFAULT_VELOCITY = 0.8`、`VELOCITY_MIN = 0.6`、`VELOCITY_MAX = 1.0`
  - `export function defaultKey(mode: Mode): Key`（大调 C，小调 a：`{ tonic: 9, mode: 'minor' }`）
  - `export function resolveVariation(variationLevel: number, mode: Mode, rng: Rng): ResolvedVariation`

- [ ] **Step 1: 写失败的测试**

`src/exercises/variation.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { makeRng } from '../music/rng'
import {
  BPM_MAX,
  BPM_MIN,
  DEFAULT_BPM,
  DEFAULT_CENTER_MIDI,
  DEFAULT_VELOCITY,
  REGISTER_MAX,
  REGISTER_MIN,
  TIMBRES,
  VELOCITY_MAX,
  VELOCITY_MIN,
  defaultKey,
  resolveVariation,
} from './variation'
import type { ResolvedVariation } from './types'

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1)

function varies(level: number, pick: (v: ResolvedVariation) => unknown): boolean {
  const values = SEEDS.map((s) => JSON.stringify(pick(resolveVariation(level, 'major', makeRng(s)))))
  return new Set(values).size > 1
}

const AXES: [string, (v: ResolvedVariation) => unknown][] = [
  ['调', (v) => v.key],
  ['音色', (v) => v.timbreId],
  ['音区', (v) => v.centerMidi],
  ['速度', (v) => v.bpm],
  ['力度', (v) => v.velocity],
  ['呈现方式', (v) => v.presentation],
]

describe('resolveVariation：按主 spec §6.2 的固定顺序逐轴开放', () => {
  for (let level = 0; level <= 6; level++) {
    it(`variationLevel=${level} 时恰好前 ${level} 条轴会变`, () => {
      const pattern = AXES.map(([, pick]) => varies(level, pick))
      expect(pattern).toEqual(AXES.map((_, i) => i < level))
    })
  }

  it('level 0 全部取默认值，且不消耗 rng', () => {
    const rng = makeRng(7)
    const v = resolveVariation(0, 'major', rng)
    expect(v).toEqual({
      key: { tonic: 0, mode: 'major' },
      timbreId: 'piano',
      centerMidi: DEFAULT_CENTER_MIDI,
      bpm: DEFAULT_BPM,
      velocity: DEFAULT_VELOCITY,
      presentation: 'block',
    })
    expect(rng.next()).toBe(makeRng(7).next())
  })

  it('调式由知识点决定，永不随机', () => {
    for (const s of SEEDS) {
      expect(resolveVariation(6, 'minor', makeRng(s)).key.mode).toBe('minor')
      expect(resolveVariation(6, 'major', makeRng(s)).key.mode).toBe('major')
    }
  })

  it('默认调：大调 C、小调 a', () => {
    expect(defaultKey('major')).toEqual({ tonic: 0, mode: 'major' })
    expect(defaultKey('minor')).toEqual({ tonic: 9, mode: 'minor' })
    expect(resolveVariation(0, 'minor', makeRng(1)).key).toEqual({ tonic: 9, mode: 'minor' })
  })

  it('开放后的取值落在 spec 规定的范围内（音区 48–72，P-2b spec D6）', () => {
    for (const s of SEEDS) {
      const v = resolveVariation(6, 'major', makeRng(s))
      expect(Number.isInteger(v.key.tonic)).toBe(true)
      expect(v.key.tonic).toBeGreaterThanOrEqual(0)
      expect(v.key.tonic).toBeLessThan(12)
      expect(TIMBRES).toContain(v.timbreId)
      expect(Number.isInteger(v.centerMidi)).toBe(true)
      expect(v.centerMidi).toBeGreaterThanOrEqual(REGISTER_MIN)
      expect(v.centerMidi).toBeLessThanOrEqual(REGISTER_MAX)
      expect(Number.isInteger(v.bpm)).toBe(true)
      expect(v.bpm).toBeGreaterThanOrEqual(BPM_MIN)
      expect(v.bpm).toBeLessThanOrEqual(BPM_MAX)
      expect(v.velocity).toBeGreaterThanOrEqual(VELOCITY_MIN)
      expect(v.velocity).toBeLessThanOrEqual(VELOCITY_MAX)
      expect(['block', 'arpeggio']).toContain(v.presentation)
    }
  })

  it('同一 seed 结果相同', () => {
    expect(resolveVariation(6, 'major', makeRng(99))).toEqual(
      resolveVariation(6, 'major', makeRng(99)),
    )
  })

  it('四种音色都会出现', () => {
    const seen = new Set(SEEDS.map((s) => resolveVariation(2, 'major', makeRng(s)).timbreId))
    expect(seen.size).toBe(4)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/variation.test.ts`
Expected: FAIL —— 无法解析模块 `./variation`

- [ ] **Step 3: 写实现**

`src/exercises/variation.ts`：

```ts
import type { Key, Mode } from '../music/key'
import type { TimbreId } from '../music/playback'
import type { Rng } from '../music/rng'
import type { ResolvedVariation } from './types'

export const TIMBRES: readonly TimbreId[] = ['piano', 'strings', 'voice', 'electronic']
export const DEFAULT_TIMBRE: TimbreId = 'piano'

export const DEFAULT_CENTER_MIDI = 60
/** 音区中心随机范围：中心 ±1 个八度（P-2b spec D6，FWD-4 第一层） */
export const REGISTER_MIN = 48
export const REGISTER_MAX = 72

export const DEFAULT_BPM = 90
export const BPM_MIN = 70
export const BPM_MAX = 110

export const DEFAULT_VELOCITY = 0.8
export const VELOCITY_MIN = 0.6
export const VELOCITY_MAX = 1.0

const PRESENTATIONS = ['block', 'arpeggio'] as const

/** 未开放调轴时的默认调：大调 C，小调 a（la 基唱名下 do 仍是 C） */
export function defaultKey(mode: Mode): Key {
  return mode === 'major' ? { tonic: 0, mode } : { tonic: 9, mode }
}

/**
 * 管线第 1 步：按 variationLevel 决定每条轴取默认值还是从 rng 抽取。
 *
 * 开放顺序固定（主 spec §6.2）：1 调、2 音色、3 音区、4 速度、5 力度、6 呈现方式。
 * 未开放的轴不消耗 rng——这样提升 variationLevel 不会改变已开放轴的取值序列之外的东西，
 * 且 level 0 的题完全不依赖 seed 的这一段。
 */
export function resolveVariation(
  variationLevel: number,
  mode: Mode,
  rng: Rng,
): ResolvedVariation {
  const open = (axis: number): boolean => variationLevel >= axis

  const key: Key = open(1) ? { tonic: rng.int(12), mode } : defaultKey(mode)
  const timbreId = open(2) ? rng.pick(TIMBRES) : DEFAULT_TIMBRE
  const centerMidi = open(3)
    ? REGISTER_MIN + rng.int(REGISTER_MAX - REGISTER_MIN + 1)
    : DEFAULT_CENTER_MIDI
  const bpm = open(4) ? BPM_MIN + rng.int(BPM_MAX - BPM_MIN + 1) : DEFAULT_BPM
  const velocity = open(5)
    ? VELOCITY_MIN + rng.next() * (VELOCITY_MAX - VELOCITY_MIN)
    : DEFAULT_VELOCITY
  const presentation = open(6) ? rng.pick(PRESENTATIONS) : 'block'

  return { key, timbreId, centerMidi, bpm, velocity, presentation }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/exercises/variation.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/exercises/variation.ts src/exercises/variation.test.ts
git commit -m "feat(exercises): 变异轴按固定顺序逐轴开放" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: T 轨数据表与覆盖测试

**Files:**
- Create: `src/exercises/data/degrees.ts`
- Test: `src/exercises/data/degrees.test.ts`

**Interfaces:**
- Consumes: `KnowledgePointId`/`makeKpId`（curriculum/knowledgePoints）、`Mode`/`ScaleDegree`（music/key）、`buildCurriculum`（测试用）
- Produces:
  - `export type DegreePool = 'major' | 'minor' | 'modulation'`
  - `export interface DegreeEntry { kpId: KnowledgePointId; mode: Mode; degree: ScaleDegree; pool: DegreePool }`
  - `export const DEGREE_ENTRIES: readonly DegreeEntry[]`
  - `export function degreeEntry(kpId: KnowledgePointId): DegreeEntry | undefined`
  - `export function requireDegreeEntry(kpId: KnowledgePointId): DegreeEntry`（缺行抛错）

- [ ] **Step 1: 写失败的测试**

`src/exercises/data/degrees.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../../curriculum/curriculum'
import { DEGREE_SEMITONES } from '../../music/key'
import { DEGREE_ENTRIES, degreeEntry, requireDegreeEntry } from './degrees'

const c = buildCurriculum()
const T_KPS = [...c.knowledgePoints.values()].filter((kp) => kp.track === 'T').map((kp) => kp.id)

describe('T 轨数据表覆盖（P-2b spec §11 第 5 条）', () => {
  it('课程里每个 T 轨知识点恰好有一行，且没有多余的行', () => {
    expect(DEGREE_ENTRIES.map((e) => e.kpId).sort()).toEqual([...T_KPS].sort())
  })

  it('kpId 不重复', () => {
    const ids = DEGREE_ENTRIES.map((e) => e.kpId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('T 轨共 20 个知识点', () => {
    expect(DEGREE_ENTRIES).toHaveLength(20)
  })
})

describe('音乐含义', () => {
  it('大调骨架与小调骨架', () => {
    expect(requireDegreeEntry('degree:major:sol')).toMatchObject({ mode: 'major', degree: 'sol', pool: 'major' })
    expect(requireDegreeEntry('degree:minor:la')).toMatchObject({ mode: 'minor', degree: 'la', pool: 'minor' })
  })

  it('小调升 7 级映射到 le（半音 8，la 基导音），显示成 si 是显示层的事', () => {
    const e = requireDegreeEntry('degree:minor:si')
    expect(e.degree).toBe('le')
    expect(DEGREE_SEMITONES[e.degree]).toBe(8)
  })

  it('小调升 6 级映射到 fi（半音 6）', () => {
    expect(requireDegreeEntry('degree:minor:fi').degree).toBe('fi')
  })

  it('大调变化音 fi / te / me 属于大调池', () => {
    for (const name of ['fi', 'te', 'me'] as const) {
      expect(requireDegreeEntry(`degree:major:${name}`)).toMatchObject({ mode: 'major', degree: name, pool: 'major' })
    }
  })

  it('转调点自成一池，按大调处理', () => {
    expect(requireDegreeEntry('degree:modulation:shift')).toMatchObject({ mode: 'major', pool: 'modulation' })
  })

  it('同一池内音级不重复（否则选项 id 会撞）', () => {
    for (const pool of ['major', 'minor'] as const) {
      const degrees = DEGREE_ENTRIES.filter((e) => e.pool === pool).map((e) => e.degree)
      expect(new Set(degrees).size).toBe(degrees.length)
    }
  })
})

describe('查找', () => {
  it('未知 kpId：degreeEntry 返回 undefined，requireDegreeEntry 抛错', () => {
    expect(degreeEntry('chord:I')).toBeUndefined()
    expect(() => requireDegreeEntry('degree:major:nope')).toThrow(/degree:major:nope/)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/data/degrees.test.ts`
Expected: FAIL —— 无法解析模块 `./degrees`

- [ ] **Step 3: 写实现**

`src/exercises/data/degrees.ts`：

```ts
import { makeKpId, type KnowledgePointId } from '../../curriculum/knowledgePoints'
import type { Mode, ScaleDegree } from '../../music/key'

export type DegreePool = 'major' | 'minor' | 'modulation'

export interface DegreeEntry {
  kpId: KnowledgePointId
  mode: Mode
  /** 枚举里的稳定音级名（主 spec §4）。显示层的语境拼写见主 spec §15.1 */
  degree: ScaleDegree
  pool: DegreePool
}

const row = (name: string, mode: Mode, degree: ScaleDegree, pool: DegreePool): DegreeEntry => ({
  kpId: makeKpId('degree', name),
  mode,
  degree,
  pool,
})

/** T 轨知识点的音乐含义（P-2b spec §7.2）。增加知识点 = 加一行 */
export const DEGREE_ENTRIES: readonly DegreeEntry[] = [
  row('major:do', 'major', 'do', 'major'),
  row('major:mi', 'major', 'mi', 'major'),
  row('major:sol', 'major', 'sol', 'major'),
  row('major:re', 'major', 're', 'major'),
  row('major:la', 'major', 'la', 'major'),
  row('major:fa', 'major', 'fa', 'major'),
  row('major:ti', 'major', 'ti', 'major'),
  row('major:fi', 'major', 'fi', 'major'),
  row('major:te', 'major', 'te', 'major'),
  row('major:me', 'major', 'me', 'major'),
  row('minor:la', 'minor', 'la', 'minor'),
  row('minor:do', 'minor', 'do', 'minor'),
  row('minor:mi', 'minor', 'mi', 'minor'),
  row('minor:ti', 'minor', 'ti', 'minor'),
  row('minor:re', 'minor', 're', 'minor'),
  row('minor:fa', 'minor', 'fa', 'minor'),
  row('minor:sol', 'minor', 'sol', 'minor'),
  // 和声小调导音：半音 8。枚举统一叫 le，显示成 si 归显示层（主 spec §15.1）
  row('minor:si', 'minor', 'le', 'minor'),
  // 旋律小调升 6：半音 6
  row('minor:fi', 'minor', 'fi', 'minor'),
  row('modulation:shift', 'major', 'do', 'modulation'),
]

const BY_ID = new Map(DEGREE_ENTRIES.map((e) => [e.kpId, e]))

export function degreeEntry(kpId: KnowledgePointId): DegreeEntry | undefined {
  return BY_ID.get(kpId)
}

export function requireDegreeEntry(kpId: KnowledgePointId): DegreeEntry {
  const e = BY_ID.get(kpId)
  if (!e) throw new Error(`T 轨数据表没有知识点 ${kpId}`)
  return e
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/exercises/data/degrees.test.ts`
Expected: PASS。若覆盖测试失败，先核对 `src/curriculum/tracks.ts` 的 T 轨知识点名，修数据表，不改测试。

- [ ] **Step 5: 提交**

```bash
git add src/exercises/data/
git commit -m "feat(exercises): T 轨知识点数据表与覆盖测试" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 干扰池与选项抽取

**Files:**
- Create: `src/exercises/pools.ts`
- Test: `src/exercises/pools.test.ts`

**Interfaces:**
- Consumes: `Curriculum`、`stageOrderIndex`（curriculum/validate）、`ALL_STAGES`/`Stage`（curriculum/stages）、`Rng`、`degreeEntry`（Task 4，仅测试用）
- Produces:
  - `export function shuffle<T>(items: readonly T[], rng: Rng): T[]`
  - `export function stageOfKnowledgePoint(kpId: KnowledgePointId): Stage`（未被任何级引入则抛错）
  - `export function poolMembers(c: Curriculum, targetKpId: KnowledgePointId, poolOf: (kpId: KnowledgePointId) => string | undefined): KnowledgePointId[]` —— 与目标同池、所在级的课程顺序不晚于目标所在级的知识点，按 `stageOrderIndex` 升序（同级保持课程数据顺序），含目标本身；目标不属于任何池时抛错
  - `export function pickOptions(targetId: string, candidates: readonly string[], count: number, rng: Rng): string[]` —— 含目标、去重、个数 = `clamp(count, 2, 去重后候选数含目标)`、整体打乱

- [ ] **Step 1: 写失败的测试**

`src/exercises/pools.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { makeRng } from '../music/rng'
import { degreeEntry } from './data/degrees'
import { pickOptions, poolMembers, shuffle, stageOfKnowledgePoint } from './pools'

const c = buildCurriculum()
const degreePool = (id: string) => degreeEntry(id)?.pool
const names = (ids: string[]) => ids.map((id) => id.replace('degree:', '')).sort()

describe('stageOfKnowledgePoint', () => {
  it('返回引入该知识点的级', () => {
    expect(stageOfKnowledgePoint('degree:major:re').id).toBe('T2')
    expect(stageOfKnowledgePoint('degree:minor:si').id).toBe('T6')
  })

  it('未被引入的知识点抛错', () => {
    expect(() => stageOfKnowledgePoint('degree:major:nope')).toThrow(/degree:major:nope/)
  })
})

describe('poolMembers：干扰池由课程静态推导（P-2b spec D2）', () => {
  it('T1 的 do：只有 T1 的三个骨架音', () => {
    expect(names(poolMembers(c, 'degree:major:do', degreePool))).toEqual(
      ['major:do', 'major:mi', 'major:sol'],
    )
  })

  it('T2 的 re：T1 + T2，不含后面才学的 fa ti', () => {
    expect(names(poolMembers(c, 'degree:major:re', degreePool))).toEqual(
      ['major:do', 'major:la', 'major:mi', 'major:re', 'major:sol'],
    )
  })

  it('T7 的 fi：大调全部，不含小调', () => {
    const pool = names(poolMembers(c, 'degree:major:fi', degreePool))
    expect(pool).toHaveLength(10)
    expect(pool.every((n) => n.startsWith('major:'))).toBe(true)
  })

  it('T6 的 si：小调全部 9 个（同级的 fi 也在）', () => {
    expect(poolMembers(c, 'degree:minor:si', degreePool)).toHaveLength(9)
  })

  it('按课程顺序排列，含目标本身', () => {
    const pool = poolMembers(c, 'degree:major:ti', degreePool)
    expect(pool).toContain('degree:major:ti')
    expect(pool.slice(0, 3).sort()).toEqual(['degree:major:do', 'degree:major:mi', 'degree:major:sol'])
  })

  it('目标不属于任何池时抛错', () => {
    expect(() => poolMembers(c, 'chord:I', degreePool)).toThrow(/chord:I/)
  })
})

describe('shuffle', () => {
  it('是原数组的一个排列，且不修改输入', () => {
    const xs = [1, 2, 3, 4, 5, 6]
    const out = shuffle(xs, makeRng(3))
    expect([...out].sort()).toEqual(xs)
    expect(xs).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('不同 seed 至少产生两种排列', () => {
    const seen = new Set(
      Array.from({ length: 20 }, (_, s) => shuffle([1, 2, 3, 4], makeRng(s + 1)).join()),
    )
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('pickOptions', () => {
  const pool = ['do', 'mi', 'sol', 're', 'la']

  it('含目标、去重、个数正确', () => {
    for (let s = 1; s <= 30; s++) {
      const opts = pickOptions('re', pool, 3, makeRng(s))
      expect(opts).toHaveLength(3)
      expect(opts).toContain('re')
      expect(new Set(opts).size).toBe(3)
      expect(opts.every((o) => pool.includes(o))).toBe(true)
    }
  })

  it('个数少于 2 时按 2 算；超过池大小时取全部', () => {
    expect(pickOptions('re', pool, 1, makeRng(1))).toHaveLength(2)
    expect(pickOptions('re', pool, Infinity, makeRng(1)).sort()).toEqual([...pool].sort())
  })

  it('候选里有重复或不含目标时仍正确', () => {
    const opts = pickOptions('ti', ['do', 'do', 'mi'], 10, makeRng(1))
    expect(opts.sort()).toEqual(['do', 'mi', 'ti'])
  })

  it('目标不总在第一位', () => {
    const firsts = new Set(
      Array.from({ length: 30 }, (_, s) => pickOptions('re', pool, 4, makeRng(s + 1))[0]),
    )
    expect(firsts.size).toBeGreaterThan(1)
  })

  it('确定性', () => {
    expect(pickOptions('re', pool, 4, makeRng(8))).toEqual(pickOptions('re', pool, 4, makeRng(8)))
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/pools.test.ts`
Expected: FAIL —— 无法解析模块 `./pools`

- [ ] **Step 3: 写实现**

`src/exercises/pools.ts`：

```ts
import type { Curriculum } from '../curriculum/curriculum'
import type { KnowledgePointId } from '../curriculum/knowledgePoints'
import { ALL_STAGES, type Stage } from '../curriculum/stages'
import { stageOrderIndex } from '../curriculum/validate'
import type { Rng } from '../music/rng'

/** Fisher–Yates，返回新数组 */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function stageOfKnowledgePoint(kpId: KnowledgePointId): Stage {
  const stage = ALL_STAGES.find((s) => s.introduces.includes(kpId))
  if (!stage) throw new Error(`知识点 ${kpId} 未被任何级引入`)
  return stage
}

/**
 * 干扰池（P-2b spec §7）：与目标同池、所在级的课程顺序不晚于目标所在级。
 *
 * 只看课程，不看学习者的掌握度 store（D2）——generate 因此保持
 * (spec, curriculum) 的纯函数，重放与重练无需额外状态即可复现。
 */
export function poolMembers(
  c: Curriculum,
  targetKpId: KnowledgePointId,
  poolOf: (kpId: KnowledgePointId) => string | undefined,
): KnowledgePointId[] {
  const pool = poolOf(targetKpId)
  if (pool === undefined) throw new Error(`知识点 ${targetKpId} 不属于任何干扰池`)
  const limit = stageOrderIndex(c, stageOfKnowledgePoint(targetKpId).id)

  const members: { id: KnowledgePointId; order: number }[] = []
  for (const id of c.knowledgePoints.keys()) {
    if (poolOf(id) !== pool) continue
    const order = stageOrderIndex(c, stageOfKnowledgePoint(id).id)
    if (order <= limit) members.push({ id, order })
  }
  // Array.prototype.sort 是稳定排序：同级保持课程数据顺序
  return members.sort((a, b) => a.order - b.order).map((m) => m.id)
}

/**
 * 选项 = 目标 + 从其余候选里抽取的干扰项，整体打乱。
 * 个数至少 2，至多为去重后的候选数（含目标）。
 */
export function pickOptions(
  targetId: string,
  candidates: readonly string[],
  count: number,
  rng: Rng,
): string[] {
  const others = [...new Set(candidates)].filter((id) => id !== targetId)
  const wanted = Math.max(2, count)
  const distractors = shuffle(others, rng).slice(0, Math.min(wanted - 1, others.length))
  return shuffle([targetId, ...distractors], rng)
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/exercises/pools.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/exercises/pools.ts src/exercises/pools.test.ts
git commit -m "feat(exercises): 由课程静态推导的干扰池与选项抽取" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: T/H 轨语境包装与整份 plan 折叠

**Files:**
- Create: `src/exercises/context.ts`
- Test: `src/exercises/context.test.ts`

**Interfaces:**
- Consumes: `buildTonalContext`/`ContextLevel`（music/tonalContext）、`mergePlans`/`notesToPlan`/`PlaybackPlan`/`TimbreId`（music/playback）、`foldPlanToRange`（Task 1）、`freqToMidi`（Task 1，测试用）、`doMidiForKey`（music/register）
- Produces:
  - `export const PLAN_MIDI_MIN = 36`、`export const PLAN_MIDI_MAX = 96`
  - `export function shiftPlan(plan: PlaybackPlan, offsetSec: number): PlaybackPlan`
  - `export function foldToPlanRange(plan: PlaybackPlan): PlaybackPlan`（= `foldPlanToRange(plan, PLAN_MIDI_MIN, PLAN_MIDI_MAX)`）
  - `export interface TonalWrapInput { key: Key; level: ContextLevel; timbreId: TimbreId; doMidi: number; content: PlaybackPlan; contentDurSec: number }`
  - `export function wrapWithTonalContext(input: TonalWrapInput): { plan: PlaybackPlan; contentStartSec: number }`

- [ ] **Step 1: 写失败的测试**

`src/exercises/context.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import type { Key } from '../music/key'
import { freqToMidi } from '../music/pitch'
import { notesToPlan } from '../music/playback'
import { doMidiForKey } from '../music/register'
import { buildTonalContext, type ContextLevel } from '../music/tonalContext'
import {
  PLAN_MIDI_MAX,
  PLAN_MIDI_MIN,
  foldToPlanRange,
  shiftPlan,
  wrapWithTonalContext,
} from './context'

const C: Key = { tonic: 0, mode: 'major' }
const content = notesToPlan([{ midi: 64, atSec: 0, durSec: 0.8 }], 'piano')
const LEVELS: ContextLevel[] = [0, 1, 2, 3, 4]

describe('shiftPlan', () => {
  it('所有事件平移同一偏移，总时长随之增加，不修改输入', () => {
    const shifted = shiftPlan(content, 2)
    expect(shifted.events[0].atSec).toBe(2)
    expect(shifted.totalDurSec).toBeCloseTo(2.8, 12)
    expect(content.events[0].atSec).toBe(0)
  })
})

describe('wrapWithTonalContext', () => {
  for (const level of LEVELS) {
    it(`L${level}：题目内容紧接在 leadInSec 之后`, () => {
      const { plan, contentStartSec } = wrapWithTonalContext({
        key: C, level, timbreId: 'piano', doMidi: 60, content, contentDurSec: 0.8,
      })
      const expected = buildTonalContext({
        key: C, level, timbreId: 'piano', doMidi: 60, itemDurSec: 0.8,
      }).leadInSec
      expect(contentStartSec).toBe(expected)
      const target = plan.events.filter((e) => Math.abs(freqToMidi(e.freqHz) - 64) < 1e-6)
      expect(target.map((e) => e.atSec)).toContain(expected)
      expect(plan.totalDurSec).toBeGreaterThanOrEqual(contentStartSec + 0.8 - 1e-9)
    })
  }

  it('事件按时刻排序', () => {
    const { plan } = wrapWithTonalContext({
      key: C, level: 0, timbreId: 'piano', doMidi: 60, content, contentDurSec: 0.8,
    })
    const times = plan.events.map((e) => e.atSec)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('低音区的持续低音被折叠回 MIDI 36 以上（FWD-4 第二层）', () => {
    const B: Key = { tonic: 11, mode: 'major' }
    const doMidi = doMidiForKey(B, 48)
    for (const level of [2, 3, 4] as ContextLevel[]) {
      const { plan } = wrapWithTonalContext({
        key: B, level, timbreId: 'piano', doMidi, content, contentDurSec: 0.8,
      })
      for (const e of plan.events) {
        expect(freqToMidi(e.freqHz)).toBeGreaterThanOrEqual(PLAN_MIDI_MIN - 1e-6)
        expect(freqToMidi(e.freqHz)).toBeLessThanOrEqual(PLAN_MIDI_MAX + 1e-6)
      }
    }
  })

  it('空内容（唱模态）也能包装，contentStartSec 仍为 leadInSec', () => {
    const { contentStartSec } = wrapWithTonalContext({
      key: C, level: 3, timbreId: 'piano', doMidi: 60,
      content: notesToPlan([], 'piano'), contentDurSec: 2,
    })
    expect(contentStartSec).toBe(
      buildTonalContext({ key: C, level: 3, timbreId: 'piano', doMidi: 60, itemDurSec: 2 }).leadInSec,
    )
  })
})

describe('foldToPlanRange', () => {
  it('区间为 MIDI 36–96', () => {
    expect([PLAN_MIDI_MIN, PLAN_MIDI_MAX]).toEqual([36, 96])
    const folded = foldToPlanRange(notesToPlan([{ midi: 20, atSec: 0, durSec: 1 }], 'piano'))
    expect(freqToMidi(folded.events[0].freqHz)).toBeCloseTo(44, 9)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/context.test.ts`
Expected: FAIL —— 无法解析模块 `./context`

- [ ] **Step 3: 写实现**

`src/exercises/context.ts`：

```ts
import type { Key } from '../music/key'
import { mergePlans, type PlaybackPlan, type TimbreId } from '../music/playback'
import { foldPlanToRange } from '../music/register'
import { buildTonalContext, type ContextLevel } from '../music/tonalContext'

/** 整份 plan 的可听区间（P-2b spec §5，FWD-4 第二层） */
export const PLAN_MIDI_MIN = 36
export const PLAN_MIDI_MAX = 96

export function shiftPlan(plan: PlaybackPlan, offsetSec: number): PlaybackPlan {
  return {
    events: plan.events.map((e) => ({ ...e, atSec: e.atSec + offsetSec })),
    totalDurSec: plan.events.length > 0 ? plan.totalDurSec + offsetSec : 0,
  }
}

export function foldToPlanRange(plan: PlaybackPlan): PlaybackPlan {
  return foldPlanToRange(plan, PLAN_MIDI_MIN, PLAN_MIDI_MAX)
}

export interface TonalWrapInput {
  key: Key
  level: ContextLevel
  timbreId: TimbreId
  doMidi: number
  /** 题目内容，时刻相对 0 */
  content: PlaybackPlan
  /** 题目内容时长——L2/L4 的持续低音要据此伸缩；唱模态内容为空时仍需给出 */
  contentDurSec: number
}

/**
 * 管线第 3 步（T/H 轨）：主 spec §6.1 的调性语境 + 题目内容，最后整份折叠。
 * R 轨的节拍器语境在 P-2b-R 计划中另行实现。
 */
export function wrapWithTonalContext(input: TonalWrapInput): {
  plan: PlaybackPlan
  contentStartSec: number
} {
  const ctx = buildTonalContext({
    key: input.key,
    level: input.level,
    timbreId: input.timbreId,
    doMidi: input.doMidi,
    itemDurSec: input.contentDurSec,
  })
  const merged = mergePlans(ctx.plan, shiftPlan(input.content, ctx.leadInSec))
  return { plan: foldToPlanRange(merged), contentStartSec: ctx.leadInSec }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/exercises/context.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/exercises/context.ts src/exercises/context.test.ts
git commit -m "feat(exercises): T/H 轨语境包装与整份 plan 八度折叠" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 反馈 plan

**Files:**
- Create: `src/exercises/feedback.ts`
- Test: `src/exercises/feedback.test.ts`

**Interfaces:**
- Consumes: `NoteSpec`/`notesToPlan`/`TimbreId`（music/playback）、`SLOW_FACTOR`（Task 2）、`foldToPlanRange`（Task 6）、`FeedbackPlan`（Task 2）
- Produces:
  - `export const FEEDBACK_ANCHOR_SEC = 0.6`、`export const FEEDBACK_GAP_SEC = 0.25`
  - `export function buildFeedback(contentNotes: readonly NoteSpec[], anchorNotes: readonly NoteSpec[], timbreId: TimbreId): FeedbackPlan`

- [ ] **Step 1: 写失败的测试**

`src/exercises/feedback.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { freqToMidi } from '../music/pitch'
import type { NoteSpec } from '../music/playback'
import { SLOW_FACTOR } from './difficulty'
import { FEEDBACK_ANCHOR_SEC, FEEDBACK_GAP_SEC, buildFeedback } from './feedback'

const content: NoteSpec[] = [
  { midi: 64, atSec: 0, durSec: 0.5, gain: 0.8 },
  { midi: 67, atSec: 0.5, durSec: 0.5, gain: 0.8 },
]
const anchor: NoteSpec[] = [{ midi: 60, atSec: 0, durSec: FEEDBACK_ANCHOR_SEC, gain: 0.8 }]

describe('buildFeedback（主 spec §6.4）', () => {
  it('replay：先放锚点，再放内容；内容整体后移「锚点结束 + 间隔」', () => {
    const { replay } = buildFeedback(content, anchor, 'piano')
    expect(replay.events).toHaveLength(3)
    expect(freqToMidi(replay.events[0].freqHz)).toBeCloseTo(60, 9)
    const offset = FEEDBACK_ANCHOR_SEC + FEEDBACK_GAP_SEC
    expect(replay.events[1].atSec).toBeCloseTo(offset, 12)
    expect(replay.events[2].atSec).toBeCloseTo(offset + 0.5, 12)
  })

  it('slow：只含内容，时刻与时值都除以 SLOW_FACTOR', () => {
    const { slow } = buildFeedback(content, anchor, 'piano')
    expect(slow.events).toHaveLength(2)
    expect(slow.events[1].atSec).toBeCloseTo(0.5 / SLOW_FACTOR, 12)
    expect(slow.events[1].durSec).toBeCloseTo(0.5 / SLOW_FACTOR, 12)
    expect(slow.totalDurSec).toBeCloseTo(1 / SLOW_FACTOR, 12)
  })

  it('无锚点时内容不后移', () => {
    const { replay } = buildFeedback(content, [], 'piano')
    expect(replay.events[0].atSec).toBe(0)
  })

  it('越界音高被折叠回 36–96', () => {
    const { replay, slow } = buildFeedback([{ midi: 20, atSec: 0, durSec: 1 }], [], 'piano')
    expect(freqToMidi(replay.events[0].freqHz)).toBeGreaterThanOrEqual(36 - 1e-6)
    expect(freqToMidi(slow.events[0].freqHz)).toBeGreaterThanOrEqual(36 - 1e-6)
  })

  it('使用指定音色', () => {
    const { replay } = buildFeedback(content, anchor, 'strings')
    expect(replay.events.every((e) => e.timbreId === 'strings')).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/feedback.test.ts`
Expected: FAIL —— 无法解析模块 `./feedback`

- [ ] **Step 3: 写实现**

`src/exercises/feedback.ts`：

```ts
import { notesToPlan, type NoteSpec, type TimbreId } from '../music/playback'
import { foldToPlanRange } from './context'
import { SLOW_FACTOR } from './difficulty'
import type { FeedbackPlan } from './types'

/** T/H 轨锚点（主音）时长 */
export const FEEDBACK_ANCHOR_SEC = 0.6
/** 锚点与内容之间的空隙 */
export const FEEDBACK_GAP_SEC = 0.25

function endOf(notes: readonly NoteSpec[]): number {
  return notes.reduce((max, n) => Math.max(max, n.atSec + n.durSec), 0)
}

/**
 * 管线第 4 步（主 spec §6.4）。
 *
 * replay：锚点（T/H 为主音，R 为一小节节拍器）→ 题目内容，「趁错误还在耳朵里时做对比」。
 * slow：同一内容放慢，不含语境与锚点。
 * 「你选的 vs 正确的」标在音阶条上是显示层的事，不在这里产出。
 */
export function buildFeedback(
  contentNotes: readonly NoteSpec[],
  anchorNotes: readonly NoteSpec[],
  timbreId: TimbreId,
): FeedbackPlan {
  const offset = anchorNotes.length > 0 ? endOf(anchorNotes) + FEEDBACK_GAP_SEC : 0
  const replay = notesToPlan(
    [...anchorNotes, ...contentNotes.map((n) => ({ ...n, atSec: n.atSec + offset }))],
    timbreId,
  )
  const slow = notesToPlan(
    contentNotes.map((n) => ({
      ...n,
      atSec: n.atSec / SLOW_FACTOR,
      durSec: n.durSec / SLOW_FACTOR,
    })),
    timbreId,
  )
  return { replay: foldToPlanRange(replay), slow: foldToPlanRange(slow) }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/exercises/feedback.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/exercises/feedback.ts src/exercises/feedback.test.ts
git commit -m "feat(exercises): 重放与慢速反馈 plan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 判定

**Files:**
- Create: `src/exercises/grade.ts`
- Test: `src/exercises/grade.test.ts`

**Interfaces:**
- Consumes: `Exercise`/`Answer`/`AnswerFormat`/`Response`/`GradeResult`（Task 2）
- Produces:
  - `export function grade(exercise: Pick<Exercise, 'format' | 'answer'>, response: Response): GradeResult`
  - `export function answerAsResponse(answer: Answer): Response` —— 把正确答案转成「完美作答」，属性测试与 P-3 的演示模式用

- [ ] **Step 1: 写失败的测试**

`src/exercises/grade.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { answerAsResponse, grade } from './grade'
import type { Exercise } from './types'

type Gradable = Pick<Exercise, 'format' | 'answer'>

const choice: Gradable = {
  format: { kind: 'choice', options: [{ id: 'do' }, { id: 're' }] },
  answer: { kind: 'choice', id: 're' },
}
const sequence: Gradable = {
  format: { kind: 'sequence', length: 3, alphabet: [{ id: 'do' }, { id: 're' }, { id: 'mi' }] },
  answer: { kind: 'sequence', ids: ['do', 'mi', 're'] },
}
const pitch: Gradable = {
  format: { kind: 'pitch', targets: [{ degree: 'do', midi: 60, freqHz: 261.63, centsTolerance: 50 }] },
  answer: { kind: 'pitch', targets: [{ degree: 'do', midi: 60, freqHz: 261.63, centsTolerance: 50 }] },
}
const tap: Gradable = {
  format: { kind: 'tap', onsetsSec: [1, 1.5, 2, 3], toleranceSec: 0.1 },
  answer: { kind: 'tap', onsetsSec: [1, 1.5, 2, 3] },
}

describe('grade：choice', () => {
  it('id 相等即对', () => {
    expect(grade(choice, { kind: 'choice', id: 're' })).toEqual({ correct: true, detail: { kind: 'choice' } })
    expect(grade(choice, { kind: 'choice', id: 'do' }).correct).toBe(false)
  })
})

describe('grade：sequence（整串一致才算对，P-2b spec D5）', () => {
  it('全对', () => {
    expect(grade(sequence, { kind: 'sequence', ids: ['do', 'mi', 're'] })).toEqual({
      correct: true,
      detail: { kind: 'sequence', positions: [true, true, true] },
    })
  })

  it('错一位：整体错，逐位标出', () => {
    expect(grade(sequence, { kind: 'sequence', ids: ['do', 're', 're'] })).toEqual({
      correct: false,
      detail: { kind: 'sequence', positions: [true, false, true] },
    })
  })

  it('长度不等：整体错，按答案长度逐位比较，缺的位判错', () => {
    expect(grade(sequence, { kind: 'sequence', ids: ['do'] })).toEqual({
      correct: false,
      detail: { kind: 'sequence', positions: [true, false, false] },
    })
  })
})

describe('grade：pitch（P-2b 阶段取自评）', () => {
  it('自评对即对', () => {
    expect(grade(pitch, { kind: 'pitch', selfAssessedCorrect: true }).correct).toBe(true)
    expect(grade(pitch, { kind: 'pitch', selfAssessedCorrect: false }).correct).toBe(false)
  })
})

describe('grade：tap（首击对齐后逐个比偏差）', () => {
  it('整体延迟 0.3 秒但节奏准确：对（反应延迟被消除）', () => {
    const r = grade(tap, { kind: 'tap', tapsSec: [1.3, 1.8, 2.3, 3.3] })
    expect(r.correct).toBe(true)
    if (r.detail.kind !== 'tap') throw new Error('detail 类型错')
    for (const o of r.detail.offsetsSec) expect(Math.abs(o)).toBeLessThan(1e-9)
  })

  it('某一下偏差超过容差：错，偏差逐个给出', () => {
    const r = grade(tap, { kind: 'tap', tapsSec: [1, 1.5, 2.2, 3] })
    expect(r.correct).toBe(false)
    if (r.detail.kind !== 'tap') throw new Error('detail 类型错')
    expect(r.detail.offsetsSec[2]).toBeCloseTo(0.2, 9)
  })

  it('偏差恰在容差内：对', () => {
    expect(grade(tap, { kind: 'tap', tapsSec: [1, 1.59, 2, 3] }).correct).toBe(true)
  })

  it('点击数不等：错，偏差按较短长度给出', () => {
    const r = grade(tap, { kind: 'tap', tapsSec: [1, 1.5] })
    expect(r.correct).toBe(false)
    if (r.detail.kind !== 'tap') throw new Error('detail 类型错')
    expect(r.detail.offsetsSec).toHaveLength(2)
  })

  it('一下都没点：错', () => {
    expect(grade(tap, { kind: 'tap', tapsSec: [] }).correct).toBe(false)
  })
})

describe('grade：格式不匹配是调用方的 bug', () => {
  it('抛错', () => {
    expect(() => grade(choice, { kind: 'sequence', ids: ['re'] })).toThrow()
    expect(() => grade(tap, { kind: 'choice', id: 're' })).toThrow()
  })
})

describe('answerAsResponse', () => {
  it('完美作答对四种格式都判对', () => {
    for (const ex of [choice, sequence, pitch, tap]) {
      expect(grade(ex, answerAsResponse(ex.answer)).correct).toBe(true)
    }
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/grade.test.ts`
Expected: FAIL —— 无法解析模块 `./grade`

- [ ] **Step 3: 写实现**

`src/exercises/grade.ts`：

```ts
import type { Answer, Exercise, GradeResult, Response } from './types'

const TAP_EPSILON = 1e-9

function mismatch(expected: string, got: string): never {
  throw new Error(`作答格式 ${got} 与题目格式 ${expected} 不匹配`)
}

/**
 * 判定（P-2b spec §8）。纯函数。
 * 作答种类与题目格式不匹配时抛错——那是调用方的 bug，不是学习者答错。
 */
export function grade(
  exercise: Pick<Exercise, 'format' | 'answer'>,
  response: Response,
): GradeResult {
  const { answer } = exercise
  switch (answer.kind) {
    case 'choice': {
      if (response.kind !== 'choice') return mismatch('choice', response.kind)
      return { correct: response.id === answer.id, detail: { kind: 'choice' } }
    }
    case 'sequence': {
      if (response.kind !== 'sequence') return mismatch('sequence', response.kind)
      const positions = answer.ids.map((id, i) => response.ids[i] === id)
      const correct =
        response.ids.length === answer.ids.length && positions.every(Boolean)
      return { correct, detail: { kind: 'sequence', positions } }
    }
    case 'pitch': {
      if (response.kind !== 'pitch') return mismatch('pitch', response.kind)
      return { correct: response.selfAssessedCorrect, detail: { kind: 'pitch' } }
    }
    case 'tap': {
      if (response.kind !== 'tap') return mismatch('tap', response.kind)
      if (exercise.format.kind !== 'tap') return mismatch('tap', exercise.format.kind)
      const target = answer.onsetsSec
      const taps = response.tapsSec
      if (taps.length === 0) {
        return { correct: false, detail: { kind: 'tap', offsetsSec: [] } }
      }
      // 整串平移，让首击对齐首个目标起音——消除反应延迟，只比节奏本身
      const shift = target[0] - taps[0]
      const n = Math.min(taps.length, target.length)
      const offsetsSec = Array.from({ length: n }, (_, i) => taps[i] + shift - target[i])
      const tolerance = exercise.format.toleranceSec
      const correct =
        taps.length === target.length &&
        offsetsSec.every((o) => Math.abs(o) <= tolerance + TAP_EPSILON)
      return { correct, detail: { kind: 'tap', offsetsSec } }
    }
  }
}

/** 正确答案 → 完美作答。属性测试与 P-3 演示模式用 */
export function answerAsResponse(answer: Answer): Response {
  switch (answer.kind) {
    case 'choice':
      return { kind: 'choice', id: answer.id }
    case 'sequence':
      return { kind: 'sequence', ids: [...answer.ids] }
    case 'pitch':
      return { kind: 'pitch', selfAssessedCorrect: true }
    case 'tap':
      return { kind: 'tap', tapsSec: [...answer.onsetsSec] }
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/exercises/grade.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/exercises/grade.ts src/exercises/grade.test.ts
git commit -m "feat(exercises): 四种作答格式的判定" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 普通音级生成器（T 轨三模态）

**Files:**
- Create: `src/exercises/generators/degree.ts`
- Create: `src/exercises/generators/testInput.ts`（测试辅助，供 Task 9/10 复用）
- Test: `src/exercises/generators/degree.test.ts`

**Interfaces:**
- Consumes: `GeneratorInput`/`ContentResult`/`Generator`/`PitchTarget`（Task 2）、`difficultyParams`/`SING_CENTS_TOLERANCE`/`BASE_BPM`（Task 2）、`requireDegreeEntry`/`degreeEntry`（Task 4）、`poolMembers`/`pickOptions`/`shuffle`（Task 5）、`degreeToMidi`/`doMidiForKey`（music/register）、`midiToFreq`（music/pitch）、`resolveVariation`（Task 3，测试辅助用）
- Produces:
  - `export const SING_NOTE_SEC = 1.0`、`export const MAX_MELODIC_LEAP = 7`
  - `export const recognizeDegree: Generator`、`export const singDegrees: Generator`、`export const notateMelody: Generator`
  - `export const DEGREE_GENERATORS: Record<Modality, Generator>`
  - `testInput.ts`：`export function generatorInput(kpId: string, modality: Modality, opts?: { step?: number; seed?: number; variationLevel?: number; mode?: Mode }): GeneratorInput`

- [ ] **Step 1: 写测试辅助**

`src/exercises/generators/testInput.ts`：

```ts
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
```

- [ ] **Step 2: 写失败的测试**

`src/exercises/generators/degree.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { DEGREE_SEMITONES, type ScaleDegree } from '../../music/key'
import { midiToFreq } from '../../music/pitch'
import { degreeToMidi } from '../../music/register'
import { DIFFICULTY_TABLE } from '../difficulty'
import {
  MAX_MELODIC_LEAP,
  SING_NOTE_SEC,
  notateMelody,
  recognizeDegree,
  singDegrees,
} from './degree'
import { generatorInput } from './testInput'

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1)
const T2_POOL = ['do', 'mi', 'sol', 're', 'la']

describe('recognizeDegree', () => {
  it('放单个目标音，音高 = degreeToMidi(目标, doMidi)', () => {
    const input = generatorInput('degree:major:re', 'recognize')
    const r = recognizeDegree(input)
    expect(r.notes).toHaveLength(1)
    expect(r.notes[0].midi).toBe(degreeToMidi('re', input.doMidi))
    expect(r.notes[0].atSec).toBe(0)
    expect(r.feedbackNotes).toEqual(r.notes)
    expect(r.prompt).toBe('which-degree')
    expect(r.answer).toEqual({ kind: 'choice', id: 're' })
  })

  it('选项个数按档位、受池大小限制，且都来自干扰池', () => {
    for (let step = 0; step <= 5; step++) {
      for (const seed of SEEDS) {
        const r = recognizeDegree(generatorInput('degree:major:re', 'recognize', { step, seed }))
        if (r.format.kind !== 'choice') throw new Error('格式错')
        const ids = r.format.options.map((o) => o.id)
        expect(ids).toHaveLength(Math.min(DIFFICULTY_TABLE.recognizeOptionCount[step], T2_POOL.length))
        expect(ids).toContain('re')
        expect(ids.every((id) => T2_POOL.includes(id))).toBe(true)
      }
    }
  })

  it('目标音时长随档位缩短（默认 90 bpm 下即表中秒数）', () => {
    expect(recognizeDegree(generatorInput('degree:major:re', 'recognize', { step: 0 })).durSec).toBeCloseTo(1.0, 12)
    expect(recognizeDegree(generatorInput('degree:major:re', 'recognize', { step: 5 })).durSec).toBeCloseTo(0.5, 12)
  })

  it('gain 等于力度（旋律内容视为重音）', () => {
    const input = generatorInput('degree:major:re', 'recognize')
    expect(recognizeDegree(input).notes[0].gain).toBe(input.resolved.velocity)
  })

  it('小调升 7 级的答案 id 是 le', () => {
    const r = recognizeDegree(generatorInput('degree:minor:si', 'recognize', { mode: 'minor' }))
    expect(r.answer).toEqual({ kind: 'choice', id: 'le' })
  })
})

describe('singDegrees', () => {
  it('目标音个数按档位，必含目标，全部来自池', () => {
    for (let step = 0; step <= 5; step++) {
      for (const seed of SEEDS) {
        const r = singDegrees(generatorInput('degree:major:re', 'sing', { step, seed }))
        if (r.format.kind !== 'pitch') throw new Error('格式错')
        const degrees = r.format.targets.map((t) => t.degree)
        expect(degrees).toHaveLength(DIFFICULTY_TABLE.singTargetCount[step])
        expect(degrees).toContain('re')
        expect(degrees.every((d) => T2_POOL.includes(d))).toBe(true)
      }
    }
  })

  it('目标的 midi、频率与容差', () => {
    const input = generatorInput('degree:major:re', 'sing', { step: 4, seed: 3 })
    const r = singDegrees(input)
    if (r.format.kind !== 'pitch') throw new Error('格式错')
    for (const t of r.format.targets) {
      expect(t.midi).toBe(degreeToMidi(t.degree, input.doMidi))
      expect(t.freqHz).toBeCloseTo(midiToFreq(t.midi), 9)
      expect(t.centsTolerance).toBe(50)
    }
    expect(r.answer).toEqual({ kind: 'pitch', targets: r.format.targets })
  })

  it('题目里不放目标音（要学习者自己唱），反馈里依次放出目标音', () => {
    const r = singDegrees(generatorInput('degree:major:re', 'sing', { step: 4, seed: 3 }))
    if (r.format.kind !== 'pitch') throw new Error('格式错')
    expect(r.notes).toEqual([])
    expect(r.feedbackNotes.map((n) => n.midi)).toEqual(r.format.targets.map((t) => t.midi))
    expect(r.feedbackNotes.map((n) => n.atSec)).toEqual(r.format.targets.map((_, i) => i * SING_NOTE_SEC))
    expect(r.durSec).toBeCloseTo(r.format.targets.length * SING_NOTE_SEC, 12)
    expect(r.prompt).toBe('sing-degrees')
  })
})

describe('notateMelody', () => {
  it('长度按档位、至少含一次目标、相邻音程不超过纯五度', () => {
    for (let step = 0; step <= 5; step++) {
      for (const seed of SEEDS) {
        const input = generatorInput('degree:major:re', 'notate', { step, seed })
        const r = notateMelody(input)
        if (r.answer.kind !== 'sequence') throw new Error('格式错')
        const ids = r.answer.ids
        expect(ids).toHaveLength(DIFFICULTY_TABLE.notateMelodyLength[step])
        expect(ids).toContain('re')
        for (let i = 1; i < r.notes.length; i++) {
          expect(Math.abs(r.notes[i].midi - r.notes[i - 1].midi)).toBeLessThanOrEqual(MAX_MELODIC_LEAP)
        }
      }
    }
  })

  it('答案与实际播放的音一一对应', () => {
    const input = generatorInput('degree:major:re', 'notate', { step: 3, seed: 5 })
    const r = notateMelody(input)
    if (r.answer.kind !== 'sequence') throw new Error('格式错')
    expect(r.notes.map((n) => n.midi)).toEqual(
      r.answer.ids.map((id) => input.doMidi + DEGREE_SEMITONES[id as ScaleDegree]),
    )
  })

  it('字母表 = 整个干扰池；格式长度 = 答案长度', () => {
    const r = notateMelody(generatorInput('degree:major:re', 'notate', { step: 2 }))
    if (r.format.kind !== 'sequence' || r.answer.kind !== 'sequence') throw new Error('格式错')
    expect(r.format.alphabet.map((o) => o.id).sort()).toEqual([...T2_POOL].sort())
    expect(r.format.length).toBe(r.answer.ids.length)
    expect(r.prompt).toBe('notate-melody')
  })

  it('每个音一拍，等时值', () => {
    const input = generatorInput('degree:major:re', 'notate', { step: 2 })
    const r = notateMelody(input)
    const beat = 60 / input.resolved.bpm
    expect(r.notes.map((n) => n.atSec)).toEqual(r.notes.map((_, i) => i * beat))
    expect(r.durSec).toBeCloseTo(r.notes.length * beat, 12)
  })
})

describe('确定性', () => {
  it('同一输入两次生成结果相同', () => {
    for (const gen of [recognizeDegree, singDegrees, notateMelody]) {
      expect(gen(generatorInput('degree:major:la', 'notate', { step: 4, seed: 11 }))).toEqual(
        gen(generatorInput('degree:major:la', 'notate', { step: 4, seed: 11 })),
      )
    }
  })
})
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `npx vitest run src/exercises/generators/degree.test.ts`
Expected: FAIL —— 无法解析模块 `./degree`

- [ ] **Step 4: 写实现**

`src/exercises/generators/degree.ts`：

```ts
import type { Modality } from '../../curriculum/knowledgePoints'
import type { ScaleDegree } from '../../music/key'
import { midiToFreq } from '../../music/pitch'
import type { NoteSpec } from '../../music/playback'
import { degreeToMidi } from '../../music/register'
import { degreeEntry, requireDegreeEntry } from '../data/degrees'
import { BASE_BPM, SING_CENTS_TOLERANCE, difficultyParams } from '../difficulty'
import { pickOptions, poolMembers, shuffle } from '../pools'
import type { ContentResult, Generator, GeneratorInput, PitchTarget } from '../types'

/** 唱模态每个目标音预留的时长（秒），也是反馈里每个目标音的时值 */
export const SING_NOTE_SEC = 1.0
/** 听写旋律相邻音的最大音程（半音）：纯五度 */
export const MAX_MELODIC_LEAP = 7
/** 听写旋律的音符占一拍的比例，留一点空隙让音头清楚 */
const LEGATO = 0.9

function poolDegrees(input: GeneratorInput): ScaleDegree[] {
  return poolMembers(input.curriculum, input.spec.kpId, (id) => degreeEntry(id)?.pool).map(
    (id) => requireDegreeEntry(id).degree,
  )
}

export const recognizeDegree: Generator = (input): ContentResult => {
  const { spec, resolved, doMidi, rng } = input
  const entry = requireDegreeEntry(spec.kpId)
  const p = difficultyParams(spec.difficultyStep)
  const durSec = p.recognizeNoteSec * (BASE_BPM / resolved.bpm)
  const notes: NoteSpec[] = [
    { midi: degreeToMidi(entry.degree, doMidi), atSec: 0, durSec, gain: resolved.velocity },
  ]
  const options = pickOptions(entry.degree, poolDegrees(input), p.recognizeOptionCount, rng)
  return {
    notes,
    feedbackNotes: notes,
    durSec,
    prompt: 'which-degree',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: entry.degree },
  }
}

export const singDegrees: Generator = (input): ContentResult => {
  const { spec, resolved, doMidi, rng } = input
  const entry = requireDegreeEntry(spec.kpId)
  const count = difficultyParams(spec.difficultyStep).singTargetCount
  const others = shuffle(
    poolDegrees(input).filter((d) => d !== entry.degree),
    rng,
  ).slice(0, count - 1)
  const sequence = shuffle([entry.degree, ...others], rng)

  const targets: PitchTarget[] = sequence.map((degree) => {
    const midi = degreeToMidi(degree, doMidi)
    return { degree, midi, freqHz: midiToFreq(midi), centsTolerance: SING_CENTS_TOLERANCE }
  })
  const feedbackNotes: NoteSpec[] = targets.map((t, i) => ({
    midi: t.midi,
    atSec: i * SING_NOTE_SEC,
    durSec: SING_NOTE_SEC,
    gain: resolved.velocity,
  }))
  return {
    notes: [],
    feedbackNotes,
    durSec: targets.length * SING_NOTE_SEC,
    prompt: 'sing-degrees',
    format: { kind: 'pitch', targets },
    answer: { kind: 'pitch', targets },
  }
}

export const notateMelody: Generator = (input): ContentResult => {
  const { spec, resolved, doMidi, rng } = input
  const entry = requireDegreeEntry(spec.kpId)
  const length = difficultyParams(spec.difficultyStep).notateMelodyLength
  const pool = poolDegrees(input)
  const midiOf = (d: ScaleDegree) => degreeToMidi(d, doMidi)
  const near = (from: ScaleDegree) =>
    pool.filter((d) => Math.abs(midiOf(d) - midiOf(from)) <= MAX_MELODIC_LEAP)

  // 先把目标放在随机位置，再向两侧随机游走——保证必含目标且每步音程合规
  const sequence: ScaleDegree[] = new Array(length)
  const targetPos = rng.int(length)
  sequence[targetPos] = entry.degree
  for (let i = targetPos + 1; i < length; i++) sequence[i] = rng.pick(near(sequence[i - 1]))
  for (let i = targetPos - 1; i >= 0; i--) sequence[i] = rng.pick(near(sequence[i + 1]))

  const beat = 60 / resolved.bpm
  const notes: NoteSpec[] = sequence.map((d, i) => ({
    midi: midiOf(d),
    atSec: i * beat,
    durSec: beat * LEGATO,
    gain: resolved.velocity,
  }))
  return {
    notes,
    feedbackNotes: notes,
    durSec: length * beat,
    prompt: 'notate-melody',
    format: { kind: 'sequence', length, alphabet: pool.map((id) => ({ id })) },
    answer: { kind: 'sequence', ids: [...sequence] },
  }
}

export const DEGREE_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeDegree,
  sing: singDegrees,
  notate: notateMelody,
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `npx vitest run src/exercises/generators/degree.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/exercises/generators/
git commit -m "feat(exercises): T 轨普通音级的听辨、唱、听写生成器" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 转调生成器

**Files:**
- Create: `src/exercises/generators/modulation.ts`
- Test: `src/exercises/generators/modulation.test.ts`

**Interfaces:**
- Consumes: `GeneratorInput`/`ContentResult`/`Generator`（Task 2）、`SING_CENTS_TOLERANCE`（Task 2）、`pickOptions`（Task 5）、`doMidiForKey`/`tonicMidi`（music/register）、`tonicDegree`/`Key`（music/key）、`midiToFreq`、`generatorInput`（Task 9 测试辅助）
- Produces:
  - `export type Shift = 'stay' | 'IV' | 'V' | 'relative'`
  - `export const SHIFTS: readonly Shift[]`
  - `export const SHIFT_ANSWER: Record<Shift, ScaleDegree>`（`stay→do, IV→fa, V→sol, relative→la`）
  - `export const FIRST_HALF_SEMITONES`、`MAJOR_CADENCE_SEMITONES`、`MINOR_CADENCE_SEMITONES`（各 8 个，相对各自主音）
  - `export function newKeyOf(key: Key, shift: Shift): Key`
  - `export interface ModulationPhrase { shift: Shift; newKey: Key; newTonicMidi: number; notes: NoteSpec[]; durSec: number }`
  - `export function modulationPhrase(input: GeneratorInput): ModulationPhrase`（消耗 rng：先抽 shift）
  - `export const MODULATION_GENERATORS: Record<Modality, Generator>`

- [ ] **Step 1: 写失败的测试**

`src/exercises/generators/modulation.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { midiToFreq } from '../../music/pitch'
import { tonicMidi } from '../../music/register'
import {
  FIRST_HALF_SEMITONES,
  MAJOR_CADENCE_SEMITONES,
  MINOR_CADENCE_SEMITONES,
  MODULATION_GENERATORS,
  SHIFTS,
  SHIFT_ANSWER,
  modulationPhrase,
  newKeyOf,
} from './modulation'
import { generatorInput } from './testInput'

const KP = 'degree:modulation:shift'
const SEEDS = Array.from({ length: 80 }, (_, i) => i + 1)

describe('newKeyOf', () => {
  const C = { tonic: 0, mode: 'major' as const }
  it('四种去向', () => {
    expect(newKeyOf(C, 'stay')).toEqual(C)
    expect(newKeyOf(C, 'IV')).toEqual({ tonic: 5, mode: 'major' })
    expect(newKeyOf(C, 'V')).toEqual({ tonic: 7, mode: 'major' })
    expect(newKeyOf(C, 'relative')).toEqual({ tonic: 9, mode: 'minor' })
  })
  it('音类按 12 取模', () => {
    expect(newKeyOf({ tonic: 10, mode: 'major' }, 'V')).toEqual({ tonic: 5, mode: 'major' })
  })
})

describe('modulationPhrase', () => {
  it('四种去向都会出现', () => {
    const seen = new Set(SEEDS.map((s) => modulationPhrase(generatorInput(KP, 'recognize', { seed: s })).shift))
    expect([...seen].sort()).toEqual([...SHIFTS].sort())
  })

  it('四小节 16 个四分音符：前 8 个按原调模板，后 8 个按新调模板，以新主音结尾', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const input = generatorInput(KP, 'recognize', { seed })
      const ph = modulationPhrase(input)
      expect(ph.notes).toHaveLength(16)
      const oldTonic = tonicMidi(input.resolved.key, input.doMidi)
      expect(ph.notes.slice(0, 8).map((n) => n.midi - oldTonic)).toEqual([...FIRST_HALF_SEMITONES])
      const template = ph.newKey.mode === 'minor' ? MINOR_CADENCE_SEMITONES : MAJOR_CADENCE_SEMITONES
      expect(ph.notes.slice(8).map((n) => n.midi - ph.newTonicMidi)).toEqual([...template])
      expect(ph.notes[15].midi).toBe(ph.newTonicMidi)
      const beat = 60 / input.resolved.bpm
      expect(ph.notes.map((n) => n.atSec)).toEqual(ph.notes.map((_, i) => i * beat))
      expect(ph.durSec).toBeCloseTo(16 * beat, 12)
    }
  })

  it('模板的最后两音是导音→主音（新调必须靠导音立住）', () => {
    for (const t of [FIRST_HALF_SEMITONES, MAJOR_CADENCE_SEMITONES, MINOR_CADENCE_SEMITONES]) {
      expect(t.slice(-2)).toEqual([-1, 0])
    }
  })
})

describe('三模态', () => {
  it('听辨：选项恰为 shift / stay，答案与实际去向一致', () => {
    for (const seed of SEEDS) {
      const input = generatorInput(KP, 'recognize', { seed })
      const shift = modulationPhrase(generatorInput(KP, 'recognize', { seed })).shift
      const r = MODULATION_GENERATORS.recognize(input)
      if (r.format.kind !== 'choice') throw new Error('格式错')
      expect(r.format.options.map((o) => o.id).sort()).toEqual(['shift', 'stay'])
      expect(r.answer).toEqual({ kind: 'choice', id: shift === 'stay' ? 'stay' : 'shift' })
      expect(r.prompt).toBe('did-it-modulate')
    }
  })

  it('唱：唯一目标是新主音；关系小调唱 la，其余唱 do', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const ph = modulationPhrase(generatorInput(KP, 'sing', { seed }))
      const r = MODULATION_GENERATORS.sing(generatorInput(KP, 'sing', { seed }))
      if (r.format.kind !== 'pitch') throw new Error('格式错')
      expect(r.format.targets).toHaveLength(1)
      const t = r.format.targets[0]
      expect(t.midi).toBe(ph.newTonicMidi)
      expect(t.freqHz).toBeCloseTo(midiToFreq(ph.newTonicMidi), 9)
      expect(t.degree).toBe(ph.shift === 'relative' ? 'la' : 'do')
      expect(t.centsTolerance).toBe(50)
      expect(r.notes).toHaveLength(16)
      expect(r.feedbackNotes.at(-1)?.midi).toBe(ph.newTonicMidi)
      expect(r.prompt).toBe('sing-new-tonic')
    }
  })

  it('听写：长度 1，字母表 do/fa/sol/la，答案按 SHIFT_ANSWER', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const ph = modulationPhrase(generatorInput(KP, 'notate', { seed }))
      const r = MODULATION_GENERATORS.notate(generatorInput(KP, 'notate', { seed }))
      if (r.format.kind !== 'sequence') throw new Error('格式错')
      expect(r.format.length).toBe(1)
      expect(r.format.alphabet.map((o) => o.id)).toEqual(['do', 'fa', 'sol', 'la'])
      expect(r.answer).toEqual({ kind: 'sequence', ids: [SHIFT_ANSWER[ph.shift]] })
      expect(r.prompt).toBe('new-tonic-degree')
    }
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/generators/modulation.test.ts`
Expected: FAIL —— 无法解析模块 `./modulation`

- [ ] **Step 3: 写实现**

`src/exercises/generators/modulation.ts`：

```ts
import type { Modality } from '../../curriculum/knowledgePoints'
import { tonicDegree, type Key, type ScaleDegree } from '../../music/key'
import { midiToFreq } from '../../music/pitch'
import type { NoteSpec } from '../../music/playback'
import { doMidiForKey, tonicMidi } from '../../music/register'
import { SING_CENTS_TOLERANCE } from '../difficulty'
import { pickOptions } from '../pools'
import type { ContentResult, Generator, GeneratorInput } from '../types'

export type Shift = 'stay' | 'IV' | 'V' | 'relative'
export const SHIFTS: readonly Shift[] = ['stay', 'IV', 'V', 'relative']

/** 新主音是原调的哪个音级（听写答案）。关系小调的主音是原调 la */
export const SHIFT_ANSWER: Record<Shift, ScaleDegree> = {
  stay: 'do',
  IV: 'fa',
  V: 'sol',
  relative: 'la',
}

/** 前两小节：原调大调，mi re do re | mi fa ti do（相对主音的半音数，ti 在主音下方） */
export const FIRST_HALF_SEMITONES = [4, 2, 0, 2, 4, 5, -1, 0] as const
/** 后两小节（大调）：sol fa mi re | do re ti do */
export const MAJOR_CADENCE_SEMITONES = [7, 5, 4, 2, 0, 2, -1, 0] as const
/** 后两小节（小调，相对 la）：mi re do ti | la ti si la——用升 7 级导音立住小调 */
export const MINOR_CADENCE_SEMITONES = [7, 5, 3, 2, 0, 2, -1, 0] as const

export function newKeyOf(key: Key, shift: Shift): Key {
  switch (shift) {
    case 'stay':
      return key
    case 'IV':
      return { tonic: (key.tonic + 5) % 12, mode: 'major' }
    case 'V':
      return { tonic: (key.tonic + 7) % 12, mode: 'major' }
    case 'relative':
      return { tonic: (key.tonic + 9) % 12, mode: 'minor' }
  }
}

export interface ModulationPhrase {
  shift: Shift
  newKey: Key
  newTonicMidi: number
  notes: NoteSpec[]
  durSec: number
}

/** 四小节短句：前两小节原调，后两小节原调或新调（P-2b spec §7.2）。先消耗 rng 抽去向 */
export function modulationPhrase(input: GeneratorInput): ModulationPhrase {
  const { resolved, doMidi, rng } = input
  const shift = rng.pick(SHIFTS)
  const newKey = newKeyOf(resolved.key, shift)
  const newDoMidi = doMidiForKey(newKey, resolved.centerMidi)
  const oldTonic = tonicMidi(resolved.key, doMidi)
  const newTonicMidi = tonicMidi(newKey, newDoMidi)
  const cadence = newKey.mode === 'minor' ? MINOR_CADENCE_SEMITONES : MAJOR_CADENCE_SEMITONES

  const midis = [
    ...FIRST_HALF_SEMITONES.map((s) => oldTonic + s),
    ...cadence.map((s) => newTonicMidi + s),
  ]
  const beat = 60 / resolved.bpm
  const notes: NoteSpec[] = midis.map((midi, i) => ({
    midi,
    atSec: i * beat,
    durSec: beat * 0.9,
    gain: resolved.velocity,
  }))
  return { shift, newKey, newTonicMidi, notes, durSec: midis.length * beat }
}

const recognizeModulation: Generator = (input): ContentResult => {
  const ph = modulationPhrase(input)
  const answerId = ph.shift === 'stay' ? 'stay' : 'shift'
  const options = pickOptions(answerId, ['shift', 'stay'], 2, input.rng)
  return {
    notes: ph.notes,
    feedbackNotes: ph.notes,
    durSec: ph.durSec,
    prompt: 'did-it-modulate',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: answerId },
  }
}

const singNewTonic: Generator = (input): ContentResult => {
  const ph = modulationPhrase(input)
  const target = {
    degree: tonicDegree(ph.newKey),
    midi: ph.newTonicMidi,
    freqHz: midiToFreq(ph.newTonicMidi),
    centsTolerance: SING_CENTS_TOLERANCE,
  }
  const beat = 60 / input.resolved.bpm
  return {
    notes: ph.notes,
    // 反馈：短句之后再单独放一次新主音
    feedbackNotes: [
      ...ph.notes,
      { midi: ph.newTonicMidi, atSec: ph.durSec + beat, durSec: 1, gain: input.resolved.velocity },
    ],
    durSec: ph.durSec,
    prompt: 'sing-new-tonic',
    format: { kind: 'pitch', targets: [target] },
    answer: { kind: 'pitch', targets: [target] },
  }
}

const notateNewTonic: Generator = (input): ContentResult => {
  const ph = modulationPhrase(input)
  return {
    notes: ph.notes,
    feedbackNotes: ph.notes,
    durSec: ph.durSec,
    prompt: 'new-tonic-degree',
    format: {
      kind: 'sequence',
      length: 1,
      alphabet: (['do', 'fa', 'sol', 'la'] as const).map((id) => ({ id })),
    },
    answer: { kind: 'sequence', ids: [SHIFT_ANSWER[ph.shift]] },
  }
}

export const MODULATION_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeModulation,
  sing: singNewTonic,
  notate: notateNewTonic,
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/exercises/generators/`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/exercises/generators/modulation.ts src/exercises/generators/modulation.test.ts
git commit -m "feat(exercises): 转调的听辨、唱、听写生成器" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: 管线入口 `generate`、快照与属性测试

**Files:**
- Create: `src/exercises/generate.ts`
- Test: `src/exercises/generate.test.ts`

**Interfaces:**
- Consumes: Task 2–10 的全部产物；`describeSpec`（scheduling/exerciseSpec）、`makeRng`、`notesToPlan`、`doMidiForKey`/`tonicMidi`
- Produces:
  - `export function lookupGenerator(kpId: KnowledgePointId): GeneratorEntry | undefined` —— P-2b-H / P-2b-R 在这里追加分支
  - `export function generate(spec: ExerciseSpec, curriculum: Curriculum): Exercise`
  - 再导出：`export { grade, answerAsResponse } from './grade'`、`export type * from './types'`

- [ ] **Step 1: 写失败的测试**

`src/exercises/generate.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { MODALITIES } from '../curriculum/knowledgePoints'
import type { VariationLevel } from '../curriculum/stages'
import { freqToMidi } from '../music/pitch'
import { makeRng } from '../music/rng'
import type { ContextLevel } from '../music/tonalContext'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'
import { PLAN_MIDI_MAX, PLAN_MIDI_MIN } from './context'
import { DEGREE_ENTRIES } from './data/degrees'
import { answerAsResponse, generate, grade, lookupGenerator } from './generate'
import type { Exercise } from './types'

const c = buildCurriculum()

function spec(overrides: Partial<ExerciseSpec>): ExerciseSpec {
  return {
    kpId: 'degree:major:re',
    modality: 'recognize',
    track: 'T',
    contextLevel: 0,
    variationLevel: 0,
    difficultyStep: 0,
    seed: 1,
    segment: 'focus',
    ...overrides,
  }
}

/** 覆盖全部 T 轨知识点 × 模态 × 语境 × 变异 × 档位的随机规格 */
function randomSpecs(n: number): ExerciseSpec[] {
  const rng = makeRng(20261013)
  return Array.from({ length: n }, () =>
    spec({
      kpId: rng.pick(DEGREE_ENTRIES).kpId,
      modality: rng.pick(MODALITIES),
      contextLevel: rng.int(5) as ContextLevel,
      variationLevel: rng.int(7) as VariationLevel,
      difficultyStep: rng.int(6),
      seed: rng.int(2 ** 31),
    }),
  )
}

const allMidis = (ex: Exercise) =>
  [ex.plan, ex.feedback.replay, ex.feedback.slow].flatMap((p) => p.events.map((e) => freqToMidi(e.freqHz)))

describe('lookupGenerator', () => {
  it('每个 T 轨知识点都有生成器；转调走转调分支', () => {
    for (const e of DEGREE_ENTRIES) expect(lookupGenerator(e.kpId)).toBeDefined()
    expect(lookupGenerator('degree:modulation:shift')?.byModality.recognize).not.toBe(
      lookupGenerator('degree:major:do')?.byModality.recognize,
    )
  })

  it('H/R 轨在本计划中尚无生成器', () => {
    expect(lookupGenerator('chord:I')).toBeUndefined()
    expect(lookupGenerator('rhythm:quarter')).toBeUndefined()
  })
})

describe('generate：管线', () => {
  it('题目内容紧接语境之后，且确实出现在 plan 里', () => {
    const ex = generate(spec({ contextLevel: 1 }), c)
    expect(ex.contentStartSec).toBeGreaterThan(0)
    expect(ex.plan.events.some((e) => Math.abs(e.atSec - ex.contentStartSec) < 1e-9)).toBe(true)
  })

  it('携带输入规格与解析后的变异', () => {
    const s = spec({ variationLevel: 3, seed: 42 })
    const ex = generate(s, c)
    expect(ex.spec).toEqual(s)
    expect(ex.resolved.key.mode).toBe('major')
  })

  it('小调知识点用小调', () => {
    expect(generate(spec({ kpId: 'degree:minor:do' }), c).resolved.key).toEqual({ tonic: 9, mode: 'minor' })
  })

  it('反馈 replay 以主音开头', () => {
    const ex = generate(spec({}), c)
    expect(freqToMidi(ex.feedback.replay.events[0].freqHz)).toBeCloseTo(60, 6)
  })

  it('没有生成器的知识点抛错，消息含定位信息', () => {
    expect(() => generate(spec({ kpId: 'chord:I', track: 'H' }), c)).toThrow(/chord:I@recognize/)
  })
})

describe('generate：快照（固定 seed）', () => {
  const cases: [string, Partial<ExerciseSpec>][] = [
    ['普通音级·听辨', { kpId: 'degree:major:re', modality: 'recognize', contextLevel: 1, variationLevel: 2, difficultyStep: 2, seed: 101 }],
    ['普通音级·唱', { kpId: 'degree:major:la', modality: 'sing', contextLevel: 2, variationLevel: 3, difficultyStep: 4, seed: 102 }],
    ['普通音级·听写', { kpId: 'degree:minor:si', modality: 'notate', contextLevel: 3, variationLevel: 6, difficultyStep: 5, seed: 103 }],
    ['转调·听辨', { kpId: 'degree:modulation:shift', modality: 'recognize', contextLevel: 0, variationLevel: 1, seed: 104 }],
    ['转调·唱', { kpId: 'degree:modulation:shift', modality: 'sing', contextLevel: 4, variationLevel: 4, seed: 105 }],
    ['转调·听写', { kpId: 'degree:modulation:shift', modality: 'notate', contextLevel: 2, variationLevel: 5, seed: 106 }],
  ]
  for (const [name, o] of cases) {
    it(name, () => {
      expect(generate(spec(o), c)).toMatchSnapshot()
    })
  }
})

describe('generate：属性（P-2b spec §11 第 3 条）', () => {
  const specs = randomSpecs(600)

  it('正确答案必判为对', () => {
    for (const s of specs) {
      const ex = generate(s, c)
      expect(grade(ex, answerAsResponse(ex.answer)).correct).toBe(true)
    }
  })

  it('plan、replay、slow 的全部音高落在 MIDI 36–96', () => {
    for (const s of specs) {
      for (const m of allMidis(generate(s, c))) {
        expect(m).toBeGreaterThanOrEqual(PLAN_MIDI_MIN - 1e-6)
        expect(m).toBeLessThanOrEqual(PLAN_MIDI_MAX + 1e-6)
      }
    }
  })

  it('确定性：同一输入两次生成深度相等', () => {
    for (const s of specs.slice(0, 100)) {
      expect(generate(s, c)).toEqual(generate(s, c))
    }
  })

  it('选择题选项 id 不重复且含答案；听写答案都在字母表里', () => {
    for (const s of specs) {
      const ex = generate(s, c)
      if (ex.format.kind === 'choice' && ex.answer.kind === 'choice') {
        const ids = ex.format.options.map((o) => o.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids).toContain(ex.answer.id)
        expect(ids.length).toBeGreaterThanOrEqual(2)
      }
      if (ex.format.kind === 'sequence' && ex.answer.kind === 'sequence') {
        const alphabet = new Set(ex.format.alphabet.map((o) => o.id))
        expect(ex.answer.ids.every((id) => alphabet.has(id))).toBe(true)
        expect(ex.answer.ids).toHaveLength(ex.format.length)
      }
    }
  })

  it('答案格式与题目格式同种', () => {
    for (const s of specs) {
      const ex = generate(s, c)
      expect(ex.answer.kind).toBe(ex.format.kind)
    }
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/generate.test.ts`
Expected: FAIL —— 无法解析模块 `./generate`

- [ ] **Step 3: 写实现**

`src/exercises/generate.ts`：

```ts
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
```

- [ ] **Step 4: 运行测试，确认通过；首次运行会写出快照文件**

Run: `npx vitest run src/exercises/generate.test.ts`
Expected: PASS；生成 `src/exercises/__snapshots__/generate.test.ts.snap`。打开快照文件人工抽查一条：`plan.events` 按时刻升序、`answer` 与 `format` 同种、频率在 65–2093 Hz 之间。

- [ ] **Step 5: 再跑一次，确认快照稳定**

Run: `npx vitest run src/exercises/generate.test.ts`
Expected: PASS，无「snapshot written」提示

- [ ] **Step 6: 提交（含快照文件）**

```bash
git add src/exercises/generate.ts src/exercises/generate.test.ts src/exercises/__snapshots__/
git commit -m "feat(exercises): generate 管线入口、快照与属性测试" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: 集成守卫、主 spec 写回与完成检查

**Files:**
- Test: `src/exercises/integration.test.ts`（新建）
- Modify: `docs/superpowers/specs/2026-08-24-ear-training-design.md`（§6.2 音区一行；§16.2 FWD-2、FWD-4 各追加一行状态）

**Interfaces:**
- Consumes: `runSimulation`/`AttemptTrace`（simulation/runSimulation，测试中使用）、`AVERAGE_LEARNER`/`SLOW_LEARNER`（simulation/virtualLearner）、`generate`（Task 11）、`describeSpec`
- Produces: 无新导出

- [ ] **Step 1: 写集成守卫测试**

`src/exercises/integration.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { describeSpec, type ExerciseSpec } from '../scheduling/exerciseSpec'
import { runSimulation } from '../simulation/runSimulation'
import { AVERAGE_LEARNER, SLOW_LEARNER } from '../simulation/virtualLearner'
import { answerAsResponse, generate, grade } from './generate'

const c = buildCurriculum()

/**
 * P-2b spec §11 第 4 条：拿仿真 180 天里调度器真实发出的规格（已由运行时写入
 * 阶梯档位）逐道生成。P-2b-T 只覆盖 T 轨；P-2b-H/R 把过滤条件逐步放宽。
 */
function collectTrackSpecs(learner: typeof AVERAGE_LEARNER): ExerciseSpec[] {
  const specs: ExerciseSpec[] = []
  runSimulation({
    learner,
    days: 180,
    minutesPerDay: 25,
    seed: 4242,
    trace: (t) => {
      if (t.spec.track === 'T') specs.push(t.spec)
    },
  })
  return specs
}

describe('集成守卫：调度器真实发出的 T 轨规格都能生成并判定', () => {
  for (const [name, learner] of [['普通学习者', AVERAGE_LEARNER], ['慢学习者', SLOW_LEARNER]] as const) {
    it(name, () => {
      const specs = collectTrackSpecs(learner)
      expect(specs.length).toBeGreaterThan(500)
      // 运行时契约（主 spec FWD-8）：规格里的档位确实被写进来了
      expect(specs.some((s) => s.difficultyStep > 0)).toBe(true)

      const failures: string[] = []
      for (const s of specs) {
        try {
          const ex = generate(s, c)
          if (!grade(ex, answerAsResponse(ex.answer)).correct) {
            failures.push(`答案判错：${describeSpec(s)}`)
          }
        } catch (e) {
          failures.push(`${describeSpec(s)}：${(e as Error).message}`)
        }
      }
      expect(failures).toEqual([])
    })
  }
})
```

- [ ] **Step 2: 运行，确认通过**

Run: `npx vitest run src/exercises/integration.test.ts`
Expected: PASS。若失败，`failures` 会列出出错规格；按出错位置修对应生成器，不改此测试。

- [ ] **Step 3: 写回主 spec**

在 `docs/superpowers/specs/2026-08-24-ear-training-design.md` 中做三处精确替换。

替换 §6.2 表格行：

```
| 音区 | ±2 个八度 |
```

为：

```
| 音区 | ±1 个八度（P-2b 修订：原 ±2 八度会把持续低音推到听阈之下；整份 plan 另行八度折叠到 MIDI 36–96，见 FWD-4） |
```

在 FWD-2 段落的这一行之后：

```
**修法**：P-2 落地 R 轨前先定清楚合成规则（`gain = baseVelocity × accentFactor` 或其他）。现在定比事后拆便宜。
```

插入一行：

```
**状态（P-2b-T，已关闭）**：规则定为 `gain = velocity × (accent ? 1.0 : 0.75)`，桥接函数 `onsetsToNotes` 落在 `music/rhythm.ts`。旋律内容的每个音视为重音。
```

在 FWD-4 段落的这一行之后：

```
**修法**：钳制做在 `centerMidi` 入口或整个 `PlaybackPlan` 上，而不是只给 drone 打补丁。
```

插入一行：

```
**状态（P-2b-T，已关闭）**：两层都做了。音区中心随机范围收到 MIDI 48–72；整份 plan（语境、内容、反馈）最后经 `foldPlanToRange` 八度折叠到 MIDI 36–96。属性测试对随机规格断言全部音高在区间内。
```

- [ ] **Step 4: 完成检查**

```bash
npx vitest run
npx tsc --noEmit
npx vite build
grep -rn "Math.random\|Date.now\|window\.\|document\." src/exercises/ || echo "OK: src/exercises 保持纯净"
grep -rn "from '../audio\|from '../../audio\|from '../simulation\|from '../../simulation" src/exercises/ --include=*.ts | grep -v "\.test\.ts" || echo "OK: 依赖方向正确"
```

Expected: 全部测试 PASS；tsc 无输出；构建成功；两条 grep 都输出 OK。

- [ ] **Step 5: 提交**

```bash
git add src/exercises/integration.test.ts docs/superpowers/specs/2026-08-24-ear-training-design.md
git commit -m "test(exercises): T 轨集成守卫；docs(spec): 关闭 FWD-2、FWD-4" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 完成标准

P-2b-T 完成的判据：

1. `npx vitest run` 全绿
2. `npx tsc --noEmit` 无输出
3. `npx vite build` 成功
4. T 轨数据表覆盖测试通过：20 个知识点无一遗漏
5. 属性测试通过：随机规格下答案必判对、音高全在 MIDI 36–96、生成确定
6. 集成守卫通过：普通与慢学习者 180 天里调度器发出的全部 T 轨规格都能生成并判定
7. `src/exercises/` 零 IO、依赖方向正确
8. 主 spec 已写回：§6.2 音区修订、FWD-2 与 FWD-4 关闭

## 下一步

**P-2b-H**：FWD-3 的 `voiceChord`，H 轨四类生成器（品质、功能和弦、整条进行、转位/低音线）。在 `lookupGenerator` 追加 H 轨分支；集成守卫与覆盖测试扩到 H 轨。
