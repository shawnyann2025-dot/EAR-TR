# P-2b-H 和声轨生成器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让调度器发出的全部 H 轨（和声，26 个知识点）`ExerciseSpec` 都能生成可播放、可作答、可判定的 `Exercise`。

**Architecture:** 复用 P-2b-T 已落地的管线（`generate` → 变异轴 → 内容 → 语境 → 反馈）。新增 FWD-3 的 `voiceChord`（music 层）、H 轨数据表、四组生成器（品质与功能和弦、整条进行、转位与低音线），并在 `lookupGenerator` 追加 H 分支。每道和弦题先算出全部音高（内容、反馈、唱的目标），再**整题统一移同一个八度**落入 MIDI 36–96，保证转位与低音走向不被逐音折叠破坏（P-2b spec §14）。

**Tech Stack:** TypeScript、vitest。无新依赖。

**Spec:** `docs/superpowers/specs/2026-10-13-p2b-exercise-generators-design.md`（P-2b spec）§7.3、§12 第二行、§14 的三条 P-2b-H 约束。主 spec：`docs/superpowers/specs/2026-08-24-ear-training-design.md` §6、§16.2 FWD-3。

## Global Constraints

- `src/exercises/` 只依赖 `src/music/`、`src/curriculum/`、`src/scheduling/exerciseSpec.ts`；不得依赖 `src/audio/`、`src/simulation/`（测试文件除外）。
- 零 IO：不得出现 `Math.random`、`Date.now`、`window.`、`document.`。随机性只来自传入的 `rng`。
- rng 消耗顺序固定为「变异轴 → 内容 → 选项打乱」：每个生成器先抽完内容，最后才调用 `pickOptions`。
- 整份 plan 的音高必须落在 MIDI 36–96。**H 轨题目内容不得依赖逐音折叠**：内容、反馈、唱的目标在生成器内整体移八度落入区间（P-2b spec §14）。
- 和弦与音级同一锚点：根音用 `degreeToMidiFromTonic` 放在 [主音, 主音+11]；`doMidi` 由管线的 `doMidiFor` 给出（小调主音居中）。
- 不改 `chordToMidi` 的行为（主 spec FWD-3）。
- 唱模态音高容差固定 50 音分；唱的每个目标音预留 `SING_NOTE_SEC = 1.0` 秒（沿用 `generators/degree.ts`）。
- 和弦题的速度规则：听辨单和弦时长 = `recognizeNoteSec × (BASE_BPM / bpm)`；进行与听写里每个和弦占 2 拍 = `2 × 60 / bpm` 秒，音符时值取其 0.9。
- 测试命令：`npx vitest run <path>`；全量 `npx vitest run`；类型 `npx tsc --noEmit`；构建 `npx vite build`。
- 每个任务结束提交一次，提交信息以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾。

## File Structure

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/music/chord.ts`（改） | `voiceChord`、`Voicing`（FWD-3） | 1 |
| `src/exercises/difficulty.ts`（改） | `DifficultyParams` 改为由表推导的映射类型 | 2 |
| `src/exercises/context.ts`（改） | `octaveOffsetToFit` | 2 |
| `src/exercises/types.ts`（改） | `PromptId` 增加 `notate-qualities`、`notate-inversions` | 2 |
| `src/exercises/generators/chordCommon.ts` | 和弦音高、音符排布、整题移八度、唱的目标 | 2 |
| `src/exercises/data/chords.ts` | H 轨数据表、功能和弦查找、低音线模板 | 3 |
| `src/exercises/generators/chord.ts` | 品质与功能和弦三模态 | 4 |
| `src/exercises/generators/progression.ts` | 整条进行三模态 | 5 |
| `src/exercises/generators/inversion.ts` | 转位与低音线三模态 | 6 |
| `src/exercises/generate.ts`（改） | `lookupGenerator` 追加 H 分支 | 7 |
| `src/exercises/integration.test.ts`（改） | 集成守卫扩到 H 轨 | 8 |

---

### Task 1: `voiceChord`——独立低音声部（FWD-3）

**Files:**
- Modify: `src/music/chord.ts`（文件末尾追加）
- Test: `src/music/voiceChord.test.ts`（新建）

**Interfaces:**
- Consumes: `Chord`、`QUALITY_INTERVALS`（chord.ts 已有）
- Produces:
  - `export interface Voicing { bassMidi: number; upperMidis: number[] }`
  - `export function voiceChord(chord: Chord, rootMidi: number): Voicing` —— `upperMidis` 是从 `rootMidi` 起的原位密集排列；`bassMidi` 是 `chord.inversion` 指定的那个和弦音（0 根音、1 三音、2 五音、3 七音，按音数取模），放在 `rootMidi` 下方一个八度的区域：`rootMidi + interval - 12`

- [ ] **Step 1: 写失败的测试**

`src/music/voiceChord.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { QUALITY_INTERVALS, chordToMidi, voiceChord, type ChordQuality } from './chord'

const C = (inversion: number, quality: ChordQuality = 'maj') => ({
  rootDegree: 'do' as const,
  quality,
  inversion,
})

describe('voiceChord（FWD-3：独立低音声部）', () => {
  it('上方声部是从根音起的原位密集排列', () => {
    expect(voiceChord(C(0), 60).upperMidis).toEqual([60, 64, 67])
    expect(voiceChord(C(2), 60).upperMidis).toEqual([60, 64, 67])
    expect(voiceChord(C(0, 'dom7'), 60).upperMidis).toEqual([60, 64, 67, 70])
  })

  it('低音是转位指定的和弦音，落在根音下方一个八度的区域', () => {
    expect(voiceChord(C(0), 60).bassMidi).toBe(48) // C
    expect(voiceChord(C(1), 60).bassMidi).toBe(52) // E
    expect(voiceChord(C(2), 60).bassMidi).toBe(55) // G
    expect(voiceChord(C(3, 'dom7'), 60).bassMidi).toBe(58) // B♭
  })

  it('转位数按音数取模', () => {
    expect(voiceChord(C(3), 60).bassMidi).toBe(48)
    expect(voiceChord(C(-1), 60).bassMidi).toBe(55)
  })

  it('任意品质、任意转位：低音严格低于全部上方声部', () => {
    for (const quality of Object.keys(QUALITY_INTERVALS) as ChordQuality[]) {
      for (let inversion = 0; inversion < 4; inversion++) {
        const v = voiceChord(C(inversion, quality), 60)
        expect(v.bassMidi).toBeLessThan(Math.min(...v.upperMidis))
      }
    }
  })

  it('不改 chordToMidi 的既有行为（二转 C 和弦仍是向上旋转的 [67,72,76]）', () => {
    expect(chordToMidi(C(2), 60)).toEqual([67, 72, 76])
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/music/voiceChord.test.ts`
Expected: FAIL —— `voiceChord` 不是导出成员

- [ ] **Step 3: 写实现**

`src/music/chord.ts` 末尾追加：

```ts
export interface Voicing {
  /** 低音声部（单音） */
  bassMidi: number
  /** 上方声部：从根音起的原位密集排列 */
  upperMidis: number[]
}

/**
 * 带独立低音声部的排列（FWD-3）。
 *
 * chordToMidi 把转位做成「向上旋转」，低音会被推高（二转 C 的低音是 G4）——
 * 对 H6 的转位与低音线听辨不够用。这里让低音待在低音区：低音取转位指定的
 * 和弦音、放在根音下方一个八度的区域；上方声部保持原位密集。
 * 低音最高为 rootMidi + 11 - 12 = rootMidi - 1，故严格低于全部上方声部。
 * 不改 chordToMidi——它对 H1–H5 的行为是正确的。
 */
export function voiceChord(chord: Chord, rootMidi: number): Voicing {
  const intervals = QUALITY_INTERVALS[chord.quality]
  const n = intervals.length
  const inv = ((chord.inversion % n) + n) % n
  return {
    bassMidi: rootMidi + intervals[inv] - 12,
    upperMidis: intervals.map((i) => rootMidi + i),
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/music/`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/music/chord.ts src/music/voiceChord.test.ts
git commit -m "feat(music): voiceChord 独立低音声部（FWD-3）" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: H 轨共享层——映射类型、整题移八度、和弦公共函数

**Files:**
- Modify: `src/exercises/difficulty.ts`（`DifficultyParams` 的定义）
- Modify: `src/exercises/context.ts`（末尾追加 `octaveOffsetToFit`）
- Modify: `src/exercises/types.ts`（`PromptId` 增加两个字面量）
- Create: `src/exercises/generators/chordCommon.ts`
- Test: `src/exercises/context.test.ts`（末尾追加 describe）
- Test: `src/exercises/generators/chordCommon.test.ts`（新建）

**Interfaces:**
- Consumes: `chordToMidi`/`Chord`（music/chord）、`degreeToMidi`/`degreeToMidiFromTonic`（music/register）、`DEGREE_SEMITONES`/`SCALE_DEGREES`/`Key`/`ScaleDegree`（music/key）、`midiToFreq`、`BASE_BPM`/`SING_CENTS_TOLERANCE`（difficulty）、`PLAN_MIDI_MIN`/`PLAN_MIDI_MAX`（context）
- Produces:
  - `difficulty.ts`：`export type DifficultyParams = { -readonly [K in keyof typeof DIFFICULTY_TABLE]: number }`（取代现有的显式 interface；字段名与类型不变）
  - `context.ts`：`export function octaveOffsetToFit(midis: readonly number[]): number` —— 返回绝对值最小的 12 的倍数 k，使 `min+k ≥ 36` 且 `max+k ≤ 96`；空数组返回 0；无解时抛错
  - `types.ts`：`PromptId` 增加 `'notate-qualities' | 'notate-inversions'`
  - `chordCommon.ts`：
    - `export const CHORD_BEATS = 2`、`export const ARPEGGIO_STEP_SEC = 0.18`、`export const CHORD_LEGATO = 0.9`
    - `export function chordRootMidi(chord: Chord, key: Key, doMidi: number): number`
    - `export function chordMidis(chord: Chord, key: Key, doMidi: number): number[]`
    - `export function degreeAbove(degree: ScaleDegree, semitones: number): ScaleDegree`
    - `export function chordNotes(midis: readonly number[], atSec: number, durSec: number, gain: number, presentation: 'block' | 'arpeggio', bpm: number): NoteSpec[]`
    - `export function chordSlotSec(bpm: number): number`（= `CHORD_BEATS * 60 / bpm`）
    - `export interface FittedItem { notes: NoteSpec[]; feedbackNotes: NoteSpec[]; targetMidis: number[] }`
    - `export function fitItem(item: FittedItem): FittedItem` —— 用 `octaveOffsetToFit` 对三组的全部音高求同一个偏移并整体平移
    - `export function pitchTargets(degrees: readonly ScaleDegree[], midis: readonly number[]): PitchTarget[]`
    - `export function sungSequence(midis: readonly number[], gain: number, startSec?: number): NoteSpec[]`（每个音 `SING_NOTE_SEC`，依次排开）

- [ ] **Step 1: 改 `DifficultyParams` 为映射类型**

在 `src/exercises/difficulty.ts` 中找到 `export interface DifficultyParams {` 起、到其右花括号 `}` 止的整段显式 interface，替换为：

```ts
/** 由表推导，去掉 as const 带来的 readonly——加表行时类型自动跟上（P-2b spec §14） */
export type DifficultyParams = { -readonly [K in keyof typeof DIFFICULTY_TABLE]: number }
```

Run: `npx tsc --noEmit && npx vitest run src/exercises/difficulty.test.ts`
Expected: tsc 无输出；PASS（字段名与类型不变，既有测试不受影响）

- [ ] **Step 2: 给 `PromptId` 加两个字面量**

在 `src/exercises/types.ts` 的 `PromptId` 联合里，把这一行：

```ts
  | 'which-quality' | 'which-chord' | 'sing-arpeggio' | 'notate-chords'
```

改为：

```ts
  | 'which-quality' | 'which-chord' | 'sing-arpeggio' | 'notate-chords' | 'notate-qualities'
```

把这一行：

```ts
  | 'which-inversion' | 'which-bass-contour' | 'notate-bassline'
```

改为：

```ts
  | 'which-inversion' | 'which-bass-contour' | 'notate-bassline' | 'notate-inversions'
```

- [ ] **Step 3: 写失败的测试**

在 `src/exercises/context.test.ts` 顶部的 import 里加入 `octaveOffsetToFit`（从 `./context`），并在文件末尾追加：

```ts
describe('octaveOffsetToFit（整题统一移八度，P-2b spec §14）', () => {
  it('已在区间内：不移', () => {
    expect(octaveOffsetToFit([40, 60, 90])).toBe(0)
  })

  it('太低：上移最少的整八度', () => {
    expect(octaveOffsetToFit([25, 50, 70])).toBe(12)
    expect(octaveOffsetToFit([13, 20])).toBe(24)
  })

  it('太高：下移最少的整八度', () => {
    expect(octaveOffsetToFit([60, 100])).toBe(-12)
  })

  it('边界本身合法', () => {
    expect(octaveOffsetToFit([36, 96])).toBe(0)
  })

  it('空数组返回 0', () => {
    expect(octaveOffsetToFit([])).toBe(0)
  })

  it('无整八度解时抛错', () => {
    expect(() => octaveOffsetToFit([30, 95])).toThrow(/30/)
    expect(() => octaveOffsetToFit([35, 90])).toThrow(/35/)
  })
})
```

`src/exercises/generators/chordCommon.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import type { Chord } from '../../music/chord'
import type { Key } from '../../music/key'
import { midiToFreq } from '../../music/pitch'
import { SING_NOTE_SEC } from './degree'
import {
  ARPEGGIO_STEP_SEC,
  chordMidis,
  chordNotes,
  chordRootMidi,
  chordSlotSec,
  degreeAbove,
  fitItem,
  pitchTargets,
  sungSequence,
} from './chordCommon'

const C: Key = { tonic: 0, mode: 'major' }
const Am: Key = { tonic: 9, mode: 'minor' }
const chord = (rootDegree: Chord['rootDegree'], quality: Chord['quality'] = 'maj'): Chord => ({
  rootDegree, quality, inversion: 0,
})

describe('chordRootMidi / chordMidis：根音以主音为锚', () => {
  it('C 大调 doMidi=60：V 的根音 G 落在 67（主音之上），原位密集', () => {
    expect(chordRootMidi(chord('sol'), C, 60)).toBe(67)
    expect(chordMidis(chord('sol'), C, 60)).toEqual([67, 71, 74])
  })

  it('a 小调 doMidi=48（主音 la=57）：i 的根音落在 57，iv 的根音 re 落在 62', () => {
    expect(chordMidis(chord('la', 'min'), Am, 48)).toEqual([57, 60, 64])
    expect(chordRootMidi(chord('re', 'min'), Am, 48)).toBe(62)
  })

  it('根音总在 [主音, 主音+11]', () => {
    for (const d of ['do', 're', 'mi', 'fa', 'sol', 'la', 'ti', 'te', 'le'] as const) {
      const r = chordRootMidi(chord(d), C, 60)
      expect(r).toBeGreaterThanOrEqual(60)
      expect(r).toBeLessThanOrEqual(71)
    }
  })
})

describe('degreeAbove', () => {
  it('按半音数求上方音级', () => {
    expect(degreeAbove('do', 4)).toBe('mi')
    expect(degreeAbove('sol', 4)).toBe('ti')
    expect(degreeAbove('la', 3)).toBe('do')
    expect(degreeAbove('ti', 2)).toBe('ra')
  })
})

describe('chordNotes', () => {
  it('block：同时起音、同时值、同 gain', () => {
    const notes = chordNotes([60, 64, 67], 1, 0.8, 0.7, 'block', 90)
    expect(notes.map((n) => n.atSec)).toEqual([1, 1, 1])
    expect(notes.every((n) => n.durSec === 0.8 && n.gain === 0.7)).toBe(true)
  })

  it('arpeggio：依次起音，步长随速度缩放，全部在同一时刻结束', () => {
    const notes = chordNotes([60, 64, 67], 0, 0.9, 0.7, 'arpeggio', 90)
    expect(notes.map((n) => n.atSec)).toEqual([0, ARPEGGIO_STEP_SEC, 2 * ARPEGGIO_STEP_SEC])
    for (const n of notes) expect(n.atSec + n.durSec).toBeCloseTo(0.9, 12)
  })

  it('chordSlotSec：两拍', () => {
    expect(chordSlotSec(120)).toBeCloseTo(1, 12)
  })
})

describe('fitItem：三组音高整体移同一个八度', () => {
  it('低音区的题整体上移，组内与组间音程不变', () => {
    const item = {
      notes: [{ midi: 25, atSec: 0, durSec: 1 }, { midi: 60, atSec: 0, durSec: 1 }],
      feedbackNotes: [{ midi: 30, atSec: 0, durSec: 1 }],
      targetMidis: [40],
    }
    const fit = fitItem(item)
    expect(fit.notes.map((n) => n.midi)).toEqual([37, 72])
    expect(fit.feedbackNotes.map((n) => n.midi)).toEqual([42])
    expect(fit.targetMidis).toEqual([52])
  })

  it('已在区间内则原样返回，且不修改输入', () => {
    const item = { notes: [{ midi: 60, atSec: 0, durSec: 1 }], feedbackNotes: [], targetMidis: [] }
    expect(fitItem(item)).toEqual(item)
    expect(item.notes[0].midi).toBe(60)
  })
})

describe('pitchTargets / sungSequence', () => {
  it('目标音带频率与 50 音分容差', () => {
    expect(pitchTargets(['do', 'mi'], [60, 64])).toEqual([
      { degree: 'do', midi: 60, freqHz: midiToFreq(60), centsTolerance: 50 },
      { degree: 'mi', midi: 64, freqHz: midiToFreq(64), centsTolerance: 50 },
    ])
  })

  it('长度不一致时抛错', () => {
    expect(() => pitchTargets(['do'], [60, 64])).toThrow()
  })

  it('依次排开，每个音 SING_NOTE_SEC', () => {
    const seq = sungSequence([60, 64], 0.8, 2)
    expect(seq).toEqual([
      { midi: 60, atSec: 2, durSec: SING_NOTE_SEC, gain: 0.8 },
      { midi: 64, atSec: 2 + SING_NOTE_SEC, durSec: SING_NOTE_SEC, gain: 0.8 },
    ])
  })
})
```

- [ ] **Step 4: 运行测试，确认失败**

Run: `npx vitest run src/exercises/context.test.ts src/exercises/generators/chordCommon.test.ts`
Expected: FAIL —— `octaveOffsetToFit` 不是导出成员；无法解析模块 `./chordCommon`

- [ ] **Step 5: 写实现**

`src/exercises/context.ts` 末尾追加：

```ts
/**
 * 整题统一移八度的偏移（P-2b spec §14）：绝对值最小的 12 的倍数 k，
 * 使 min+k ≥ PLAN_MIDI_MIN 且 max+k ≤ PLAN_MIDI_MAX。
 *
 * 和弦题必须用它而不是逐音折叠：逐音折叠会把低音抬到上方声部之上，
 * 改变听到的转位——而转位正是 H6 题的答案。
 */
export function octaveOffsetToFit(midis: readonly number[]): number {
  if (midis.length === 0) return 0
  const lo = Math.min(...midis)
  const hi = Math.max(...midis)
  let k = 0
  while (lo + k < PLAN_MIDI_MIN) k += 12
  while (hi + k > PLAN_MIDI_MAX) k -= 12
  if (lo + k < PLAN_MIDI_MIN) {
    throw new Error(`无法用整八度把 MIDI ${lo}–${hi} 移入 ${PLAN_MIDI_MIN}–${PLAN_MIDI_MAX}`)
  }
  return k
}
```

`src/exercises/generators/chordCommon.ts`：

```ts
import { chordToMidi, type Chord } from '../../music/chord'
import { DEGREE_SEMITONES, SCALE_DEGREES, type Key, type ScaleDegree } from '../../music/key'
import { midiToFreq } from '../../music/pitch'
import type { NoteSpec } from '../../music/playback'
import { degreeToMidi, degreeToMidiFromTonic } from '../../music/register'
import { octaveOffsetToFit } from '../context'
import { BASE_BPM, SING_CENTS_TOLERANCE } from '../difficulty'
import type { PitchTarget } from '../types'
import { SING_NOTE_SEC } from './degree'

/** 进行与听写里每个和弦占几拍 */
export const CHORD_BEATS = 2
/** 琶音呈现时相邻和弦音的起音间隔（秒，以 BASE_BPM 为基准） */
export const ARPEGGIO_STEP_SEC = 0.18
/** 和弦占位里实际发声的比例，留一点空隙让和弦交替清楚 */
export const CHORD_LEGATO = 0.9

/** 根音落在 [主音, 主音+11]——与 T 轨音级同一锚点（P-2b spec §7.2、§14） */
export function chordRootMidi(chord: Chord, key: Key, doMidi: number): number {
  return degreeToMidiFromTonic(chord.rootDegree, key, doMidi)
}

/** 原位（或 chord.inversion 指定的向上旋转）密集排列，整体挪到以主音为锚的八度 */
export function chordMidis(chord: Chord, key: Key, doMidi: number): number[] {
  const shift = chordRootMidi(chord, key, doMidi) - degreeToMidi(chord.rootDegree, doMidi)
  return chordToMidi(chord, doMidi).map((m) => m + shift)
}

export function degreeAbove(degree: ScaleDegree, semitones: number): ScaleDegree {
  return SCALE_DEGREES[(((DEGREE_SEMITONES[degree] + semitones) % 12) + 12) % 12]
}

export function chordSlotSec(bpm: number): number {
  return (CHORD_BEATS * 60) / bpm
}

/** block：同时起音；arpeggio：依次起音、同时结束（主 spec §6.2 呈现方式轴） */
export function chordNotes(
  midis: readonly number[],
  atSec: number,
  durSec: number,
  gain: number,
  presentation: 'block' | 'arpeggio',
  bpm: number,
): NoteSpec[] {
  if (presentation === 'block') {
    return midis.map((midi) => ({ midi, atSec, durSec, gain }))
  }
  const step = ARPEGGIO_STEP_SEC * (BASE_BPM / bpm)
  return midis.map((midi, i) => ({
    midi,
    atSec: atSec + i * step,
    durSec: Math.max(step, durSec - i * step),
    gain,
  }))
}

export interface FittedItem {
  notes: NoteSpec[]
  feedbackNotes: NoteSpec[]
  targetMidis: number[]
}

/**
 * 整题统一移同一个八度（P-2b spec §14）：内容、反馈、唱的目标三组一起算偏移、
 * 一起平移，组内与组间的音程（含低音与上方声部的关系）完全保留。
 */
export function fitItem(item: FittedItem): FittedItem {
  const k = octaveOffsetToFit([
    ...item.notes.map((n) => n.midi),
    ...item.feedbackNotes.map((n) => n.midi),
    ...item.targetMidis,
  ])
  if (k === 0) return item
  return {
    notes: item.notes.map((n) => ({ ...n, midi: n.midi + k })),
    feedbackNotes: item.feedbackNotes.map((n) => ({ ...n, midi: n.midi + k })),
    targetMidis: item.targetMidis.map((m) => m + k),
  }
}

export function pitchTargets(
  degrees: readonly ScaleDegree[],
  midis: readonly number[],
): PitchTarget[] {
  if (degrees.length !== midis.length) {
    throw new Error(`唱的目标音级数 ${degrees.length} 与音高数 ${midis.length} 不一致`)
  }
  return degrees.map((degree, i) => ({
    degree,
    midi: midis[i],
    freqHz: midiToFreq(midis[i]),
    centsTolerance: SING_CENTS_TOLERANCE,
  }))
}

/** 唱的目标音依次排开（反馈里放给学习者听） */
export function sungSequence(
  midis: readonly number[],
  gain: number,
  startSec = 0,
): NoteSpec[] {
  return midis.map((midi, i) => ({
    midi,
    atSec: startSec + i * SING_NOTE_SEC,
    durSec: SING_NOTE_SEC,
    gain,
  }))
}
```

- [ ] **Step 6: 运行测试与类型检查，确认通过**

Run: `npx vitest run src/exercises/ && npx tsc --noEmit`
Expected: PASS，tsc 无输出

- [ ] **Step 7: 提交**

```bash
git add src/exercises/
git commit -m "feat(exercises): H 轨共享层——整题移八度、和弦公共函数、映射类型" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: H 轨数据表与覆盖测试

**Files:**
- Create: `src/exercises/data/chords.ts`
- Test: `src/exercises/data/chords.test.ts`

**Interfaces:**
- Consumes: `makeKpId`/`KnowledgePointId`（curriculum/knowledgePoints）、`Chord`/`QUALITY_INTERVALS`（music/chord）、`Mode`（music/key）、`degreeAbove`（Task 2，仅测试用）
- Produces:
  - `export type ChordFamily = 'quality' | 'functional' | 'progression' | 'inversion' | 'bassline'`
  - `export type ChordPool = 'quality' | 'major-functional' | 'minor-functional' | 'major-progression' | 'minor-progression' | 'inversion' | 'bassline'`
  - `export type ChordEntry = QualityEntry | FunctionalEntry | ProgressionEntry | InversionEntry | BasslineEntry`，共有字段 `{ kpId; mode: Mode; pool: ChordPool; answerId: string; family }`；各自额外字段：`QualityEntry.quality: 'maj' | 'min'`、`FunctionalEntry.chord: Chord`、`ProgressionEntry.chordIds: readonly string[]`、`InversionEntry.inversion: 1 | 2`
  - `export const CHORD_ENTRIES: readonly ChordEntry[]`（26 行）
  - `export function chordEntry(kpId): ChordEntry | undefined`、`export function requireChordEntry(kpId): ChordEntry`、`export function chordPoolOf(kpId): ChordPool | undefined`
  - `export function functionalChord(mode: Mode, answerId: string): Chord`（找不到抛错）
  - `export const QUALITY_IDS = ['maj', 'min'] as const`
  - `export const INVERSION_IDS = ['root', 'first', 'second'] as const`、`export const INVERSION_OF: Record<(typeof INVERSION_IDS)[number], number>`（`root:0, first:1, second:2`）
  - `export const TONIC_CHORD_ID: Record<Mode, string>`（`major:'I', minor:'i'`）
  - `export const INVERSION_CHORD_IDS = ['I', 'IV', 'V'] as const`
  - `export interface BasslinePattern { id: string; steps: readonly { chordId: string; inversion: number }[] }`
  - `export const BASSLINE_PATTERNS: readonly BasslinePattern[]`（4 条，id 等于低音音级用 `-` 连接）

- [ ] **Step 1: 写失败的测试**

`src/exercises/data/chords.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../../curriculum/curriculum'
import { QUALITY_INTERVALS } from '../../music/chord'
import { degreeAbove } from '../generators/chordCommon'
import {
  BASSLINE_PATTERNS,
  CHORD_ENTRIES,
  INVERSION_CHORD_IDS,
  TONIC_CHORD_ID,
  chordEntry,
  chordPoolOf,
  functionalChord,
  requireChordEntry,
} from './chords'

const c = buildCurriculum()
const H_KPS = [...c.knowledgePoints.values()].filter((kp) => kp.track === 'H').map((kp) => kp.id)

describe('H 轨数据表覆盖', () => {
  it('课程里每个 H 轨知识点恰好有一行，且没有多余的行', () => {
    expect(CHORD_ENTRIES.map((e) => e.kpId).sort()).toEqual([...H_KPS].sort())
  })

  it('共 26 个知识点，kpId 不重复', () => {
    expect(CHORD_ENTRIES).toHaveLength(26)
    expect(new Set(CHORD_ENTRIES.map((e) => e.kpId)).size).toBe(26)
  })

  it('同一池内 answerId 不重复（否则选项 id 会撞）', () => {
    const pools = new Set(CHORD_ENTRIES.map((e) => e.pool))
    for (const pool of pools) {
      const ids = CHORD_ENTRIES.filter((e) => e.pool === pool).map((e) => e.answerId)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

describe('音乐含义', () => {
  const chordOf = (kp: string) => {
    const e = requireChordEntry(kp)
    if (e.family !== 'functional') throw new Error(`${kp} 不是功能和弦`)
    return e.chord
  }

  it('大调功能和弦', () => {
    expect(chordOf('chord:I')).toEqual({ rootDegree: 'do', quality: 'maj', inversion: 0 })
    expect(chordOf('chord:V7')).toEqual({ rootDegree: 'sol', quality: 'dom7', inversion: 0 })
    expect(chordOf('chord:ii7')).toEqual({ rootDegree: 're', quality: 'min7', inversion: 0 })
    expect(chordOf('chord:V-of-V')).toEqual({ rootDegree: 're', quality: 'maj', inversion: 0 })
    expect(chordOf('chord:borrowed-bVI')).toEqual({ rootDegree: 'le', quality: 'maj', inversion: 0 })
    expect(chordOf('chord:borrowed-bVII')).toEqual({ rootDegree: 'te', quality: 'maj', inversion: 0 })
  })

  it('小调功能和弦（la 基）', () => {
    expect(chordOf('chord:i')).toEqual({ rootDegree: 'la', quality: 'min', inversion: 0 })
    expect(chordOf('chord:iv')).toEqual({ rootDegree: 're', quality: 'min', inversion: 0 })
    expect(chordOf('chord:III')).toEqual({ rootDegree: 'do', quality: 'maj', inversion: 0 })
    expect(chordOf('chord:VI')).toEqual({ rootDegree: 'fa', quality: 'maj', inversion: 0 })
    expect(chordOf('chord:VII')).toEqual({ rootDegree: 'sol', quality: 'maj', inversion: 0 })
    for (const kp of ['chord:i', 'chord:iv', 'chord:III', 'chord:VI', 'chord:VII']) {
      expect(requireChordEntry(kp)).toMatchObject({ mode: 'minor', pool: 'minor-functional' })
    }
  })

  it('副属与借用归大调功能池', () => {
    for (const kp of ['chord:V-of-V', 'chord:borrowed-bVI', 'chord:borrowed-bVII']) {
      expect(requireChordEntry(kp)).toMatchObject({ mode: 'major', pool: 'major-functional' })
    }
  })

  it('进行的 answerId 等于和弦 id 用 - 连接，且每个和弦都能在同调式的功能和弦里找到', () => {
    for (const e of CHORD_ENTRIES) {
      if (e.family !== 'progression') continue
      expect(e.answerId).toBe(e.chordIds.join('-'))
      for (const id of e.chordIds) expect(() => functionalChord(e.mode, id)).not.toThrow()
    }
    expect(requireChordEntry('prog:i-VI-III-VII')).toMatchObject({ mode: 'minor', pool: 'minor-progression' })
  })

  it('品质与转位', () => {
    expect(requireChordEntry('chord:quality-min')).toMatchObject({ family: 'quality', quality: 'min', answerId: 'min' })
    expect(requireChordEntry('chord:inv-second')).toMatchObject({ family: 'inversion', inversion: 2, answerId: 'second' })
    expect(requireChordEntry('chord:bassline')).toMatchObject({ family: 'bassline', pool: 'bassline' })
  })

  it('主和弦 id 与转位题用的和弦都存在', () => {
    expect(functionalChord('major', TONIC_CHORD_ID.major).rootDegree).toBe('do')
    expect(functionalChord('minor', TONIC_CHORD_ID.minor).rootDegree).toBe('la')
    for (const id of INVERSION_CHORD_IDS) expect(() => functionalChord('major', id)).not.toThrow()
  })
})

describe('低音线模板', () => {
  it('4 条，id 互不相同，id 等于各步低音音级用 - 连接', () => {
    expect(BASSLINE_PATTERNS).toHaveLength(4)
    expect(new Set(BASSLINE_PATTERNS.map((p) => p.id)).size).toBe(4)
    for (const p of BASSLINE_PATTERNS) {
      const bass = p.steps.map((s) => {
        const ch = functionalChord('major', s.chordId)
        return degreeAbove(ch.rootDegree, QUALITY_INTERVALS[ch.quality][s.inversion])
      })
      expect(bass.join('-')).toBe(p.id)
    }
  })
})

describe('查找', () => {
  it('未知 kpId', () => {
    expect(chordEntry('degree:major:do')).toBeUndefined()
    expect(chordPoolOf('degree:major:do')).toBeUndefined()
    expect(() => requireChordEntry('chord:nope')).toThrow(/chord:nope/)
    expect(() => functionalChord('minor', 'V7')).toThrow(/V7/)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/data/chords.test.ts`
Expected: FAIL —— 无法解析模块 `./chords`

- [ ] **Step 3: 写实现**

`src/exercises/data/chords.ts`：

```ts
import { makeKpId, type KnowledgePointId } from '../../curriculum/knowledgePoints'
import type { Chord, ChordQuality } from '../../music/chord'
import type { Mode, ScaleDegree } from '../../music/key'

export type ChordFamily = 'quality' | 'functional' | 'progression' | 'inversion' | 'bassline'
export type ChordPool =
  | 'quality'
  | 'major-functional'
  | 'minor-functional'
  | 'major-progression'
  | 'minor-progression'
  | 'inversion'
  | 'bassline'

interface EntryBase {
  kpId: KnowledgePointId
  mode: Mode
  pool: ChordPool
  /** 作答用的语义 id，同池内唯一 */
  answerId: string
}

export interface QualityEntry extends EntryBase {
  family: 'quality'
  quality: 'maj' | 'min'
}
export interface FunctionalEntry extends EntryBase {
  family: 'functional'
  chord: Chord
}
export interface ProgressionEntry extends EntryBase {
  family: 'progression'
  /** 同调式功能和弦的 answerId */
  chordIds: readonly string[]
}
export interface InversionEntry extends EntryBase {
  family: 'inversion'
  inversion: 1 | 2
}
export interface BasslineEntry extends EntryBase {
  family: 'bassline'
}
export type ChordEntry =
  | QualityEntry
  | FunctionalEntry
  | ProgressionEntry
  | InversionEntry
  | BasslineEntry

const C = (name: string) => makeKpId('chord', name)
const P = (name: string) => makeKpId('prog', name)

const fn = (
  name: string,
  mode: Mode,
  answerId: string,
  rootDegree: ScaleDegree,
  quality: ChordQuality,
): FunctionalEntry => ({
  kpId: C(name),
  mode,
  pool: mode === 'major' ? 'major-functional' : 'minor-functional',
  answerId,
  family: 'functional',
  chord: { rootDegree, quality, inversion: 0 },
})

const prog = (name: string, mode: Mode): ProgressionEntry => ({
  kpId: P(name),
  mode,
  pool: mode === 'major' ? 'major-progression' : 'minor-progression',
  answerId: name,
  family: 'progression',
  chordIds: name.split('-'),
})

/** H 轨知识点的音乐含义（P-2b spec §7.3）。增加知识点 = 加一行 */
export const CHORD_ENTRIES: readonly ChordEntry[] = [
  { kpId: C('quality-maj'), mode: 'major', pool: 'quality', answerId: 'maj', family: 'quality', quality: 'maj' },
  { kpId: C('quality-min'), mode: 'major', pool: 'quality', answerId: 'min', family: 'quality', quality: 'min' },
  fn('I', 'major', 'I', 'do', 'maj'),
  fn('IV', 'major', 'IV', 'fa', 'maj'),
  fn('V', 'major', 'V', 'sol', 'maj'),
  fn('vi', 'major', 'vi', 'la', 'min'),
  fn('ii', 'major', 'ii', 're', 'min'),
  fn('V7', 'major', 'V7', 'sol', 'dom7'),
  fn('Imaj7', 'major', 'Imaj7', 'do', 'maj7'),
  fn('ii7', 'major', 'ii7', 're', 'min7'),
  fn('vi7', 'major', 'vi7', 'la', 'min7'),
  fn('V-of-V', 'major', 'V/V', 're', 'maj'),
  fn('borrowed-bVI', 'major', 'bVI', 'le', 'maj'),
  fn('borrowed-bVII', 'major', 'bVII', 'te', 'maj'),
  // 小调（la 基）：主音 la，do 是三级
  fn('i', 'minor', 'i', 'la', 'min'),
  fn('iv', 'minor', 'iv', 're', 'min'),
  fn('III', 'minor', 'III', 'do', 'maj'),
  fn('VI', 'minor', 'VI', 'fa', 'maj'),
  fn('VII', 'minor', 'VII', 'sol', 'maj'),
  prog('I-V-vi-IV', 'major'),
  prog('vi-IV-I-V', 'major'),
  prog('I-vi-IV-V', 'major'),
  prog('i-VI-III-VII', 'minor'),
  { kpId: C('inv-first'), mode: 'major', pool: 'inversion', answerId: 'first', family: 'inversion', inversion: 1 },
  { kpId: C('inv-second'), mode: 'major', pool: 'inversion', answerId: 'second', family: 'inversion', inversion: 2 },
  { kpId: C('bassline'), mode: 'major', pool: 'bassline', answerId: 'bassline', family: 'bassline' },
]

const BY_ID = new Map(CHORD_ENTRIES.map((e) => [e.kpId, e]))

export function chordEntry(kpId: KnowledgePointId): ChordEntry | undefined {
  return BY_ID.get(kpId)
}

export function requireChordEntry(kpId: KnowledgePointId): ChordEntry {
  const e = BY_ID.get(kpId)
  if (!e) throw new Error(`H 轨数据表没有知识点 ${kpId}`)
  return e
}

export function chordPoolOf(kpId: KnowledgePointId): ChordPool | undefined {
  return BY_ID.get(kpId)?.pool
}

export function functionalChord(mode: Mode, answerId: string): Chord {
  const e = CHORD_ENTRIES.find(
    (x): x is FunctionalEntry => x.family === 'functional' && x.mode === mode && x.answerId === answerId,
  )
  if (!e) throw new Error(`没有 ${mode} 调式的功能和弦 ${answerId}`)
  return e.chord
}

export const QUALITY_IDS = ['maj', 'min'] as const

export const INVERSION_IDS = ['root', 'first', 'second'] as const
export const INVERSION_OF: Record<(typeof INVERSION_IDS)[number], number> = {
  root: 0,
  first: 1,
  second: 2,
}

export const TONIC_CHORD_ID: Record<Mode, string> = { major: 'I', minor: 'i' }

/** 转位题从这三个和弦里抽（H6 的前置是 I/IV/V） */
export const INVERSION_CHORD_IDS = ['I', 'IV', 'V'] as const

export interface BasslinePattern {
  /** 低音音级用 - 连接，也是听辨题的选项 id */
  id: string
  steps: readonly { chordId: string; inversion: number }[]
}

/** 低音线模板（大调）：四条走向各不相同，两条下行两条上行 */
export const BASSLINE_PATTERNS: readonly BasslinePattern[] = [
  { id: 'do-ti-la-fa', steps: [{ chordId: 'I', inversion: 0 }, { chordId: 'V', inversion: 1 }, { chordId: 'vi', inversion: 0 }, { chordId: 'IV', inversion: 0 }] },
  { id: 'do-mi-fa-sol', steps: [{ chordId: 'I', inversion: 0 }, { chordId: 'I', inversion: 1 }, { chordId: 'IV', inversion: 0 }, { chordId: 'V', inversion: 0 }] },
  { id: 'do-re-mi-fa', steps: [{ chordId: 'I', inversion: 0 }, { chordId: 'V', inversion: 2 }, { chordId: 'I', inversion: 1 }, { chordId: 'IV', inversion: 0 }] },
  { id: 'fa-sol-la-ti', steps: [{ chordId: 'IV', inversion: 0 }, { chordId: 'V', inversion: 0 }, { chordId: 'vi', inversion: 0 }, { chordId: 'V', inversion: 1 }] },
]
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/exercises/data/chords.test.ts`
Expected: PASS。若覆盖测试失败，先核对 `src/curriculum/tracks.ts` 的 H 轨知识点名，修数据表，不改测试。

- [ ] **Step 5: 提交**

```bash
git add src/exercises/data/chords.ts src/exercises/data/chords.test.ts
git commit -m "feat(exercises): H 轨知识点数据表、低音线模板与覆盖测试" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 品质与功能和弦生成器

**Files:**
- Create: `src/exercises/generators/chord.ts`
- Test: `src/exercises/generators/chord.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `chordCommon.ts` 全部导出；Task 3 的 `requireChordEntry`/`chordPoolOf`/`functionalChord`/`QUALITY_IDS`/`TONIC_CHORD_ID`；`difficultyParams`/`BASE_BPM`；`pickOptions`/`poolMembers`；`SING_NOTE_SEC`（generators/degree）；`MAJOR_SCALE_DEGREES`（music/key）；`QUALITY_INTERVALS`（music/chord）；`generatorInput`（generators/testInput，测试用）
- Produces:
  - `export const QUALITY_GENERATORS: Record<Modality, Generator>`
  - `export const FUNCTIONAL_GENERATORS: Record<Modality, Generator>`

内容规则（P-2b spec §7.3）：

| | 听辨 | 唱 | 听写 |
|---|---|---|---|
| 品质 | 调内随机根音（大调音阶 7 个音级之一）上放目标品质的和弦，呈现方式按变异轴；在 `maj`/`min` 间选，prompt `which-quality` | 先放根音一声（`SING_NOTE_SEC`），再唱从根音起的琶音前 N 个音（N = `singTargetCount`），prompt `sing-arpeggio` | N 个和弦（N = `notateChordCount`），每个随机根音、随机品质、至少一个是目标品质，每个占两拍；写品质序列，字母表 `maj`/`min`，prompt `notate-qualities` |
| 功能 | 放目标和弦，呈现方式按变异轴；从干扰池选级数，prompt `which-chord` | 不放内容，唱该和弦琶音前 N 个音，prompt `sing-arpeggio` | 第 1 个和弦是主和弦，其余从池中抽且相邻不重复，目标至少出现一次；每个占两拍；写级数序列，字母表 = 干扰池，prompt `notate-chords` |

- [ ] **Step 1: 写失败的测试**

`src/exercises/generators/chord.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { QUALITY_INTERVALS } from '../../music/chord'
import { midiToFreq } from '../../music/pitch'
import { requireChordEntry, functionalChord } from '../data/chords'
import { DIFFICULTY_TABLE } from '../difficulty'
import { PLAN_MIDI_MAX, PLAN_MIDI_MIN } from '../context'
import { chordSlotSec } from './chordCommon'
import { FUNCTIONAL_GENERATORS, QUALITY_GENERATORS } from './chord'
import { SING_NOTE_SEC } from './degree'
import { generatorInput } from './testInput'
import type { ContentResult } from '../types'

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1)
const pc = (m: number) => ((m % 12) + 12) % 12
const intervalsFromLowest = (midis: number[]) => {
  const s = [...midis].sort((a, b) => a - b)
  return s.map((m) => m - s[0])
}
const modeOf = (kp: string) => requireChordEntry(kp).mode
const input = (kp: string, modality: 'recognize' | 'sing' | 'notate', o: { step?: number; seed?: number; variationLevel?: number } = {}) =>
  generatorInput(kp, modality, { ...o, mode: modeOf(kp) })
const allMidis = (r: ContentResult) => [
  ...r.notes.map((n) => n.midi),
  ...r.feedbackNotes.map((n) => n.midi),
  ...(r.format.kind === 'pitch' ? r.format.targets.map((t) => t.midi) : []),
]

describe('品质·听辨', () => {
  it('放一个目标品质的原位和弦；选项是 maj/min 的子集且含答案', () => {
    for (const kp of ['chord:quality-maj', 'chord:quality-min'] as const) {
      const quality = kp.endsWith('maj') ? 'maj' : 'min'
      for (const seed of SEEDS) {
        const r = QUALITY_GENERATORS.recognize(input(kp, 'recognize', { seed }))
        expect(intervalsFromLowest(r.notes.map((n) => n.midi))).toEqual([...QUALITY_INTERVALS[quality]])
        expect(r.answer).toEqual({ kind: 'choice', id: quality })
        if (r.format.kind !== 'choice') throw new Error('格式错')
        expect(r.format.options.map((o) => o.id).sort()).toEqual(['maj', 'min'])
        expect(r.prompt).toBe('which-quality')
      }
    }
  })

  it('variationLevel 6 时会出现琶音呈现（起音时刻不全相同）', () => {
    const arpeggiated = SEEDS.some((seed) => {
      const r = QUALITY_GENERATORS.recognize(input('chord:quality-maj', 'recognize', { seed, variationLevel: 6 }))
      return new Set(r.notes.map((n) => n.atSec)).size > 1
    })
    expect(arpeggiated).toBe(true)
  })
})

describe('品质·唱', () => {
  it('先放根音；目标是从根音起的琶音前 N 个音', () => {
    for (let step = 0; step <= 5; step++) {
      const r = QUALITY_GENERATORS.sing(input('chord:quality-min', 'sing', { step, seed: step + 1 }))
      if (r.format.kind !== 'pitch') throw new Error('格式错')
      const n = DIFFICULTY_TABLE.singTargetCount[step]
      const t = r.format.targets
      expect(t).toHaveLength(n)
      expect(r.notes).toHaveLength(1)
      expect(r.notes[0].midi).toBe(t[0].midi)
      expect(t.map((x) => x.midi - t[0].midi)).toEqual(QUALITY_INTERVALS.min.slice(0, n))
      for (const x of t) {
        expect(x.freqHz).toBeCloseTo(midiToFreq(x.midi), 9)
        expect(x.centsTolerance).toBe(50)
      }
      expect(r.feedbackNotes.map((f) => f.midi)).toEqual(t.map((x) => x.midi))
      expect(r.durSec).toBeCloseTo(SING_NOTE_SEC * (1 + n), 12)
      expect(r.prompt).toBe('sing-arpeggio')
    }
  })
})

describe('品质·听写', () => {
  it('长度按档位，含目标品质，答案与实际和弦一一对应', () => {
    for (let step = 0; step <= 5; step++) {
      for (const seed of SEEDS.slice(0, 10)) {
        const inp = input('chord:quality-maj', 'notate', { step, seed })
        const r = QUALITY_GENERATORS.notate(inp)
        if (r.answer.kind !== 'sequence' || r.format.kind !== 'sequence') throw new Error('格式错')
        const len = DIFFICULTY_TABLE.notateChordCount[step]
        expect(r.answer.ids).toHaveLength(len)
        expect(r.answer.ids).toContain('maj')
        expect(r.format.alphabet.map((o) => o.id)).toEqual(['maj', 'min'])
        const slot = chordSlotSec(inp.resolved.bpm)
        r.answer.ids.forEach((q, i) => {
          const chord = r.notes.filter((n) => Math.abs(n.atSec - i * slot) < 1e-9).map((n) => n.midi)
          expect(intervalsFromLowest(chord)).toEqual([...QUALITY_INTERVALS[q as 'maj' | 'min']])
        })
        expect(r.prompt).toBe('notate-qualities')
      }
    }
  })
})

describe('功能和弦·听辨', () => {
  it('C 大调默认音区下 V 是 [67,71,74]；选项来自干扰池', () => {
    const r = FUNCTIONAL_GENERATORS.recognize(input('chord:V', 'recognize', { step: 5 }))
    expect(r.notes.map((n) => n.midi)).toEqual([67, 71, 74])
    expect(r.answer).toEqual({ kind: 'choice', id: 'V' })
    if (r.format.kind !== 'choice') throw new Error('格式错')
    expect(r.format.options.map((o) => o.id).sort()).toEqual(['I', 'IV', 'V'])
    expect(r.prompt).toBe('which-chord')
  })

  it('a 小调默认音区下 i 以主音 la 为根：[57,60,64]', () => {
    const r = FUNCTIONAL_GENERATORS.recognize(input('chord:i', 'recognize'))
    expect(r.notes.map((n) => n.midi)).toEqual([57, 60, 64])
  })

  it('音级类与目标和弦一致（任意 seed、任意变异等级）', () => {
    for (const kp of ['chord:ii7', 'chord:borrowed-bVII', 'chord:VI']) {
      const e = requireChordEntry(kp)
      if (e.family !== 'functional') throw new Error('不是功能和弦')
      for (const seed of SEEDS.slice(0, 10)) {
        const inp = input(kp, 'recognize', { seed, variationLevel: 6 })
        const r = FUNCTIONAL_GENERATORS.recognize(inp)
        expect(intervalsFromLowest(r.notes.map((n) => n.midi))).toEqual([...QUALITY_INTERVALS[e.chord.quality]])
      }
    }
  })
})

describe('功能和弦·唱', () => {
  it('不放内容；目标是该和弦琶音前 N 个音', () => {
    const r = FUNCTIONAL_GENERATORS.sing(input('chord:V7', 'sing', { step: 5 }))
    if (r.format.kind !== 'pitch') throw new Error('格式错')
    expect(r.notes).toEqual([])
    expect(r.format.targets.map((t) => t.degree)).toEqual(['sol', 'ti', 're'])
    expect(r.format.targets.map((t) => pc(t.midi))).toEqual([7, 11, 2])
    expect(r.prompt).toBe('sing-arpeggio')
  })
})

describe('功能和弦·听写', () => {
  it('首个是主和弦，含目标，相邻不重复，字母表 = 干扰池，和弦与答案一一对应', () => {
    for (let step = 0; step <= 5; step++) {
      for (const seed of SEEDS.slice(0, 10)) {
        const inp = input('chord:vi', 'notate', { step, seed })
        const r = FUNCTIONAL_GENERATORS.notate(inp)
        if (r.answer.kind !== 'sequence' || r.format.kind !== 'sequence') throw new Error('格式错')
        const ids = r.answer.ids
        expect(ids).toHaveLength(DIFFICULTY_TABLE.notateChordCount[step])
        expect(ids[0]).toBe('I')
        expect(ids).toContain('vi')
        for (let i = 1; i < ids.length; i++) {
          if (ids[i] !== 'vi') expect(ids[i]).not.toBe(ids[i - 1])
        }
        expect(r.format.alphabet.map((o) => o.id).sort()).toEqual(['I', 'IV', 'V', 'ii', 'vi'].sort())
        const slot = chordSlotSec(inp.resolved.bpm)
        ids.forEach((id, i) => {
          const chord = r.notes.filter((n) => Math.abs(n.atSec - i * slot) < 1e-9).map((n) => pc(n.midi)).sort((a, b) => a - b)
          const ch = functionalChord('major', id)
          const want = QUALITY_INTERVALS[ch.quality]
            .map((iv) => pc(inp.doMidi + ({ do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, ti: 11 } as Record<string, number>)[ch.rootDegree] + iv))
            .sort((a, b) => a - b)
          expect(chord).toEqual(want)
        })
        expect(r.prompt).toBe('notate-chords')
      }
    }
  })
})

describe('音区：整题落在 36–96（不依赖逐音折叠）', () => {
  it('任意变异与档位', () => {
    for (const kp of ['chord:quality-maj', 'chord:V7', 'chord:Imaj7', 'chord:VII']) {
      for (const modality of ['recognize', 'sing', 'notate'] as const) {
        for (const seed of SEEDS) {
          const gens = kp.includes('quality') ? QUALITY_GENERATORS : FUNCTIONAL_GENERATORS
          const r = gens[modality](input(kp, modality, { seed, variationLevel: 6, step: seed % 6 }))
          for (const m of allMidis(r)) {
            expect(m).toBeGreaterThanOrEqual(PLAN_MIDI_MIN)
            expect(m).toBeLessThanOrEqual(PLAN_MIDI_MAX)
          }
        }
      }
    }
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/generators/chord.test.ts`
Expected: FAIL —— 无法解析模块 `./chord`

- [ ] **Step 3: 写实现**

`src/exercises/generators/chord.ts`：

```ts
import type { Modality } from '../../curriculum/knowledgePoints'
import { QUALITY_INTERVALS, type Chord } from '../../music/chord'
import { MAJOR_SCALE_DEGREES, type ScaleDegree } from '../../music/key'
import type { NoteSpec } from '../../music/playback'
import {
  QUALITY_IDS,
  TONIC_CHORD_ID,
  chordPoolOf,
  functionalChord,
  requireChordEntry,
  type FunctionalEntry,
  type QualityEntry,
} from '../data/chords'
import { BASE_BPM, difficultyParams } from '../difficulty'
import { pickOptions, poolMembers } from '../pools'
import type { ContentResult, Generator, GeneratorInput } from '../types'
import {
  CHORD_LEGATO,
  chordMidis,
  chordNotes,
  chordSlotSec,
  degreeAbove,
  fitItem,
  pitchTargets,
  sungSequence,
} from './chordCommon'
import { SING_NOTE_SEC } from './degree'

function qualityEntry(input: GeneratorInput): QualityEntry {
  const e = requireChordEntry(input.spec.kpId)
  if (e.family !== 'quality') throw new Error(`${input.spec.kpId} 不是品质知识点`)
  return e
}

function functionalEntry(input: GeneratorInput): FunctionalEntry {
  const e = requireChordEntry(input.spec.kpId)
  if (e.family !== 'functional') throw new Error(`${input.spec.kpId} 不是功能和弦知识点`)
  return e
}

function poolIds(input: GeneratorInput): string[] {
  return poolMembers(input.curriculum, input.spec.kpId, chordPoolOf).map(
    (id) => requireChordEntry(id).answerId,
  )
}

function recognizeDurSec(input: GeneratorInput): number {
  return difficultyParams(input.spec.difficultyStep).recognizeNoteSec * (BASE_BPM / input.resolved.bpm)
}

/** 琶音前 N 个音：音级与音高（原位、以主音为锚） */
function arpeggioHead(chord: Chord, input: GeneratorInput, count: number) {
  const midis = chordMidis(chord, input.resolved.key, input.doMidi).slice(0, count)
  const degrees: ScaleDegree[] = QUALITY_INTERVALS[chord.quality]
    .slice(0, count)
    .map((i) => degreeAbove(chord.rootDegree, i))
  return { midis, degrees }
}

/** 一串和弦，每个占两拍 */
function chordSequenceNotes(chords: readonly Chord[], input: GeneratorInput): NoteSpec[] {
  const { resolved, doMidi } = input
  const slot = chordSlotSec(resolved.bpm)
  return chords.flatMap((ch, i) =>
    chordNotes(chordMidis(ch, resolved.key, doMidi), i * slot, slot * CHORD_LEGATO, resolved.velocity, 'block', resolved.bpm),
  )
}

const recognizeQuality: Generator = (input): ContentResult => {
  const { resolved, doMidi, rng } = input
  const entry = qualityEntry(input)
  const root = rng.pick(MAJOR_SCALE_DEGREES)
  const durSec = recognizeDurSec(input)
  const chord: Chord = { rootDegree: root, quality: entry.quality, inversion: 0 }
  const raw = chordNotes(chordMidis(chord, resolved.key, doMidi), 0, durSec, resolved.velocity, resolved.presentation, resolved.bpm)
  const fit = fitItem({ notes: raw, feedbackNotes: raw, targetMidis: [] })
  const options = pickOptions(entry.answerId, QUALITY_IDS, difficultyParams(input.spec.difficultyStep).recognizeOptionCount, rng)
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec,
    prompt: 'which-quality',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: entry.answerId },
  }
}

const singQualityArpeggio: Generator = (input): ContentResult => {
  const { resolved, rng } = input
  const entry = qualityEntry(input)
  const count = difficultyParams(input.spec.difficultyStep).singTargetCount
  const root = rng.pick(MAJOR_SCALE_DEGREES)
  const head = arpeggioHead({ rootDegree: root, quality: entry.quality, inversion: 0 }, input, count)
  const reference: NoteSpec[] = [{ midi: head.midis[0], atSec: 0, durSec: SING_NOTE_SEC, gain: resolved.velocity }]
  const fit = fitItem({
    notes: reference,
    feedbackNotes: sungSequence(head.midis, resolved.velocity),
    targetMidis: head.midis,
  })
  const targets = pitchTargets(head.degrees, fit.targetMidis)
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec: SING_NOTE_SEC * (1 + count),
    prompt: 'sing-arpeggio',
    format: { kind: 'pitch', targets },
    answer: { kind: 'pitch', targets },
  }
}

const notateQualities: Generator = (input): ContentResult => {
  const { resolved, rng } = input
  const entry = qualityEntry(input)
  const length = difficultyParams(input.spec.difficultyStep).notateChordCount
  const targetPos = rng.int(length)
  const qualities = Array.from({ length }, (_, i) => (i === targetPos ? entry.quality : rng.pick(QUALITY_IDS)))
  const chords: Chord[] = qualities.map((quality) => ({ rootDegree: rng.pick(MAJOR_SCALE_DEGREES), quality, inversion: 0 }))
  const raw = chordSequenceNotes(chords, input)
  const fit = fitItem({ notes: raw, feedbackNotes: raw, targetMidis: [] })
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec: length * chordSlotSec(resolved.bpm),
    prompt: 'notate-qualities',
    format: { kind: 'sequence', length, alphabet: QUALITY_IDS.map((id) => ({ id })) },
    answer: { kind: 'sequence', ids: [...qualities] },
  }
}

const recognizeFunctional: Generator = (input): ContentResult => {
  const { resolved, doMidi, rng } = input
  const entry = functionalEntry(input)
  const durSec = recognizeDurSec(input)
  const raw = chordNotes(chordMidis(entry.chord, resolved.key, doMidi), 0, durSec, resolved.velocity, resolved.presentation, resolved.bpm)
  const fit = fitItem({ notes: raw, feedbackNotes: raw, targetMidis: [] })
  const options = pickOptions(entry.answerId, poolIds(input), difficultyParams(input.spec.difficultyStep).recognizeOptionCount, rng)
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec,
    prompt: 'which-chord',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: entry.answerId },
  }
}

const singFunctionalArpeggio: Generator = (input): ContentResult => {
  const entry = functionalEntry(input)
  const count = difficultyParams(input.spec.difficultyStep).singTargetCount
  const head = arpeggioHead(entry.chord, input, count)
  const fit = fitItem({
    notes: [],
    feedbackNotes: sungSequence(head.midis, input.resolved.velocity),
    targetMidis: head.midis,
  })
  const targets = pitchTargets(head.degrees, fit.targetMidis)
  return {
    notes: [],
    feedbackNotes: fit.feedbackNotes,
    durSec: SING_NOTE_SEC * count,
    prompt: 'sing-arpeggio',
    format: { kind: 'pitch', targets },
    answer: { kind: 'pitch', targets },
  }
}

const notateFunctional: Generator = (input): ContentResult => {
  const { resolved, rng } = input
  const entry = functionalEntry(input)
  const length = difficultyParams(input.spec.difficultyStep).notateChordCount
  const pool = poolIds(input)
  const tonicId = TONIC_CHORD_ID[entry.mode]
  // 目标若是主和弦，首位已含目标；否则放在第 2 位及以后
  const targetPos = entry.answerId === tonicId ? 0 : 1 + rng.int(length - 1)
  const ids: string[] = [tonicId]
  for (let i = 1; i < length; i++) {
    ids.push(i === targetPos ? entry.answerId : rng.pick(pool.filter((id) => id !== ids[i - 1])))
  }
  const raw = chordSequenceNotes(ids.map((id) => functionalChord(entry.mode, id)), input)
  const fit = fitItem({ notes: raw, feedbackNotes: raw, targetMidis: [] })
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec: length * chordSlotSec(resolved.bpm),
    prompt: 'notate-chords',
    format: { kind: 'sequence', length, alphabet: pool.map((id) => ({ id })) },
    answer: { kind: 'sequence', ids },
  }
}

export const QUALITY_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeQuality,
  sing: singQualityArpeggio,
  notate: notateQualities,
}

export const FUNCTIONAL_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeFunctional,
  sing: singFunctionalArpeggio,
  notate: notateFunctional,
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/exercises/generators/chord.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/exercises/generators/chord.ts src/exercises/generators/chord.test.ts
git commit -m "feat(exercises): 品质与功能和弦的听辨、唱、听写生成器" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 整条进行生成器

**Files:**
- Create: `src/exercises/generators/progression.ts`
- Test: `src/exercises/generators/progression.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `chordCommon.ts`；Task 3 的 `CHORD_ENTRIES`/`requireChordEntry`/`chordPoolOf`/`functionalChord`/`ProgressionEntry`；`stageOfKnowledgePoint`/`poolMembers`/`pickOptions`（pools）；`stageOrderIndex`（curriculum/validate）；`difficultyParams`；`SING_NOTE_SEC`
- Produces:
  - `export function rotationIds(chordIds: readonly string[]): string[]` —— 除自身外的全部轮转，每个用 `-` 连接
  - `export function progressionCandidates(target: ProgressionEntry, poolIds: readonly string[], wanted: number): string[]` —— 池够 `wanted` 时就是池；不够时（D8）追加目标的轮转，去重
  - `export function functionalAlphabet(c: Curriculum, mode: Mode, kpId: KnowledgePointId): string[]` —— 同调式、所在级不晚于该知识点所在级的功能和弦 answerId，按数据表顺序
  - `export const PROGRESSION_GENERATORS: Record<Modality, Generator>`

内容规则：

| 听辨 | 唱 | 听写 |
|---|---|---|
| 放整条进行（每个和弦两拍）；选项 = `progressionCandidates`，个数按档位；prompt `which-progression` | 先放整条进行，再唱前 N 个和弦的根音（N = `singTargetCount`，不超过进行长度）；prompt `sing-bassline` | 放整条进行；逐和弦写级数，长度 = 进行长度；字母表 = `functionalAlphabet`；prompt `notate-progression` |

- [ ] **Step 1: 写失败的测试**

`src/exercises/generators/progression.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../../curriculum/curriculum'
import { requireChordEntry, type ProgressionEntry } from '../data/chords'
import { DIFFICULTY_TABLE } from '../difficulty'
import { chordSlotSec } from './chordCommon'
import { SING_NOTE_SEC } from './degree'
import {
  PROGRESSION_GENERATORS,
  functionalAlphabet,
  progressionCandidates,
  rotationIds,
} from './progression'
import { generatorInput } from './testInput'

const c = buildCurriculum()
const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1)
const entry = (kp: string) => requireChordEntry(kp) as ProgressionEntry
const input = (kp: string, modality: 'recognize' | 'sing' | 'notate', o: { step?: number; seed?: number; variationLevel?: number } = {}) =>
  generatorInput(kp, modality, { ...o, mode: entry(kp).mode })

describe('rotationIds / progressionCandidates（D8）', () => {
  it('除自身外的全部轮转', () => {
    expect(rotationIds(['i', 'VI', 'III', 'VII'])).toEqual(['VI-III-VII-i', 'III-VII-i-VI', 'VII-i-VI-III'])
  })

  it('池够时就是池', () => {
    expect(progressionCandidates(entry('prog:I-V-vi-IV'), ['I-V-vi-IV', 'vi-IV-I-V', 'I-vi-IV-V'], 3))
      .toEqual(['I-V-vi-IV', 'vi-IV-I-V', 'I-vi-IV-V'])
  })

  it('池不够时追加目标的轮转并去重（I-V-vi-IV 的轮转之一就是 vi-IV-I-V）', () => {
    const cands = progressionCandidates(entry('prog:I-V-vi-IV'), ['I-V-vi-IV', 'vi-IV-I-V', 'I-vi-IV-V'], Infinity)
    expect(new Set(cands).size).toBe(cands.length)
    expect(cands).toContain('V-vi-IV-I')
    expect(cands.filter((x) => x === 'vi-IV-I-V')).toHaveLength(1)
  })

  it('小调进行池只有自己，也至少给出 2 个候选', () => {
    expect(progressionCandidates(entry('prog:i-VI-III-VII'), ['i-VI-III-VII'], 2).length).toBeGreaterThanOrEqual(2)
  })
})

describe('functionalAlphabet', () => {
  it('大调进行（H5）：H2–H4 的 9 个大调功能和弦，不含副属与借用', () => {
    expect(functionalAlphabet(c, 'major', 'prog:I-V-vi-IV').sort()).toEqual(
      ['I', 'IV', 'V', 'vi', 'ii', 'V7', 'Imaj7', 'ii7', 'vi7'].sort(),
    )
  })

  it('小调进行（H7）：5 个小调功能和弦', () => {
    expect(functionalAlphabet(c, 'minor', 'prog:i-VI-III-VII').sort()).toEqual(['III', 'VI', 'VII', 'i', 'iv'])
  })
})

describe('进行·听辨', () => {
  it('放出进行的每个和弦（每个两拍）；答案与选项正确', () => {
    for (const kp of ['prog:I-V-vi-IV', 'prog:i-VI-III-VII']) {
      for (let step = 0; step <= 5; step++) {
        const inp = input(kp, 'recognize', { step, seed: step + 1 })
        const r = PROGRESSION_GENERATORS.recognize(inp)
        const slot = chordSlotSec(inp.resolved.bpm)
        expect(new Set(r.notes.map((n) => n.atSec))).toEqual(new Set([0, slot, 2 * slot, 3 * slot]))
        expect(r.answer).toEqual({ kind: 'choice', id: entry(kp).answerId })
        if (r.format.kind !== 'choice') throw new Error('格式错')
        const ids = r.format.options.map((o) => o.id)
        expect(ids).toContain(entry(kp).answerId)
        expect(ids.length).toBeGreaterThanOrEqual(2)
        expect(new Set(ids).size).toBe(ids.length)
        expect(r.durSec).toBeCloseTo(4 * slot, 12)
        expect(r.prompt).toBe('which-progression')
      }
    }
  })
})

describe('进行·唱', () => {
  it('先放进行，目标是前 N 个和弦的根音', () => {
    for (let step = 0; step <= 5; step++) {
      const inp = input('prog:vi-IV-I-V', 'sing', { step })
      const r = PROGRESSION_GENERATORS.sing(inp)
      if (r.format.kind !== 'pitch') throw new Error('格式错')
      const n = DIFFICULTY_TABLE.singTargetCount[step]
      expect(r.format.targets.map((t) => t.degree)).toEqual(['la', 'fa', 'do'].slice(0, n))
      expect(r.notes.length).toBeGreaterThan(0)
      const slot = chordSlotSec(inp.resolved.bpm)
      expect(r.durSec).toBeCloseTo(4 * slot + n * SING_NOTE_SEC, 12)
      expect(r.feedbackNotes.slice(-n).map((f) => f.midi)).toEqual(r.format.targets.map((t) => t.midi))
      expect(r.prompt).toBe('sing-bassline')
    }
  })
})

describe('进行·听写', () => {
  it('答案是进行本身，长度固定，不随档位变；字母表 = functionalAlphabet', () => {
    for (let step = 0; step <= 5; step++) {
      const r = PROGRESSION_GENERATORS.notate(input('prog:i-VI-III-VII', 'notate', { step }))
      if (r.answer.kind !== 'sequence' || r.format.kind !== 'sequence') throw new Error('格式错')
      expect(r.answer.ids).toEqual(['i', 'VI', 'III', 'VII'])
      expect(r.format.length).toBe(4)
      expect(r.format.alphabet.map((o) => o.id).sort()).toEqual(['III', 'VI', 'VII', 'i', 'iv'])
      expect(r.prompt).toBe('notate-progression')
    }
  })
})

describe('音区：整题落在 36–96', () => {
  it('任意变异与档位', () => {
    for (const kp of ['prog:I-V-vi-IV', 'prog:i-VI-III-VII']) {
      for (const modality of ['recognize', 'sing', 'notate'] as const) {
        for (const seed of SEEDS) {
          const r = PROGRESSION_GENERATORS[modality](input(kp, modality, { seed, variationLevel: 6, step: seed % 6 }))
          const midis = [
            ...r.notes.map((n) => n.midi),
            ...r.feedbackNotes.map((n) => n.midi),
            ...(r.format.kind === 'pitch' ? r.format.targets.map((t) => t.midi) : []),
          ]
          for (const m of midis) {
            expect(m).toBeGreaterThanOrEqual(36)
            expect(m).toBeLessThanOrEqual(96)
          }
        }
      }
    }
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/generators/progression.test.ts`
Expected: FAIL —— 无法解析模块 `./progression`

- [ ] **Step 3: 写实现**

`src/exercises/generators/progression.ts`：

```ts
import type { Curriculum } from '../../curriculum/curriculum'
import type { KnowledgePointId, Modality } from '../../curriculum/knowledgePoints'
import { stageOrderIndex } from '../../curriculum/validate'
import type { Mode } from '../../music/key'
import type { NoteSpec } from '../../music/playback'
import {
  CHORD_ENTRIES,
  chordPoolOf,
  functionalChord,
  requireChordEntry,
  type ProgressionEntry,
} from '../data/chords'
import { difficultyParams } from '../difficulty'
import { pickOptions, poolMembers, stageOfKnowledgePoint } from '../pools'
import type { ContentResult, Generator, GeneratorInput } from '../types'
import {
  CHORD_LEGATO,
  chordMidis,
  chordNotes,
  chordRootMidi,
  chordSlotSec,
  fitItem,
  pitchTargets,
  sungSequence,
} from './chordCommon'
import { SING_NOTE_SEC } from './degree'

export function rotationIds(chordIds: readonly string[]): string[] {
  return chordIds
    .map((_, r) => [...chordIds.slice(r), ...chordIds.slice(0, r)].join('-'))
    .slice(1)
}

/** 进行类干扰池不足时，用目标和弦的轮转补足（P-2b spec D8） */
export function progressionCandidates(
  target: ProgressionEntry,
  poolIds: readonly string[],
  wanted: number,
): string[] {
  if (poolIds.length >= wanted) return [...poolIds]
  return [...new Set([...poolIds, ...rotationIds(target.chordIds)])]
}

/** 同调式、所在级不晚于该知识点所在级的功能和弦——进行听写的字母表 */
export function functionalAlphabet(
  c: Curriculum,
  mode: Mode,
  kpId: KnowledgePointId,
): string[] {
  const limit = stageOrderIndex(c, stageOfKnowledgePoint(kpId).id)
  return CHORD_ENTRIES.filter(
    (e) =>
      e.family === 'functional' &&
      e.mode === mode &&
      stageOrderIndex(c, stageOfKnowledgePoint(e.kpId).id) <= limit,
  ).map((e) => e.answerId)
}

function progressionEntry(input: GeneratorInput): ProgressionEntry {
  const e = requireChordEntry(input.spec.kpId)
  if (e.family !== 'progression') throw new Error(`${input.spec.kpId} 不是进行知识点`)
  return e
}

function progressionNotes(entry: ProgressionEntry, input: GeneratorInput): { notes: NoteSpec[]; durSec: number } {
  const { resolved, doMidi } = input
  const slot = chordSlotSec(resolved.bpm)
  const notes = entry.chordIds.flatMap((id, i) =>
    chordNotes(
      chordMidis(functionalChord(entry.mode, id), resolved.key, doMidi),
      i * slot,
      slot * CHORD_LEGATO,
      resolved.velocity,
      'block',
      resolved.bpm,
    ),
  )
  return { notes, durSec: entry.chordIds.length * slot }
}

const recognizeProgression: Generator = (input): ContentResult => {
  const entry = progressionEntry(input)
  const { notes, durSec } = progressionNotes(entry, input)
  const fit = fitItem({ notes, feedbackNotes: notes, targetMidis: [] })
  const wanted = difficultyParams(input.spec.difficultyStep).recognizeOptionCount
  const pool = poolMembers(input.curriculum, input.spec.kpId, chordPoolOf).map(
    (id) => requireChordEntry(id).answerId,
  )
  const options = pickOptions(entry.answerId, progressionCandidates(entry, pool, wanted), wanted, input.rng)
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec,
    prompt: 'which-progression',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: entry.answerId },
  }
}

const singProgressionRoots: Generator = (input): ContentResult => {
  const { resolved, doMidi } = input
  const entry = progressionEntry(input)
  const count = Math.min(
    difficultyParams(input.spec.difficultyStep).singTargetCount,
    entry.chordIds.length,
  )
  const { notes, durSec } = progressionNotes(entry, input)
  const chords = entry.chordIds.slice(0, count).map((id) => functionalChord(entry.mode, id))
  const rootMidis = chords.map((ch) => chordRootMidi(ch, resolved.key, doMidi))
  const fit = fitItem({
    notes,
    feedbackNotes: [...notes, ...sungSequence(rootMidis, resolved.velocity, durSec)],
    targetMidis: rootMidis,
  })
  const targets = pitchTargets(chords.map((ch) => ch.rootDegree), fit.targetMidis)
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec: durSec + count * SING_NOTE_SEC,
    prompt: 'sing-bassline',
    format: { kind: 'pitch', targets },
    answer: { kind: 'pitch', targets },
  }
}

const notateProgression: Generator = (input): ContentResult => {
  const entry = progressionEntry(input)
  const { notes, durSec } = progressionNotes(entry, input)
  const fit = fitItem({ notes, feedbackNotes: notes, targetMidis: [] })
  const alphabet = functionalAlphabet(input.curriculum, entry.mode, input.spec.kpId)
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec,
    prompt: 'notate-progression',
    format: { kind: 'sequence', length: entry.chordIds.length, alphabet: alphabet.map((id) => ({ id })) },
    answer: { kind: 'sequence', ids: [...entry.chordIds] },
  }
}

export const PROGRESSION_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeProgression,
  sing: singProgressionRoots,
  notate: notateProgression,
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/exercises/generators/progression.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/exercises/generators/progression.ts src/exercises/generators/progression.test.ts
git commit -m "feat(exercises): 整条进行的听辨、唱、听写生成器" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 转位与低音线生成器

**Files:**
- Create: `src/exercises/generators/inversion.ts`
- Test: `src/exercises/generators/inversion.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `voiceChord`；Task 2 的 `chordCommon.ts`；Task 3 的 `requireChordEntry`/`chordPoolOf`/`functionalChord`/`INVERSION_IDS`/`INVERSION_OF`/`INVERSION_CHORD_IDS`/`BASSLINE_PATTERNS`/`BasslinePattern`；`degreeToMidiFromTonic`（music/register）；`MAJOR_SCALE_DEGREES`；`QUALITY_INTERVALS`；`pickOptions`/`poolMembers`；`difficultyParams`/`BASE_BPM`；`SING_NOTE_SEC`
- Produces:
  - `export function voicedChordMidis(chord: Chord, input: GeneratorInput): { bassMidi: number; upperMidis: number[] }` —— 上方声部根音用 `chordRootMidi`，低音用 `voiceChord`
  - `export interface BasslineRender { notes: NoteSpec[]; bassMidis: number[]; bassDegrees: ScaleDegree[]; durSec: number }`
  - `export function renderBassline(pattern: BasslinePattern, input: GeneratorInput): BasslineRender` —— 每步占两拍；上方声部是该和弦以主音为锚的原位；低音第一步放在 `degreeToMidiFromTonic(低音音级) − 12`，之后每步取离上一个低音最近的八度
  - `export const INVERSION_GENERATORS: Record<Modality, Generator>`
  - `export const BASSLINE_GENERATORS: Record<Modality, Generator>`

内容规则：

| | 听辨 | 唱 | 听写 |
|---|---|---|---|
| 转位 | 从 I/IV/V 抽一个和弦，按目标转位排列（独立低音）；选项 = `['root', ...池中转位 id]`，prompt `which-inversion` | 放该和弦，唱它的低音（1 个目标），prompt `sing-bassline` | N 个和弦（N = `notateChordCount`），每个从 I/IV/V 抽、转位从候选里抽、至少一个是目标转位；写转位序列，字母表 = 候选，prompt `notate-inversions` |
| 低音线 | 从 4 条模板抽一条放出；选项 = 模板 id，个数按档位，prompt `which-bass-contour` | 放整条，唱前 N 个低音，prompt `sing-bassline` | 放整条，写低音音级序列（长度 4），字母表 = 大调 7 个音级，prompt `notate-bassline` |

- [ ] **Step 1: 写失败的测试**

`src/exercises/generators/inversion.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { QUALITY_INTERVALS } from '../../music/chord'
import { DEGREE_SEMITONES } from '../../music/key'
import { BASSLINE_PATTERNS, functionalChord } from '../data/chords'
import { DIFFICULTY_TABLE } from '../difficulty'
import { chordSlotSec } from './chordCommon'
import {
  BASSLINE_GENERATORS,
  INVERSION_GENERATORS,
  renderBassline,
  voicedChordMidis,
} from './inversion'
import { generatorInput } from './testInput'
import type { ContentResult } from '../types'

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1)
const pc = (m: number) => ((m % 12) + 12) % 12
const allMidis = (r: ContentResult) => [
  ...r.notes.map((n) => n.midi),
  ...r.feedbackNotes.map((n) => n.midi),
  ...(r.format.kind === 'pitch' ? r.format.targets.map((t) => t.midi) : []),
]

describe('voicedChordMidis', () => {
  it('C 大调默认音区：V 的一转低音是 B，上方声部原位 G B D', () => {
    const inp = generatorInput('chord:inv-first', 'recognize')
    const v = voicedChordMidis({ ...functionalChord('major', 'V'), inversion: 1 }, inp)
    expect(v.upperMidis).toEqual([67, 71, 74])
    expect(v.bassMidi).toBe(59)
  })
})

describe('转位·听辨', () => {
  it('低音严格最低，且是目标转位指定的和弦音；选项含 root', () => {
    for (const [kp, inv, id] of [['chord:inv-first', 1, 'first'], ['chord:inv-second', 2, 'second']] as const) {
      for (const seed of SEEDS) {
        const r = INVERSION_GENERATORS.recognize(generatorInput(kp, 'recognize', { seed, step: 5, variationLevel: 6 }))
        const midis = r.notes.map((n) => n.midi)
        const bass = Math.min(...midis)
        expect(midis.filter((m) => m === bass)).toHaveLength(1)
        const upper = midis.filter((m) => m !== bass)
        const root = Math.min(...upper)
        expect(pc(bass - root)).toBe(QUALITY_INTERVALS.maj[inv])
        expect(r.answer).toEqual({ kind: 'choice', id })
        if (r.format.kind !== 'choice') throw new Error('格式错')
        expect(r.format.options.map((o) => o.id).sort()).toEqual(['first', 'root', 'second'])
        expect(r.prompt).toBe('which-inversion')
      }
    }
  })
})

describe('转位·唱', () => {
  it('唱和弦的低音，1 个目标', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const r = INVERSION_GENERATORS.sing(generatorInput('chord:inv-second', 'sing', { seed, step: 5 }))
      if (r.format.kind !== 'pitch') throw new Error('格式错')
      expect(r.format.targets).toHaveLength(1)
      expect(r.format.targets[0].midi).toBe(Math.min(...r.notes.map((n) => n.midi)))
      expect(r.prompt).toBe('sing-bassline')
    }
  })
})

describe('转位·听写', () => {
  it('长度按档位，含目标转位，每个和弦的低音与答案一致', () => {
    for (let step = 0; step <= 5; step++) {
      for (const seed of SEEDS.slice(0, 10)) {
        const inp = generatorInput('chord:inv-first', 'notate', { step, seed })
        const r = INVERSION_GENERATORS.notate(inp)
        if (r.answer.kind !== 'sequence' || r.format.kind !== 'sequence') throw new Error('格式错')
        const ids = r.answer.ids
        expect(ids).toHaveLength(DIFFICULTY_TABLE.notateChordCount[step])
        expect(ids).toContain('first')
        expect(r.format.alphabet.map((o) => o.id).sort()).toEqual(['first', 'root', 'second'])
        const slot = chordSlotSec(inp.resolved.bpm)
        ids.forEach((id, i) => {
          const chord = r.notes.filter((n) => Math.abs(n.atSec - i * slot) < 1e-9).map((n) => n.midi)
          const bass = Math.min(...chord)
          const root = Math.min(...chord.filter((m) => m !== bass))
          const inv = { root: 0, first: 1, second: 2 }[id as 'root' | 'first' | 'second']
          expect(pc(bass - root)).toBe(QUALITY_INTERVALS.maj[inv])
        })
        expect(r.prompt).toBe('notate-inversions')
      }
    }
  })
})

describe('renderBassline', () => {
  it('每条模板：低音音级与 id 一致；低音逐步取最近八度（相邻 ≤ 6 半音）；低音严格低于同一和弦的上方声部', () => {
    for (const pattern of BASSLINE_PATTERNS) {
      for (const seed of SEEDS.slice(0, 10)) {
        const inp = generatorInput('chord:bassline', 'recognize', { seed, variationLevel: 6 })
        const out = renderBassline(pattern, inp)
        expect(out.bassDegrees.join('-')).toBe(pattern.id)
        out.bassMidis.forEach((m, i) => {
          expect(pc(m - inp.doMidi)).toBe(DEGREE_SEMITONES[out.bassDegrees[i]])
          if (i > 0) expect(Math.abs(m - out.bassMidis[i - 1])).toBeLessThanOrEqual(6)
        })
        const slot = chordSlotSec(inp.resolved.bpm)
        out.bassMidis.forEach((bass, i) => {
          const atStep = out.notes.filter((n) => Math.abs(n.atSec - i * slot) < 1e-9).map((n) => n.midi)
          expect(atStep).toContain(bass)
          expect(Math.min(...atStep.filter((m) => m !== bass))).toBeGreaterThan(bass)
        })
        expect(out.durSec).toBeCloseTo(4 * slot, 12)
      }
    }
  })
})

describe('低音线·三模态', () => {
  it('听辨：答案是被抽中的模板，选项来自模板 id', () => {
    const answers = new Set<string>()
    for (const seed of SEEDS) {
      const r = BASSLINE_GENERATORS.recognize(generatorInput('chord:bassline', 'recognize', { seed, step: 5 }))
      if (r.answer.kind !== 'choice' || r.format.kind !== 'choice') throw new Error('格式错')
      answers.add(r.answer.id)
      expect(r.format.options.map((o) => o.id)).toContain(r.answer.id)
      for (const o of r.format.options) expect(BASSLINE_PATTERNS.map((p) => p.id)).toContain(o.id)
      expect(r.prompt).toBe('which-bass-contour')
    }
    expect(answers.size).toBeGreaterThan(1)
  })

  it('唱：前 N 个低音', () => {
    for (let step = 0; step <= 5; step++) {
      const r = BASSLINE_GENERATORS.sing(generatorInput('chord:bassline', 'sing', { step, seed: 3 }))
      if (r.format.kind !== 'pitch') throw new Error('格式错')
      const n = DIFFICULTY_TABLE.singTargetCount[step]
      expect(r.format.targets).toHaveLength(n)
      const bassIds = BASSLINE_PATTERNS.map((p) => p.id)
      expect(bassIds.some((id) => id.split('-').slice(0, n).join('-') === r.format.targets.map((t) => t.degree).join('-'))).toBe(true)
      expect(r.prompt).toBe('sing-bassline')
    }
  })

  it('听写：低音音级序列，字母表大调 7 音级', () => {
    const r = BASSLINE_GENERATORS.notate(generatorInput('chord:bassline', 'notate', { seed: 5 }))
    if (r.answer.kind !== 'sequence' || r.format.kind !== 'sequence') throw new Error('格式错')
    expect(BASSLINE_PATTERNS.map((p) => p.id)).toContain(r.answer.ids.join('-'))
    expect(r.format.length).toBe(4)
    expect(r.format.alphabet.map((o) => o.id)).toEqual(['do', 're', 'mi', 'fa', 'sol', 'la', 'ti'])
    expect(r.prompt).toBe('notate-bassline')
  })
})

describe('音区：整题落在 36–96，且移八度不改变转位', () => {
  it('任意变异与档位（含最低与最高音区）', () => {
    for (const [gens, kp] of [[INVERSION_GENERATORS, 'chord:inv-first'], [INVERSION_GENERATORS, 'chord:inv-second'], [BASSLINE_GENERATORS, 'chord:bassline']] as const) {
      for (const modality of ['recognize', 'sing', 'notate'] as const) {
        for (const seed of SEEDS) {
          const r = gens[modality](generatorInput(kp, modality, { seed, variationLevel: 6, step: seed % 6 }))
          for (const m of allMidis(r)) {
            expect(m).toBeGreaterThanOrEqual(36)
            expect(m).toBeLessThanOrEqual(96)
          }
        }
      }
    }
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/generators/inversion.test.ts`
Expected: FAIL —— 无法解析模块 `./inversion`

- [ ] **Step 3: 写实现**

`src/exercises/generators/inversion.ts`：

```ts
import type { Modality } from '../../curriculum/knowledgePoints'
import { QUALITY_INTERVALS, voiceChord, type Chord } from '../../music/chord'
import { MAJOR_SCALE_DEGREES, type ScaleDegree } from '../../music/key'
import type { NoteSpec } from '../../music/playback'
import { degreeToMidiFromTonic } from '../../music/register'
import {
  BASSLINE_PATTERNS,
  INVERSION_CHORD_IDS,
  INVERSION_OF,
  chordPoolOf,
  functionalChord,
  requireChordEntry,
  type BasslinePattern,
  type InversionEntry,
} from '../data/chords'
import { BASE_BPM, difficultyParams } from '../difficulty'
import { pickOptions, poolMembers } from '../pools'
import type { ContentResult, Generator, GeneratorInput } from '../types'
import {
  CHORD_LEGATO,
  chordMidis,
  chordRootMidi,
  chordSlotSec,
  degreeAbove,
  fitItem,
  pitchTargets,
  sungSequence,
} from './chordCommon'
import { SING_NOTE_SEC } from './degree'

type InversionId = keyof typeof INVERSION_OF

export function voicedChordMidis(chord: Chord, input: GeneratorInput): { bassMidi: number; upperMidis: number[] } {
  return voiceChord(chord, chordRootMidi(chord, input.resolved.key, input.doMidi))
}

function bassDegreeOf(chord: Chord): ScaleDegree {
  const intervals = QUALITY_INTERVALS[chord.quality]
  const inv = ((chord.inversion % intervals.length) + intervals.length) % intervals.length
  return degreeAbove(chord.rootDegree, intervals[inv])
}

function voicedNotes(chord: Chord, input: GeneratorInput, atSec: number, durSec: number): NoteSpec[] {
  const v = voicedChordMidis(chord, input)
  const gain = input.resolved.velocity
  return [v.bassMidi, ...v.upperMidis].map((midi) => ({ midi, atSec, durSec, gain }))
}

function inversionEntry(input: GeneratorInput): InversionEntry {
  const e = requireChordEntry(input.spec.kpId)
  if (e.family !== 'inversion') throw new Error(`${input.spec.kpId} 不是转位知识点`)
  return e
}

/** 候选转位：原位 + 干扰池里不晚于目标所在级的转位 */
function inversionCandidates(input: GeneratorInput): InversionId[] {
  const pool = poolMembers(input.curriculum, input.spec.kpId, chordPoolOf).map(
    (id) => requireChordEntry(id).answerId as InversionId,
  )
  return ['root', ...pool]
}

function randomInversionChord(input: GeneratorInput, inversionId: InversionId): Chord {
  const base = functionalChord('major', input.rng.pick(INVERSION_CHORD_IDS))
  return { ...base, inversion: INVERSION_OF[inversionId] }
}

const recognizeInversion: Generator = (input): ContentResult => {
  const entry = inversionEntry(input)
  const p = difficultyParams(input.spec.difficultyStep)
  const durSec = p.recognizeNoteSec * (BASE_BPM / input.resolved.bpm)
  const chord = randomInversionChord(input, entry.answerId as InversionId)
  const raw = voicedNotes(chord, input, 0, durSec)
  const fit = fitItem({ notes: raw, feedbackNotes: raw, targetMidis: [] })
  const options = pickOptions(entry.answerId, inversionCandidates(input), p.recognizeOptionCount, input.rng)
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec,
    prompt: 'which-inversion',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: entry.answerId },
  }
}

const singInversionBass: Generator = (input): ContentResult => {
  const entry = inversionEntry(input)
  const slot = chordSlotSec(input.resolved.bpm)
  const chord = randomInversionChord(input, entry.answerId as InversionId)
  const notes = voicedNotes(chord, input, 0, slot * CHORD_LEGATO)
  const bass = voicedChordMidis(chord, input).bassMidi
  const fit = fitItem({
    notes,
    feedbackNotes: [...notes, ...sungSequence([bass], input.resolved.velocity, slot)],
    targetMidis: [bass],
  })
  const targets = pitchTargets([bassDegreeOf(chord)], fit.targetMidis)
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec: slot + SING_NOTE_SEC,
    prompt: 'sing-bassline',
    format: { kind: 'pitch', targets },
    answer: { kind: 'pitch', targets },
  }
}

const notateInversions: Generator = (input): ContentResult => {
  const entry = inversionEntry(input)
  const { rng } = input
  const length = difficultyParams(input.spec.difficultyStep).notateChordCount
  const candidates = inversionCandidates(input)
  const targetPos = rng.int(length)
  const ids: InversionId[] = Array.from({ length }, (_, i) =>
    i === targetPos ? (entry.answerId as InversionId) : rng.pick(candidates),
  )
  const slot = chordSlotSec(input.resolved.bpm)
  const raw = ids.flatMap((id, i) => voicedNotes(randomInversionChord(input, id), input, i * slot, slot * CHORD_LEGATO))
  const fit = fitItem({ notes: raw, feedbackNotes: raw, targetMidis: [] })
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec: length * slot,
    prompt: 'notate-inversions',
    format: { kind: 'sequence', length, alphabet: candidates.map((id) => ({ id })) },
    answer: { kind: 'sequence', ids: [...ids] },
  }
}

export interface BasslineRender {
  notes: NoteSpec[]
  bassMidis: number[]
  bassDegrees: ScaleDegree[]
  durSec: number
}

/**
 * 低音线：上方声部是各和弦以主音为锚的原位，低音逐步取离上一个低音最近的八度，
 * 让低音走向（上行 / 下行）保持连贯——逐和弦独立放低音会把走向打断。
 */
export function renderBassline(pattern: BasslinePattern, input: GeneratorInput): BasslineRender {
  const { resolved, doMidi } = input
  const slot = chordSlotSec(resolved.bpm)
  const bassMidis: number[] = []
  const bassDegrees: ScaleDegree[] = []
  const notes: NoteSpec[] = []
  pattern.steps.forEach((step, i) => {
    const base = functionalChord('major', step.chordId)
    const chord: Chord = { ...base, inversion: step.inversion }
    const degree = bassDegreeOf(chord)
    let bass = degreeToMidiFromTonic(degree, resolved.key, doMidi) - 12
    if (i > 0) {
      const prev = bassMidis[i - 1]
      while (bass - prev > 6) bass -= 12
      while (prev - bass > 6) bass += 12
    }
    bassMidis.push(bass)
    bassDegrees.push(degree)
    const upper = chordMidis(base, resolved.key, doMidi)
    for (const midi of [bass, ...upper]) {
      notes.push({ midi, atSec: i * slot, durSec: slot * CHORD_LEGATO, gain: resolved.velocity })
    }
  })
  return { notes, bassMidis, bassDegrees, durSec: pattern.steps.length * slot }
}

const recognizeBassline: Generator = (input): ContentResult => {
  const pattern = input.rng.pick(BASSLINE_PATTERNS)
  const out = renderBassline(pattern, input)
  const fit = fitItem({ notes: out.notes, feedbackNotes: out.notes, targetMidis: [] })
  const options = pickOptions(
    pattern.id,
    BASSLINE_PATTERNS.map((p) => p.id),
    difficultyParams(input.spec.difficultyStep).recognizeOptionCount,
    input.rng,
  )
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec: out.durSec,
    prompt: 'which-bass-contour',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: pattern.id },
  }
}

const singBassline: Generator = (input): ContentResult => {
  const pattern = input.rng.pick(BASSLINE_PATTERNS)
  const out = renderBassline(pattern, input)
  const count = Math.min(difficultyParams(input.spec.difficultyStep).singTargetCount, out.bassMidis.length)
  const sung = out.bassMidis.slice(0, count)
  const fit = fitItem({
    notes: out.notes,
    feedbackNotes: [...out.notes, ...sungSequence(sung, input.resolved.velocity, out.durSec)],
    targetMidis: sung,
  })
  const targets = pitchTargets(out.bassDegrees.slice(0, count), fit.targetMidis)
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec: out.durSec + count * SING_NOTE_SEC,
    prompt: 'sing-bassline',
    format: { kind: 'pitch', targets },
    answer: { kind: 'pitch', targets },
  }
}

const notateBassline: Generator = (input): ContentResult => {
  const pattern = input.rng.pick(BASSLINE_PATTERNS)
  const out = renderBassline(pattern, input)
  const fit = fitItem({ notes: out.notes, feedbackNotes: out.notes, targetMidis: [] })
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec: out.durSec,
    prompt: 'notate-bassline',
    format: {
      kind: 'sequence',
      length: out.bassDegrees.length,
      alphabet: MAJOR_SCALE_DEGREES.map((id) => ({ id })),
    },
    answer: { kind: 'sequence', ids: [...out.bassDegrees] },
  }
}

export const INVERSION_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeInversion,
  sing: singInversionBass,
  notate: notateInversions,
}

export const BASSLINE_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeBassline,
  sing: singBassline,
  notate: notateBassline,
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/exercises/generators/inversion.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/exercises/generators/inversion.ts src/exercises/generators/inversion.test.ts
git commit -m "feat(exercises): 转位与低音线的听辨、唱、听写生成器" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 管线接入 H 轨、快照与属性测试

**Files:**
- Modify: `src/exercises/generate.ts`（`lookupGenerator` 追加 H 分支）
- Modify: `src/exercises/generate.test.ts`（两条既有用例改写、随机规格覆盖 H、新增 H 快照与音区属性）

**Interfaces:**
- Consumes: `chordEntry`/`CHORD_ENTRIES`/`ChordFamily`（Task 3）、`QUALITY_GENERATORS`/`FUNCTIONAL_GENERATORS`（Task 4）、`PROGRESSION_GENERATORS`（Task 5）、`INVERSION_GENERATORS`/`BASSLINE_GENERATORS`（Task 6）
- Produces: `lookupGenerator` 对 26 个 H 轨知识点返回生成器；R 轨仍返回 `undefined`

- [ ] **Step 1: 改写两条既有用例，并加 H 轨用例（先让它们失败）**

在 `src/exercises/generate.test.ts` 中：

把这一整条用例：

```ts
  it('H/R 轨在本计划中尚无生成器', () => {
    expect(lookupGenerator('chord:I')).toBeUndefined()
    expect(lookupGenerator('rhythm:quarter')).toBeUndefined()
  })
```

替换为：

```ts
  it('每个 H 轨知识点都有生成器；R 轨在 P-2b-R 之前尚无生成器', () => {
    for (const e of CHORD_ENTRIES) expect(lookupGenerator(e.kpId)).toBeDefined()
    expect(lookupGenerator('chord:i')?.mode).toBe('minor')
    expect(lookupGenerator('rhythm:quarter')).toBeUndefined()
  })
```

把这一整条用例：

```ts
  it('没有生成器的知识点抛错，消息含定位信息', () => {
    expect(() => generate(spec({ kpId: 'chord:I', track: 'H' }), c)).toThrow(/chord:I@recognize/)
  })
```

替换为：

```ts
  it('没有生成器的知识点抛错，消息含定位信息', () => {
    expect(() => generate(spec({ kpId: 'rhythm:quarter', track: 'R' }), c)).toThrow(/rhythm:quarter@recognize/)
  })
```

在文件顶部 import 中加入：

```ts
import { CHORD_ENTRIES } from './data/chords'
import { doMidiFor, resolveVariation } from './variation'
```

（`makeRng`、`freqToMidi`、`lookupGenerator` 已在该文件导入。）

把 `randomSpecs` 函数里的这一行：

```ts
      kpId: rng.pick(DEGREE_ENTRIES).kpId,
```

替换为（同时把 `track` 跟着知识点走）：

```ts
      ...pickTH(rng),
```

并在 `randomSpecs` 函数**之前**加入：

```ts
const TH_ROWS: { kpId: string; track: 'T' | 'H' }[] = [
  ...DEGREE_ENTRIES.map((e) => ({ kpId: e.kpId, track: 'T' as const })),
  ...CHORD_ENTRIES.map((e) => ({ kpId: e.kpId, track: 'H' as const })),
]
const pickTH = (rng: { pick<T>(xs: readonly T[]): T }) => rng.pick(TH_ROWS)
```

在 `describe('generate：快照（固定 seed）'` 的 `cases` 数组末尾追加 8 条：

```ts
    ['品质·听辨', { kpId: 'chord:quality-min', track: 'H', modality: 'recognize', contextLevel: 1, variationLevel: 6, difficultyStep: 1, seed: 201 }],
    ['功能和弦·唱', { kpId: 'chord:V7', track: 'H', modality: 'sing', contextLevel: 2, variationLevel: 3, difficultyStep: 5, seed: 202 }],
    ['功能和弦·听写', { kpId: 'chord:VI', track: 'H', modality: 'notate', contextLevel: 3, variationLevel: 4, difficultyStep: 4, seed: 203 }],
    ['进行·听辨', { kpId: 'prog:i-VI-III-VII', track: 'H', modality: 'recognize', contextLevel: 0, variationLevel: 2, difficultyStep: 5, seed: 204 }],
    ['进行·听写', { kpId: 'prog:I-vi-IV-V', track: 'H', modality: 'notate', contextLevel: 2, variationLevel: 5, seed: 205 }],
    ['转位·听辨', { kpId: 'chord:inv-second', track: 'H', modality: 'recognize', contextLevel: 1, variationLevel: 3, difficultyStep: 2, seed: 206 }],
    ['低音线·唱', { kpId: 'chord:bassline', track: 'H', modality: 'sing', contextLevel: 2, variationLevel: 6, difficultyStep: 4, seed: 207 }],
    ['低音线·听写', { kpId: 'chord:bassline', track: 'H', modality: 'notate', contextLevel: 4, variationLevel: 1, seed: 208 }],
```

在 `describe('generate：属性（P-2b spec §11 第 3 条）'` 内部末尾追加：

```ts
  it('H 轨：题目内容不依赖逐音折叠——plan 里的内容事件与生成器给出的音高完全一致（P-2b spec §14）', () => {
    for (const s of specs.filter((x) => x.track === 'H')) {
      // 按管线同样的顺序单独跑一次生成器，拿到「折叠前」的内容
      const entry = lookupGenerator(s.kpId)
      if (!entry) throw new Error(`没有生成器：${s.kpId}`)
      const rng = makeRng(s.seed)
      const resolved = resolveVariation(s.variationLevel, entry.mode, rng)
      const content = entry.byModality[s.modality]({
        spec: s, curriculum: c, resolved, doMidi: doMidiFor(resolved), rng,
      })
      const ex = generate(s, c)
      // 语境事件（终止式、持续低音、主音提示）都在 contentStartSec 之前起音
      const inPlan = ex.plan.events
        .filter((e) => e.atSec >= ex.contentStartSec - 1e-9)
        .map((e) => Math.round(freqToMidi(e.freqHz)))
        .sort((a, b) => a - b)
      const fromGenerator = content.notes.map((n) => n.midi).sort((a, b) => a - b)
      expect(inPlan).toEqual(fromGenerator)
    }
  })

  it('随机规格里确实有 H 轨', () => {
    expect(specs.filter((x) => x.track === 'H').length).toBeGreaterThan(100)
  })
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/generate.test.ts`
Expected: FAIL —— H 轨知识点 `lookupGenerator` 返回 undefined、`generate` 对 H 规格抛「没有可用的生成器」

- [ ] **Step 3: 写实现**

在 `src/exercises/generate.ts` 顶部 import 中加入：

```ts
import type { Modality } from '../curriculum/knowledgePoints'
import { chordEntry, type ChordFamily } from './data/chords'
import { FUNCTIONAL_GENERATORS, QUALITY_GENERATORS } from './generators/chord'
import { BASSLINE_GENERATORS, INVERSION_GENERATORS } from './generators/inversion'
import { PROGRESSION_GENERATORS } from './generators/progression'
import type { Generator } from './types'
```

（`Generator` 若与已有的 `import type { Exercise, GeneratorEntry } from './types'` 同源，合并到那一行；`Modality` 若与已有的 `KnowledgePointId` import 同源，合并到那一行。）

在 `lookupGenerator` 之前加入：

```ts
const CHORD_GENERATORS: Record<ChordFamily, Record<Modality, Generator>> = {
  quality: QUALITY_GENERATORS,
  functional: FUNCTIONAL_GENERATORS,
  progression: PROGRESSION_GENERATORS,
  inversion: INVERSION_GENERATORS,
  bassline: BASSLINE_GENERATORS,
}
```

在 `lookupGenerator` 函数体里、`return undefined` 之前加入：

```ts
  const chord = chordEntry(kpId)
  if (chord) {
    return { mode: chord.mode, byModality: CHORD_GENERATORS[chord.family] }
  }
```

并把函数注释里的「P-2b-H / P-2b-R 在此追加 H/R 轨的查找。」改为「P-2b-R 在此追加 R 轨的查找。」

- [ ] **Step 4: 运行测试；首次运行写出新快照**

Run: `npx vitest run src/exercises/generate.test.ts`
Expected: PASS；8 条新快照写入。T 轨的 6 条既有快照**必须不变**（若提示 obsolete 或 mismatch，停下排查：H 轨改动不应影响 T 轨）。打开快照文件抽查两条 H 快照：`plan.events` 按时刻升序；转位快照里内容部分的最低音只有一个；频率在 65–2093 Hz 之间。

- [ ] **Step 5: 再跑一次，确认快照稳定；跑全量与类型检查**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS，无「snapshot written」；tsc 无输出

- [ ] **Step 6: 提交（含快照文件）**

```bash
git add src/exercises/generate.ts src/exercises/generate.test.ts src/exercises/__snapshots__/
git commit -m "feat(exercises): 管线接入 H 轨，补 H 快照与音区属性测试" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 集成守卫扩到 H 轨、spec 写回与完成检查

**Files:**
- Modify: `src/exercises/integration.test.ts`
- Modify: `docs/superpowers/specs/2026-08-24-ear-training-design.md`（FWD-3 状态）
- Modify: `docs/superpowers/specs/2026-10-13-p2b-exercise-generators-design.md`（§2 `voiceChord` 签名、§3 `PromptId`、§14 H 轨三条标注已落实）

**Interfaces:**
- Consumes: Task 7 的 `generate`
- Produces: 无新导出

- [ ] **Step 1: 扩集成守卫**

在 `src/exercises/integration.test.ts` 中：

把：

```ts
      if (t.spec.track === 'T') specs.push(t.spec)
```

替换为：

```ts
      if (t.spec.track === 'T' || t.spec.track === 'H') specs.push(t.spec)
```

把：

```ts
describe('集成守卫：调度器真实发出的 T 轨规格都能生成并判定', () => {
```

替换为：

```ts
describe('集成守卫：调度器真实发出的 T/H 轨规格都能生成并判定', () => {
```

在 `expect(specs.some((s) => s.difficultyStep > 0)).toBe(true)` 这一行之后插入：

```ts
      // H 轨确实被覆盖到了，且覆盖面不止一两个知识点
      const hKps = new Set(specs.filter((s) => s.track === 'H').map((s) => s.kpId))
      expect(hKps.size).toBeGreaterThanOrEqual(5)
```

并把文件内 JSDoc 里的「P-2b-T 只覆盖 T 轨；P-2b-H/R 把过滤条件逐步放宽。」改为「P-2b-H 覆盖 T/H 轨；P-2b-R 放宽到全量。」

- [ ] **Step 2: 运行，确认通过**

Run: `npx vitest run src/exercises/integration.test.ts`
Expected: PASS。若失败，`failures` 列出出错规格；按出错位置修对应生成器，不改此测试。

- [ ] **Step 3: 写回 spec**

主 spec `docs/superpowers/specs/2026-08-24-ear-training-design.md`，在 FWD-3 段落的这一行之后：

```
**修法**：新增 voicing 函数，**不要改 `chordToMidi`**——它当前的行为对 H1–H5 是正确的。
```

插入一行：

```
**状态（P-2b-H，已关闭）**：新增 `voiceChord(chord, rootMidi)`（`music/chord.ts`），低音取转位指定的和弦音、放在根音下方一个八度，上方声部原位密集；`chordToMidi` 未改。和弦题整题统一移八度落入 MIDI 36–96，不做逐音折叠，转位与低音走向因此保持不变。
```

P-2b spec `docs/superpowers/specs/2026-10-13-p2b-exercise-generators-design.md`：

把 §2 中这一行：

```
- `chord.ts`：`voiceChord(chord, doMidi, bassMidi)`（FWD-3，H 轨计划落地；不改 `chordToMidi`）
```

替换为：

```
- `chord.ts`：`voiceChord(chord, rootMidi) → { bassMidi, upperMidis }`（FWD-3，P-2b-H 已落地；不改 `chordToMidi`）
```

把 §3 `PromptId` 联合中的 `| 'which-quality' | 'which-chord' | 'sing-arpeggio' | 'notate-chords'` 一行替换为 `| 'which-quality' | 'which-chord' | 'sing-arpeggio' | 'notate-chords' | 'notate-qualities'`，把 `| 'which-inversion' | 'which-bass-contour' | 'notate-bassline'` 一行替换为 `| 'which-inversion' | 'which-bass-contour' | 'notate-bassline' | 'notate-inversions'`。

在 §14 的三条 P-2b-H 条目末尾各追加「（P-2b-H 已落实）」。

- [ ] **Step 4: 完成检查**

```bash
npx vitest run
npx tsc --noEmit
npx vite build
grep -rn "Math.random\|Date.now\|window\.\|document\." src/exercises/ || echo "OK: src/exercises 保持纯净"
grep -rn "from '../audio\|from '../../audio\|from '../simulation\|from '../../simulation" src/exercises/ --include=*.ts | grep -v "\.test\.ts" || echo "OK: 依赖方向正确"
```

Expected: 全部 PASS；tsc 无输出；构建成功；两条 grep 都输出 OK。

- [ ] **Step 5: 提交**

```bash
git add src/exercises/integration.test.ts docs/superpowers/specs/
git commit -m "test(exercises): 集成守卫扩到 H 轨；docs(spec): 关闭 FWD-3" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 完成标准

1. `npx vitest run` 全绿
2. `npx tsc --noEmit` 无输出
3. `npx vite build` 成功
4. H 轨数据表覆盖测试通过：26 个知识点无一遗漏
5. 属性测试通过：随机 T/H 规格下答案必判对、全部音高在 MIDI 36–96、生成确定；H 轨内容事件不依赖逐音折叠
6. 集成守卫通过：普通与慢学习者 180 天里调度器发出的全部 T/H 轨规格都能生成并判定
7. T 轨的 6 条既有快照不变
8. `src/exercises/` 零 IO、依赖方向正确
9. spec 已写回：主 spec FWD-3 关闭；P-2b spec §2、§3、§14 更新

## 下一步

**P-2b-R**：R 轨节拍器语境、音型库、五类生成器（音型、拍号、beat 1、弱起、混合拍子）、打拍判定的端到端测试。开工前按 P-2b spec §14 的两条 P-2b-R 约束先改 `GeneratorEntry` 与 `grade`。
