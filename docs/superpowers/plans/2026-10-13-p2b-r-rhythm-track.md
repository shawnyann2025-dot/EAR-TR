# P-2b-R 节奏轨生成器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让调度器发出的全部 R 轨（节奏，15 个知识点）`ExerciseSpec` 都能生成可播放、可作答、可判定的 `Exercise`，完成 P-2b。

**Architecture:** 复用既有管线，新增第二种语境——节拍器（P-2b spec D7、§7.1）。`GeneratorEntry` 声明语境种类（`tonal` / `metronome`），`generate` 按它分派；R 轨生成器在 `ContentResult.rhythm` 里交出小节结构与节拍器模式。节奏内容一律用主音一个音高、按 FWD-2 的力度规则合成；时间以「感知拍」为速度单位（x/4 是四分音符，6/8 是附点四分，FWD-6）。

**Tech Stack:** TypeScript、vitest。无新依赖。

**Spec:** `docs/superpowers/specs/2026-10-13-p2b-exercise-generators-design.md`（P-2b spec）§3、§7.1、§7.4、§8、§12 第三行、§14 的两条 P-2b-R 约束。主 spec：`docs/superpowers/specs/2026-08-24-ear-training-design.md` §6.1、§6.3、§16.2 FWD-6。

## 本计划落实的设计裁定（执行者照做，不必再议）

spec §7.4 的表格把 R 轨内容写得很粗，有三处若照字面实现会**泄露答案**或**无法实现**，本计划按下列裁定落地，并在 Task 10 写回 spec：

1. **中性节拍器。** 拍号、找 beat 1、弱起、混合拍子这四类题问的正是「强拍在哪 / 一小节几拍」。若预备拍按题目拍号数、并给第一拍加重音，答案直接被节拍器说出来。这四类题的听辨与听写改用**中性节拍器**：所有点击同一力度；预备拍固定 4 个感知拍（L0 为 8 个），不按拍号分组；L2 改为「隔一个感知拍响一次」而不是「只在强拍响」。音型类题与两类「打出给定音型」的打拍题仍用**按拍号节拍器**（预备拍按小节、强拍加重）。
2. **拍号听写**按「N 段短句，每段 2 小节同一拍号、段间空一小节，逐段写拍号」实现。spec 原文「该拍号音型的 id 序列」在 R1（尚无任何音型知识点）时字母表为空，无法出题。
3. **音型类打拍题不放内容**：屏幕显示音型（`format.patternIds`），学习者跟节拍器打出来；反馈里再放给他听。拍号、beat 1、混合拍子的打拍题则是**边听边打强拍**。

其余数据层决定：音型库全部是 4/4（`tie-across-bar` 为两小节），6/8 只出现在拍号类题的随机填充里；混合拍子用 4 种 x/4 组合；beat 1 的片段在 2/4、3/4、4/4 中抽。

## Global Constraints

- `src/exercises/` 只依赖 `src/music/`、`src/curriculum/`、`src/scheduling/exerciseSpec.ts`；不得依赖 `src/audio/`、`src/simulation/`（测试文件除外）。
- 零 IO：不得出现 `Math.random`、`Date.now`、`window.`、`document.`。随机性只来自传入的 `rng`。
- rng 消耗顺序固定为「变异轴 → 内容 → 选项打乱」：每个生成器先抽完内容，最后才调用 `pickOptions`。
- 整份 plan 的音高必须落在 MIDI 36–96。
- R 轨内容的音高是主音 `tonicMidi(key, doMidi)`；节拍器点击是主音高一个八度（`+12`）。R 轨知识点的 `mode` 一律 `'major'`。
- 力度规则（FWD-2）：节奏内容必须经 `onsetsToNotes(onsets, midi, velocity)` 生成——重音 `velocity`，非重音 `velocity × 0.75`。
- 速度：`resolved.bpm` 是**感知拍**每分钟个数。x/4 的感知拍 = 1 个四分音符；x/8 的感知拍 = 3 个八分音符（附点四分）。一个记谱单位的秒数 = `60 / bpm / unitsPerPulse(meter)`（FWD-6：`Meter.beatsPerBar` 填记谱拍数，6/8 是 `{ beatsPerBar: 6, beatUnit: 8 }`）。
- 节奏内容的音符时值 = 记谱时值 × `RHYTHM_LEGATO`（0.85），让每个起音清楚。
- 打拍题：`format.onsetsSec` 与 `answer.onsetsSec` 都相对题目内容起点（`contentStartSec`），容差取 `difficultyParams(step).tapToleranceSec`。
- 测试命令：`npx vitest run <path>`；全量 `npx vitest run`；类型 `npx tsc --noEmit`；构建 `npx vite build`。
- 每个任务结束提交一次，提交信息以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾。不要提交 `.superpowers/` 下的任何文件。

## File Structure

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/exercises/grade.ts`（重写） | 先统一校验格式；打拍边界 | 1 |
| `src/exercises/types.ts`（改） | `MetronomeMode`、`ContentResult.rhythm`、`GeneratorEntry.context`、打拍 `patternIds` | 2 |
| `src/exercises/metronome.ts` | 感知拍网格、节拍器语境包装、反馈锚点小节 | 2 |
| `src/exercises/generate.ts`（改） | `generateWith` 按语境分派；R 轨查找 | 3、9 |
| `src/exercises/data/rhythms.ts` | R 轨数据表、拍号、音型库、弱起、混合拍子组合 | 4 |
| `src/exercises/generators/rhythmCommon.ts` | 时间换算、放置事件、随机填充、音型池 | 5 |
| `src/exercises/generators/pattern.ts` | 音型类三模态 | 6 |
| `src/exercises/generators/meter.ts` | 拍号类、混合拍子三模态 | 7 |
| `src/exercises/generators/pickup.ts` | 找 beat 1、弱起三模态 | 8 |
| `src/exercises/generate.test.ts`、`integration.test.ts`（改） | R 快照、属性、集成守卫全量 | 9、10 |

---

### Task 1: `grade` 先统一校验格式，补打拍边界用例（P-2b spec §14）

**Files:**
- Modify: `src/exercises/grade.ts`（整文件替换）
- Test: `src/exercises/grade.test.ts`（末尾追加 describe）

**Interfaces:**
- Consumes: `Answer`/`Exercise`/`GradeResult`/`Response`（types）
- Produces: `grade` 与 `answerAsResponse` 签名不变；新增行为：`exercise.format.kind !== exercise.answer.kind` 时抛错，消息含两者的 kind

- [ ] **Step 1: 写失败的测试**

在 `src/exercises/grade.test.ts` 末尾追加：

```ts
describe('grade：先统一校验题目自身的格式（P-2b spec §14）', () => {
  it('format 与 answer 种类不一致时抛错，消息含两者', () => {
    const broken = {
      format: { kind: 'choice' as const, options: [{ id: 'a' }] },
      answer: { kind: 'sequence' as const, ids: ['a'] },
    }
    expect(() => grade(broken, { kind: 'sequence', ids: ['a'] })).toThrow(/choice.*sequence|sequence.*choice/)
  })

  it('作答种类不一致时的消息把作答种类当作「收到的」', () => {
    expect(() => grade(tap, { kind: 'choice', id: 're' })).toThrow(/作答格式 choice/)
  })
})

describe('grade：打拍边界（P-2b spec §14）', () => {
  // 容差与偏差都取二进制可精确表示的数，避免浮点误差左右边界判定
  const exact: Gradable = {
    format: { kind: 'tap', onsetsSec: [0, 0.5, 1, 1.5], toleranceSec: 0.125 },
    answer: { kind: 'tap', onsetsSec: [0, 0.5, 1, 1.5] },
  }

  it('偏差恰等于容差：对', () => {
    expect(grade(exact, { kind: 'tap', tapsSec: [0, 0.625, 1, 1.5] }).correct).toBe(true)
  })

  it('偏差刚超过容差：错', () => {
    expect(grade(exact, { kind: 'tap', tapsSec: [0, 0.6251, 1, 1.5] }).correct).toBe(false)
  })

  it('负偏差（抢拍）同样按绝对值判', () => {
    const r = grade(exact, { kind: 'tap', tapsSec: [0, 0.375, 1, 1.5] })
    expect(r.correct).toBe(true)
    if (r.detail.kind !== 'tap') throw new Error('detail 类型错')
    expect(r.detail.offsetsSec[1]).toBeCloseTo(-0.125, 12)
    expect(grade(exact, { kind: 'tap', tapsSec: [0, 0.37, 1, 1.5] }).correct).toBe(false)
  })

  it('多点：错，偏差按目标长度给出', () => {
    const r = grade(exact, { kind: 'tap', tapsSec: [0, 0.5, 1, 1.5, 2] })
    expect(r.correct).toBe(false)
    if (r.detail.kind !== 'tap') throw new Error('detail 类型错')
    expect(r.detail.offsetsSec).toHaveLength(4)
  })

  it('首击晚到、其后每下都偏早：平移后看出节奏错', () => {
    expect(grade(exact, { kind: 'tap', tapsSec: [0.3, 0.6, 1.1, 1.6] }).correct).toBe(false)
  })
})

describe('grade：听写作答比答案长', () => {
  it('整体错，逐位按答案长度给出', () => {
    expect(grade(sequence, { kind: 'sequence', ids: ['do', 'mi', 're', 'fa'] })).toEqual({
      correct: false,
      detail: { kind: 'sequence', positions: [true, true, true] },
    })
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/grade.test.ts`
Expected: FAIL —— 「format 与 answer 种类不一致时抛错」不抛错（现有代码只在打拍分支校验）；「作答种类不一致时的消息」不匹配。其余新用例可能已通过，这是预期的（它们是补测试）。

- [ ] **Step 3: 写实现**

把 `src/exercises/grade.ts` 整个替换为：

```ts
import type { Answer, Exercise, GradeResult, Response } from './types'

const TAP_EPSILON = 1e-9

function responseMismatch(expected: string, got: string): never {
  throw new Error(`作答格式 ${got} 与题目格式 ${expected} 不匹配`)
}

/**
 * 判定（P-2b spec §8）。纯函数。
 *
 * 先校验题目自身：format 与 answer 种类必须一致（P-2b spec §14）。
 * 再校验作答：作答种类与题目不一致时抛错——那是调用方的 bug，不是学习者答错。
 */
export function grade(
  exercise: Pick<Exercise, 'format' | 'answer'>,
  response: Response,
): GradeResult {
  const { format, answer } = exercise
  if (format.kind !== answer.kind) {
    throw new Error(`题目自身不一致：format 是 ${format.kind}，answer 是 ${answer.kind}`)
  }
  if (response.kind !== answer.kind) responseMismatch(answer.kind, response.kind)

  switch (answer.kind) {
    case 'choice': {
      if (response.kind !== 'choice') return responseMismatch('choice', response.kind)
      return { correct: response.id === answer.id, detail: { kind: 'choice' } }
    }
    case 'sequence': {
      if (response.kind !== 'sequence') return responseMismatch('sequence', response.kind)
      const positions = answer.ids.map((id, i) => response.ids[i] === id)
      const correct = response.ids.length === answer.ids.length && positions.every(Boolean)
      return { correct, detail: { kind: 'sequence', positions } }
    }
    case 'pitch': {
      if (response.kind !== 'pitch') return responseMismatch('pitch', response.kind)
      return { correct: response.selfAssessedCorrect, detail: { kind: 'pitch' } }
    }
    case 'tap': {
      if (response.kind !== 'tap' || format.kind !== 'tap') return responseMismatch('tap', response.kind)
      const target = answer.onsetsSec
      const taps = response.tapsSec
      if (taps.length === 0 || target.length === 0) {
        return { correct: false, detail: { kind: 'tap', offsetsSec: [] } }
      }
      // 整串平移，让首击对齐首个目标起音——消除反应延迟，只比节奏本身
      const shift = target[0] - taps[0]
      const n = Math.min(taps.length, target.length)
      const offsetsSec = Array.from({ length: n }, (_, i) => taps[i] + shift - target[i])
      const correct =
        taps.length === target.length &&
        offsetsSec.every((o) => Math.abs(o) <= format.toleranceSec + TAP_EPSILON)
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

Run: `npx vitest run src/exercises/`
Expected: PASS（含既有 grade 测试与全部生成器测试）

- [ ] **Step 5: 提交**

```bash
git add src/exercises/grade.ts src/exercises/grade.test.ts
git commit -m "fix(exercises): grade 先统一校验题目格式，补打拍边界用例" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 类型扩展与节拍器语境

**Files:**
- Modify: `src/exercises/types.ts`
- Modify: `src/exercises/generate.ts`（`lookupGenerator` 的两处 return 加 `context: 'tonal'`）
- Create: `src/exercises/metronome.ts`
- Test: `src/exercises/metronome.test.ts`

**Interfaces:**
- Consumes: `Meter`（music/rhythm）、`ContextLevel`（music/tonalContext）、`mergePlans`/`notesToPlan`/`NoteSpec`/`PlaybackPlan`/`TimbreId`（music/playback）、`shiftPlan`/`foldToPlanRange`（context）
- Produces:
  - `types.ts`：
    - `export type MetronomeMode = 'metered' | 'neutral'`
    - `ContentResult` 增加可选字段 `rhythm?: { bars: readonly Meter[]; metronome: MetronomeMode }`
    - `GeneratorEntry` 增加必填字段 `context: 'tonal' | 'metronome'`
    - `AnswerFormat` 的 tap 分支增加可选字段 `patternIds?: string[]`（屏幕上要显示的音型 / 弱起 id，供「打出给定音型」类题）
  - `metronome.ts`：
    - 常量 `CLICK_SEC = 0.06`、`CLICK_GAIN_ACCENT = 0.6`、`CLICK_GAIN = 0.4`、`NEUTRAL_COUNT_IN_PULSES = 4`、`METRONOME_L4_COVERAGE = 0.4`
    - `export function unitsPerPulse(meter: Meter): number`（x/8 → 3，否则 1）
    - `export function pulsesPerBar(meter: Meter): number`
    - `export interface Pulse { atSec: number; downbeat: boolean }`
    - `export function pulseGrid(bars: readonly Meter[], bpm: number): Pulse[]`
    - `export interface MetronomeWrapInput { bars: readonly Meter[]; bpm: number; level: ContextLevel; mode: MetronomeMode; clickMidi: number; timbreId: TimbreId; content: PlaybackPlan; contentDurSec: number }`
    - `export function wrapWithMetronome(input: MetronomeWrapInput): { plan: PlaybackPlan; contentStartSec: number }`
    - `export function metronomeBarNotes(meter: Meter, bpm: number, clickMidi: number): NoteSpec[]`（一小节按拍号点击，强拍加重；R 轨反馈的锚点）

节拍器各级（P-2b spec §7.1 + 本计划裁定 1）：

| 等级 | metered（按拍号） | neutral（中性） |
|---|---|---|
| 预备拍 | L0 两小节、其余一小节，按 `bars[0]` 的拍号，每小节第一拍加重 | L0 8 个、其余 4 个感知拍，全部同力度 |
| L0、L1 内容中 | 每个感知拍都响，强拍加重 | 每个感知拍都响，同力度 |
| L2 内容中 | 只在每小节第一拍响（加重） | 隔一个感知拍响一次（第 0、2、4…个） |
| L3 内容中 | 不响 | 不响 |
| L4 内容中 | 只在内容前 40% 时长内响 | 同左，同力度 |

- [ ] **Step 1: 扩展类型**

在 `src/exercises/types.ts`：

顶部 import 区加入：

```ts
import type { Meter } from '../music/rhythm'
```

把 tap 分支：

```ts
  | { kind: 'tap'; onsetsSec: number[]; toleranceSec: number }
```

替换为：

```ts
  | {
      kind: 'tap'
      onsetsSec: number[]
      toleranceSec: number
      /** 「打出给定音型」类题：屏幕上要显示的音型 / 弱起 id；边听边打强拍的题不给 */
      patternIds?: string[]
    }
```

在 `export interface ContentResult {` 之前加入：

```ts
/** 节拍器模式：metered 按拍号分组、强拍加重；neutral 不透露拍号与强拍（P-2b-R 裁定 1） */
export type MetronomeMode = 'metered' | 'neutral'
```

在 `ContentResult` 的 `answer: Answer` 字段之后加入：

```ts
  /** 节拍器语境需要的小节结构；只有 context 为 metronome 的生成器才给 */
  rhythm?: { bars: readonly Meter[]; metronome: MetronomeMode }
```

把 `GeneratorEntry` 改为：

```ts
export interface GeneratorEntry {
  mode: Mode
  /** tonal：调性语境（主 spec §6.1）；metronome：节拍器语境（P-2b spec §7.1） */
  context: 'tonal' | 'metronome'
  byModality: Record<Modality, Generator>
}
```

在 `src/exercises/generate.ts` 的 `lookupGenerator` 里，把两处 return 分别改为：

```ts
    return {
      mode: degree.mode,
      context: 'tonal',
      byModality: degree.pool === 'modulation' ? MODULATION_GENERATORS : DEGREE_GENERATORS,
    }
```

```ts
    return { mode: chord.mode, context: 'tonal', byModality: CHORD_GENERATORS[chord.family] }
```

Run: `npx tsc --noEmit && npx vitest run src/exercises/`
Expected: tsc 无输出；PASS（纯类型扩展，行为不变，快照不变）

- [ ] **Step 2: 写失败的测试**

`src/exercises/metronome.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { freqToMidi } from '../music/pitch'
import { notesToPlan } from '../music/playback'
import type { Meter } from '../music/rhythm'
import type { ContextLevel } from '../music/tonalContext'
import {
  CLICK_GAIN,
  CLICK_GAIN_ACCENT,
  metronomeBarNotes,
  pulseGrid,
  pulsesPerBar,
  unitsPerPulse,
  wrapWithMetronome,
} from './metronome'
import type { MetronomeMode } from './types'

const M24: Meter = { beatsPerBar: 2, beatUnit: 4 }
const M34: Meter = { beatsPerBar: 3, beatUnit: 4 }
const M44: Meter = { beatsPerBar: 4, beatUnit: 4 }
const M68: Meter = { beatsPerBar: 6, beatUnit: 8 }

const CONTENT_MIDI = 60
const CLICK_MIDI = 72
const content = notesToPlan([{ midi: CONTENT_MIDI, atSec: 0, durSec: 0.3 }], 'piano')

function wrap(level: ContextLevel, mode: MetronomeMode, bars: Meter[] = [M44, M44], contentDurSec = 8) {
  return wrapWithMetronome({
    bars, bpm: 60, level, mode, clickMidi: CLICK_MIDI, timbreId: 'piano', content, contentDurSec,
  })
}
const clicks = (r: ReturnType<typeof wrap>) =>
  r.plan.events.filter((e) => Math.round(freqToMidi(e.freqHz)) === CLICK_MIDI)
const contentClicks = (r: ReturnType<typeof wrap>) =>
  clicks(r).filter((e) => e.atSec >= r.contentStartSec - 1e-9)

describe('感知拍（FWD-6）', () => {
  it('x/4 一拍一个四分音符；6/8 一拍是附点四分＝3 个八分', () => {
    expect(unitsPerPulse(M44)).toBe(1)
    expect(unitsPerPulse(M68)).toBe(3)
    expect(pulsesPerBar(M34)).toBe(3)
    expect(pulsesPerBar(M68)).toBe(2)
  })

  it('pulseGrid：按小节铺感知拍，标出每小节第一拍', () => {
    expect(pulseGrid([M34, M24], 120)).toEqual([
      { atSec: 0, downbeat: true },
      { atSec: 0.5, downbeat: false },
      { atSec: 1, downbeat: false },
      { atSec: 1.5, downbeat: true },
      { atSec: 2, downbeat: false },
    ])
    expect(pulseGrid([M68], 60).map((p) => p.atSec)).toEqual([0, 1])
  })
})

describe('wrapWithMetronome：metered', () => {
  it('L0：两小节预备拍，强拍加重；内容中每拍都响', () => {
    const r = wrap(0, 'metered')
    expect(r.contentStartSec).toBe(8)
    const pre = clicks(r).filter((e) => e.atSec < 8)
    expect(pre.map((e) => e.atSec)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(pre.map((e) => e.gain)).toEqual([
      CLICK_GAIN_ACCENT, CLICK_GAIN, CLICK_GAIN, CLICK_GAIN,
      CLICK_GAIN_ACCENT, CLICK_GAIN, CLICK_GAIN, CLICK_GAIN,
    ])
    expect(contentClicks(r)).toHaveLength(8)
  })

  it('L1：一小节预备拍', () => {
    expect(wrap(1, 'metered').contentStartSec).toBe(4)
  })

  it('L2：内容中只在每小节第一拍响', () => {
    const r = wrap(2, 'metered')
    expect(contentClicks(r).map((e) => e.atSec - r.contentStartSec)).toEqual([0, 4])
    expect(contentClicks(r).every((e) => e.gain === CLICK_GAIN_ACCENT)).toBe(true)
  })

  it('L3：内容中不响', () => {
    expect(contentClicks(wrap(3, 'metered'))).toHaveLength(0)
  })

  it('L4：只在内容前 40% 响', () => {
    const r = wrap(4, 'metered')
    expect(contentClicks(r).map((e) => e.atSec - r.contentStartSec)).toEqual([0, 1, 2, 3])
  })

  it('预备拍按第一小节的拍号分组', () => {
    expect(wrap(1, 'metered', [M34, M34], 6).contentStartSec).toBe(3)
  })
})

describe('wrapWithMetronome：neutral（不透露拍号与强拍）', () => {
  it('预备拍固定 4 个感知拍（L0 为 8 个），与拍号无关，全部同力度', () => {
    for (const bars of [[M24, M24], [M34, M34], [M44, M44]]) {
      const r = wrap(1, 'neutral', bars, 6)
      expect(r.contentStartSec).toBe(4)
      expect(clicks(r).every((e) => e.gain === CLICK_GAIN)).toBe(true)
    }
    expect(wrap(0, 'neutral').contentStartSec).toBe(8)
  })

  it('L2：隔一个感知拍响一次，不跟强拍对齐', () => {
    const r = wrap(2, 'neutral', [M34, M34], 6)
    expect(contentClicks(r).map((e) => e.atSec - r.contentStartSec)).toEqual([0, 2, 4])
  })
})

describe('内容与音区', () => {
  it('内容整体后移 contentStartSec，事件按时刻排序', () => {
    const r = wrap(1, 'metered')
    const c = r.plan.events.filter((e) => Math.round(freqToMidi(e.freqHz)) === CONTENT_MIDI)
    expect(c.map((e) => e.atSec)).toEqual([4])
    const times = r.plan.events.map((e) => e.atSec)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('点击过高时整份折叠回 36–96', () => {
    const r = wrapWithMetronome({
      bars: [M44], bpm: 60, level: 1, mode: 'metered', clickMidi: 100, timbreId: 'piano', content, contentDurSec: 4,
    })
    for (const e of r.plan.events) expect(freqToMidi(e.freqHz)).toBeLessThanOrEqual(96 + 1e-6)
  })
})

describe('metronomeBarNotes（R 轨反馈锚点）', () => {
  it('一小节按拍号点击，第一拍加重', () => {
    expect(metronomeBarNotes(M34, 60, CLICK_MIDI).map((n) => [n.atSec, n.gain])).toEqual([
      [0, CLICK_GAIN_ACCENT], [1, CLICK_GAIN], [2, CLICK_GAIN],
    ])
  })
})
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `npx vitest run src/exercises/metronome.test.ts`
Expected: FAIL —— 无法解析模块 `./metronome`

- [ ] **Step 4: 写实现**

`src/exercises/metronome.ts`：

```ts
import { mergePlans, notesToPlan, type NoteSpec, type PlaybackPlan, type TimbreId } from '../music/playback'
import type { Meter } from '../music/rhythm'
import type { ContextLevel } from '../music/tonalContext'
import { foldToPlanRange, shiftPlan } from './context'
import type { MetronomeMode } from './types'

export const CLICK_SEC = 0.06
export const CLICK_GAIN_ACCENT = 0.6
export const CLICK_GAIN = 0.4
/** 中性节拍器的预备拍个数（L0 加倍）——固定值，不按拍号分组，免得泄露拍号 */
export const NEUTRAL_COUNT_IN_PULSES = 4
/** L4：节拍器只覆盖内容前 40% */
export const METRONOME_L4_COVERAGE = 0.4

/** 一个感知拍含几个记谱单位：x/8 复合拍是附点四分＝3 个八分（FWD-6），其余 1 个 */
export function unitsPerPulse(meter: Meter): number {
  return meter.beatUnit === 8 ? 3 : 1
}

export function pulsesPerBar(meter: Meter): number {
  return meter.beatsPerBar / unitsPerPulse(meter)
}

export interface Pulse {
  atSec: number
  downbeat: boolean
}

/** 按小节铺感知拍；bpm 是每分钟感知拍数 */
export function pulseGrid(bars: readonly Meter[], bpm: number): Pulse[] {
  const pulseSec = 60 / bpm
  const out: Pulse[] = []
  let t = 0
  for (const bar of bars) {
    const n = pulsesPerBar(bar)
    for (let i = 0; i < n; i++) out.push({ atSec: t + i * pulseSec, downbeat: i === 0 })
    t += n * pulseSec
  }
  return out
}

function click(atSec: number, accent: boolean, clickMidi: number): NoteSpec {
  return { midi: clickMidi, atSec, durSec: CLICK_SEC, gain: accent ? CLICK_GAIN_ACCENT : CLICK_GAIN }
}

export interface MetronomeWrapInput {
  bars: readonly Meter[]
  bpm: number
  level: ContextLevel
  mode: MetronomeMode
  clickMidi: number
  timbreId: TimbreId
  /** 题目内容，时刻相对 0 */
  content: PlaybackPlan
  contentDurSec: number
}

/**
 * 管线第 3 步（R 轨）：节拍器语境（P-2b spec §7.1，D7）。
 * metered 按拍号分组、强拍加重；neutral 所有点击同力度、预备拍固定个数（P-2b-R 裁定 1）。
 */
export function wrapWithMetronome(input: MetronomeWrapInput): {
  plan: PlaybackPlan
  contentStartSec: number
} {
  const { bars, bpm, level, mode, clickMidi } = input
  const pulseSec = 60 / bpm
  const metered = mode === 'metered'

  const countIn: NoteSpec[] = metered
    ? pulseGrid(Array.from({ length: level === 0 ? 2 : 1 }, () => bars[0]), bpm).map((p) =>
        click(p.atSec, p.downbeat, clickMidi),
      )
    : Array.from({ length: level === 0 ? 2 * NEUTRAL_COUNT_IN_PULSES : NEUTRAL_COUNT_IN_PULSES }, (_, i) =>
        click(i * pulseSec, false, clickMidi),
      )
  const leadInSec = countIn.length * pulseSec

  const grid = pulseGrid(bars, bpm)
  const kept = grid.filter((p, i) => {
    switch (level) {
      case 0:
      case 1:
        return true
      case 2:
        return metered ? p.downbeat : i % 2 === 0
      case 3:
        return false
      case 4:
        return p.atSec < METRONOME_L4_COVERAGE * input.contentDurSec
    }
  })
  const during = kept.map((p) => click(leadInSec + p.atSec, metered && p.downbeat, clickMidi))

  const merged = mergePlans(
    notesToPlan([...countIn, ...during], input.timbreId),
    shiftPlan(input.content, leadInSec),
  )
  return { plan: foldToPlanRange(merged), contentStartSec: leadInSec }
}

/** 一小节按拍号的点击，强拍加重——R 轨反馈「先放一小节节拍器」的锚点（P-2b spec §9） */
export function metronomeBarNotes(meter: Meter, bpm: number, clickMidi: number): NoteSpec[] {
  return pulseGrid([meter], bpm).map((p) => click(p.atSec, p.downbeat, clickMidi))
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `npx vitest run src/exercises/ && npx tsc --noEmit`
Expected: PASS；tsc 无输出

- [ ] **Step 6: 提交**

```bash
git add src/exercises/types.ts src/exercises/generate.ts src/exercises/metronome.ts src/exercises/metronome.test.ts
git commit -m "feat(exercises): 节拍器语境（按拍号 / 中性）与类型扩展" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 管线按语境分派（`generateWith`）

**Files:**
- Modify: `src/exercises/generate.ts`
- Test: `src/exercises/generate.test.ts`（新增一个 describe）

**Interfaces:**
- Consumes: `wrapWithMetronome`/`metronomeBarNotes`（Task 2）、既有 `wrapWithTonalContext`/`buildFeedback`
- Produces:
  - `export const CLICK_OCTAVE = 12`
  - `export function generateWith(entry: GeneratorEntry, spec: ExerciseSpec, curriculum: Curriculum): Exercise` —— 管线本体；`context === 'metronome'` 时要求 `content.rhythm` 存在（否则抛错，消息含 `describeSpec`），用 `wrapWithMetronome` 包装，反馈锚点是 `metronomeBarNotes(bars[0], bpm, 主音 + 12)`；`context === 'tonal'` 时行为与现在完全一致
  - `generate(spec, curriculum)` 改为查表后调用 `generateWith`

- [ ] **Step 1: 写失败的测试**

在 `src/exercises/generate.test.ts` 顶部 import 中，把 `import { answerAsResponse, generate, grade, lookupGenerator } from './generate'` 改为：

```ts
import { CLICK_OCTAVE, answerAsResponse, generate, generateWith, grade, lookupGenerator } from './generate'
import { CLICK_GAIN_ACCENT } from './metronome'
import type { ContentResult, GeneratorEntry } from './types'
```

（若 `Exercise` 已从 `./types` 导入，合并到同一行。）

在文件末尾追加：

```ts
describe('generateWith：按语境分派', () => {
  const fakeContent = (withRhythm: boolean): ContentResult => ({
    notes: [{ midi: 60, atSec: 0, durSec: 0.2, gain: 0.8 }],
    feedbackNotes: [{ midi: 60, atSec: 0, durSec: 0.2, gain: 0.8 }],
    durSec: 4 * (60 / 90),
    prompt: 'which-pattern',
    format: { kind: 'choice', options: [{ id: 'a' }, { id: 'b' }] },
    answer: { kind: 'choice', id: 'a' },
    ...(withRhythm ? { rhythm: { bars: [{ beatsPerBar: 4, beatUnit: 4 }], metronome: 'metered' as const } } : {}),
  })
  const metronomeEntry = (withRhythm: boolean): GeneratorEntry => ({
    mode: 'major',
    context: 'metronome',
    byModality: { recognize: () => fakeContent(withRhythm), sing: () => fakeContent(withRhythm), notate: () => fakeContent(withRhythm) },
  })
  const rSpec = spec({ kpId: 'rhythm:quarter', track: 'R', contextLevel: 1 })

  it('节拍器语境：一小节预备拍（默认 90 bpm），内容在其后', () => {
    const ex = generateWith(metronomeEntry(true), rSpec, c)
    expect(ex.contentStartSec).toBeCloseTo(4 * (60 / 90), 12)
    expect(ex.plan.events.some((e) => Math.abs(e.atSec - ex.contentStartSec) < 1e-9 && Math.round(freqToMidi(e.freqHz)) === 60)).toBe(true)
  })

  it('节拍器语境：点击在主音上方一个八度；反馈先放一小节强拍加重的节拍器', () => {
    const ex = generateWith(metronomeEntry(true), rSpec, c)
    const clickMidi = 60 + CLICK_OCTAVE
    expect(ex.plan.events.some((e) => Math.round(freqToMidi(e.freqHz)) === clickMidi)).toBe(true)
    const anchor = ex.feedback.replay.events.slice(0, 4)
    expect(anchor.every((e) => Math.round(freqToMidi(e.freqHz)) === clickMidi)).toBe(true)
    expect(anchor[0].gain).toBe(CLICK_GAIN_ACCENT)
  })

  it('节拍器语境缺 rhythm：抛错，消息含定位信息', () => {
    expect(() => generateWith(metronomeEntry(false), rSpec, c)).toThrow(/rhythm:quarter@recognize/)
  })

  it('调性语境：generateWith 与 generate 结果一致', () => {
    const s = spec({ kpId: 'degree:major:re', contextLevel: 2, variationLevel: 4, seed: 9 })
    const entry = lookupGenerator(s.kpId)
    if (!entry) throw new Error('缺生成器')
    expect(generateWith(entry, s, c)).toEqual(generate(s, c))
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/generate.test.ts`
Expected: FAIL —— `generateWith` / `CLICK_OCTAVE` 不是导出成员

- [ ] **Step 3: 写实现**

在 `src/exercises/generate.ts`：

顶部 import 加入：

```ts
import type { NoteSpec } from '../music/playback'
import { metronomeBarNotes, wrapWithMetronome } from './metronome'
```

（`NoteSpec` 若可与已有的 `import { notesToPlan } from '../music/playback'` 合并，合并为 `import { notesToPlan, type NoteSpec } from '../music/playback'`。）

把整个 `generate` 函数（含其上方注释）替换为：

```ts
/** R 轨节拍器点击比主音高一个八度 */
export const CLICK_OCTAVE = 12

/**
 * 管线本体（P-2b spec §4）：解析变异轴 → 生成内容 → 语境包装 → 反馈。
 *
 * 按 entry.context 分派语境：tonal 用调性语境（主 spec §6.1），反馈锚点是主音；
 * metronome 用节拍器（P-2b spec §7.1），反馈锚点是一小节节拍器（§9）。
 * 纯函数；rng 消耗顺序固定为「变异轴 → 内容 → 选项打乱」。
 * spec.difficultyStep 必须已由调用方写入阶梯档位（主 spec FWD-8），这里不检查。
 */
export function generateWith(
  entry: GeneratorEntry,
  spec: ExerciseSpec,
  curriculum: Curriculum,
): Exercise {
  const rng = makeRng(spec.seed)
  const resolved = resolveVariation(spec.variationLevel, entry.mode, rng)
  const doMidi = doMidiFor(resolved)
  const content = entry.byModality[spec.modality]({ spec, curriculum, resolved, doMidi, rng })
  const contentPlan = notesToPlan(content.notes, resolved.timbreId)
  const tonic = tonicMidi(resolved.key, doMidi)

  let wrapped: { plan: Exercise['plan']; contentStartSec: number }
  let anchor: NoteSpec[]
  if (entry.context === 'tonal') {
    wrapped = wrapWithTonalContext({
      key: resolved.key,
      level: spec.contextLevel,
      timbreId: resolved.timbreId,
      doMidi,
      content: contentPlan,
      contentDurSec: content.durSec,
    })
    anchor = [{ midi: tonic, atSec: 0, durSec: FEEDBACK_ANCHOR_SEC, gain: resolved.velocity }]
  } else {
    if (!content.rhythm) {
      throw new Error(`节拍器语境的生成器必须给出 rhythm：${describeSpec(spec)}`)
    }
    const clickMidi = tonic + CLICK_OCTAVE
    wrapped = wrapWithMetronome({
      bars: content.rhythm.bars,
      bpm: resolved.bpm,
      level: spec.contextLevel,
      mode: content.rhythm.metronome,
      clickMidi,
      timbreId: resolved.timbreId,
      content: contentPlan,
      contentDurSec: content.durSec,
    })
    anchor = metronomeBarNotes(content.rhythm.bars[0], resolved.bpm, clickMidi)
  }

  const feedback = buildFeedback(content.feedbackNotes, anchor, resolved.timbreId)
  return {
    spec,
    resolved,
    plan: wrapped.plan,
    contentStartSec: wrapped.contentStartSec,
    prompt: content.prompt,
    format: content.format,
    answer: content.answer,
    feedback,
  }
}

/** 管线入口：查生成器表，再走 generateWith */
export function generate(spec: ExerciseSpec, curriculum: Curriculum): Exercise {
  const entry = lookupGenerator(spec.kpId)
  if (!entry) throw new Error(`没有可用的生成器：${describeSpec(spec)}`)
  return generateWith(entry, spec, curriculum)
}
```

- [ ] **Step 4: 运行测试，确认通过；快照必须不变**

Run: `npx vitest run src/exercises/ && npx tsc --noEmit`
Expected: PASS；无「snapshot written」/「obsolete」；tsc 无输出。若 T/H 快照有任何变化，停下排查——调性分支应与改动前逐字等价。

- [ ] **Step 5: 提交**

```bash
git add src/exercises/generate.ts src/exercises/generate.test.ts
git commit -m "feat(exercises): 管线按语境分派，支持节拍器语境" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: R 轨数据表与覆盖测试

**Files:**
- Create: `src/exercises/data/rhythms.ts`
- Test: `src/exercises/data/rhythms.test.ts`

**Interfaces:**
- Consumes: `makeKpId`/`KnowledgePointId`（curriculum/knowledgePoints）、`Meter`（music/rhythm）
- Produces:
  - `export type RhythmFamily = 'pattern' | 'meter' | 'beat-one' | 'anacrusis' | 'mixed-meter'`
  - `export type MeterId = '2/4' | '3/4' | '4/4' | '6/8'`
  - `export const METERS: Record<MeterId, Meter>`
  - `export interface RhythmEntry { kpId: KnowledgePointId; family: RhythmFamily; pool: RhythmFamily; meterId?: MeterId }`（`meterId` 只有拍号类有）
  - `export const RHYTHM_ENTRIES: readonly RhythmEntry[]`（15 行）
  - `export function rhythmEntry(kpId)`、`export function requireRhythmEntry(kpId)`、`export function rhythmPoolOf(kpId): RhythmFamily | undefined`
  - `export interface PatternNote { onset: number; dur: number }`（4/4，以四分音符为单位，可跨小节）
  - `export interface PatternDef { id: string; ownerKpId: KnowledgePointId; bars: 1 | 2; notes: readonly PatternNote[] }`
  - `export const PATTERNS: readonly PatternDef[]`
  - `export function patternsOf(kpId): PatternDef[]`、`export function patternById(id): PatternDef`（找不到抛错）
  - `export const PICKUP_IDS = ['none', 'half', 'one'] as const`、`export type PickupId`、`export const PICKUPS: Record<PickupId, readonly PatternNote[]>`（落在第 0 小节，4/4）
  - `export interface MixedCombo { id: string; meters: readonly MeterId[] }`、`export const MIXED_COMBOS: readonly MixedCombo[]`、`export const MIXED_METER_ALPHABET: readonly MeterId[]`（`['2/4','3/4','4/4']`）
  - `export const BEAT_ONE_METERS: readonly MeterId[]`（`['2/4','3/4','4/4']`）

- [ ] **Step 1: 写失败的测试**

`src/exercises/data/rhythms.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../../curriculum/curriculum'
import {
  METERS,
  MIXED_COMBOS,
  PATTERNS,
  PICKUPS,
  RHYTHM_ENTRIES,
  patternById,
  patternsOf,
  requireRhythmEntry,
  rhythmEntry,
  rhythmPoolOf,
} from './rhythms'

const c = buildCurriculum()
const R_KPS = [...c.knowledgePoints.values()].filter((kp) => kp.track === 'R').map((kp) => kp.id)

describe('R 轨数据表覆盖', () => {
  it('课程里每个 R 轨知识点恰好有一行，且没有多余的行', () => {
    expect(RHYTHM_ENTRIES.map((e) => e.kpId).sort()).toEqual([...R_KPS].sort())
  })

  it('共 15 个，kpId 不重复；家族与池一致', () => {
    expect(RHYTHM_ENTRIES).toHaveLength(15)
    expect(new Set(RHYTHM_ENTRIES.map((e) => e.kpId)).size).toBe(15)
    for (const e of RHYTHM_ENTRIES) expect(e.pool).toBe(e.family)
  })

  it('家族划分（P-2b spec §7.4）', () => {
    const fam = (f: string) => RHYTHM_ENTRIES.filter((e) => e.family === f).map((e) => e.kpId).sort()
    expect(fam('pattern')).toHaveLength(9)
    expect(fam('meter')).toEqual(['rhythm:meter-2-4', 'rhythm:meter-3-4', 'rhythm:meter-6-8'])
    expect(fam('beat-one')).toEqual(['rhythm:beat-one'])
    expect(fam('anacrusis')).toEqual(['rhythm:anacrusis'])
    expect(fam('mixed-meter')).toEqual(['rhythm:mixed-meter'])
  })

  it('拍号类带 meterId；6/8 按记谱拍数填写（FWD-6）', () => {
    expect(requireRhythmEntry('rhythm:meter-3-4').meterId).toBe('3/4')
    expect(requireRhythmEntry('rhythm:meter-6-8').meterId).toBe('6/8')
    expect(METERS['6/8']).toEqual({ beatsPerBar: 6, beatUnit: 8 })
  })
})

describe('音型库', () => {
  it('id 唯一；每个音型的起音集合互不相同（打拍题靠起音判定）', () => {
    expect(new Set(PATTERNS.map((p) => p.id)).size).toBe(PATTERNS.length)
    const onsetKeys = PATTERNS.map((p) => p.notes.map((n) => n.onset.toFixed(4)).join(','))
    expect(new Set(onsetKeys).size).toBe(PATTERNS.length)
  })

  it('每个音型类知识点至少拥有 1 个音型；音型的主人都是音型类知识点', () => {
    for (const e of RHYTHM_ENTRIES.filter((x) => x.family === 'pattern')) {
      expect(patternsOf(e.kpId).length).toBeGreaterThanOrEqual(1)
    }
    for (const p of PATTERNS) expect(rhythmEntry(p.ownerKpId)?.family).toBe('pattern')
  })

  it('每个音型：起音升序、从 0 开始、时值为正、不越出自己的小节数，相邻音不重叠', () => {
    for (const p of PATTERNS) {
      expect(p.notes[0].onset).toBe(0)
      for (let i = 0; i < p.notes.length; i++) {
        const n = p.notes[i]
        expect(n.dur).toBeGreaterThan(0)
        expect(n.onset + n.dur).toBeLessThanOrEqual(p.bars * 4 + 1e-9)
        if (i > 0) expect(n.onset).toBeGreaterThanOrEqual(p.notes[i - 1].onset + p.notes[i - 1].dur - 1e-9)
      }
    }
  })

  it('只有跨小节连线是两小节，且第二小节第一拍没有起音（被连线吃掉）', () => {
    const two = PATTERNS.filter((p) => p.bars === 2)
    expect(two.map((p) => p.ownerKpId)).toEqual(['rhythm:tie-across-bar'])
    expect(two[0].notes.some((n) => Math.abs(n.onset - 4) < 1e-9)).toBe(false)
    expect(two[0].notes.some((n) => n.onset < 4 && n.onset + n.dur > 4)).toBe(true)
  })

  it('patternById 找不到抛错', () => {
    expect(() => patternById('nope')).toThrow(/nope/)
  })
})

describe('弱起与混合拍子', () => {
  it('弱起：none 无音；half 是第四拍后半；one 是第四拍', () => {
    expect(PICKUPS.none).toEqual([])
    expect(PICKUPS.half).toEqual([{ onset: 3.5, dur: 0.5 }])
    expect(PICKUPS.one).toEqual([{ onset: 3, dur: 1 }])
  })

  it('混合拍子组合：id 等于拍号用 + 连接，互不相同，至少两种不同拍号', () => {
    expect(new Set(MIXED_COMBOS.map((m) => m.id)).size).toBe(MIXED_COMBOS.length)
    for (const m of MIXED_COMBOS) {
      expect(m.id).toBe(m.meters.join('+'))
      expect(new Set(m.meters).size).toBeGreaterThan(1)
    }
  })
})

describe('查找', () => {
  it('未知 kpId', () => {
    expect(rhythmEntry('chord:I')).toBeUndefined()
    expect(rhythmPoolOf('chord:I')).toBeUndefined()
    expect(() => requireRhythmEntry('rhythm:nope')).toThrow(/rhythm:nope/)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/data/rhythms.test.ts`
Expected: FAIL —— 无法解析模块 `./rhythms`

- [ ] **Step 3: 写实现**

`src/exercises/data/rhythms.ts`：

```ts
import { makeKpId, type KnowledgePointId } from '../../curriculum/knowledgePoints'
import type { Meter } from '../../music/rhythm'

export type RhythmFamily = 'pattern' | 'meter' | 'beat-one' | 'anacrusis' | 'mixed-meter'
export type MeterId = '2/4' | '3/4' | '4/4' | '6/8'

/** 6/8 按记谱拍数填写：六个八分音符（FWD-6） */
export const METERS: Record<MeterId, Meter> = {
  '2/4': { beatsPerBar: 2, beatUnit: 4 },
  '3/4': { beatsPerBar: 3, beatUnit: 4 },
  '4/4': { beatsPerBar: 4, beatUnit: 4 },
  '6/8': { beatsPerBar: 6, beatUnit: 8 },
}

export interface RhythmEntry {
  kpId: KnowledgePointId
  family: RhythmFamily
  pool: RhythmFamily
  /** 只有拍号类知识点有 */
  meterId?: MeterId
}

const R = (name: string) => makeKpId('rhythm', name)
const row = (name: string, family: RhythmFamily, meterId?: MeterId): RhythmEntry => ({
  kpId: R(name),
  family,
  pool: family,
  ...(meterId ? { meterId } : {}),
})

/** R 轨知识点（P-2b spec §7.4）。增加知识点 = 加一行 */
export const RHYTHM_ENTRIES: readonly RhythmEntry[] = [
  row('beat-one', 'beat-one'),
  row('meter-2-4', 'meter', '2/4'),
  row('meter-3-4', 'meter', '3/4'),
  row('quarter', 'pattern'),
  row('eighth-pair', 'pattern'),
  row('dotted', 'pattern'),
  row('rest', 'pattern'),
  row('sixteenth', 'pattern'),
  row('synco-8', 'pattern'),
  row('triplet', 'pattern'),
  row('meter-6-8', 'meter', '6/8'),
  row('anacrusis', 'anacrusis'),
  row('tie-across-bar', 'pattern'),
  row('mixed-meter', 'mixed-meter'),
  row('synco-16', 'pattern'),
]

const BY_ID = new Map(RHYTHM_ENTRIES.map((e) => [e.kpId, e]))

export function rhythmEntry(kpId: KnowledgePointId): RhythmEntry | undefined {
  return BY_ID.get(kpId)
}

export function requireRhythmEntry(kpId: KnowledgePointId): RhythmEntry {
  const e = BY_ID.get(kpId)
  if (!e) throw new Error(`R 轨数据表没有知识点 ${kpId}`)
  return e
}

export function rhythmPoolOf(kpId: KnowledgePointId): RhythmFamily | undefined {
  return BY_ID.get(kpId)?.pool
}

/** 4/4 里的一个音：起音与时值都以四分音符为单位，可跨小节 */
export interface PatternNote {
  onset: number
  dur: number
}

export interface PatternDef {
  /** 选项 id；显示层按它画节奏型 */
  id: string
  ownerKpId: KnowledgePointId
  bars: 1 | 2
  notes: readonly PatternNote[]
}

const n = (onset: number, dur: number): PatternNote => ({ onset, dur })
const T = 1 / 3

/** 音型库（全部 4/4）。每个音型类知识点拥有至少一个能体现它的音型 */
export const PATTERNS: readonly PatternDef[] = [
  { id: 'q-q-q-q', ownerKpId: R('quarter'), bars: 1, notes: [n(0, 1), n(1, 1), n(2, 1), n(3, 1)] },
  { id: 'q-q-h', ownerKpId: R('quarter'), bars: 1, notes: [n(0, 1), n(1, 1), n(2, 2)] },
  { id: 'ee-q-q-q', ownerKpId: R('eighth-pair'), bars: 1, notes: [n(0, 0.5), n(0.5, 0.5), n(1, 1), n(2, 1), n(3, 1)] },
  { id: 'q-ee-q-ee', ownerKpId: R('eighth-pair'), bars: 1, notes: [n(0, 1), n(1, 0.5), n(1.5, 0.5), n(2, 1), n(3, 0.5), n(3.5, 0.5)] },
  { id: 'dq-e-q-q', ownerKpId: R('dotted'), bars: 1, notes: [n(0, 1.5), n(1.5, 0.5), n(2, 1), n(3, 1)] },
  { id: 'q-dq-e-q', ownerKpId: R('dotted'), bars: 1, notes: [n(0, 1), n(1, 1.5), n(2.5, 0.5), n(3, 1)] },
  { id: 'q-r-q-q', ownerKpId: R('rest'), bars: 1, notes: [n(0, 1), n(2, 1), n(3, 1)] },
  { id: 'q-q-r-q', ownerKpId: R('rest'), bars: 1, notes: [n(0, 1), n(1, 1), n(3, 1)] },
  { id: 'ssss-q-q-q', ownerKpId: R('sixteenth'), bars: 1, notes: [n(0, 0.25), n(0.25, 0.25), n(0.5, 0.25), n(0.75, 0.25), n(1, 1), n(2, 1), n(3, 1)] },
  { id: 'q-ssss-q-q', ownerKpId: R('sixteenth'), bars: 1, notes: [n(0, 1), n(1, 0.25), n(1.25, 0.25), n(1.5, 0.25), n(1.75, 0.25), n(2, 1), n(3, 1)] },
  { id: 'e-q-e-q-q', ownerKpId: R('synco-8'), bars: 1, notes: [n(0, 0.5), n(0.5, 1), n(1.5, 0.5), n(2, 1), n(3, 1)] },
  { id: 'q-e-q-e-q', ownerKpId: R('synco-8'), bars: 1, notes: [n(0, 1), n(1, 0.5), n(1.5, 1), n(2.5, 0.5), n(3, 1)] },
  { id: 'trip-q-q-q', ownerKpId: R('triplet'), bars: 1, notes: [n(0, T), n(T, T), n(2 * T, T), n(1, 1), n(2, 1), n(3, 1)] },
  { id: 'q-q-trip-q', ownerKpId: R('triplet'), bars: 1, notes: [n(0, 1), n(1, 1), n(2, T), n(2 + T, T), n(2 + 2 * T, T), n(3, 1)] },
  // 第一小节第四拍后半起音，连线延续到第二小节第一拍——第二小节第一拍没有起音
  { id: 'q-q-q-e~q-q-q', ownerKpId: R('tie-across-bar'), bars: 2, notes: [n(0, 1), n(1, 1), n(2, 1), n(3.5, 1.5), n(5, 1), n(6, 1), n(7, 1)] },
  { id: 's-e-s-q-q-q', ownerKpId: R('synco-16'), bars: 1, notes: [n(0, 0.25), n(0.25, 0.5), n(0.75, 0.25), n(1, 1), n(2, 1), n(3, 1)] },
  { id: 'q-s-e-s-q-q', ownerKpId: R('synco-16'), bars: 1, notes: [n(0, 1), n(1, 0.25), n(1.25, 0.5), n(1.75, 0.25), n(2, 1), n(3, 1)] },
]

export function patternsOf(kpId: KnowledgePointId): PatternDef[] {
  return PATTERNS.filter((p) => p.ownerKpId === kpId)
}

export function patternById(id: string): PatternDef {
  const p = PATTERNS.find((x) => x.id === id)
  if (!p) throw new Error(`音型库里没有 ${id}`)
  return p
}

export const PICKUP_IDS = ['none', 'half', 'one'] as const
export type PickupId = (typeof PICKUP_IDS)[number]

/** 弱起落在第 0 小节（4/4）末尾；none 表示第 0 小节全空 */
export const PICKUPS: Record<PickupId, readonly PatternNote[]> = {
  none: [],
  half: [n(3.5, 0.5)],
  one: [n(3, 1)],
}

export interface MixedCombo {
  /** 拍号用 + 连接，也是听辨题的选项 id */
  id: string
  meters: readonly MeterId[]
}

export const MIXED_COMBOS: readonly MixedCombo[] = [
  { id: '3/4+2/4', meters: ['3/4', '2/4'] },
  { id: '2/4+3/4', meters: ['2/4', '3/4'] },
  { id: '4/4+3/4', meters: ['4/4', '3/4'] },
  { id: '3/4+4/4', meters: ['3/4', '4/4'] },
]

/** 混合拍子听写的字母表 */
export const MIXED_METER_ALPHABET: readonly MeterId[] = ['2/4', '3/4', '4/4']

/** 找 beat 1 的片段从这些拍号里抽 */
export const BEAT_ONE_METERS: readonly MeterId[] = ['2/4', '3/4', '4/4']
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/exercises/data/rhythms.test.ts`
Expected: PASS。若覆盖测试失败，先核对 `src/curriculum/tracks.ts` 的 R 轨知识点名，修数据表，不改测试。

- [ ] **Step 5: 提交**

```bash
git add src/exercises/data/rhythms.ts src/exercises/data/rhythms.test.ts
git commit -m "feat(exercises): R 轨数据表、音型库、弱起与混合拍子组合" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 节奏公共函数

**Files:**
- Create: `src/exercises/generators/rhythmCommon.ts`
- Test: `src/exercises/generators/rhythmCommon.test.ts`

**Interfaces:**
- Consumes: `unitsPerPulse`/`pulsesPerBar`（metronome）、`onsetsToNotes`/`Meter`/`TimedOnset`（music/rhythm）、`tonicMidi`（music/register）、`stageOrderIndex`（curriculum/validate）、`stageOfKnowledgePoint`（pools）、`PATTERNS`/`RHYTHM_ENTRIES`/`PatternDef`/`PatternNote`（Task 4）
- Produces:
  - `export const RHYTHM_LEGATO = 0.85`
  - `export function unitSec(meter: Meter, bpm: number): number`（`60 / bpm / unitsPerPulse(meter)`）
  - `export function barSec(meter: Meter, bpm: number): number`
  - `export function barStartTimes(bars: readonly Meter[], bpm: number): number[]`
  - `export function barsDurSec(bars: readonly Meter[], bpm: number): number`
  - `export interface PlacedEvent { bar: number; onsetUnits: number; durUnits: number; accent: boolean }`（`onsetUnits` 以该小节的记谱单位计）
  - `export function placedToOnsets(events: readonly PlacedEvent[], bars: readonly Meter[], bpm: number): TimedOnset[]`（按时刻升序；时值乘 `RHYTHM_LEGATO`）
  - `export function contentMidi(input: GeneratorInput): number`（主音）
  - `export function rhythmNotes(onsets: readonly TimedOnset[], input: GeneratorInput): NoteSpec[]`（经 `onsetsToNotes`）
  - `export function notesAsPlacedEvents(notes: readonly PatternNote[], firstBar: number, accentDownbeats: boolean): PlacedEvent[]`（4/4 四分音符单位 → 放置事件；`accentDownbeats` 时小节第一拍上的音加重）
  - `export function randomPulseFill(meter: Meter, bar: number, rng: Rng, fromPulse?: number): PlacedEvent[]`
  - `export function patternsUpTo(c: Curriculum, kpId: KnowledgePointId, opts?: { singleBarOnly?: boolean }): PatternDef[]`

- [ ] **Step 1: 写失败的测试**

`src/exercises/generators/rhythmCommon.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../../curriculum/curriculum'
import { makeRng } from '../../music/rng'
import { ACCENT_OFF_FACTOR, type Meter } from '../../music/rhythm'
import { METERS } from '../data/rhythms'
import {
  RHYTHM_LEGATO,
  barSec,
  barStartTimes,
  barsDurSec,
  contentMidi,
  notesAsPlacedEvents,
  patternsUpTo,
  placedToOnsets,
  randomPulseFill,
  rhythmNotes,
  unitSec,
} from './rhythmCommon'
import { generatorInput } from './testInput'

const c = buildCurriculum()
const M44: Meter = METERS['4/4']
const M68: Meter = METERS['6/8']

describe('时间换算（bpm 是感知拍，FWD-6）', () => {
  it('4/4 一个四分音符 = 一拍；6/8 一个八分音符 = 三分之一拍', () => {
    expect(unitSec(M44, 60)).toBe(1)
    expect(unitSec(M68, 60)).toBeCloseTo(1 / 3, 12)
    expect(barSec(M68, 60)).toBeCloseTo(2, 12)
    expect(barSec(METERS['3/4'], 120)).toBeCloseTo(1.5, 12)
  })

  it('小节起点与总时长', () => {
    expect(barStartTimes([M44, METERS['3/4'], M44], 60)).toEqual([0, 4, 7])
    expect(barsDurSec([M44, METERS['3/4']], 60)).toBe(7)
  })
})

describe('placedToOnsets', () => {
  it('按小节起点与单位秒数换算，时值乘 RHYTHM_LEGATO，按时刻排序', () => {
    const onsets = placedToOnsets(
      [
        { bar: 1, onsetUnits: 0, durUnits: 1, accent: true },
        { bar: 0, onsetUnits: 2.5, durUnits: 0.5, accent: false },
      ],
      [M44, M44],
      60,
    )
    expect(onsets).toEqual([
      { atSec: 2.5, durSec: 0.5 * RHYTHM_LEGATO, accent: false },
      { atSec: 4, durSec: RHYTHM_LEGATO, accent: true },
    ])
  })
})

describe('rhythmNotes（FWD-2 力度规则）', () => {
  it('音高是主音；重音 gain = velocity，非重音 × ACCENT_OFF_FACTOR', () => {
    const input = generatorInput('rhythm:quarter', 'recognize')
    const notes = rhythmNotes(
      [{ atSec: 0, durSec: 0.5, accent: true }, { atSec: 1, durSec: 0.5, accent: false }],
      input,
    )
    expect(notes.every((x) => x.midi === contentMidi(input))).toBe(true)
    expect(notes[0].gain).toBeCloseTo(input.resolved.velocity, 12)
    expect(notes[1].gain).toBeCloseTo(input.resolved.velocity * ACCENT_OFF_FACTOR, 12)
  })
})

describe('notesAsPlacedEvents', () => {
  it('四分音符单位、可跨小节；小节第一拍上的音加重', () => {
    const ev = notesAsPlacedEvents([{ onset: 0, dur: 1 }, { onset: 3.5, dur: 1.5 }, { onset: 5, dur: 1 }], 2, true)
    expect(ev).toEqual([
      { bar: 2, onsetUnits: 0, durUnits: 1, accent: true },
      { bar: 2, onsetUnits: 3.5, durUnits: 1.5, accent: false },
      { bar: 3, onsetUnits: 1, durUnits: 1, accent: false },
    ])
  })

  it('accentDownbeats=false 时全部不加重（弱起）', () => {
    expect(notesAsPlacedEvents([{ onset: 0, dur: 1 }], 0, false)[0].accent).toBe(false)
  })
})

describe('randomPulseFill', () => {
  it('铺满一小节、首尾相接；只有第一个音加重；x/4 细分为两个八分，6/8 细分为三个八分', () => {
    for (const meter of [METERS['2/4'], METERS['3/4'], M44, M68]) {
      for (let s = 1; s <= 30; s++) {
        const ev = randomPulseFill(meter, 0, makeRng(s))
        expect(ev[0].onsetUnits).toBe(0)
        for (let i = 1; i < ev.length; i++) {
          expect(ev[i].onsetUnits).toBeCloseTo(ev[i - 1].onsetUnits + ev[i - 1].durUnits, 12)
        }
        const last = ev[ev.length - 1]
        expect(last.onsetUnits + last.durUnits).toBeCloseTo(meter.beatsPerBar, 12)
        expect(ev.filter((e) => e.accent)).toEqual([ev[0]])
        const sizes = new Set(ev.map((e) => e.durUnits))
        for (const d of sizes) expect(meter.beatUnit === 8 ? [1, 3] : [0.5, 1]).toContain(d)
      }
    }
  })

  it('fromPulse：从小节中间开始填，前面空着，且不加重', () => {
    const ev = randomPulseFill(M44, 0, makeRng(3), 2)
    expect(ev[0].onsetUnits).toBe(2)
    expect(ev.some((e) => e.accent)).toBe(false)
  })

  it('不同 seed 填法不同', () => {
    const keys = new Set(Array.from({ length: 20 }, (_, s) => JSON.stringify(randomPulseFill(M44, 0, makeRng(s + 1)))))
    expect(keys.size).toBeGreaterThan(1)
  })
})

describe('patternsUpTo', () => {
  it('quarter（R2）：只有 R2 的四分与八分音型', () => {
    expect(patternsUpTo(c, 'rhythm:quarter').map((p) => p.ownerKpId).sort()).toEqual(
      ['rhythm:eighth-pair', 'rhythm:eighth-pair', 'rhythm:quarter', 'rhythm:quarter'],
    )
  })

  it('anacrusis（R7）：含连线；singleBarOnly 时去掉两小节音型', () => {
    expect(patternsUpTo(c, 'rhythm:anacrusis').some((p) => p.bars === 2)).toBe(true)
    expect(patternsUpTo(c, 'rhythm:anacrusis', { singleBarOnly: true }).every((p) => p.bars === 1)).toBe(true)
  })

  it('beat-one（R1）：还没有任何音型', () => {
    expect(patternsUpTo(c, 'rhythm:beat-one')).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/generators/rhythmCommon.test.ts`
Expected: FAIL —— 无法解析模块 `./rhythmCommon`

- [ ] **Step 3: 写实现**

`src/exercises/generators/rhythmCommon.ts`：

```ts
import type { Curriculum } from '../../curriculum/curriculum'
import type { KnowledgePointId } from '../../curriculum/knowledgePoints'
import { stageOrderIndex } from '../../curriculum/validate'
import type { NoteSpec } from '../../music/playback'
import { tonicMidi } from '../../music/register'
import { onsetsToNotes, type Meter, type TimedOnset } from '../../music/rhythm'
import type { Rng } from '../../music/rng'
import { PATTERNS, RHYTHM_ENTRIES, type PatternDef, type PatternNote } from '../data/rhythms'
import { pulsesPerBar, unitsPerPulse } from '../metronome'
import { stageOfKnowledgePoint } from '../pools'
import type { GeneratorInput } from '../types'

/** 节奏内容的发声比例：留出空隙，让每个起音清楚 */
export const RHYTHM_LEGATO = 0.85

const EPS = 1e-9

/** 一个记谱单位的秒数：bpm 是感知拍；x/8 的感知拍含 3 个八分（FWD-6） */
export function unitSec(meter: Meter, bpm: number): number {
  return 60 / bpm / unitsPerPulse(meter)
}

export function barSec(meter: Meter, bpm: number): number {
  return meter.beatsPerBar * unitSec(meter, bpm)
}

export function barStartTimes(bars: readonly Meter[], bpm: number): number[] {
  let t = 0
  return bars.map((m) => {
    const start = t
    t += barSec(m, bpm)
    return start
  })
}

export function barsDurSec(bars: readonly Meter[], bpm: number): number {
  return bars.reduce((s, m) => s + barSec(m, bpm), 0)
}

export interface PlacedEvent {
  bar: number
  /** 以该小节拍号的记谱单位计（x/4 是四分音符，6/8 是八分音符） */
  onsetUnits: number
  durUnits: number
  accent: boolean
}

export function placedToOnsets(
  events: readonly PlacedEvent[],
  bars: readonly Meter[],
  bpm: number,
): TimedOnset[] {
  const starts = barStartTimes(bars, bpm)
  return events
    .map((e) => {
      const u = unitSec(bars[e.bar], bpm)
      return { atSec: starts[e.bar] + e.onsetUnits * u, durSec: e.durUnits * u * RHYTHM_LEGATO, accent: e.accent }
    })
    .sort((a, b) => a.atSec - b.atSec)
}

export function contentMidi(input: GeneratorInput): number {
  return tonicMidi(input.resolved.key, input.doMidi)
}

/** 节奏内容一律经 onsetsToNotes 合成（FWD-2：力度轴给 velocity，accent 只给相对系数） */
export function rhythmNotes(onsets: readonly TimedOnset[], input: GeneratorInput): NoteSpec[] {
  return onsetsToNotes(onsets, contentMidi(input), input.resolved.velocity)
}

/** 4/4 四分音符单位的音（可跨小节）→ 放置事件 */
export function notesAsPlacedEvents(
  notes: readonly PatternNote[],
  firstBar: number,
  accentDownbeats: boolean,
): PlacedEvent[] {
  return notes.map((x) => {
    const barOffset = Math.floor(x.onset / 4 + EPS)
    const onsetUnits = x.onset - 4 * barOffset
    return {
      bar: firstBar + barOffset,
      onsetUnits,
      durUnits: x.dur,
      accent: accentDownbeats && Math.abs(onsetUnits) < EPS,
    }
  })
}

/**
 * 一小节的随机填充：每个感知拍要么一个长音（x/4 四分、x/8 附点四分），
 * 要么细分（x/4 两个八分、x/8 三个八分）。只有小节第一拍上的第一个音加重。
 * fromPulse > 0 时前面的感知拍留空（找 beat 1 的片段从小节中间起拍）。
 */
export function randomPulseFill(meter: Meter, bar: number, rng: Rng, fromPulse = 0): PlacedEvent[] {
  const upp = unitsPerPulse(meter)
  const out: PlacedEvent[] = []
  for (let p = fromPulse; p < pulsesPerBar(meter); p++) {
    const start = p * upp
    if (rng.next() < 0.5) {
      out.push({ bar, onsetUnits: start, durUnits: upp, accent: p === 0 })
    } else {
      const parts = upp === 3 ? 3 : 2
      const d = upp / parts
      for (let i = 0; i < parts; i++) {
        out.push({ bar, onsetUnits: start + i * d, durUnits: d, accent: p === 0 && i === 0 })
      }
    }
  }
  return out
}

/** 所在级不晚于该知识点所在级的音型类知识点拥有的全部音型 */
export function patternsUpTo(
  c: Curriculum,
  kpId: KnowledgePointId,
  opts: { singleBarOnly?: boolean } = {},
): PatternDef[] {
  const limit = stageOrderIndex(c, stageOfKnowledgePoint(kpId).id)
  const owners = new Set(
    RHYTHM_ENTRIES.filter(
      (e) => e.family === 'pattern' && stageOrderIndex(c, stageOfKnowledgePoint(e.kpId).id) <= limit,
    ).map((e) => e.kpId),
  )
  return PATTERNS.filter((p) => owners.has(p.ownerKpId) && (!opts.singleBarOnly || p.bars === 1))
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/exercises/generators/rhythmCommon.test.ts && npx tsc --noEmit`
Expected: PASS；tsc 无输出

- [ ] **Step 5: 提交**

```bash
git add src/exercises/generators/rhythmCommon.ts src/exercises/generators/rhythmCommon.test.ts
git commit -m "feat(exercises): 节奏公共函数——感知拍换算、放置事件、随机填充、音型池" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 音型类生成器

**Files:**
- Create: `src/exercises/generators/pattern.ts`
- Test: `src/exercises/generators/pattern.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `METERS`/`patternsOf`/`PatternDef`；Task 5 的全部导出；`difficultyParams`；`pickOptions`；`generatorInput`（测试）
- Produces:
  - `export function patternPassage(patterns: readonly PatternDef[], input: GeneratorInput): { bars: Meter[]; onsets: TimedOnset[]; durSec: number }`（依次排列音型，强拍加重）
  - `export const PATTERN_GENERATORS: Record<Modality, Generator>`

内容规则（节拍器一律 `metered`）：

| 听辨 | 打拍（唱模态） | 听写 |
|---|---|---|
| 从目标知识点自己的音型里抽一个放出；选项 = `patternsUpTo` 的音型 id，个数按档位；prompt `which-pattern` | 从目标自己的音型里抽一个；**不放内容**；重复 `max(1, floor(tapBars / 音型小节数))` 遍；`format.patternIds` 给屏幕显示用；反馈放给他听；prompt `tap-pattern` | `notateRhythmBars` 个音型依次放出，至少一个是目标自己的音型，其余从 `patternsUpTo` 抽；字母表 = `patternsUpTo` 的音型 id；prompt `notate-patterns` |

- [ ] **Step 1: 写失败的测试**

`src/exercises/generators/pattern.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../../curriculum/curriculum'
import { METERS, patternById, patternsOf } from '../data/rhythms'
import { DIFFICULTY_TABLE } from '../difficulty'
import { PATTERN_GENERATORS, patternPassage } from './pattern'
import { barSec, patternsUpTo } from './rhythmCommon'
import { generatorInput } from './testInput'

const c = buildCurriculum()
const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1)
const near = (a: number[], b: number[]) => {
  expect(a).toHaveLength(b.length)
  a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 9))
}

describe('patternPassage', () => {
  it('依次排列音型；小节数 = 各音型小节数之和；起音换算正确', () => {
    const input = generatorInput('rhythm:tie-across-bar', 'recognize')
    const bar = barSec(METERS['4/4'], input.resolved.bpm)
    const out = patternPassage([patternById('q-q-q-q'), patternById('q-q-q-e~q-q-q')], input)
    expect(out.bars).toHaveLength(3)
    near(out.onsets.map((o) => o.atSec / bar * 4), [0, 1, 2, 3, 4, 5, 6, 7.5, 9, 10, 11])
    expect(out.durSec).toBeCloseTo(3 * bar, 12)
    expect(out.onsets.filter((o) => o.accent).map((o) => o.atSec / bar)).toEqual([0, 1])
  })
})

describe('音型·听辨', () => {
  it('放出目标自己的音型之一；选项来自音型池并含答案；按拍号节拍器', () => {
    for (const kp of ['rhythm:quarter', 'rhythm:synco-8', 'rhythm:tie-across-bar']) {
      const own = patternsOf(kp).map((p) => p.id)
      const pool = patternsUpTo(c, kp).map((p) => p.id)
      for (const seed of SEEDS) {
        const r = PATTERN_GENERATORS.recognize(generatorInput(kp, 'recognize', { seed, step: 5 }))
        if (r.answer.kind !== 'choice' || r.format.kind !== 'choice') throw new Error('格式错')
        expect(own).toContain(r.answer.id)
        const ids = r.format.options.map((o) => o.id)
        expect(ids).toContain(r.answer.id)
        for (const id of ids) expect(pool).toContain(id)
        expect(r.notes).toHaveLength(patternById(r.answer.id).notes.length)
        expect(r.rhythm?.metronome).toBe('metered')
        expect(r.rhythm?.bars).toHaveLength(patternById(r.answer.id).bars)
        expect(r.prompt).toBe('which-pattern')
      }
    }
  })
})

describe('音型·打拍', () => {
  it('不放内容；按档位重复；起音、容差、显示用 patternIds 正确；反馈放出音型', () => {
    for (let step = 0; step <= 5; step++) {
      const input = generatorInput('rhythm:dotted', 'sing', { step, seed: step + 1 })
      const r = PATTERN_GENERATORS.sing(input)
      if (r.format.kind !== 'tap' || r.answer.kind !== 'tap') throw new Error('格式错')
      expect(r.notes).toEqual([])
      const ids = r.format.patternIds ?? []
      const reps = DIFFICULTY_TABLE.tapBars[step]
      expect(ids).toHaveLength(reps)
      expect(new Set(ids).size).toBe(1)
      const p = patternById(ids[0])
      expect(patternsOf('rhythm:dotted').map((x) => x.id)).toContain(p.id)
      const bar = barSec(METERS['4/4'], input.resolved.bpm)
      const want = Array.from({ length: reps }, (_, k) => p.notes.map((n) => (k * 4 + n.onset) * bar / 4)).flat()
      near(r.format.onsetsSec, want)
      expect(r.answer.onsetsSec).toEqual(r.format.onsetsSec)
      expect(r.format.toleranceSec).toBe(DIFFICULTY_TABLE.tapToleranceSec[step])
      expect(r.feedbackNotes).toHaveLength(want.length)
      expect(r.prompt).toBe('tap-pattern')
    }
  })

  it('两小节音型：至少 1 遍，tapBars 为 2 时也只 1 遍', () => {
    const r = PATTERN_GENERATORS.sing(generatorInput('rhythm:tie-across-bar', 'sing', { step: 5 }))
    if (r.format.kind !== 'tap') throw new Error('格式错')
    expect(r.format.patternIds).toEqual(['q-q-q-e~q-q-q'])
  })
})

describe('音型·听写', () => {
  it('个数按档位，含目标自己的音型，字母表 = 音型池；起音与答案一致', () => {
    for (let step = 0; step <= 5; step++) {
      for (const seed of SEEDS.slice(0, 10)) {
        const input = generatorInput('rhythm:sixteenth', 'notate', { step, seed })
        const r = PATTERN_GENERATORS.notate(input)
        if (r.answer.kind !== 'sequence' || r.format.kind !== 'sequence') throw new Error('格式错')
        const ids = r.answer.ids
        expect(ids).toHaveLength(DIFFICULTY_TABLE.notateRhythmBars[step])
        expect(ids.some((id) => patternsOf('rhythm:sixteenth').map((p) => p.id).includes(id))).toBe(true)
        expect(r.format.alphabet.map((o) => o.id).sort()).toEqual(patternsUpTo(c, 'rhythm:sixteenth').map((p) => p.id).sort())
        const passage = patternPassage(ids.map(patternById), input)
        near(r.notes.map((n) => n.atSec), passage.onsets.map((o) => o.atSec))
        expect(r.prompt).toBe('notate-patterns')
      }
    }
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/generators/pattern.test.ts`
Expected: FAIL —— 无法解析模块 `./pattern`

- [ ] **Step 3: 写实现**

`src/exercises/generators/pattern.ts`：

```ts
import type { Modality } from '../../curriculum/knowledgePoints'
import type { Meter, TimedOnset } from '../../music/rhythm'
import { METERS, patternsOf, type PatternDef } from '../data/rhythms'
import { difficultyParams } from '../difficulty'
import { pickOptions } from '../pools'
import type { ContentResult, Generator, GeneratorInput } from '../types'
import {
  barsDurSec,
  notesAsPlacedEvents,
  patternsUpTo,
  placedToOnsets,
  rhythmNotes,
  type PlacedEvent,
} from './rhythmCommon'

const M44 = METERS['4/4']

function ownPatterns(input: GeneratorInput): PatternDef[] {
  const own = patternsOf(input.spec.kpId)
  if (own.length === 0) throw new Error(`${input.spec.kpId} 没有音型`)
  return own
}

/** 依次排列音型（全部 4/4），每小节第一拍加重 */
export function patternPassage(
  patterns: readonly PatternDef[],
  input: GeneratorInput,
): { bars: Meter[]; onsets: TimedOnset[]; durSec: number } {
  const events: PlacedEvent[] = []
  let bar = 0
  for (const p of patterns) {
    events.push(...notesAsPlacedEvents(p.notes, bar, true))
    bar += p.bars
  }
  const bars = Array.from({ length: bar }, () => M44)
  return {
    bars,
    onsets: placedToOnsets(events, bars, input.resolved.bpm),
    durSec: barsDurSec(bars, input.resolved.bpm),
  }
}

const recognizePattern: Generator = (input): ContentResult => {
  const p = input.rng.pick(ownPatterns(input))
  const passage = patternPassage([p], input)
  const notes = rhythmNotes(passage.onsets, input)
  const pool = patternsUpTo(input.curriculum, input.spec.kpId).map((x) => x.id)
  const options = pickOptions(p.id, pool, difficultyParams(input.spec.difficultyStep).recognizeOptionCount, input.rng)
  return {
    notes,
    feedbackNotes: notes,
    durSec: passage.durSec,
    prompt: 'which-pattern',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: p.id },
    rhythm: { bars: passage.bars, metronome: 'metered' },
  }
}

const tapPattern: Generator = (input): ContentResult => {
  const p = input.rng.pick(ownPatterns(input))
  const params = difficultyParams(input.spec.difficultyStep)
  const reps = Math.max(1, Math.floor(params.tapBars / p.bars))
  const passage = patternPassage(Array.from({ length: reps }, () => p), input)
  const onsetsSec = passage.onsets.map((o) => o.atSec)
  return {
    // 「打出给定音型」：题目不放内容，屏幕显示音型，学习者跟节拍器打（P-2b-R 裁定 3）
    notes: [],
    feedbackNotes: rhythmNotes(passage.onsets, input),
    durSec: passage.durSec,
    prompt: 'tap-pattern',
    format: {
      kind: 'tap',
      onsetsSec,
      toleranceSec: params.tapToleranceSec,
      patternIds: Array.from({ length: reps }, () => p.id),
    },
    answer: { kind: 'tap', onsetsSec: [...onsetsSec] },
    rhythm: { bars: passage.bars, metronome: 'metered' },
  }
}

const notatePatterns: Generator = (input): ContentResult => {
  const { rng } = input
  const count = difficultyParams(input.spec.difficultyStep).notateRhythmBars
  const own = ownPatterns(input)
  const pool = patternsUpTo(input.curriculum, input.spec.kpId)
  const targetPos = rng.int(count)
  const chosen = Array.from({ length: count }, (_, i) => (i === targetPos ? rng.pick(own) : rng.pick(pool)))
  const passage = patternPassage(chosen, input)
  const notes = rhythmNotes(passage.onsets, input)
  return {
    notes,
    feedbackNotes: notes,
    durSec: passage.durSec,
    prompt: 'notate-patterns',
    format: { kind: 'sequence', length: count, alphabet: pool.map((x) => ({ id: x.id })) },
    answer: { kind: 'sequence', ids: chosen.map((x) => x.id) },
    rhythm: { bars: passage.bars, metronome: 'metered' },
  }
}

export const PATTERN_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizePattern,
  sing: tapPattern,
  notate: notatePatterns,
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/exercises/generators/pattern.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/exercises/generators/pattern.ts src/exercises/generators/pattern.test.ts
git commit -m "feat(exercises): 音型类的听辨、打拍、听写生成器" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 拍号类与混合拍子生成器

**Files:**
- Create: `src/exercises/generators/meter.ts`
- Test: `src/exercises/generators/meter.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `METERS`/`MeterId`/`MIXED_COMBOS`/`MIXED_METER_ALPHABET`/`requireRhythmEntry`/`rhythmPoolOf`；Task 5 的全部导出；`difficultyParams`；`pickOptions`/`poolMembers`
- Produces:
  - `export function filledPassage(meterIds: readonly (MeterId | null)[], input: GeneratorInput): { bars: Meter[]; onsets: TimedOnset[]; durSec: number }` —— 每项是一小节：给拍号则随机填满、`null` 表示与上一小节同拍号的**空小节**（拍号听写的段间空小节）
  - `export const METER_GENERATORS: Record<Modality, Generator>`
  - `export const MIXED_METER_GENERATORS: Record<Modality, Generator>`

内容规则（节拍器一律 `neutral`，P-2b-R 裁定 1）：

| | 听辨 | 打拍（唱模态） | 听写 |
|---|---|---|---|
| 拍号 | 目标拍号的 2–4 小节（`2 + rng.int(3)`）随机填充；选项 = 池中拍号，prompt `which-meter` | 目标拍号的 `max(2, tapBars + 1)` 小节，**边听边打每小节第一拍**；答案 = 各小节起点；prompt `tap-downbeats` | `max(2, notateRhythmBars)` 段，每段 2 小节同一拍号（目标拍号至少一段，其余从池中抽），段间空一小节；逐段写拍号，字母表 = 池中拍号；prompt `notate-meters`（P-2b-R 裁定 2） |
| 混合拍子 | 抽一个组合，循环两遍放出；选项 = 组合 id，prompt `which-meter-sequence` | 同左的片段，边听边打每小节第一拍；prompt `tap-downbeats` | 同左的片段，逐小节写拍号，字母表 `MIXED_METER_ALPHABET`；prompt `notate-meters` |

- [ ] **Step 1: 写失败的测试**

`src/exercises/generators/meter.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { MIXED_COMBOS, METERS } from '../data/rhythms'
import { DIFFICULTY_TABLE } from '../difficulty'
import { METER_GENERATORS, MIXED_METER_GENERATORS, filledPassage } from './meter'
import { barStartTimes } from './rhythmCommon'
import { generatorInput } from './testInput'

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1)

describe('filledPassage', () => {
  it('每个拍号小节都铺满；null 小节为空且沿用上一小节拍号', () => {
    const input = generatorInput('rhythm:meter-3-4', 'notate', { seed: 4 })
    const out = filledPassage(['3/4', '3/4', null, '2/4'], input)
    expect(out.bars).toEqual([METERS['3/4'], METERS['3/4'], METERS['3/4'], METERS['2/4']])
    const starts = barStartTimes(out.bars, input.resolved.bpm)
    const inBar = (b: number) => out.onsets.filter((o) => o.atSec >= starts[b] - 1e-9 && (b + 1 >= starts.length || o.atSec < starts[b + 1] - 1e-9))
    expect(inBar(2)).toHaveLength(0)
    for (const b of [0, 1, 3]) {
      expect(inBar(b)[0].atSec).toBeCloseTo(starts[b], 9)
      expect(inBar(b)[0].accent).toBe(true)
    }
  })
})

describe('拍号·听辨', () => {
  it('2–4 小节、全部是目标拍号、中性节拍器；选项来自池并含答案', () => {
    for (const [kp, id] of [['rhythm:meter-2-4', '2/4'], ['rhythm:meter-3-4', '3/4'], ['rhythm:meter-6-8', '6/8']] as const) {
      for (const seed of SEEDS) {
        const r = METER_GENERATORS.recognize(generatorInput(kp, 'recognize', { seed, step: 5 }))
        expect(r.answer).toEqual({ kind: 'choice', id })
        const bars = r.rhythm?.bars ?? []
        expect(bars.length).toBeGreaterThanOrEqual(2)
        expect(bars.length).toBeLessThanOrEqual(4)
        for (const b of bars) expect(b).toEqual(METERS[id])
        expect(r.rhythm?.metronome).toBe('neutral')
        if (r.format.kind !== 'choice') throw new Error('格式错')
        expect(r.format.options.map((o) => o.id)).toContain(id)
        expect(r.prompt).toBe('which-meter')
      }
    }
  })

  it('R1 的 2/4 题：池里只有 2/4 与 3/4', () => {
    const r = METER_GENERATORS.recognize(generatorInput('rhythm:meter-2-4', 'recognize', { step: 5 }))
    if (r.format.kind !== 'choice') throw new Error('格式错')
    expect(r.format.options.map((o) => o.id).sort()).toEqual(['2/4', '3/4'])
  })
})

describe('拍号·打拍', () => {
  it('边听边打强拍：内容在放；答案是各小节起点；小节数按档位', () => {
    for (let step = 0; step <= 5; step++) {
      const input = generatorInput('rhythm:meter-3-4', 'sing', { step, seed: step + 2 })
      const r = METER_GENERATORS.sing(input)
      if (r.format.kind !== 'tap' || r.answer.kind !== 'tap') throw new Error('格式错')
      const bars = r.rhythm?.bars ?? []
      expect(bars).toHaveLength(Math.max(2, DIFFICULTY_TABLE.tapBars[step] + 1))
      expect(r.notes.length).toBeGreaterThan(0)
      expect(r.answer.onsetsSec).toEqual(barStartTimes(bars, input.resolved.bpm))
      expect(r.format.patternIds).toBeUndefined()
      expect(r.prompt).toBe('tap-downbeats')
    }
  })
})

describe('拍号·听写', () => {
  it('段数按档位（至少 2），含目标拍号，每段 2 小节、段间空一小节', () => {
    for (let step = 0; step <= 5; step++) {
      for (const seed of SEEDS.slice(0, 10)) {
        const r = METER_GENERATORS.notate(generatorInput('rhythm:meter-6-8', 'notate', { step, seed }))
        if (r.answer.kind !== 'sequence' || r.format.kind !== 'sequence') throw new Error('格式错')
        const phrases = Math.max(2, DIFFICULTY_TABLE.notateRhythmBars[step])
        expect(r.answer.ids).toHaveLength(phrases)
        expect(r.answer.ids).toContain('6/8')
        expect(r.rhythm?.bars).toHaveLength(phrases * 3 - 1)
        r.answer.ids.forEach((id, i) => {
          expect(r.rhythm?.bars[i * 3]).toEqual(METERS[id as keyof typeof METERS])
          expect(r.rhythm?.bars[i * 3 + 1]).toEqual(METERS[id as keyof typeof METERS])
        })
        expect(r.format.alphabet.map((o) => o.id).sort()).toEqual(['2/4', '3/4', '6/8'])
        expect(r.prompt).toBe('notate-meters')
      }
    }
  })
})

describe('混合拍子', () => {
  it('听辨：组合循环两遍；答案是组合 id；选项来自组合表', () => {
    const seen = new Set<string>()
    for (const seed of SEEDS) {
      const r = MIXED_METER_GENERATORS.recognize(generatorInput('rhythm:mixed-meter', 'recognize', { seed, step: 5 }))
      if (r.answer.kind !== 'choice' || r.format.kind !== 'choice') throw new Error('格式错')
      const combo = MIXED_COMBOS.find((m) => m.id === r.answer.id)
      if (!combo) throw new Error('答案不是组合')
      seen.add(combo.id)
      expect(r.rhythm?.bars).toEqual([...combo.meters, ...combo.meters].map((m) => METERS[m]))
      for (const o of r.format.options) expect(MIXED_COMBOS.map((m) => m.id)).toContain(o.id)
      expect(r.rhythm?.metronome).toBe('neutral')
      expect(r.prompt).toBe('which-meter-sequence')
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('打拍：答案是各小节起点', () => {
    const input = generatorInput('rhythm:mixed-meter', 'sing', { seed: 6 })
    const r = MIXED_METER_GENERATORS.sing(input)
    if (r.answer.kind !== 'tap') throw new Error('格式错')
    expect(r.answer.onsetsSec).toEqual(barStartTimes(r.rhythm?.bars ?? [], input.resolved.bpm))
    expect(r.prompt).toBe('tap-downbeats')
  })

  it('听写：逐小节写拍号，字母表 2/4、3/4、4/4', () => {
    const r = MIXED_METER_GENERATORS.notate(generatorInput('rhythm:mixed-meter', 'notate', { seed: 7 }))
    if (r.answer.kind !== 'sequence' || r.format.kind !== 'sequence') throw new Error('格式错')
    expect(r.answer.ids).toHaveLength(4)
    expect(r.format.alphabet.map((o) => o.id)).toEqual(['2/4', '3/4', '4/4'])
    expect(r.prompt).toBe('notate-meters')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/generators/meter.test.ts`
Expected: FAIL —— 无法解析模块 `./meter`

- [ ] **Step 3: 写实现**

`src/exercises/generators/meter.ts`：

```ts
import type { Modality } from '../../curriculum/knowledgePoints'
import type { Meter, TimedOnset } from '../../music/rhythm'
import {
  METERS,
  MIXED_COMBOS,
  MIXED_METER_ALPHABET,
  requireRhythmEntry,
  rhythmPoolOf,
  type MeterId,
} from '../data/rhythms'
import { difficultyParams } from '../difficulty'
import { pickOptions, poolMembers } from '../pools'
import type { ContentResult, Generator, GeneratorInput } from '../types'
import {
  barStartTimes,
  barsDurSec,
  placedToOnsets,
  randomPulseFill,
  rhythmNotes,
  type PlacedEvent,
} from './rhythmCommon'

/** 每项一小节：给拍号则随机填满；null 是沿用上一小节拍号的空小节 */
export function filledPassage(
  meterIds: readonly (MeterId | null)[],
  input: GeneratorInput,
): { bars: Meter[]; onsets: TimedOnset[]; durSec: number } {
  const bars: Meter[] = []
  const events: PlacedEvent[] = []
  meterIds.forEach((id, i) => {
    const meter = id === null ? bars[i - 1] : METERS[id]
    if (!meter) throw new Error('空小节不能是第一小节')
    bars.push(meter)
    if (id !== null) events.push(...randomPulseFill(meter, i, input.rng))
  })
  return {
    bars,
    onsets: placedToOnsets(events, bars, input.resolved.bpm),
    durSec: barsDurSec(bars, input.resolved.bpm),
  }
}

function targetMeter(input: GeneratorInput): MeterId {
  const id = requireRhythmEntry(input.spec.kpId).meterId
  if (!id) throw new Error(`${input.spec.kpId} 不是拍号知识点`)
  return id
}

function poolMeters(input: GeneratorInput): MeterId[] {
  return poolMembers(input.curriculum, input.spec.kpId, rhythmPoolOf).map((id) => {
    const m = requireRhythmEntry(id).meterId
    if (!m) throw new Error(`${id} 不是拍号知识点`)
    return m
  })
}

function listened(
  passage: { bars: Meter[]; onsets: TimedOnset[]; durSec: number },
  input: GeneratorInput,
) {
  const notes = rhythmNotes(passage.onsets, input)
  return { notes, feedbackNotes: notes, durSec: passage.durSec }
}

/** 边听边打每小节第一拍（P-2b-R 裁定 3） */
function downbeatTap(
  passage: { bars: Meter[]; onsets: TimedOnset[]; durSec: number },
  input: GeneratorInput,
): ContentResult {
  const onsetsSec = barStartTimes(passage.bars, input.resolved.bpm)
  return {
    ...listened(passage, input),
    prompt: 'tap-downbeats',
    format: { kind: 'tap', onsetsSec, toleranceSec: difficultyParams(input.spec.difficultyStep).tapToleranceSec },
    answer: { kind: 'tap', onsetsSec: [...onsetsSec] },
    rhythm: { bars: passage.bars, metronome: 'neutral' },
  }
}

const recognizeMeter: Generator = (input): ContentResult => {
  const id = targetMeter(input)
  const nBars = 2 + input.rng.int(3)
  const passage = filledPassage(Array.from({ length: nBars }, () => id), input)
  const options = pickOptions(id, poolMeters(input), difficultyParams(input.spec.difficultyStep).recognizeOptionCount, input.rng)
  return {
    ...listened(passage, input),
    prompt: 'which-meter',
    format: { kind: 'choice', options: options.map((x) => ({ id: x })) },
    answer: { kind: 'choice', id },
    rhythm: { bars: passage.bars, metronome: 'neutral' },
  }
}

const tapMeterDownbeats: Generator = (input): ContentResult => {
  const id = targetMeter(input)
  const nBars = Math.max(2, difficultyParams(input.spec.difficultyStep).tapBars + 1)
  return downbeatTap(filledPassage(Array.from({ length: nBars }, () => id), input), input)
}

const notateMeters: Generator = (input): ContentResult => {
  const { rng } = input
  const id = targetMeter(input)
  const pool = poolMeters(input)
  const phrases = Math.max(2, difficultyParams(input.spec.difficultyStep).notateRhythmBars)
  const targetPos = rng.int(phrases)
  const meters = Array.from({ length: phrases }, (_, i) => (i === targetPos ? id : rng.pick(pool)))
  // 每段两小节，段间空一小节（P-2b-R 裁定 2）
  const layout: (MeterId | null)[] = meters.flatMap((m, i) => (i < phrases - 1 ? [m, m, null] : [m, m]))
  const passage = filledPassage(layout, input)
  return {
    ...listened(passage, input),
    prompt: 'notate-meters',
    format: { kind: 'sequence', length: phrases, alphabet: pool.map((x) => ({ id: x })) },
    answer: { kind: 'sequence', ids: meters },
    rhythm: { bars: passage.bars, metronome: 'neutral' },
  }
}

function mixedPassage(input: GeneratorInput) {
  const combo = input.rng.pick(MIXED_COMBOS)
  const meters = [...combo.meters, ...combo.meters]
  return { combo, meters, passage: filledPassage(meters, input) }
}

const recognizeMixed: Generator = (input): ContentResult => {
  const { combo, passage } = mixedPassage(input)
  const options = pickOptions(
    combo.id,
    MIXED_COMBOS.map((m) => m.id),
    difficultyParams(input.spec.difficultyStep).recognizeOptionCount,
    input.rng,
  )
  return {
    ...listened(passage, input),
    prompt: 'which-meter-sequence',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: combo.id },
    rhythm: { bars: passage.bars, metronome: 'neutral' },
  }
}

const tapMixedDownbeats: Generator = (input): ContentResult => downbeatTap(mixedPassage(input).passage, input)

const notateMixed: Generator = (input): ContentResult => {
  const { meters, passage } = mixedPassage(input)
  return {
    ...listened(passage, input),
    prompt: 'notate-meters',
    format: { kind: 'sequence', length: meters.length, alphabet: MIXED_METER_ALPHABET.map((id) => ({ id })) },
    answer: { kind: 'sequence', ids: [...meters] },
    rhythm: { bars: passage.bars, metronome: 'neutral' },
  }
}

export const METER_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeMeter,
  sing: tapMeterDownbeats,
  notate: notateMeters,
}

export const MIXED_METER_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeMixed,
  sing: tapMixedDownbeats,
  notate: notateMixed,
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/exercises/generators/meter.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/exercises/generators/meter.ts src/exercises/generators/meter.test.ts
git commit -m "feat(exercises): 拍号与混合拍子的听辨、打拍、听写生成器" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 找 beat 1 与弱起生成器

**Files:**
- Create: `src/exercises/generators/pickup.ts`
- Test: `src/exercises/generators/pickup.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `METERS`/`BEAT_ONE_METERS`/`PICKUP_IDS`/`PICKUPS`/`PickupId`/`PatternDef`；Task 5 的全部导出；`pulsesPerBar`（metronome）；`difficultyParams`；`pickOptions`
- Produces:
  - `export const BEAT_ONE_MAX_CANDIDATES = 8`
  - `export interface BeatOnePassage { bars: Meter[]; onsets: TimedOnset[]; durSec: number; answerIndex: number; candidates: string[] }`
  - `export function beatOnePassage(input: GeneratorInput, fullBars: number): BeatOnePassage` —— 第 0 小节从中间某个感知拍起（`1 + rng.int(pulsesPerBar - 1)`），后接 `fullBars` 个满小节；`answerIndex` = 第 0 小节里的音数 + 1（1 起）；`candidates` = `'1'…String(min(音数, 8))`
  - `export interface AnacrusisPassage { pickupId: PickupId; patterns: PatternDef[]; bars: Meter[]; onsets: TimedOnset[]; durSec: number }`
  - `export function anacrusisPassage(input: GeneratorInput): AnacrusisPassage` —— 第 0 小节只有弱起（不加重），第 1、2 小节各一个单小节音型（强拍加重）
  - `export const BEAT_ONE_GENERATORS: Record<Modality, Generator>`
  - `export const ANACRUSIS_GENERATORS: Record<Modality, Generator>`

内容规则：

| | 听辨 | 打拍（唱模态） | 听写 |
|---|---|---|---|
| 找 beat 1 | 片段（2 个满小节）；「第几个音是第一拍」，选项 = 候选序号，个数按档位；中性节拍器；prompt `which-onset-is-beat-one` | 片段（`max(2, tapBars + 1)` 个满小节），边听边打满小节的第一拍；中性；prompt `tap-downbeats` | 同听辨的片段；长度 1 的序列（序号），字母表 = 候选序号；中性；prompt `which-onset-is-beat-one` |
| 弱起 | 片段；选弱起长度（`none`/`half`/`one`）；中性；prompt `which-pickup` | **不放内容**，屏幕显示 `patternIds = [弱起, 音型1, 音型2]`，跟按拍号节拍器打出来；prompt `tap-pattern` | 片段；序列 `[弱起, 音型1, 音型2]`，字母表 = 弱起 id + 单小节音型池；中性；prompt `notate-patterns` |

- [ ] **Step 1: 写失败的测试**

`src/exercises/generators/pickup.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../../curriculum/curriculum'
import { METERS, PICKUP_IDS } from '../data/rhythms'
import { DIFFICULTY_TABLE } from '../difficulty'
import {
  ANACRUSIS_GENERATORS,
  BEAT_ONE_GENERATORS,
  anacrusisPassage,
  beatOnePassage,
} from './pickup'
import { barStartTimes, patternsUpTo } from './rhythmCommon'
import { generatorInput } from './testInput'

const c = buildCurriculum()
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1)

describe('beatOnePassage', () => {
  it('第 0 小节从中间起拍；答案序号正好指向第 1 小节的第一个音；该音加重，此前的音都不加重', () => {
    for (const seed of SEEDS) {
      const input = generatorInput('rhythm:beat-one', 'recognize', { seed })
      const p = beatOnePassage(input, 2)
      const starts = barStartTimes(p.bars, input.resolved.bpm)
      expect(p.bars).toHaveLength(3)
      expect(p.onsets[0].atSec).toBeGreaterThan(starts[0] + 1e-9)
      const target = p.onsets[p.answerIndex - 1]
      expect(target.atSec).toBeCloseTo(starts[1], 9)
      expect(target.accent).toBe(true)
      expect(p.onsets.slice(0, p.answerIndex - 1).every((o) => !o.accent)).toBe(true)
      expect(p.candidates).toContain(String(p.answerIndex))
      expect(p.candidates.length).toBeLessThanOrEqual(8)
    }
  })

  it('会出现不同拍号', () => {
    const seen = new Set(SEEDS.map((seed) => JSON.stringify(beatOnePassage(generatorInput('rhythm:beat-one', 'recognize', { seed }), 2).bars[0])))
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('找 beat 1·三模态', () => {
  it('听辨：选项是候选序号；中性节拍器', () => {
    for (const seed of SEEDS.slice(0, 15)) {
      const r = BEAT_ONE_GENERATORS.recognize(generatorInput('rhythm:beat-one', 'recognize', { seed, step: 5 }))
      if (r.answer.kind !== 'choice' || r.format.kind !== 'choice') throw new Error('格式错')
      expect(r.format.options.map((o) => o.id)).toContain(r.answer.id)
      expect(r.rhythm?.metronome).toBe('neutral')
      expect(r.prompt).toBe('which-onset-is-beat-one')
    }
  })

  it('打拍：答案是满小节的起点（不含起拍那一小节）', () => {
    for (let step = 0; step <= 5; step++) {
      const input = generatorInput('rhythm:beat-one', 'sing', { step, seed: step + 1 })
      const r = BEAT_ONE_GENERATORS.sing(input)
      if (r.answer.kind !== 'tap') throw new Error('格式错')
      const bars = r.rhythm?.bars ?? []
      expect(bars).toHaveLength(1 + Math.max(2, DIFFICULTY_TABLE.tapBars[step] + 1))
      expect(r.answer.onsetsSec).toEqual(barStartTimes(bars, input.resolved.bpm).slice(1))
      expect(r.prompt).toBe('tap-downbeats')
    }
  })

  it('听写：长度 1 的序号序列', () => {
    const r = BEAT_ONE_GENERATORS.notate(generatorInput('rhythm:beat-one', 'notate', { seed: 3 }))
    if (r.answer.kind !== 'sequence' || r.format.kind !== 'sequence') throw new Error('格式错')
    expect(r.format.length).toBe(1)
    expect(r.format.alphabet.map((o) => o.id)).toContain(r.answer.ids[0])
  })
})

describe('anacrusisPassage', () => {
  it('第 0 小节只有弱起且不加重；第 1、2 小节是单小节音型、第一拍加重', () => {
    const seen = new Set<string>()
    for (const seed of SEEDS) {
      const input = generatorInput('rhythm:anacrusis', 'recognize', { seed })
      const p = anacrusisPassage(input)
      seen.add(p.pickupId)
      expect(p.bars).toEqual([METERS['4/4'], METERS['4/4'], METERS['4/4']])
      const starts = barStartTimes(p.bars, input.resolved.bpm)
      const bar0 = p.onsets.filter((o) => o.atSec < starts[1] - 1e-9)
      expect(bar0).toHaveLength({ none: 0, half: 1, one: 1 }[p.pickupId])
      expect(bar0.every((o) => !o.accent)).toBe(true)
      expect(p.patterns).toHaveLength(2)
      for (const pat of p.patterns) expect(pat.bars).toBe(1)
      for (const b of [1, 2]) {
        const first = p.onsets.find((o) => o.atSec >= starts[b] - 1e-9)
        expect(first?.atSec).toBeCloseTo(starts[b], 9)
        expect(first?.accent).toBe(true)
      }
    }
    expect([...seen].sort()).toEqual([...PICKUP_IDS].sort())
  })
})

describe('弱起·三模态', () => {
  it('听辨：答案是弱起 id；中性节拍器', () => {
    const r = ANACRUSIS_GENERATORS.recognize(generatorInput('rhythm:anacrusis', 'recognize', { seed: 2, step: 5 }))
    if (r.answer.kind !== 'choice' || r.format.kind !== 'choice') throw new Error('格式错')
    expect(PICKUP_IDS).toContain(r.answer.id as (typeof PICKUP_IDS)[number])
    expect(r.format.options.map((o) => o.id).sort()).toEqual([...PICKUP_IDS].sort())
    expect(r.rhythm?.metronome).toBe('neutral')
    expect(r.prompt).toBe('which-pickup')
  })

  it('打拍：不放内容，显示 [弱起, 音型1, 音型2]，按拍号节拍器', () => {
    const r = ANACRUSIS_GENERATORS.sing(generatorInput('rhythm:anacrusis', 'sing', { seed: 5 }))
    if (r.format.kind !== 'tap') throw new Error('格式错')
    expect(r.notes).toEqual([])
    expect(r.format.patternIds).toHaveLength(3)
    expect(PICKUP_IDS).toContain(r.format.patternIds?.[0] as (typeof PICKUP_IDS)[number])
    expect(r.rhythm?.metronome).toBe('metered')
    expect(r.prompt).toBe('tap-pattern')
  })

  it('听写：[弱起, 音型1, 音型2]，字母表 = 弱起 id + 单小节音型池', () => {
    const r = ANACRUSIS_GENERATORS.notate(generatorInput('rhythm:anacrusis', 'notate', { seed: 8 }))
    if (r.answer.kind !== 'sequence' || r.format.kind !== 'sequence') throw new Error('格式错')
    expect(r.answer.ids).toHaveLength(3)
    expect(r.format.alphabet.map((o) => o.id).sort()).toEqual(
      [...PICKUP_IDS, ...patternsUpTo(c, 'rhythm:anacrusis', { singleBarOnly: true }).map((p) => p.id)].sort(),
    )
    expect(r.prompt).toBe('notate-patterns')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/generators/pickup.test.ts`
Expected: FAIL —— 无法解析模块 `./pickup`

- [ ] **Step 3: 写实现**

`src/exercises/generators/pickup.ts`：

```ts
import type { Modality } from '../../curriculum/knowledgePoints'
import type { Meter, TimedOnset } from '../../music/rhythm'
import {
  BEAT_ONE_METERS,
  METERS,
  PICKUPS,
  PICKUP_IDS,
  type PatternDef,
  type PickupId,
} from '../data/rhythms'
import { difficultyParams } from '../difficulty'
import { pulsesPerBar } from '../metronome'
import { pickOptions } from '../pools'
import type { ContentResult, Generator, GeneratorInput } from '../types'
import {
  barStartTimes,
  barsDurSec,
  notesAsPlacedEvents,
  patternsUpTo,
  placedToOnsets,
  randomPulseFill,
  rhythmNotes,
  type PlacedEvent,
} from './rhythmCommon'

export const BEAT_ONE_MAX_CANDIDATES = 8

export interface BeatOnePassage {
  bars: Meter[]
  onsets: TimedOnset[]
  durSec: number
  /** 第 1 小节第一个音的序号（1 起） */
  answerIndex: number
  candidates: string[]
}

/** 从小节中间起拍的片段：第 0 小节从某个非第一拍的感知拍开始，后接 fullBars 个满小节 */
export function beatOnePassage(input: GeneratorInput, fullBars: number): BeatOnePassage {
  const { rng } = input
  const meter = METERS[rng.pick(BEAT_ONE_METERS)]
  const startPulse = 1 + rng.int(pulsesPerBar(meter) - 1)
  const bars = Array.from({ length: 1 + fullBars }, () => meter)
  const events: PlacedEvent[] = [...randomPulseFill(meter, 0, rng, startPulse)]
  for (let b = 1; b <= fullBars; b++) events.push(...randomPulseFill(meter, b, rng))
  const onsets = placedToOnsets(events, bars, input.resolved.bpm)
  const inBar0 = events.filter((e) => e.bar === 0).length
  const total = Math.min(onsets.length, BEAT_ONE_MAX_CANDIDATES)
  return {
    bars,
    onsets,
    durSec: barsDurSec(bars, input.resolved.bpm),
    answerIndex: inBar0 + 1,
    candidates: Array.from({ length: total }, (_, i) => String(i + 1)),
  }
}

function listenedNotes(onsets: readonly TimedOnset[], input: GeneratorInput) {
  const notes = rhythmNotes(onsets, input)
  return { notes, feedbackNotes: notes }
}

const recognizeBeatOne: Generator = (input): ContentResult => {
  const p = beatOnePassage(input, 2)
  const answerId = String(p.answerIndex)
  const options = pickOptions(answerId, p.candidates, difficultyParams(input.spec.difficultyStep).recognizeOptionCount, input.rng)
  return {
    ...listenedNotes(p.onsets, input),
    durSec: p.durSec,
    prompt: 'which-onset-is-beat-one',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: answerId },
    rhythm: { bars: p.bars, metronome: 'neutral' },
  }
}

const tapBeatOne: Generator = (input): ContentResult => {
  const params = difficultyParams(input.spec.difficultyStep)
  const p = beatOnePassage(input, Math.max(2, params.tapBars + 1))
  const onsetsSec = barStartTimes(p.bars, input.resolved.bpm).slice(1)
  return {
    ...listenedNotes(p.onsets, input),
    durSec: p.durSec,
    prompt: 'tap-downbeats',
    format: { kind: 'tap', onsetsSec, toleranceSec: params.tapToleranceSec },
    answer: { kind: 'tap', onsetsSec: [...onsetsSec] },
    rhythm: { bars: p.bars, metronome: 'neutral' },
  }
}

const notateBeatOne: Generator = (input): ContentResult => {
  const p = beatOnePassage(input, 2)
  return {
    ...listenedNotes(p.onsets, input),
    durSec: p.durSec,
    prompt: 'which-onset-is-beat-one',
    format: { kind: 'sequence', length: 1, alphabet: p.candidates.map((id) => ({ id })) },
    answer: { kind: 'sequence', ids: [String(p.answerIndex)] },
    rhythm: { bars: p.bars, metronome: 'neutral' },
  }
}

export interface AnacrusisPassage {
  pickupId: PickupId
  patterns: PatternDef[]
  bars: Meter[]
  onsets: TimedOnset[]
  durSec: number
}

/** 第 0 小节只有弱起（不加重）；第 1、2 小节各一个单小节音型（强拍加重） */
export function anacrusisPassage(input: GeneratorInput): AnacrusisPassage {
  const { rng } = input
  const body = patternsUpTo(input.curriculum, input.spec.kpId, { singleBarOnly: true })
  if (body.length === 0) throw new Error(`${input.spec.kpId} 之前没有可用的单小节音型`)
  const pickupId = rng.pick(PICKUP_IDS)
  const patterns = [rng.pick(body), rng.pick(body)]
  const bars = [METERS['4/4'], METERS['4/4'], METERS['4/4']]
  const events: PlacedEvent[] = [
    ...notesAsPlacedEvents(PICKUPS[pickupId], 0, false),
    ...notesAsPlacedEvents(patterns[0].notes, 1, true),
    ...notesAsPlacedEvents(patterns[1].notes, 2, true),
  ]
  return {
    pickupId,
    patterns,
    bars,
    onsets: placedToOnsets(events, bars, input.resolved.bpm),
    durSec: barsDurSec(bars, input.resolved.bpm),
  }
}

const recognizeAnacrusis: Generator = (input): ContentResult => {
  const p = anacrusisPassage(input)
  const options = pickOptions(p.pickupId, PICKUP_IDS, difficultyParams(input.spec.difficultyStep).recognizeOptionCount, input.rng)
  return {
    ...listenedNotes(p.onsets, input),
    durSec: p.durSec,
    prompt: 'which-pickup',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: p.pickupId },
    rhythm: { bars: p.bars, metronome: 'neutral' },
  }
}

const tapAnacrusis: Generator = (input): ContentResult => {
  const p = anacrusisPassage(input)
  const onsetsSec = p.onsets.map((o) => o.atSec)
  return {
    // 「打出给定音型」：不放内容，屏幕显示弱起与音型（P-2b-R 裁定 3）
    notes: [],
    feedbackNotes: rhythmNotes(p.onsets, input),
    durSec: p.durSec,
    prompt: 'tap-pattern',
    format: {
      kind: 'tap',
      onsetsSec,
      toleranceSec: difficultyParams(input.spec.difficultyStep).tapToleranceSec,
      patternIds: [p.pickupId, ...p.patterns.map((x) => x.id)],
    },
    answer: { kind: 'tap', onsetsSec: [...onsetsSec] },
    rhythm: { bars: p.bars, metronome: 'metered' },
  }
}

const notateAnacrusis: Generator = (input): ContentResult => {
  const p = anacrusisPassage(input)
  const body = patternsUpTo(input.curriculum, input.spec.kpId, { singleBarOnly: true })
  return {
    ...listenedNotes(p.onsets, input),
    durSec: p.durSec,
    prompt: 'notate-patterns',
    format: {
      kind: 'sequence',
      length: 3,
      alphabet: [...PICKUP_IDS, ...body.map((x) => x.id)].map((id) => ({ id })),
    },
    answer: { kind: 'sequence', ids: [p.pickupId, ...p.patterns.map((x) => x.id)] },
    rhythm: { bars: p.bars, metronome: 'neutral' },
  }
}

export const BEAT_ONE_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeBeatOne,
  sing: tapBeatOne,
  notate: notateBeatOne,
}

export const ANACRUSIS_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeAnacrusis,
  sing: tapAnacrusis,
  notate: notateAnacrusis,
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/exercises/generators/pickup.test.ts && npx tsc --noEmit`
Expected: PASS；tsc 无输出

- [ ] **Step 5: 提交**

```bash
git add src/exercises/generators/pickup.ts src/exercises/generators/pickup.test.ts
git commit -m "feat(exercises): 找 beat 1 与弱起的听辨、打拍、听写生成器" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 管线接入 R 轨、快照与属性测试

**Files:**
- Modify: `src/exercises/generate.ts`（`lookupGenerator` 追加 R 分支）
- Modify: `src/exercises/generate.test.ts`

**Interfaces:**
- Consumes: `rhythmEntry`/`RHYTHM_ENTRIES`/`RhythmFamily`（Task 4）、`PATTERN_GENERATORS`（Task 6）、`METER_GENERATORS`/`MIXED_METER_GENERATORS`（Task 7）、`BEAT_ONE_GENERATORS`/`ANACRUSIS_GENERATORS`（Task 8）
- Produces: `lookupGenerator` 对 15 个 R 轨知识点返回 `{ mode: 'major', context: 'metronome', byModality }`

- [ ] **Step 1: 改测试（先让它们失败）**

在 `src/exercises/generate.test.ts`：

import 区加入：

```ts
import { RHYTHM_ENTRIES } from './data/rhythms'
```

把这条用例：

```ts
  it('每个 H 轨知识点都有生成器；R 轨在 P-2b-R 之前尚无生成器', () => {
    for (const e of CHORD_ENTRIES) expect(lookupGenerator(e.kpId)).toBeDefined()
    expect(lookupGenerator('chord:i')?.mode).toBe('minor')
    expect(lookupGenerator('rhythm:quarter')).toBeUndefined()
  })
```

替换为：

```ts
  it('每个 H/R 轨知识点都有生成器；T/H 用调性语境，R 用节拍器语境', () => {
    for (const e of CHORD_ENTRIES) expect(lookupGenerator(e.kpId)?.context).toBe('tonal')
    expect(lookupGenerator('chord:i')?.mode).toBe('minor')
    for (const e of RHYTHM_ENTRIES) {
      const g = lookupGenerator(e.kpId)
      expect(g?.context).toBe('metronome')
      expect(g?.mode).toBe('major')
    }
    expect(lookupGenerator('degree:major:do')?.context).toBe('tonal')
  })
```

把这一行：

```ts
    expect(() => generate(spec({ kpId: 'rhythm:quarter', track: 'R' }), c)).toThrow(/rhythm:quarter@recognize/)
```

替换为：

```ts
    expect(() => generate(spec({ kpId: 'rhythm:nope', track: 'R' }), c)).toThrow(/rhythm:nope@recognize/)
```

把：

```ts
const TH_ROWS: { kpId: string; track: 'T' | 'H' }[] = [
  ...DEGREE_ENTRIES.map((e) => ({ kpId: e.kpId, track: 'T' as const })),
  ...CHORD_ENTRIES.map((e) => ({ kpId: e.kpId, track: 'H' as const })),
]
const pickTH = (rng: { pick<T>(xs: readonly T[]): T }) => rng.pick(TH_ROWS)

/** 覆盖全部 T/H 轨知识点 × 模态 × 语境 × 变异 × 档位的随机规格 */
```

替换为：

```ts
const TH_ROWS: { kpId: string; track: 'T' | 'H' | 'R' }[] = [
  ...DEGREE_ENTRIES.map((e) => ({ kpId: e.kpId, track: 'T' as const })),
  ...CHORD_ENTRIES.map((e) => ({ kpId: e.kpId, track: 'H' as const })),
  ...RHYTHM_ENTRIES.map((e) => ({ kpId: e.kpId, track: 'R' as const })),
]
const pickTH = (rng: { pick<T>(xs: readonly T[]): T }) => rng.pick(TH_ROWS)

/** 覆盖全部 T/H/R 轨知识点 × 模态 × 语境 × 变异 × 档位的随机规格 */
```

在快照 `cases` 数组末尾（`['低音线·听写', …]` 这一行之后）追加 8 条：

```ts
    ['音型·听辨', { kpId: 'rhythm:synco-8', track: 'R', modality: 'recognize', contextLevel: 1, variationLevel: 4, difficultyStep: 3, seed: 301 }],
    ['音型·打拍', { kpId: 'rhythm:tie-across-bar', track: 'R', modality: 'sing', contextLevel: 2, variationLevel: 5, difficultyStep: 4, seed: 302 }],
    ['音型·听写', { kpId: 'rhythm:triplet', track: 'R', modality: 'notate', contextLevel: 0, variationLevel: 2, difficultyStep: 2, seed: 303 }],
    ['拍号·听辨', { kpId: 'rhythm:meter-6-8', track: 'R', modality: 'recognize', contextLevel: 2, variationLevel: 3, difficultyStep: 5, seed: 304 }],
    ['拍号·听写', { kpId: 'rhythm:meter-3-4', track: 'R', modality: 'notate', contextLevel: 3, variationLevel: 1, difficultyStep: 3, seed: 305 }],
    ['找 beat 1·打拍', { kpId: 'rhythm:beat-one', track: 'R', modality: 'sing', contextLevel: 1, variationLevel: 0, difficultyStep: 4, seed: 306 }],
    ['弱起·听辨', { kpId: 'rhythm:anacrusis', track: 'R', modality: 'recognize', contextLevel: 4, variationLevel: 6, difficultyStep: 5, seed: 307 }],
    ['混合拍子·听写', { kpId: 'rhythm:mixed-meter', track: 'R', modality: 'notate', contextLevel: 2, variationLevel: 6, seed: 308 }],
```

在 `describe('generate：属性（P-2b spec §11 第 3 条）'` 内部末尾追加：

```ts
  it('随机规格里确实有 R 轨', () => {
    expect(specs.filter((x) => x.track === 'R').length).toBeGreaterThan(100)
  })

  it('R 轨：打拍题的起音都落在内容时长之内，且严格递增', () => {
    for (const s of specs.filter((x) => x.track === 'R' && x.modality === 'sing')) {
      const ex = generate(s, c)
      if (ex.format.kind !== 'tap') throw new Error(`R 轨唱模态应为打拍：${s.kpId}`)
      const onsets = ex.format.onsetsSec
      expect(onsets.length).toBeGreaterThan(0)
      for (let i = 1; i < onsets.length; i++) expect(onsets[i]).toBeGreaterThan(onsets[i - 1])
    }
  })

  it('R 轨：内容音高都是主音，点击都是主音上方一个八度（折叠前）', () => {
    for (const s of specs.filter((x) => x.track === 'R').slice(0, 150)) {
      const ex = generate(s, c)
      const pcs = new Set(ex.plan.events.map((e) => ((Math.round(freqToMidi(e.freqHz)) % 12) + 12) % 12))
      expect(pcs.size).toBe(1)
    }
  })
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/exercises/generate.test.ts`
Expected: FAIL —— R 轨知识点 `lookupGenerator` 返回 undefined；随机规格里的 R 规格抛「没有可用的生成器」

- [ ] **Step 3: 写实现**

在 `src/exercises/generate.ts` 的 import 区加入：

```ts
import { rhythmEntry, type RhythmFamily } from './data/rhythms'
import { ANACRUSIS_GENERATORS, BEAT_ONE_GENERATORS } from './generators/pickup'
import { METER_GENERATORS, MIXED_METER_GENERATORS } from './generators/meter'
import { PATTERN_GENERATORS } from './generators/pattern'
```

在 `CHORD_GENERATORS` 定义之后加入：

```ts
const RHYTHM_GENERATORS: Record<RhythmFamily, Record<Modality, Generator>> = {
  pattern: PATTERN_GENERATORS,
  meter: METER_GENERATORS,
  'beat-one': BEAT_ONE_GENERATORS,
  anacrusis: ANACRUSIS_GENERATORS,
  'mixed-meter': MIXED_METER_GENERATORS,
}
```

在 `lookupGenerator` 里、`return undefined` 之前加入：

```ts
  const rhythm = rhythmEntry(kpId)
  if (rhythm) {
    // 节奏不需要调中心；调式取默认（P-2b spec §14），音高只用主音
    return { mode: 'major', context: 'metronome', byModality: RHYTHM_GENERATORS[rhythm.family] }
  }
```

并把 `lookupGenerator` 注释里的「P-2b-R 在此追加 R 轨的查找。」删掉。

- [ ] **Step 4: 运行测试；首次运行写出 R 快照**

Run: `npx vitest run src/exercises/generate.test.ts`
Expected: PASS；写入 8 条 R 快照。T/H 的 14 条既有快照**必须不变**（若提示 mismatch 或 obsolete，停下排查，绝不用 `-u`）。打开快照文件抽查两条 R 快照：`plan.events` 按时刻升序；打拍题 `format.onsetsSec` 与 `answer.onsetsSec` 相同；频率在 65–2093 Hz 之间。

- [ ] **Step 5: 再跑一次确认快照稳定；跑全量与类型检查**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS，无「snapshot written」；tsc 无输出

- [ ] **Step 6: 提交（含快照文件）**

```bash
git add src/exercises/generate.ts src/exercises/generate.test.ts src/exercises/__snapshots__/
git commit -m "feat(exercises): 管线接入 R 轨，补 R 快照与属性测试" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 集成守卫全量、spec 写回与完成检查

**Files:**
- Modify: `src/exercises/integration.test.ts`
- Modify: `docs/superpowers/specs/2026-08-24-ear-training-design.md`（§6.1 增补、FWD-6 状态）
- Modify: `docs/superpowers/specs/2026-10-13-p2b-exercise-generators-design.md`（§3、§7.1、§7.4、§14）

**Interfaces:**
- Consumes: Task 9 的 `generate`
- Produces: 无新导出

- [ ] **Step 1: 集成守卫放宽到全量**

在 `src/exercises/integration.test.ts` 中：

把：

```ts
      if (t.spec.track === 'T' || t.spec.track === 'H') specs.push(t.spec)
```

替换为：

```ts
      specs.push(t.spec)
```

把：

```ts
describe('集成守卫：调度器真实发出的 T/H 轨规格都能生成并判定', () => {
```

替换为：

```ts
describe('集成守卫：调度器真实发出的全部规格都能生成并判定', () => {
```

在：

```ts
      expect(hKps.size).toBeGreaterThanOrEqual(5)
```

之后插入：

```ts
      const rKps = new Set(specs.filter((s) => s.track === 'R').map((s) => s.kpId))
      expect(rKps.size).toBeGreaterThanOrEqual(5)
```

并把 JSDoc 里的「P-2b-H 覆盖 T/H 轨；P-2b-R 放宽到全量。」改为「P-2b-R 起覆盖全部三条轨道。」

Run: `npx vitest run src/exercises/integration.test.ts`
Expected: PASS。若失败，`failures` 列出出错规格；修对应生成器，不改此测试。

- [ ] **Step 2: 写回主 spec**

`docs/superpowers/specs/2026-08-24-ear-training-design.md`：

在这一行之后：

```
**已确认**：阶梯做满到 L4，不在 L3 封顶。
```

插入：

```

**R 轨的语境（P-2b-R 增补）**：节奏不需要调中心，R 轨的 L0–L4 是节拍器逐级撤走——L0 两小节预备拍加全程节拍器，L1 一小节预备拍加全程，L2 只在强拍响，L3 只有预备拍，L4 节拍器在内容前 40% 后撤走。问「强拍在哪、一小节几拍」的题（拍号、找 beat 1、弱起、混合拍子）改用**中性节拍器**：点击不分强弱、预备拍固定 4 个感知拍、L2 改为隔拍响，免得节拍器替学习者说出答案。速度以感知拍计：x/4 是四分音符，6/8 是附点四分。
```

在 FWD-6 段落的这一行之后：

```
**现状**：P-1 已补一条 6/8 钉桩测试锁住该约定。P-2 实现 R6 时若要扩展复合拍，先读那条测试。
```

插入一行：

```
**状态（P-2b-R）**：R 轨生成器沿用该约定（6/8 填 `{ beatsPerBar: 6, beatUnit: 8 }`），并把 `resolved.bpm` 定义为感知拍速度：6/8 的一个感知拍是 3 个八分音符（`unitsPerPulse`），一个记谱单位的秒数为 `60 / bpm / unitsPerPulse`。
```

- [ ] **Step 3: 写回 P-2b spec**

`docs/superpowers/specs/2026-10-13-p2b-exercise-generators-design.md`：

§3 中把：

```
  | { kind: 'tap'; onsetsSec: number[]; toleranceSec: number }       // R 唱
```

替换为：

```
  | { kind: 'tap'; onsetsSec: number[]; toleranceSec: number; patternIds?: string[] } // R 唱；patternIds 供「打出给定音型」类题显示
```

在 §7.1 的 R 轨语境表格最后一行（`| L4 | 一小节预备拍 + 前 40% 时长有节拍器，随后撤走 |`）之后插入：

```

上表是**按拍号节拍器**（预备拍按小节、强拍加重），用于音型类题和两类「打出给定音型」的打拍题。拍号、找 beat 1、弱起、混合拍子的听辨与听写，以及边听边打强拍的打拍题，用**中性节拍器**：所有点击同力度；预备拍固定 4 个感知拍（L0 为 8 个），不按拍号分组；L2 改为隔一个感知拍响一次。理由：这些题问的就是强拍位置与拍号，按拍号的节拍器会直接说出答案。点击音高为主音上方一个八度；R 轨反馈的锚点是一小节按拍号节拍器。`GeneratorEntry.context` 声明语境种类，R 轨生成器在 `ContentResult.rhythm` 里交出小节结构与节拍器模式。
```

在 `## 8. 判定` 这一行**之前**插入：

```
**P-2b-R 实施说明**（对上表的落地与修正）：

- 音型库全部为 4/4（跨小节连线为两小节音型），以四分音符为单位定义；6/8 只出现在拍号类题的随机填充中。
- 音型类与弱起的打拍题**不放内容**：屏幕按 `format.patternIds` 显示音型，学习者跟按拍号节拍器打出来，反馈里再放给他听。拍号、找 beat 1、混合拍子的打拍题是**边听边打每小节第一拍**。
- 拍号听写改为「N 段短句（每段 2 小节同一拍号，段间空一小节），逐段写拍号」。原文「该拍号音型的 id 序列」在 R1 时字母表为空，无法出题。
- 找 beat 1：片段从 2/4、3/4、4/4 中抽，第 0 小节从中间某个感知拍起拍；候选序号最多 8 个。
- 弱起：第 0 小节只有弱起音（不加重），后接两个单小节音型；弱起长度 `none` / `half`（第四拍后半）/ `one`（第四拍）。
- 混合拍子：4 种 x/4 组合（`3/4+2/4`、`2/4+3/4`、`4/4+3/4`、`3/4+4/4`），循环两遍。

```

§14 的两条 P-2b-R 条目末尾各追加「（P-2b-R 已落实）」。

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
git commit -m "test(exercises): 集成守卫覆盖全部轨道；docs(spec): R 轨语境与 FWD-6 写回" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 完成标准

1. `npx vitest run` 全绿
2. `npx tsc --noEmit` 无输出
3. `npx vite build` 成功
4. R 轨数据表覆盖测试通过：15 个知识点无一遗漏
5. 属性测试通过：随机 T/H/R 规格下答案必判对、全部音高在 MIDI 36–96、生成确定
6. 集成守卫通过：普通与慢学习者 180 天里调度器发出的**全部**规格都能生成并判定
7. T/H 的 14 条既有快照不变
8. `src/exercises/` 零 IO、依赖方向正确
9. spec 已写回：主 spec §6.1 R 轨语境、FWD-6 状态；P-2b spec §3、§7.1、§7.4 实施说明、§14

## 下一步

P-2b 完成。下一阶段是 **P-3 会话运行时、存储与最小 UI**——先做 brainstorming，P-2b spec §14 里的 P-3 约束（阶梯档位写入规格、显示文案表、进行选项按 `-` 拆分、作答前不显示知识点名称）是它的输入。
