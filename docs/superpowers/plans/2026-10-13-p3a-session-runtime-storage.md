# P-3a 会话运行时与存储 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 不带界面地完成「按调度器真练一天」的全部逻辑：纯函数会话状态机、可续起的存储（内存 + IndexedDB）、把两者接到音频与时钟的薄壳；并修 FWD-1。

**Architecture:** `src/session/` 是纯函数核心——逐题函数（与仿真共用）、日期与 seed、状态机 `reduce(state, event, ctx) → { state, effects }`。`src/storage/` 定义 `Repository` 接口，内存实现与 IndexedDB 实现跑同一套契约测试。`src/runtime/` 是薄壳：持有状态与掌握度副本，按顺序执行副作用（播放、落盘、计时），对外暴露可订阅的快照。界面留给 P-3b。

**Tech Stack:** TypeScript、vitest；新增开发依赖 `fake-indexeddb`（只在测试中使用）。

**Spec:** `docs/superpowers/specs/2026-10-13-p3-session-storage-ui-design.md`（P-3 spec）§3、§4、§5、§8、§9、§10。主 spec：`docs/superpowers/specs/2026-08-24-ear-training-design.md` §7、§10、§11、§16.2 FWD-1。

## Global Constraints

- `src/session/` 与 `src/storage/`（`indexeddb.ts` 除外）零 IO：不得出现 `Math.random`、`Date.now`、`new Date()`（不带参数）、`window.`、`document.`、`indexedDB`。时间与日期一律由调用方传入。
- 依赖方向：`session` → `exercises`、`scheduling`、`curriculum`、`music`；`storage` → `session` 的类型与 `scheduling`、`curriculum` 的类型；`runtime` → `session`、`storage`、`exercises`、`scheduling`、`curriculum`。`session`、`storage` 不得依赖 `runtime`、`audio`、`ui`、`simulation`。
- 运行时契约（P-2b §14）：出题前把阶梯档位写进规格（`{ ...planned, difficultyStep: ladder.step }`）。
- 记录答后档位：`applyAttempt(state, correct, day, steppedLadder.step)`。
- 热身题（`segment === 'warmup'`）不计分：不改阶梯、不写作答、不写掌握度。
- 中断：当前题作废，不写作答、不改阶梯与计数；恢复后同一道计划题以同一实时规格、同一 seed 重新出题。
- 实战关替身：`BOSS_STANDIN_ACCURACY = 0.8`，且本场实战关段至少答过 1 题（P-3 spec D3）。
- 作答归档上限 `ATTEMPT_CAP = 50_000`；超出部分按 MasteryKey 聚合后删除（主 spec §10.2）。
- `SCHEMA_VERSION = 1`；数据损坏绝不静默清空（主 spec §10.3）。
- 每场会话 25 分钟（`SESSION_MINUTES = 25`）。
- 测试命令：`npx vitest run <path>`；全量 `npx vitest run`；类型 `npx tsc --noEmit`；构建 `npx vite build`。
- 每个任务结束提交一次，提交信息以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾；不要提交 `.superpowers/` 下的任何文件。

## 对 spec 的一处具体化

P-3 spec §3.5 的副作用里有 `saveProfile`。本计划改为 `{ type: 'advancePhase'; from; to; day }`：状态机不持有 Profile，只声明「阶段推进了」，由壳层更新 Profile 并写 `GateRecord`。语义不变，状态机更纯。

## File Structure

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/audio/AudioEngine.ts`（改） | FWD-1：节点结束时从 `active` 移除 | 1 |
| `src/session/item.ts` | 逐题函数（准备、记录、跨天护栏），仿真与状态机共用 | 2 |
| `src/simulation/runSimulation.ts`（改） | 改为调用 `session/item.ts` | 2 |
| `src/session/time.ts` | 本地日期、`dayIndex`、`sessionSeed` | 3 |
| `src/session/types.ts` | 状态、事件、副作用、记录、总结类型与常量 | 4 |
| `src/session/machine.ts` | `createSession`、`resumeSession`、`toRecord`、`reduce`、`bossPassed`、`createDrill` | 4、5、6 |
| `src/storage/types.ts` | Profile、GateRecord、聚合、导出包、`Repository`、错误类型 | 7 |
| `src/storage/archive.ts`、`bundle.ts` | 归档、导出包校验与迁移 | 7 |
| `src/storage/memory.ts` | 内存实现 | 7 |
| `src/storage/contract.ts` | 契约测试套件（被两个实现的测试复用） | 7 |
| `src/storage/indexeddb.ts` | IndexedDB 实现 | 8 |
| `src/runtime/runtime.ts` | 薄壳 | 9 |

---

### Task 1: FWD-1——`AudioEngine` 不再累积已结束的节点

**Files:**
- Modify: `src/audio/AudioEngine.ts`
- Test: `src/audio/AudioEngine.test.ts`（末尾追加 describe）

**Interfaces:**
- Consumes: 既有 `AudioEngine`
- Produces: 新增只读访问器 `get activeCount(): number`（测试与诊断用）；`spawn` 里每个音的增益节点在该音的最后一个振荡器 `onended` 时一并断开并从 `active` 移除，振荡器与分音增益节点同样移除

- [ ] **Step 1: 写失败的测试**

在 `src/audio/AudioEngine.test.ts` 末尾追加（文件顶部已有 `makeFakeContext`、`AudioEngine`、`notesToPlan` 的导入与定义；若 `makeFakeContext` 返回值里没有 `created`，按该文件现有写法取到已创建的振荡器列表）：

```ts
describe('FWD-1：已结束的节点不再累积', () => {
  it('每个音的全部振荡器结束后，active 恢复为 0；连续播放不线性增长', () => {
    const { ctx, created } = makeFakeContext()
    const engine = new AudioEngine(ctx as unknown as AudioContext)
    const plan = notesToPlan([{ midi: 60, atSec: 0, durSec: 0.5 }, { midi: 64, atSec: 0.5, durSec: 0.5 }], 'piano')

    for (let round = 0; round < 5; round++) {
      engine.play(plan)
      expect(engine.activeCount).toBeGreaterThan(0)
      // 模拟所有已创建振荡器播完
      for (const osc of created.oscillators) osc.onended?.()
      expect(engine.activeCount).toBe(0)
    }
  })

  it('stopAll 之后 activeCount 为 0', () => {
    const { ctx } = makeFakeContext()
    const engine = new AudioEngine(ctx as unknown as AudioContext)
    engine.play(notesToPlan([{ midi: 60, atSec: 0, durSec: 1 }], 'strings'))
    engine.stopAll()
    expect(engine.activeCount).toBe(0)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/audio/AudioEngine.test.ts`
Expected: FAIL —— `activeCount` 不存在（或结束后不为 0）

- [ ] **Step 3: 写实现**

在 `AudioEngine` 类里加入：

```ts
  /** 仍在 active 中的节点数（FWD-1：已结束的节点应已移除） */
  get activeCount(): number {
    return this.active.length
  }

  private release(nodes: { disconnect(): void }[]): void {
    for (const node of nodes) {
      try {
        node.disconnect()
      } catch {
        // 已断开，忽略
      }
    }
    this.active = this.active.filter((n) => !nodes.includes(n))
  }
```

把 `spawn` 的振荡器循环改为：每个音记录自己的节点与尚未结束的振荡器个数，最后一个振荡器结束时释放该音的全部节点（含 `amp`）：

```ts
    const voiceNodes: { disconnect(): void }[] = [amp]
    let remaining = voice.timbre.partials.length
    for (const partial of voice.timbre.partials) {
      const osc = this.ctx.createOscillator()
      osc.type = voice.timbre.oscType
      osc.frequency.setValueAtTime(voice.freqHz * partial.ratio, voice.startSec)

      const partialGain = this.ctx.createGain()
      partialGain.gain.setValueAtTime(partial.gain, voice.startSec)

      osc.connect(partialGain)
      partialGain.connect(amp)
      osc.start(voice.startSec)
      osc.stop(voice.stopSec)

      this.active.push(osc, partialGain)
      voiceNodes.push(osc, partialGain)
      osc.onended = () => {
        remaining--
        // FWD-1：该音的最后一个分音结束时，释放该音全部节点并移出 active
        if (remaining === 0) this.release(voiceNodes)
      }
    }
```

（删除原来 `osc.onended` 里只 `disconnect` 不移除的写法。`amp` 仍在函数开头 `this.active.push(amp)`。）

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/audio/ && npx tsc --noEmit`
Expected: PASS；tsc 无输出

- [ ] **Step 5: 提交**

```bash
git add src/audio/AudioEngine.ts src/audio/AudioEngine.test.ts
git commit -m "fix(audio): 已结束的节点从 active 移除（FWD-1）" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 逐题函数抽到 `session/item.ts`，仿真改为复用

**Files:**
- Create: `src/session/item.ts`
- Test: `src/session/item.test.ts`
- Test: `src/simulation/characterization.test.ts`（新建，**先于重构**写出快照）
- Modify: `src/simulation/runSimulation.ts`

**Interfaces:**
- Consumes: `resumeLadder`/`applyLadder`/`LadderState`（scheduling/ladder）、`needsRelief`/`relieveSpec`/`isStagnant`/`decompose`/`SessionProgress`（scheduling/guardrails）、`applyAttempt`/`getMastery`/`MasteryState`/`MasteryStore`（scheduling/mastery）、`applyGating`（scheduling/gating）、`requirementFor`/`unlockedKnowledgePoints`/`Curriculum`（curriculum）、`masteryKey`/`MODALITIES`/`MasteryKey`（curriculum/knowledgePoints）、`ExerciseSpec`
- Produces:
  - `export interface PreparedItem { key: MasteryKey; spec: ExerciseSpec; ladder: LadderState; relief: boolean }`
  - `export function prepareItem(planned: ExerciseSpec, ladderInSession: LadderState | undefined, mastery: MasteryStore, progress: SessionProgress): PreparedItem`
  - `export interface RecordedAnswer { key: MasteryKey; ladder: LadderState; state: MasteryState }`（`ladder` 是答后阶梯）
  - `export function recordAnswer(input: { curriculum: Curriculum; phaseId: PhaseId; day: number; mastery: MasteryStore; spec: ExerciseSpec; ladder: LadderState; correct: boolean }): RecordedAnswer`
  - `export function stagnationUpdates(curriculum: Curriculum, phaseId: PhaseId, day: number, mastery: MasteryStore): { key: MasteryKey; state: MasteryState }[]`

- [ ] **Step 1: 先写仿真的特征快照（重构前）**

`src/simulation/characterization.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { runSimulation, type SimulationResult } from './runSimulation'
import { AVERAGE_LEARNER, SLOW_LEARNER } from './virtualLearner'

/**
 * 特征快照：P-3a 把逐题逻辑搬到 session/item.ts，仿真改为复用。
 * 这份快照在搬迁之前写出，搬迁后必须逐字一致——它守的是「搬家不改行为」。
 */
function fingerprint(r: SimulationResult) {
  return {
    finalPhase: r.finalPhase,
    phaseCompletionDay: r.phaseCompletionDay,
    ladderAccuracy: r.ladderAccuracy.toFixed(9),
    days: r.days.map((d) => [d.phaseId, d.itemCount, d.correct, d.reliefTriggered ? 1 : 0, d.decomposedKeys.join(',')]),
    store: [...r.finalStore.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, s]) => [k, s.stability.toFixed(9), s.difficulty.toFixed(9), s.variationLevel, s.contextLevel, s.window.length]),
  }
}

describe('仿真特征快照（搬迁守卫）', () => {
  it('普通学习者 180 天', () => {
    expect(fingerprint(runSimulation({ learner: AVERAGE_LEARNER, days: 180, minutesPerDay: 25, seed: 4242 }))).toMatchSnapshot()
  })
  it('慢学习者 180 天', () => {
    expect(fingerprint(runSimulation({ learner: SLOW_LEARNER, days: 180, minutesPerDay: 25, seed: 4242 }))).toMatchSnapshot()
  })
})
```

Run: `npx vitest run src/simulation/characterization.test.ts`
Expected: PASS，写出 `src/simulation/__snapshots__/characterization.test.ts.snap`。**立刻提交这份快照**（重构之前）：

```bash
git add src/simulation/characterization.test.ts src/simulation/__snapshots__/characterization.test.ts.snap
git commit -m "test(simulation): 搬迁前写出仿真特征快照" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: 写逐题函数的失败测试**

`src/session/item.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { masteryKey } from '../curriculum/knowledgePoints'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'
import { initialLadder } from '../scheduling/ladder'
import { getMastery, initialMastery, type MasteryState } from '../scheduling/mastery'
import { prepareItem, recordAnswer, stagnationUpdates } from './item'

const c = buildCurriculum()
const planned: ExerciseSpec = {
  kpId: 'degree:major:do', modality: 'recognize', track: 'T',
  contextLevel: 1, variationLevel: 1, difficultyStep: 0, seed: 7, segment: 'focus',
}
const key = masteryKey(planned.kpId, planned.modality)
const withWindow = (steps: number[], correct = true): MasteryState => ({
  ...initialMastery(),
  window: steps.map((s, i) => ({ correct, day: i, difficultyStep: s })),
  lastSeenDay: steps.length - 1,
})

describe('prepareItem', () => {
  it('从掌握度窗口续起阶梯，并把档位写进规格', () => {
    const p = prepareItem(planned, undefined, new Map([[key, withWindow([1, 2, 3])]]), { attempted: 0, correct: 0 })
    expect(p.key).toBe(key)
    expect(p.ladder.step).toBe(3)
    expect(p.spec.difficultyStep).toBe(3)
    expect(p.relief).toBe(false)
  })

  it('会话内已有阶梯时优先用它', () => {
    const p = prepareItem(planned, { step: 4, consecutiveCorrect: 1 }, new Map(), { attempted: 0, correct: 0 })
    expect(p.spec.difficultyStep).toBe(4)
  })

  it('回血：降档、降语境与变异，阶梯落到回血后的档位且连对清零', () => {
    const p = prepareItem(planned, { step: 3, consecutiveCorrect: 1 }, new Map(), { attempted: 20, correct: 2 })
    expect(p.relief).toBe(true)
    expect(p.spec.difficultyStep).toBe(2)
    expect(p.spec.contextLevel).toBe(0)
    expect(p.ladder).toEqual({ step: 2, consecutiveCorrect: 0 })
  })
})

describe('recordAnswer', () => {
  it('答后档位写进窗口；门控按阶段上限', () => {
    const r = recordAnswer({
      curriculum: c, phaseId: 'P1', day: 5, mastery: new Map(),
      spec: { ...planned, difficultyStep: 0 }, ladder: { step: 0, consecutiveCorrect: 1 }, correct: true,
    })
    expect(r.ladder).toEqual({ step: 1, consecutiveCorrect: 0 })
    expect(r.state.window.at(-1)).toEqual({ correct: true, day: 5, difficultyStep: 1 })
    expect(r.state.lastSeenDay).toBe(5)
  })

  it('不修改传入的掌握度表', () => {
    const mastery = new Map([[key, withWindow([1])]])
    recordAnswer({ curriculum: c, phaseId: 'P1', day: 9, mastery, spec: planned, ladder: initialLadder(), correct: false })
    expect(getMastery(mastery, key).window).toHaveLength(1)
  })
})

describe('stagnationUpdates', () => {
  it('只对停滞的已解锁 key 给出拆解后的状态', () => {
    const stagnant: MasteryState = {
      ...withWindow(Array(8).fill(0), false),
      contextLevel: 1,
      variationLevel: 1,
      window: Array.from({ length: 8 }, (_, i) => ({ correct: false, day: 10 + (i % 3), difficultyStep: 0 })),
      lastSeenDay: 12,
    }
    const healthy = withWindow([3, 3, 3])
    const mastery = new Map([[key, stagnant], [masteryKey('degree:major:mi', 'sing'), healthy]])
    const ups = stagnationUpdates(c, 'P1', 12, mastery)
    expect(ups.map((u) => u.key)).toEqual([key])
    expect(ups[0].state.contextLevel).toBe(0)
  })
})
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `npx vitest run src/session/item.test.ts`
Expected: FAIL —— 无法解析模块 `./item`

- [ ] **Step 4: 写实现**

`src/session/item.ts`：

```ts
import { requirementFor, unlockedKnowledgePoints, type Curriculum } from '../curriculum/curriculum'
import { MODALITIES, masteryKey, type MasteryKey } from '../curriculum/knowledgePoints'
import type { PhaseId } from '../curriculum/stages'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'
import { applyGating } from '../scheduling/gating'
import {
  decompose,
  isStagnant,
  needsRelief,
  relieveSpec,
  type SessionProgress,
} from '../scheduling/guardrails'
import { applyLadder, resumeLadder, type LadderState } from '../scheduling/ladder'
import {
  applyAttempt,
  getMastery,
  type MasteryState,
  type MasteryStore,
} from '../scheduling/mastery'

/**
 * 逐题函数：会话状态机与仿真共用同一套（P-3 spec §3.4），避免两份实现漂移。
 * 全部纯函数，不修改输入。
 */

export interface PreparedItem {
  key: MasteryKey
  /** 实时规格：已写入阶梯档位（P-2b §14 运行时契约），回血时已降难度 */
  spec: ExerciseSpec
  /** 出题时的阶梯（回血时已落到回血后的档位） */
  ladder: LadderState
  relief: boolean
}

export function prepareItem(
  planned: ExerciseSpec,
  ladderInSession: LadderState | undefined,
  mastery: MasteryStore,
  progress: SessionProgress,
): PreparedItem {
  const key = masteryKey(planned.kpId, planned.modality)
  // 阶梯续起（P-2 裁定 C/D）：会话内已有则用之，否则从掌握度窗口尾部推导
  let ladder = ladderInSession ?? resumeLadder(getMastery(mastery, key).window)
  let spec: ExerciseSpec = { ...planned, difficultyStep: ladder.step }
  let relief = false
  if (needsRelief(progress)) {
    // 会话内回血（主 spec §7.5）：阶梯跟着落到回血后的档位、连对清零
    relief = true
    spec = relieveSpec(spec)
    ladder = { step: spec.difficultyStep, consecutiveCorrect: 0 }
  }
  return { key, spec, ladder, relief }
}

export interface RecordedAnswer {
  key: MasteryKey
  /** 答后阶梯 */
  ladder: LadderState
  /** 写回后的掌握度（已过门控） */
  state: MasteryState
}

export function recordAnswer(input: {
  curriculum: Curriculum
  phaseId: PhaseId
  day: number
  mastery: MasteryStore
  spec: ExerciseSpec
  ladder: LadderState
  correct: boolean
}): RecordedAnswer {
  const { curriculum, phaseId, day, mastery, spec, ladder, correct } = input
  const key = masteryKey(spec.kpId, spec.modality)
  const stepped = applyLadder(ladder, correct)
  // 记答后档位（P-2 裁定 C 的修复）：续起与门控都读它
  const updated = applyAttempt(getMastery(mastery, key), correct, day, stepped.step)
  const state = applyGating(updated, requirementFor(curriculum, spec.kpId, phaseId))
  return { key, ladder: stepped, state }
}

/** 跨天护栏（主 spec §7.5）：已解锁、已练过且停滞的 key → 拆解后的状态 */
export function stagnationUpdates(
  curriculum: Curriculum,
  phaseId: PhaseId,
  day: number,
  mastery: MasteryStore,
): { key: MasteryKey; state: MasteryState }[] {
  const out: { key: MasteryKey; state: MasteryState }[] = []
  for (const kpId of unlockedKnowledgePoints(curriculum, phaseId)) {
    for (const m of MODALITIES) {
      const key = masteryKey(kpId, m)
      const state = mastery.get(key)
      if (state && isStagnant(state, day)) out.push({ key, state: decompose(state) })
    }
  }
  return out
}
```

- [ ] **Step 5: 运行逐题测试，确认通过**

Run: `npx vitest run src/session/item.test.ts`
Expected: PASS

- [ ] **Step 6: 仿真改为复用逐题函数**

在 `src/simulation/runSimulation.ts` 的逐题循环里：

- 用 `const prepared = prepareItem(planned, ladders.get(key), store, progress)` 取代「续起阶梯 → 写档位 → 回血」三段；之后 `let ladder = prepared.ladder`、`const spec = prepared.spec`，`if (prepared.relief) reliefTriggered = true`。
- 用 `const recorded = recordAnswer({ curriculum, phaseId, day, mastery: store, spec, ladder, correct })` 取代 `applyLadder` → `applyAttempt` → `applyGating` 三段；之后 `ladders.set(key, recorded.ladder)`、`store.set(key, recorded.state)`，`trace` 里的 `stateAfter` 用 `recorded.state`。
- 用 `for (const u of stagnationUpdates(curriculum, phaseId, day, store)) { store.set(u.key, u.state); decomposedKeys.push(u.key) }` 取代跨天护栏的双重循环。
- `ladderAttempts` / `ladderCorrect` 的统计、`learner.answer(spec, ladder.step)`、`ability` 与 `probability` 的取值保持原样（都用 `prepared.ladder.step`）。
- 删除因此不再使用的 import（tsc 的 noUnusedLocals 会指出）。保留原有注释中仍然适用的部分，指向 `session/item.ts`。

- [ ] **Step 7: 运行全部仿真测试，特征快照必须逐字一致**

Run: `npx vitest run src/simulation/ && npx tsc --noEmit`
Expected: PASS；**无「snapshot written」、无 mismatch**。若特征快照不一致，说明搬迁改变了行为——停下排查，绝不用 `-u`。

- [ ] **Step 8: 提交**

```bash
git add src/session/item.ts src/session/item.test.ts src/simulation/runSimulation.ts
git commit -m "refactor(session): 逐题函数抽到 session/item.ts，仿真改为复用" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 本地日期、`dayIndex` 与会话 seed

**Files:**
- Create: `src/session/time.ts`
- Test: `src/session/time.test.ts`

**Interfaces:**
- Produces:
  - `export function localDateString(d: Date): string`（`'YYYY-MM-DD'`，按 `d` 的本地时区年月日；由壳层传入 `new Date()`）
  - `export function dayIndex(createdAtLocalDate: string, todayLocalDate: string): number`（两日历日之差，天）
  - `export function sessionSeed(profileId: string, day: number, sessionNo: number): number`（32 位无符号整数，确定性）

- [ ] **Step 1: 写失败的测试**

`src/session/time.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { dayIndex, localDateString, sessionSeed } from './time'

describe('localDateString', () => {
  it('按本地年月日格式化，补零', () => {
    expect(localDateString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(localDateString(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31')
  })
})

describe('dayIndex', () => {
  it('同一天为 0，次日为 1', () => {
    expect(dayIndex('2026-10-13', '2026-10-13')).toBe(0)
    expect(dayIndex('2026-10-13', '2026-10-14')).toBe(1)
  })
  it('跨月、跨年、跨夏令时都按日历日计', () => {
    expect(dayIndex('2026-01-31', '2026-03-01')).toBe(29)
    expect(dayIndex('2025-12-31', '2026-01-01')).toBe(1)
    expect(dayIndex('2026-03-28', '2026-03-30')).toBe(2)
  })
  it('格式不对时抛错', () => {
    expect(() => dayIndex('2026/10/13', '2026-10-14')).toThrow()
  })
})

describe('sessionSeed', () => {
  it('确定性、非负整数，且随 profile、day、场次变化', () => {
    const s = sessionSeed('p1', 3, 0)
    expect(s).toBe(sessionSeed('p1', 3, 0))
    expect(Number.isInteger(s)).toBe(true)
    expect(s).toBeGreaterThanOrEqual(0)
    expect(s).toBeLessThan(2 ** 32)
    const others = [sessionSeed('p2', 3, 0), sessionSeed('p1', 4, 0), sessionSeed('p1', 3, 1)]
    for (const o of others) expect(o).not.toBe(s)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/session/time.test.ts`
Expected: FAIL —— 无法解析模块 `./time`

- [ ] **Step 3: 写实现**

`src/session/time.ts`：

```ts
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** 本地日历日 'YYYY-MM-DD'。日期由调用方传入——本模块不读时钟 */
export function localDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function utcDays(local: string): number {
  const m = DATE_RE.exec(local)
  if (!m) throw new Error(`日期格式应为 YYYY-MM-DD，收到 ${local}`)
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000
}

/** 两个本地日历日之差（天）。与掌握度模型、仿真里的 day 同义（P-3 spec §3.1） */
export function dayIndex(createdAtLocalDate: string, todayLocalDate: string): number {
  return Math.round(utcDays(todayLocalDate) - utcDays(createdAtLocalDate))
}

/** FNV-1a 32 位：由 (profileId, day, sessionNo) 确定性派生会话 seed */
export function sessionSeed(profileId: string, day: number, sessionNo: number): number {
  const text = `${profileId}|${day}|${sessionNo}`
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/session/time.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/session/time.ts src/session/time.test.ts
git commit -m "feat(session): 本地日期、dayIndex 与会话 seed" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 会话类型与状态机（出题、作答、中断）

**Files:**
- Create: `src/session/types.ts`
- Create: `src/session/machine.ts`
- Test: `src/session/machine.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `prepareItem`/`recordAnswer`；`generate`/`grade`/`Exercise`/`GradeResult`/`Response`（exercises/generate）；`SessionPlan`（scheduling/scheduler）；`ExerciseSpec`；`LadderState`；`SessionProgress`；`MasteryStore`/`MasteryState`；`Curriculum`；`PhaseId`；`MasteryKey`/`Track`；`PlaybackPlan`
- Produces（`types.ts`）：
  - 常量 `BOSS_STANDIN_ACCURACY = 0.8`、`SESSION_MINUTES = 25`
  - `SessionMode = 'session' | 'drill'`、`SessionPhase = 'idle' | 'presenting' | 'answering' | 'feedback' | 'done'`
  - `interface Tally { attempted: number; correct: number }`
  - `interface CurrentItem { planIndex: number; spec: ExerciseSpec; exercise: Exercise; scored: boolean; ladder: LadderState | null }`
  - `interface SessionState { mode; day; sessionNo; phaseId; plan: SessionPlan; index: number; ladders: Record<MasteryKey, LadderState>; progress: SessionProgress; boss: Tally; byTrack: Record<Track, number>; reliefTriggered: boolean; phase: SessionPhase; current: CurrentItem | null; lastGrade: GradeResult | null; wrongThisSession: ExerciseSpec[]; summary: SessionSummary | null }`
  - `interface AttemptRecord { at: string; day: number; sessionNo: number; kpId; modality; spec: ExerciseSpec; correct: boolean; latencyMs: number; detail: GradeResult['detail'] }`
  - `interface SessionRecord { day; sessionNo; phaseId; plan: SessionPlan; index; progress: SessionProgress; boss: Tally; byTrack: Record<Track, number>; reliefTriggered: boolean; completed: boolean }`
  - `interface SessionSummary { scored: number; correct: number; accuracy: number; byTrack: Record<Track, number>; reliefTriggered: boolean; gate: { evaluated: boolean; passed: boolean; blockingKeys: number; bossSatisfied: boolean; advancedTo: PhaseId | null } }`
  - `type SessionEvent`（`start`、`contentPlayed`、`answer`、`interrupted`、`next`、`endEarly`，见 Step 3）
  - `type SessionEffect`（`play`、`stopAudio`、`saveAttempt`、`saveMastery`、`saveSession`、`advancePhase`、`itemError`、`ended`）
  - `interface ReduceContext { curriculum: Curriculum; mastery: MasteryStore; nowIso: string }`
- Produces（`machine.ts`，本任务部分）：`createSession`、`resumeSession`、`toRecord`、`reduce`（结束流程在 Task 5 补全；本任务里计划用完时只进入 `done` 并发 `saveSession` 与 `ended`，`summary.gate.evaluated = false`）

- [ ] **Step 1: 写类型文件**

`src/session/types.ts`：

```ts
import type { Curriculum } from '../curriculum/curriculum'
import type { KnowledgePointId, MasteryKey, Modality, Track } from '../curriculum/knowledgePoints'
import type { PhaseId } from '../curriculum/stages'
import type { Exercise, GradeResult, Response } from '../exercises/generate'
import type { PlaybackPlan } from '../music/playback'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'
import type { SessionProgress } from '../scheduling/guardrails'
import type { LadderState } from '../scheduling/ladder'
import type { MasteryState, MasteryStore } from '../scheduling/mastery'
import type { SessionPlan } from '../scheduling/scheduler'

/** 实战关替身：本场实战关段正确率达标即视为通过（P-3 spec D3） */
export const BOSS_STANDIN_ACCURACY = 0.8
export const SESSION_MINUTES = 25

export type SessionMode = 'session' | 'drill'
export type SessionPhase = 'idle' | 'presenting' | 'answering' | 'feedback' | 'done'

export interface Tally {
  attempted: number
  correct: number
}

export interface CurrentItem {
  planIndex: number
  /** 实时规格（含档位、回血后的难度） */
  spec: ExerciseSpec
  exercise: Exercise
  /** 计分题才更新阶梯、计数、掌握度与作答记录 */
  scored: boolean
  /** 计分题出题时的阶梯；非计分题为 null */
  ladder: LadderState | null
}

export interface SessionSummary {
  scored: number
  correct: number
  accuracy: number
  byTrack: Record<Track, number>
  reliefTriggered: boolean
  gate: {
    evaluated: boolean
    passed: boolean
    blockingKeys: number
    bossSatisfied: boolean
    advancedTo: PhaseId | null
  }
}

export interface SessionState {
  mode: SessionMode
  day: number
  sessionNo: number
  phaseId: PhaseId
  plan: SessionPlan
  /** 下一道要出的计划题下标；作答后即 +1 */
  index: number
  ladders: Record<MasteryKey, LadderState>
  progress: SessionProgress
  boss: Tally
  byTrack: Record<Track, number>
  reliefTriggered: boolean
  phase: SessionPhase
  current: CurrentItem | null
  lastGrade: GradeResult | null
  wrongThisSession: ExerciseSpec[]
  summary: SessionSummary | null
}

export interface AttemptRecord {
  /** ISO 时间戳，仅作记录，不参与任何判定 */
  at: string
  day: number
  sessionNo: number
  kpId: KnowledgePointId
  modality: Modality
  /** 实时规格（含档位与 seed），可复现该题 */
  spec: ExerciseSpec
  correct: boolean
  latencyMs: number
  detail: GradeResult['detail']
}

export interface SessionRecord {
  day: number
  sessionNo: number
  phaseId: PhaseId
  plan: SessionPlan
  index: number
  progress: SessionProgress
  boss: Tally
  byTrack: Record<Track, number>
  reliefTriggered: boolean
  completed: boolean
}

export type SessionEvent =
  | { type: 'start' }
  | { type: 'contentPlayed' }
  | { type: 'answer'; response: Response; latencyMs: number }
  | { type: 'interrupted' }
  | { type: 'next' }
  | { type: 'endEarly' }

export type SessionEffect =
  | { type: 'play'; plan: PlaybackPlan }
  | { type: 'stopAudio' }
  | { type: 'saveAttempt'; attempt: AttemptRecord }
  | { type: 'saveMastery'; key: MasteryKey; state: MasteryState }
  | { type: 'saveSession'; record: SessionRecord }
  | { type: 'advancePhase'; from: PhaseId; to: PhaseId; day: number }
  | { type: 'itemError'; spec: ExerciseSpec; message: string }
  | { type: 'ended'; summary: SessionSummary }

export interface ReduceContext {
  curriculum: Curriculum
  /** 只读；变化经 saveMastery 副作用交给壳层 */
  mastery: MasteryStore
  /** 作答记录的时间戳，由壳层传入 */
  nowIso: string
}

export interface ReduceResult {
  state: SessionState
  effects: SessionEffect[]
}
```

- [ ] **Step 2: 写失败的测试**

`src/session/machine.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { masteryKey } from '../curriculum/knowledgePoints'
import { answerAsResponse } from '../exercises/generate'
import type { MasteryState } from '../scheduling/mastery'
import { buildSessionPlan } from '../scheduling/scheduler'
import { createSession, reduce, resumeSession, toRecord } from './machine'
import { SESSION_MINUTES, type ReduceContext, type SessionEffect, type SessionState } from './types'

const c = buildCurriculum()
const ctx = (mastery = new Map<string, MasteryState>()): ReduceContext => ({ curriculum: c, mastery, nowIso: '2026-10-13T08:00:00.000Z' })

function freshSession(): SessionState {
  const plan = buildSessionPlan({ curriculum: c, store: new Map(), phaseId: 'P1', today: 0, seed: 11, minutes: SESSION_MINUTES })
  return createSession({ mode: 'session', day: 0, sessionNo: 0, phaseId: 'P1', plan })
}
const types = (effects: SessionEffect[]) => effects.map((e) => e.type)

describe('出题', () => {
  it('start：出第一道计划题并播放，进入 presenting', () => {
    const s0 = freshSession()
    const r = reduce(s0, { type: 'start' }, ctx())
    expect(r.state.phase).toBe('presenting')
    expect(r.state.current?.planIndex).toBe(0)
    expect(types(r.effects)).toEqual(['play'])
  })

  it('contentPlayed：presenting → answering', () => {
    const r1 = reduce(freshSession(), { type: 'start' }, ctx())
    const r2 = reduce(r1.state, { type: 'contentPlayed' }, ctx())
    expect(r2.state.phase).toBe('answering')
    expect(r2.effects).toEqual([])
  })
})

describe('热身题不计分', () => {
  it('作答后不写作答、不写掌握度，只写会话进度；index +1', () => {
    let s = reduce(freshSession(), { type: 'start' }, ctx()).state
    expect(s.current?.spec.segment).toBe('warmup')
    expect(s.current?.scored).toBe(false)
    s = reduce(s, { type: 'contentPlayed' }, ctx()).state
    const r = reduce(s, { type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 900 }, ctx())
    expect(types(r.effects)).toEqual(['saveSession'])
    expect(r.state.index).toBe(1)
    expect(r.state.progress).toEqual({ attempted: 0, correct: 0 })
    expect(r.state.phase).toBe('feedback')
  })
})

describe('计分题', () => {
  /** 推进到第一道计分题的 answering 状态 */
  function atFirstScored(): SessionState {
    let s = reduce(freshSession(), { type: 'start' }, ctx()).state
    while (!s.current!.scored) {
      s = reduce(s, { type: 'contentPlayed' }, ctx()).state
      s = reduce(s, { type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 500 }, ctx()).state
      s = reduce(s, { type: 'next' }, ctx()).state
    }
    return reduce(s, { type: 'contentPlayed' }, ctx()).state
  }

  it('规格里写入了阶梯档位；作答写作答、写掌握度、写会话进度', () => {
    const s = atFirstScored()
    expect(s.current!.spec.difficultyStep).toBe(s.current!.ladder!.step)
    const r = reduce(s, { type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 1200 }, ctx())
    expect(types(r.effects)).toEqual(['saveAttempt', 'saveMastery', 'saveSession'])
    const attempt = r.effects[0]
    if (attempt.type !== 'saveAttempt') throw new Error('副作用顺序错')
    expect(attempt.attempt).toMatchObject({ day: 0, sessionNo: 0, correct: true, latencyMs: 1200, at: '2026-10-13T08:00:00.000Z' })
    expect(attempt.attempt.spec).toEqual(s.current!.spec)
    const mastery = r.effects[1]
    if (mastery.type !== 'saveMastery') throw new Error('副作用顺序错')
    expect(mastery.key).toBe(masteryKey(s.current!.spec.kpId, s.current!.spec.modality))
    expect(mastery.state.window).toHaveLength(1)
    expect(r.state.progress).toEqual({ attempted: 1, correct: 1 })
    expect(r.state.byTrack[s.current!.spec.track]).toBe(1)
    expect(r.state.ladders[mastery.key]).toBeDefined()
  })

  it('答错的实时规格进入 wrongThisSession', () => {
    const s = atFirstScored()
    const ans = s.current!.exercise.answer
    const wrong =
      ans.kind === 'choice' ? { kind: 'choice' as const, id: '__wrong__' }
      : ans.kind === 'sequence' ? { kind: 'sequence' as const, ids: [] }
      : ans.kind === 'pitch' ? { kind: 'pitch' as const, selfAssessedCorrect: false }
      : { kind: 'tap' as const, tapsSec: [] }
    const r = reduce(s, { type: 'answer', response: wrong, latencyMs: 800 }, ctx())
    expect(r.state.lastGrade?.correct).toBe(false)
    expect(r.state.wrongThisSession).toEqual([s.current!.spec])
  })
})

describe('中断', () => {
  it('answering 时中断：停播，不写任何东西，回到 idle，index 不变；恢复后重出同一道题', () => {
    const r1 = reduce(freshSession(), { type: 'start' }, ctx())
    const s1 = reduce(r1.state, { type: 'contentPlayed' }, ctx()).state
    const r2 = reduce(s1, { type: 'interrupted' }, ctx())
    expect(types(r2.effects)).toEqual(['stopAudio'])
    expect(r2.state.phase).toBe('idle')
    expect(r2.state.current).toBeNull()
    expect(r2.state.index).toBe(s1.index)
    const r3 = reduce(r2.state, { type: 'start' }, ctx())
    expect(r3.state.current?.exercise).toEqual(r1.state.current?.exercise)
  })

  it('feedback 或 idle 时中断：无事发生', () => {
    const s = freshSession()
    expect(reduce(s, { type: 'interrupted' }, ctx()).effects).toEqual([])
  })
})

describe('记录与续起', () => {
  it('toRecord / resumeSession 往返保留进度；续起后处于 idle', () => {
    let s = reduce(freshSession(), { type: 'start' }, ctx()).state
    s = reduce(s, { type: 'contentPlayed' }, ctx()).state
    s = reduce(s, { type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 1 }, ctx()).state
    const record = toRecord(s)
    expect(record.completed).toBe(false)
    const resumed = resumeSession(record)
    expect(resumed.index).toBe(s.index)
    expect(resumed.progress).toEqual(s.progress)
    expect(resumed.phase).toBe('idle')
    expect(resumed.current).toBeNull()
  })
})

describe('出题抛错不让会话崩掉', () => {
  it('未知知识点：发 itemError，跳到下一道', () => {
    const s0 = freshSession()
    const broken = {
      ...s0,
      plan: { ...s0.plan, items: [{ ...s0.plan.items[0], kpId: 'degree:major:nope', segment: 'focus' as const }, ...s0.plan.items.slice(1)] },
    }
    const r = reduce(broken, { type: 'start' }, ctx())
    expect(types(r.effects)).toEqual(['itemError', 'play'])
    expect(r.state.current?.planIndex).toBe(1)
  })
})

describe('计划用完', () => {
  it('空计划：start 后直接结束，写会话完成并发 ended', () => {
    const s0 = { ...freshSession(), plan: { ...freshSession().plan, items: [] } }
    const r = reduce(s0, { type: 'start' }, ctx())
    expect(r.state.phase).toBe('done')
    expect(types(r.effects)).toContain('ended')
    const save = r.effects.find((e) => e.type === 'saveSession')
    if (!save || save.type !== 'saveSession') throw new Error('缺 saveSession')
    expect(save.record.completed).toBe(true)
  })
})
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `npx vitest run src/session/machine.test.ts`
Expected: FAIL —— 无法解析模块 `./machine`

- [ ] **Step 4: 写实现**

`src/session/machine.ts`：

```ts
import { masteryKey, type Track } from '../curriculum/knowledgePoints'
import type { PhaseId } from '../curriculum/stages'
import { generate, grade } from '../exercises/generate'
import type { SessionPlan } from '../scheduling/scheduler'
import { prepareItem, recordAnswer } from './item'
import type {
  CurrentItem,
  ReduceContext,
  ReduceResult,
  SessionEffect,
  SessionEvent,
  SessionMode,
  SessionRecord,
  SessionState,
  SessionSummary,
} from './types'

const zeroByTrack = (): Record<Track, number> => ({ T: 0, H: 0, R: 0 })

export function createSession(input: {
  mode: SessionMode
  day: number
  sessionNo: number
  phaseId: PhaseId
  plan: SessionPlan
}): SessionState {
  return {
    ...input,
    index: 0,
    ladders: {},
    progress: { attempted: 0, correct: 0 },
    boss: { attempted: 0, correct: 0 },
    byTrack: zeroByTrack(),
    reliefTriggered: false,
    phase: 'idle',
    current: null,
    lastGrade: null,
    wrongThisSession: [],
    summary: null,
  }
}

/** 从会话记录续起。阶梯不落盘：续起后由掌握度窗口推导（P-3 spec §4.1） */
export function resumeSession(record: SessionRecord): SessionState {
  return {
    ...createSession({ mode: 'session', day: record.day, sessionNo: record.sessionNo, phaseId: record.phaseId, plan: record.plan }),
    index: record.index,
    progress: { ...record.progress },
    boss: { ...record.boss },
    byTrack: { ...record.byTrack },
    reliefTriggered: record.reliefTriggered,
  }
}

export function toRecord(state: SessionState): SessionRecord {
  return {
    day: state.day,
    sessionNo: state.sessionNo,
    phaseId: state.phaseId,
    plan: state.plan,
    index: state.index,
    progress: { ...state.progress },
    boss: { ...state.boss },
    byTrack: { ...state.byTrack },
    reliefTriggered: state.reliefTriggered,
    completed: state.phase === 'done',
  }
}

const persists = (state: SessionState) => state.mode === 'session'

/** 出第 index 道计划题；出题抛错则发 itemError 并跳到下一道；计划用完则结束 */
function present(state: SessionState, ctx: ReduceContext, effects: SessionEffect[]): ReduceResult {
  let s = state
  while (s.index < s.plan.items.length) {
    const planned = s.plan.items[s.index]
    const scored = s.mode === 'session' && planned.segment !== 'warmup'
    let current: CurrentItem
    let reliefTriggered = s.reliefTriggered
    try {
      if (scored) {
        const key = masteryKey(planned.kpId, planned.modality)
        const prepared = prepareItem(planned, s.ladders[key], ctx.mastery, s.progress)
        reliefTriggered = reliefTriggered || prepared.relief
        current = { planIndex: s.index, spec: prepared.spec, exercise: generate(prepared.spec, ctx.curriculum), scored, ladder: prepared.ladder }
      } else {
        // 热身题与重练题：规格原样出题，不碰阶梯
        current = { planIndex: s.index, spec: planned, exercise: generate(planned, ctx.curriculum), scored: false, ladder: null }
      }
    } catch (e) {
      effects.push({ type: 'itemError', spec: planned, message: (e as Error).message })
      s = { ...s, index: s.index + 1 }
      continue
    }
    return {
      state: { ...s, reliefTriggered, phase: 'presenting', current, lastGrade: null },
      effects: [...effects, { type: 'play', plan: current.exercise.plan }],
    }
  }
  return finish(s, ctx, effects, true)
}

/** 结束流程。Task 5 补全跨天护栏、关卡与升阶段 */
function finish(state: SessionState, _ctx: ReduceContext, effects: SessionEffect[], _full: boolean): ReduceResult {
  const summary = baseSummary(state)
  const done: SessionState = { ...state, phase: 'done', current: null, summary }
  const out = [...effects]
  if (persists(state)) out.push({ type: 'saveSession', record: toRecord(done) })
  out.push({ type: 'ended', summary })
  return { state: done, effects: out }
}

function baseSummary(state: SessionState): SessionSummary {
  const { attempted, correct } = state.progress
  return {
    scored: attempted,
    correct,
    accuracy: attempted > 0 ? correct / attempted : 0,
    byTrack: { ...state.byTrack },
    reliefTriggered: state.reliefTriggered,
    gate: { evaluated: false, passed: false, blockingKeys: 0, bossSatisfied: false, advancedTo: null },
  }
}

function answer(
  state: SessionState,
  event: Extract<SessionEvent, { type: 'answer' }>,
  ctx: ReduceContext,
): ReduceResult {
  const cur = state.current
  if (state.phase !== 'answering' || !cur) return { state, effects: [] }
  const result = grade(cur.exercise, event.response)
  let s: SessionState = { ...state, index: state.index + 1, phase: 'feedback', lastGrade: result }
  const effects: SessionEffect[] = []

  if (cur.scored && cur.ladder) {
    const recorded = recordAnswer({
      curriculum: ctx.curriculum,
      phaseId: s.phaseId,
      day: s.day,
      mastery: ctx.mastery,
      spec: cur.spec,
      ladder: cur.ladder,
      correct: result.correct,
    })
    const isBoss = cur.spec.segment === 'boss'
    s = {
      ...s,
      ladders: { ...s.ladders, [recorded.key]: recorded.ladder },
      progress: { attempted: s.progress.attempted + 1, correct: s.progress.correct + (result.correct ? 1 : 0) },
      boss: isBoss ? { attempted: s.boss.attempted + 1, correct: s.boss.correct + (result.correct ? 1 : 0) } : s.boss,
      byTrack: { ...s.byTrack, [cur.spec.track]: s.byTrack[cur.spec.track] + 1 },
      wrongThisSession: result.correct ? s.wrongThisSession : [...s.wrongThisSession, cur.spec],
    }
    effects.push({
      type: 'saveAttempt',
      attempt: {
        at: ctx.nowIso,
        day: s.day,
        sessionNo: s.sessionNo,
        kpId: cur.spec.kpId,
        modality: cur.spec.modality,
        spec: cur.spec,
        correct: result.correct,
        latencyMs: event.latencyMs,
        detail: result.detail,
      },
    })
    effects.push({ type: 'saveMastery', key: recorded.key, state: recorded.state })
  }
  if (persists(s)) effects.push({ type: 'saveSession', record: toRecord(s) })
  return { state: s, effects }
}

export function reduce(state: SessionState, event: SessionEvent, ctx: ReduceContext): ReduceResult {
  switch (event.type) {
    case 'start':
    case 'next':
      if (state.phase !== 'idle' && state.phase !== 'feedback') return { state, effects: [] }
      return present(state, ctx, [])
    case 'contentPlayed':
      if (state.phase !== 'presenting') return { state, effects: [] }
      return { state: { ...state, phase: 'answering' }, effects: [] }
    case 'answer':
      return answer(state, event, ctx)
    case 'interrupted':
      // 当前题作废：不写作答、不改阶梯与计数；index 未动，恢复后重出同一道（主 spec §11）
      if (state.phase !== 'presenting' && state.phase !== 'answering') return { state, effects: [] }
      return { state: { ...state, phase: 'idle', current: null }, effects: [{ type: 'stopAudio' }] }
    case 'endEarly':
      if (state.phase === 'done') return { state, effects: [] }
      return finish(state, ctx, state.phase === 'presenting' || state.phase === 'answering' ? [{ type: 'stopAudio' }] : [], false)
  }
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `npx vitest run src/session/ && npx tsc --noEmit`
Expected: PASS；tsc 无输出

- [ ] **Step 6: 提交**

```bash
git add src/session/types.ts src/session/machine.ts src/session/machine.test.ts
git commit -m "feat(session): 会话状态机——出题、作答、中断、续起" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 结束流程——跨天护栏、实战关替身、关卡与升阶段

**Files:**
- Modify: `src/session/machine.ts`（`finish` 补全；新增 `bossPassed`）
- Test: `src/session/finish.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `stagnationUpdates`；`evaluateGate`/`nextPhase`（scheduling/gate）；`BOSS_STANDIN_ACCURACY`
- Produces:
  - `export function bossPassed(boss: Tally): boolean`（`attempted > 0 && correct / attempted >= BOSS_STANDIN_ACCURACY`）
  - `finish` 行为：会话模式下——①对 `stagnationUpdates` 的每项发 `saveMastery`；②完整结束（计划用完）时用「合并了护栏结果的掌握度」评估关卡，`bossPassed` 作实战关入参；过关且有下一阶段时发 `advancePhase`；③总结里填 `gate`；④`saveSession`（completed）与 `ended`。`endEarly` 做①③④，`gate.evaluated = false`。重练模式只发 `ended`。

- [ ] **Step 1: 写失败的测试**

`src/session/finish.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum, knowledgePointsOfPhase } from '../curriculum/curriculum'
import { MODALITIES, masteryKey } from '../curriculum/knowledgePoints'
import { initialMastery, type MasteryState } from '../scheduling/mastery'
import { bossPassed, createSession, reduce } from './machine'
import type { ReduceContext, SessionEffect, SessionState } from './types'

const c = buildCurriculum()
const ctx = (mastery: Map<string, MasteryState>): ReduceContext => ({ curriculum: c, mastery, nowIso: 'x' })
const emptyPlanSession = (overrides: Partial<SessionState> = {}): SessionState => ({
  ...createSession({ mode: 'session', day: 30, sessionNo: 0, phaseId: 'P1', plan: { day: 30, seed: 1, phaseId: 'P1', items: [] } }),
  ...overrides,
})
const strong = (): MasteryState => ({
  ...initialMastery(),
  stability: 20,
  contextLevel: 1,
  variationLevel: 1,
  window: Array.from({ length: 20 }, (_, i) => ({ correct: true, day: 10 + i, difficultyStep: 3 })),
  lastSeenDay: 29,
})
const allP1Strong = () => {
  const m = new Map<string, MasteryState>()
  for (const kp of knowledgePointsOfPhase(c, 'P1')) for (const mod of MODALITIES) m.set(masteryKey(kp, mod), strong())
  return m
}
const find = <T extends SessionEffect['type']>(effects: SessionEffect[], type: T) =>
  effects.filter((e): e is Extract<SessionEffect, { type: T }> => e.type === type)

describe('bossPassed（P-3 spec D3）', () => {
  it('至少答过 1 题且正确率 ≥ 0.8', () => {
    expect(bossPassed({ attempted: 0, correct: 0 })).toBe(false)
    expect(bossPassed({ attempted: 5, correct: 4 })).toBe(true)
    expect(bossPassed({ attempted: 5, correct: 3 })).toBe(false)
  })
})

describe('结束流程', () => {
  it('掌握度全部达标 + 实战关替身通过：发 advancePhase P1 → P2，总结记录升阶段', () => {
    const r = reduce(emptyPlanSession({ boss: { attempted: 5, correct: 5 } }), { type: 'start' }, ctx(allP1Strong()))
    expect(find(r.effects, 'advancePhase')).toEqual([{ type: 'advancePhase', from: 'P1', to: 'P2', day: 30 }])
    expect(r.state.summary?.gate).toMatchObject({ evaluated: true, passed: true, blockingKeys: 0, bossSatisfied: true, advancedTo: 'P2' })
  })

  it('实战关替身未通过：不升阶段', () => {
    const r = reduce(emptyPlanSession({ boss: { attempted: 5, correct: 3 } }), { type: 'start' }, ctx(allP1Strong()))
    expect(find(r.effects, 'advancePhase')).toEqual([])
    expect(r.state.summary?.gate).toMatchObject({ evaluated: true, passed: false, bossSatisfied: false })
  })

  it('掌握度不足：列出阻塞的 key 数', () => {
    const r = reduce(emptyPlanSession({ boss: { attempted: 5, correct: 5 } }), { type: 'start' }, ctx(new Map()))
    expect(r.state.summary?.gate.blockingKeys).toBe(knowledgePointsOfPhase(c, 'P1').length * 3)
  })

  it('跨天护栏：停滞的 key 发 saveMastery（拆解后的状态），并且关卡评估用的是拆解后的状态', () => {
    const m = allP1Strong()
    const k = masteryKey('degree:major:do', 'recognize')
    m.set(k, {
      ...strong(),
      window: Array.from({ length: 8 }, (_, i) => ({ correct: false, day: 28 + (i % 3), difficultyStep: 3 })),
      lastSeenDay: 30,
    })
    const r = reduce(emptyPlanSession({ boss: { attempted: 5, correct: 5 } }), { type: 'start' }, ctx(m))
    const saves = find(r.effects, 'saveMastery')
    expect(saves.map((s) => s.key)).toContain(k)
    expect(saves.find((s) => s.key === k)!.state.contextLevel).toBe(0)
  })

  it('endEarly：做护栏与总结，不评估关卡、不升阶段；会话记为完成', () => {
    const r = reduce(emptyPlanSession({ boss: { attempted: 5, correct: 5 }, index: 0, plan: { day: 30, seed: 1, phaseId: 'P1', items: [] } }), { type: 'endEarly' }, ctx(allP1Strong()))
    expect(find(r.effects, 'advancePhase')).toEqual([])
    expect(r.state.summary?.gate.evaluated).toBe(false)
    expect(find(r.effects, 'saveSession')[0].record.completed).toBe(true)
  })

  it('最后一阶段过关：不发 advancePhase', () => {
    const s = emptyPlanSession({ phaseId: 'P5', boss: { attempted: 5, correct: 5 }, plan: { day: 30, seed: 1, phaseId: 'P5', items: [] } })
    const m = new Map<string, MasteryState>()
    for (const kp of knowledgePointsOfPhase(c, 'P5')) for (const mod of MODALITIES) m.set(masteryKey(kp, mod), { ...strong(), stability: 40 })
    const r = reduce(s, { type: 'start' }, ctx(m))
    expect(find(r.effects, 'advancePhase')).toEqual([])
  })

  it('副作用顺序：saveMastery（护栏）→ advancePhase → saveSession → ended', () => {
    const r = reduce(emptyPlanSession({ boss: { attempted: 5, correct: 5 } }), { type: 'start' }, ctx(allP1Strong()))
    const order = r.effects.map((e) => e.type).filter((t) => t !== 'saveMastery')
    expect(order).toEqual(['advancePhase', 'saveSession', 'ended'])
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/session/finish.test.ts`
Expected: FAIL —— `bossPassed` 不是导出成员；关卡未评估

- [ ] **Step 3: 写实现**

在 `src/session/machine.ts` 顶部 import 加入：

```ts
import { evaluateGate, nextPhase } from '../scheduling/gate'
import type { MasteryKey } from '../curriculum/knowledgePoints'
import type { MasteryState } from '../scheduling/mastery'
import { stagnationUpdates } from './item'
import { BOSS_STANDIN_ACCURACY, type Tally } from './types'
```

（与已有的 import 合并；`stagnationUpdates` 与 `prepareItem`、`recordAnswer` 同源。）

新增：

```ts
/** 实战关替身（P-3 spec D3）：本场实战关段至少答过 1 题，且正确率达标 */
export function bossPassed(boss: Tally): boolean {
  return boss.attempted > 0 && boss.correct / boss.attempted >= BOSS_STANDIN_ACCURACY
}
```

把 `finish` 替换为：

```ts
/**
 * 结束流程（P-3 spec §3.7）。
 * full = 计划用完；endEarly 时为 false——不完整的会话不评估关卡、不升阶段。
 */
function finish(state: SessionState, ctx: ReduceContext, effects: SessionEffect[], full: boolean): ReduceResult {
  const out = [...effects]
  const summary = baseSummary(state)

  if (persists(state)) {
    // ① 跨天护栏：停滞的 key 拆解后写回；关卡评估用合并后的掌握度
    const merged = new Map<MasteryKey, MasteryState>(ctx.mastery)
    for (const u of stagnationUpdates(ctx.curriculum, state.phaseId, state.day, ctx.mastery)) {
      merged.set(u.key, u.state)
      out.push({ type: 'saveMastery', key: u.key, state: u.state })
    }

    // ② 关卡：三模态齐平 + 实战关替身
    if (full) {
      const boss = bossPassed(state.boss)
      const gate = evaluateGate(ctx.curriculum, merged, state.phaseId, boss)
      const to = gate.passed ? nextPhase(state.phaseId) : null
      if (to) out.push({ type: 'advancePhase', from: state.phaseId, to, day: state.day })
      summary.gate = {
        evaluated: true,
        passed: gate.passed,
        blockingKeys: gate.blockingKeys.length,
        bossSatisfied: gate.bossSatisfied,
        advancedTo: to,
      }
    }
  }

  const done: SessionState = { ...state, phase: 'done', current: null, summary }
  if (persists(state)) out.push({ type: 'saveSession', record: toRecord(done) })
  out.push({ type: 'ended', summary })
  return { state: done, effects: out }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/session/ && npx tsc --noEmit`
Expected: PASS；tsc 无输出

- [ ] **Step 5: 提交**

```bash
git add src/session/machine.ts src/session/finish.test.ts
git commit -m "feat(session): 结束流程——跨天护栏、实战关替身、关卡与升阶段" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 重练小会话与加练

**Files:**
- Modify: `src/session/machine.ts`（新增 `createDrill`、`DRILL_SEED_SALT`）
- Test: `src/session/drill.test.ts`

**Interfaces:**
- Consumes: Task 4/5 的 `createSession`、`reduce`
- Produces:
  - `export const DRILL_SEED_SALT = 0x9e3779b9`
  - `export function createDrill(from: SessionState): SessionState | null` —— 用 `from.wrongThisSession` 的实时规格组成计划（`seed` 换成 `(spec.seed ^ DRILL_SEED_SALT) >>> 0`，`segment` 保持原样）；`mode: 'drill'`；没有错题时返回 `null`
- 加练不需要新函数：壳层以 `sessionNo + 1` 调 `createSession` 即可（Task 9）。本任务用一条测试钉住「加练会话的 sessionNo 进入作答记录与会话记录」。

- [ ] **Step 1: 写失败的测试**

`src/session/drill.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { answerAsResponse } from '../exercises/generate'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'
import { buildSessionPlan } from '../scheduling/scheduler'
import { DRILL_SEED_SALT, createDrill, createSession, reduce } from './machine'
import type { ReduceContext, SessionState } from './types'

const c = buildCurriculum()
const ctx: ReduceContext = { curriculum: c, mastery: new Map(), nowIso: 'x' }
const wrongSpec: ExerciseSpec = {
  kpId: 'degree:major:mi', modality: 'recognize', track: 'T', contextLevel: 1, variationLevel: 1, difficultyStep: 2, seed: 123, segment: 'focus',
}
const base = (): SessionState =>
  createSession({ mode: 'session', day: 3, sessionNo: 0, phaseId: 'P1', plan: { day: 3, seed: 9, phaseId: 'P1', items: [] } })

describe('createDrill（主 spec §6.5）', () => {
  it('没有错题时返回 null', () => {
    expect(createDrill(base())).toBeNull()
  })

  it('用错题的实时规格出题，seed 换新，档位与难度保持', () => {
    const d = createDrill({ ...base(), wrongThisSession: [wrongSpec] })!
    expect(d.mode).toBe('drill')
    expect(d.plan.items).toEqual([{ ...wrongSpec, seed: (123 ^ DRILL_SEED_SALT) >>> 0 }])
  })

  it('重练不产生任何持久化副作用：只有 play、无 saveAttempt / saveMastery / saveSession，结束只发 ended', () => {
    let s = createDrill({ ...base(), wrongThisSession: [wrongSpec] })!
    const seen: string[] = []
    let r = reduce(s, { type: 'start' }, ctx)
    seen.push(...r.effects.map((e) => e.type))
    s = reduce(r.state, { type: 'contentPlayed' }, ctx).state
    r = reduce(s, { type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 1 }, ctx)
    seen.push(...r.effects.map((e) => e.type))
    r = reduce(r.state, { type: 'next' }, ctx)
    seen.push(...r.effects.map((e) => e.type))
    expect(seen).toEqual(['play', 'ended'])
    expect(r.state.phase).toBe('done')
  })
})

describe('加练', () => {
  it('sessionNo 进入作答记录与会话记录', () => {
    const plan = buildSessionPlan({ curriculum: c, store: new Map(), phaseId: 'P1', today: 3, seed: 77, minutes: 25 })
    let s = createSession({ mode: 'session', day: 3, sessionNo: 1, phaseId: 'P1', plan })
    s = reduce(s, { type: 'start' }, ctx).state
    while (!s.current!.scored) {
      s = reduce(s, { type: 'contentPlayed' }, ctx).state
      s = reduce(s, { type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 1 }, ctx).state
      s = reduce(s, { type: 'next' }, ctx).state
    }
    s = reduce(s, { type: 'contentPlayed' }, ctx).state
    const r = reduce(s, { type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 1 }, ctx)
    for (const e of r.effects) {
      if (e.type === 'saveAttempt') expect(e.attempt.sessionNo).toBe(1)
      if (e.type === 'saveSession') expect(e.record.sessionNo).toBe(1)
    }
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/session/drill.test.ts`
Expected: FAIL —— `createDrill` / `DRILL_SEED_SALT` 不是导出成员

- [ ] **Step 3: 写实现**

在 `src/session/machine.ts` 末尾追加：

```ts
/** 重练换新 seed：同一规格、不同题面 */
export const DRILL_SEED_SALT = 0x9e3779b9

/**
 * 重练刚才错的这组（主 spec §6.5）：不写作答、不写掌握度、不动阶梯，只做即时巩固。
 * 计划由本场错题的实时规格组成；没有错题时返回 null。
 */
export function createDrill(from: SessionState): SessionState | null {
  if (from.wrongThisSession.length === 0) return null
  const items = from.wrongThisSession.map((spec) => ({ ...spec, seed: (spec.seed ^ DRILL_SEED_SALT) >>> 0 }))
  return createSession({
    mode: 'drill',
    day: from.day,
    sessionNo: from.sessionNo,
    phaseId: from.phaseId,
    plan: { day: from.day, seed: from.plan.seed, phaseId: from.phaseId, items },
  })
}
```

（`present` 已按 `s.mode === 'session'` 决定是否计分；`answer` 与 `finish` 已按 `persists` 关闭持久化副作用。若测试显示仍有持久化副作用泄漏，修正那两处判定，不改测试。）

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/session/ && npx tsc --noEmit`
Expected: PASS；tsc 无输出

- [ ] **Step 5: 提交**

```bash
git add src/session/machine.ts src/session/drill.test.ts
git commit -m "feat(session): 重练小会话与加练" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 存储接口、内存实现、归档、导出导入与契约测试

**Files:**
- Create: `src/storage/types.ts`、`src/storage/archive.ts`、`src/storage/bundle.ts`、`src/storage/memory.ts`、`src/storage/contract.ts`
- Test: `src/storage/archive.test.ts`、`src/storage/bundle.test.ts`、`src/storage/memory.test.ts`

**Interfaces:**
- Consumes: `AttemptRecord`/`SessionRecord`（session/types）、`MasteryKey`/`masteryKey`、`MasteryState`、`PhaseId`、`DisplayScheme`（music/display）
- Produces（`types.ts`）：
  - `SCHEMA_VERSION = 1`、`ATTEMPT_CAP = 50_000`
  - `interface Profile { id: string; createdAtLocalDate: string; phaseId: PhaseId; displayScheme: DisplayScheme; placement: { done: boolean; startPhase: PhaseId | null }; schemaVersion: number }`
  - `interface GateRecord { phaseId: PhaseId; passedOnDay: number }`
  - `interface AttemptAggregate { key: MasteryKey; attempts: number; correct: number }`
  - `interface ExportBundle { schemaVersion: number; exportedAt: string; profile: Profile | null; mastery: [MasteryKey, MasteryState][]; attempts: AttemptRecord[]; attemptAggregates: AttemptAggregate[]; sessions: SessionRecord[]; gates: GateRecord[] }`
  - `interface Repository`（P-3 spec §4.2 全部方法，`exportAll(exportedAt: string)` 接收时间戳）
  - `class StorageCorruptError extends Error { constructor(message: string, readonly rawDump: string) }`
  - `class StorageImportError extends Error {}`
- Produces（`archive.ts`）：`export function archiveOverflow(attempts: readonly AttemptRecord[], aggregates: readonly AttemptAggregate[], cap: number): { attempts: AttemptRecord[]; aggregates: AttemptAggregate[] }`
- Produces（`bundle.ts`）：`export const MIGRATIONS: Record<number, (b: ExportBundle) => ExportBundle>`（v1 时为空表）；`export function parseBundle(json: string): ExportBundle`（校验 + 迁移，失败抛 `StorageImportError`）
- Produces（`memory.ts`）：`export class MemoryRepository implements Repository`，构造参数 `{ attemptCap?: number }`
- Produces（`contract.ts`）：`export function repositoryContract(name: string, make: (opts: { attemptCap?: number }) => Promise<Repository>): void`（在调用方的测试文件里注册一组 `describe`/`it`）

- [ ] **Step 1: 写类型与纯函数的失败测试**

`src/storage/archive.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import type { AttemptRecord } from '../session/types'
import { archiveOverflow } from './archive'

const attempt = (kpId: string, correct: boolean, i: number): AttemptRecord => ({
  at: `t${i}`, day: i, sessionNo: 0, kpId, modality: 'recognize',
  spec: { kpId, modality: 'recognize', track: 'T', contextLevel: 0, variationLevel: 0, difficultyStep: 0, seed: i, segment: 'focus' },
  correct, latencyMs: 1, detail: { kind: 'choice' },
})

describe('archiveOverflow（主 spec §10.2）', () => {
  it('未超出上限：原样返回', () => {
    const a = [attempt('degree:major:do', true, 0)]
    expect(archiveOverflow(a, [], 5)).toEqual({ attempts: a, aggregates: [] })
  })

  it('超出部分（最旧的）按 MasteryKey 聚合后删除，保留最新的 cap 条', () => {
    const a = [
      attempt('degree:major:do', true, 0),
      attempt('degree:major:do', false, 1),
      attempt('degree:major:mi', true, 2),
      attempt('degree:major:do', true, 3),
    ]
    const r = archiveOverflow(a, [{ key: 'degree:major:do|recognize', attempts: 10, correct: 7 }], 1)
    expect(r.attempts).toEqual([a[3]])
    expect(r.aggregates.sort((x, y) => x.key.localeCompare(y.key))).toEqual([
      { key: 'degree:major:do|recognize', attempts: 12, correct: 8 },
      { key: 'degree:major:mi|recognize', attempts: 1, correct: 1 },
    ])
  })
})
```

> 注意：`MasteryKey` 的字符串格式以 `masteryKey(kpId, modality)` 为准。实现中一律调用 `masteryKey`，测试里的期望值也改用 `masteryKey('degree:major:do', 'recognize')` 计算（若它的格式不是 `kpId|modality`，按实际格式写）。

`src/storage/bundle.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, StorageImportError, type ExportBundle } from './types'
import { parseBundle } from './bundle'

const valid = (): ExportBundle => ({
  schemaVersion: SCHEMA_VERSION,
  exportedAt: '2026-10-13T00:00:00.000Z',
  profile: { id: 'p', createdAtLocalDate: '2026-10-13', phaseId: 'P1', displayScheme: 'solfege', placement: { done: false, startPhase: null }, schemaVersion: SCHEMA_VERSION },
  mastery: [],
  attempts: [],
  attemptAggregates: [],
  sessions: [],
  gates: [],
})

describe('parseBundle', () => {
  it('合法导出包往返', () => {
    expect(parseBundle(JSON.stringify(valid()))).toEqual(valid())
  })
  it('不是 JSON / 缺字段 / 字段类型错：抛 StorageImportError', () => {
    expect(() => parseBundle('nope')).toThrow(StorageImportError)
    const { attempts: _a, ...missing } = valid()
    expect(() => parseBundle(JSON.stringify(missing))).toThrow(StorageImportError)
    expect(() => parseBundle(JSON.stringify({ ...valid(), mastery: 'x' }))).toThrow(StorageImportError)
  })
  it('版本高于本程序：抛 StorageImportError', () => {
    expect(() => parseBundle(JSON.stringify({ ...valid(), schemaVersion: SCHEMA_VERSION + 1 }))).toThrow(/版本/)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/storage/`
Expected: FAIL —— 无法解析模块

- [ ] **Step 3: 写类型、归档与导出包**

`src/storage/types.ts`：

```ts
import type { MasteryKey } from '../curriculum/knowledgePoints'
import type { PhaseId } from '../curriculum/stages'
import type { DisplayScheme } from '../music/display'
import type { MasteryState } from '../scheduling/mastery'
import type { AttemptRecord, SessionRecord } from '../session/types'

export const SCHEMA_VERSION = 1
/** 作答全量留存上限（主 spec §10.2） */
export const ATTEMPT_CAP = 50_000

export interface Profile {
  id: string
  /** 'YYYY-MM-DD'，本地日历日 */
  createdAtLocalDate: string
  phaseId: PhaseId
  displayScheme: DisplayScheme
  placement: { done: boolean; startPhase: PhaseId | null }
  schemaVersion: number
}

export interface GateRecord {
  phaseId: PhaseId
  passedOnDay: number
}

export interface AttemptAggregate {
  key: MasteryKey
  attempts: number
  correct: number
}

export interface ExportBundle {
  schemaVersion: number
  exportedAt: string
  profile: Profile | null
  mastery: [MasteryKey, MasteryState][]
  attempts: AttemptRecord[]
  attemptAggregates: AttemptAggregate[]
  sessions: SessionRecord[]
  gates: GateRecord[]
}

export interface Repository {
  loadProfile(): Promise<Profile | null>
  saveProfile(p: Profile): Promise<void>
  loadMastery(): Promise<Map<MasteryKey, MasteryState>>
  putMastery(key: MasteryKey, s: MasteryState): Promise<void>
  appendAttempt(a: AttemptRecord): Promise<void>
  countAttempts(): Promise<number>
  loadSession(day: number, sessionNo: number): Promise<SessionRecord | null>
  latestSessionNo(day: number): Promise<number | null>
  putSession(r: SessionRecord): Promise<void>
  putGate(g: GateRecord): Promise<void>
  exportAll(exportedAt: string): Promise<ExportBundle>
  /** 先校验与迁移再整体替换；任何一步失败都不改现有数据 */
  importAll(bundle: ExportBundle): Promise<void>
}

/** 数据损坏：带一份尽力读出的原始数据，供用户先下载再重建（主 spec §10.3） */
export class StorageCorruptError extends Error {
  constructor(message: string, readonly rawDump: string) {
    super(message)
    this.name = 'StorageCorruptError'
  }
}

export class StorageImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageImportError'
  }
}
```

`src/storage/archive.ts`：

```ts
import { masteryKey, type MasteryKey } from '../curriculum/knowledgePoints'
import type { AttemptRecord } from '../session/types'
import type { AttemptAggregate } from './types'

/**
 * 作答归档（主 spec §10.2）：超出 cap 的最旧部分按 MasteryKey 聚合进计数后删除。
 * 聚合表永久保留。纯函数，不修改输入。
 */
export function archiveOverflow(
  attempts: readonly AttemptRecord[],
  aggregates: readonly AttemptAggregate[],
  cap: number,
): { attempts: AttemptRecord[]; aggregates: AttemptAggregate[] } {
  if (attempts.length <= cap) return { attempts: [...attempts], aggregates: [...aggregates] }
  const overflow = attempts.slice(0, attempts.length - cap)
  const byKey = new Map<MasteryKey, AttemptAggregate>(aggregates.map((a) => [a.key, { ...a }]))
  for (const a of overflow) {
    const key = masteryKey(a.kpId, a.modality)
    const agg = byKey.get(key) ?? { key, attempts: 0, correct: 0 }
    agg.attempts++
    if (a.correct) agg.correct++
    byKey.set(key, agg)
  }
  return { attempts: attempts.slice(attempts.length - cap), aggregates: [...byKey.values()] }
}
```

`src/storage/bundle.ts`：

```ts
import { SCHEMA_VERSION, StorageImportError, type ExportBundle } from './types'

/** 迁移表：MIGRATIONS[v] 把 v 版导出包升到 v+1。v1 时为空 */
export const MIGRATIONS: Record<number, (b: ExportBundle) => ExportBundle> = {}

const isArray = (x: unknown): x is unknown[] => Array.isArray(x)
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** 校验 + 迁移。失败一律抛 StorageImportError，不产生部分结果 */
export function parseBundle(json: string): ExportBundle {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new StorageImportError('不是合法的 JSON 文件')
  }
  if (!isObj(raw)) throw new StorageImportError('导出包结构不对')
  const v = raw.schemaVersion
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new StorageImportError('导出包缺少版本号')
  if (v > SCHEMA_VERSION) throw new StorageImportError(`导出包版本 ${v} 高于本程序支持的 ${SCHEMA_VERSION}`)
  for (const field of ['mastery', 'attempts', 'attemptAggregates', 'sessions', 'gates'] as const) {
    if (!isArray(raw[field])) throw new StorageImportError(`导出包字段 ${field} 缺失或类型错误`)
  }
  if (typeof raw.exportedAt !== 'string') throw new StorageImportError('导出包缺少 exportedAt')
  if (raw.profile !== null && !isObj(raw.profile)) throw new StorageImportError('导出包 profile 类型错误')
  for (const pair of raw.mastery as unknown[]) {
    if (!isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !isObj(pair[1])) {
      throw new StorageImportError('导出包 mastery 条目结构不对')
    }
  }
  let bundle = raw as unknown as ExportBundle
  for (let ver = v; ver < SCHEMA_VERSION; ver++) {
    const step = MIGRATIONS[ver]
    if (!step) throw new StorageImportError(`缺少从版本 ${ver} 升级的迁移`)
    bundle = step(bundle)
  }
  return { ...bundle, schemaVersion: SCHEMA_VERSION }
}
```

Run: `npx vitest run src/storage/archive.test.ts src/storage/bundle.test.ts`
Expected: PASS

- [ ] **Step 4: 写契约测试套件与内存实现的失败测试**

`src/storage/contract.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { masteryKey } from '../curriculum/knowledgePoints'
import { initialMastery } from '../scheduling/mastery'
import type { AttemptRecord, SessionRecord } from '../session/types'
import { SCHEMA_VERSION, type Profile, type Repository } from './types'

const profile = (): Profile => ({
  id: 'p1', createdAtLocalDate: '2026-10-13', phaseId: 'P1', displayScheme: 'solfege',
  placement: { done: true, startPhase: 'P1' }, schemaVersion: SCHEMA_VERSION,
})
const attempt = (i: number, kpId = 'degree:major:do', correct = true): AttemptRecord => ({
  at: `2026-10-13T00:00:${String(i % 60).padStart(2, '0')}.000Z`, day: 0, sessionNo: 0, kpId, modality: 'recognize',
  spec: { kpId, modality: 'recognize', track: 'T', contextLevel: 0, variationLevel: 0, difficultyStep: 0, seed: i, segment: 'focus' },
  correct, latencyMs: 100, detail: { kind: 'choice' },
})
const session = (day: number, sessionNo: number, completed = false): SessionRecord => ({
  day, sessionNo, phaseId: 'P1', plan: { day, seed: 1, phaseId: 'P1', items: [] }, index: 3,
  progress: { attempted: 2, correct: 1 }, boss: { attempted: 0, correct: 0 }, byTrack: { T: 1, H: 1, R: 0 },
  reliefTriggered: false, completed,
})

/** 两个 Repository 实现共用的契约（P-3 spec §8） */
export function repositoryContract(
  name: string,
  make: (opts: { attemptCap?: number }) => Promise<Repository>,
): void {
  describe(`Repository 契约：${name}`, () => {
    it('空库：没有 Profile、掌握度为空、没有会话', async () => {
      const r = await make({})
      expect(await r.loadProfile()).toBeNull()
      expect((await r.loadMastery()).size).toBe(0)
      expect(await r.loadSession(0, 0)).toBeNull()
      expect(await r.latestSessionNo(0)).toBeNull()
      expect(await r.countAttempts()).toBe(0)
    })

    it('Profile、掌握度、会话读写往返', async () => {
      const r = await make({})
      await r.saveProfile(profile())
      expect(await r.loadProfile()).toEqual(profile())
      const k = masteryKey('degree:major:do', 'sing')
      const s = { ...initialMastery(), stability: 3.5 }
      await r.putMastery(k, s)
      expect((await r.loadMastery()).get(k)).toEqual(s)
      await r.putSession(session(2, 0))
      await r.putSession(session(2, 1, true))
      expect(await r.loadSession(2, 1)).toEqual(session(2, 1, true))
      expect(await r.latestSessionNo(2)).toBe(1)
      await r.putSession({ ...session(2, 0), index: 9 })
      expect((await r.loadSession(2, 0))?.index).toBe(9)
    })

    it('作答追加与计数；超出上限时最旧的归档为聚合', async () => {
      const r = await make({ attemptCap: 3 })
      for (let i = 0; i < 5; i++) await r.appendAttempt(attempt(i, 'degree:major:do', i % 2 === 0))
      expect(await r.countAttempts()).toBe(3)
      const b = await r.exportAll('x')
      expect(b.attempts.map((a) => a.spec.seed)).toEqual([2, 3, 4])
      expect(b.attemptAggregates).toEqual([{ key: masteryKey('degree:major:do', 'recognize'), attempts: 2, correct: 1 }])
    })

    it('导出 → 导入到新库：内容一致', async () => {
      const a = await make({})
      await a.saveProfile(profile())
      await a.putMastery(masteryKey('chord:I', 'recognize'), { ...initialMastery(), stability: 7 })
      await a.appendAttempt(attempt(1))
      await a.putSession(session(1, 0, true))
      await a.putGate({ phaseId: 'P1', passedOnDay: 40 })
      const bundle = await a.exportAll('2026-10-13T00:00:00.000Z')
      const b = await make({})
      await b.importAll(bundle)
      expect(await b.exportAll('2026-10-13T00:00:00.000Z')).toEqual(bundle)
    })

    it('导入整体替换旧数据', async () => {
      const a = await make({})
      await a.putMastery(masteryKey('degree:major:re', 'notate'), initialMastery())
      const empty = await (await make({})).exportAll('x')
      await a.importAll(empty)
      expect((await a.loadMastery()).size).toBe(0)
    })
  })
}
```

`src/storage/memory.test.ts`：

```ts
import { repositoryContract } from './contract'
import { MemoryRepository } from './memory'

repositoryContract('内存实现', async (opts) => new MemoryRepository(opts))
```

Run: `npx vitest run src/storage/memory.test.ts`
Expected: FAIL —— 无法解析模块 `./memory`

- [ ] **Step 5: 写内存实现**

`src/storage/memory.ts`：

```ts
import type { MasteryKey } from '../curriculum/knowledgePoints'
import type { MasteryState } from '../scheduling/mastery'
import type { AttemptRecord, SessionRecord } from '../session/types'
import { archiveOverflow } from './archive'
import {
  ATTEMPT_CAP,
  SCHEMA_VERSION,
  type AttemptAggregate,
  type ExportBundle,
  type GateRecord,
  type Profile,
  type Repository,
} from './types'

const clone = <T>(x: T): T => structuredClone(x)
const sessionKey = (day: number, sessionNo: number) => `${day}:${sessionNo}`

/** 内存实现：测试用，也是隐私模式下的降级（主 spec §12） */
export class MemoryRepository implements Repository {
  private profile: Profile | null = null
  private mastery = new Map<MasteryKey, MasteryState>()
  private attempts: AttemptRecord[] = []
  private aggregates: AttemptAggregate[] = []
  private sessions = new Map<string, SessionRecord>()
  private gates: GateRecord[] = []
  private readonly cap: number

  constructor(opts: { attemptCap?: number } = {}) {
    this.cap = opts.attemptCap ?? ATTEMPT_CAP
  }

  async loadProfile() {
    return this.profile ? clone(this.profile) : null
  }
  async saveProfile(p: Profile) {
    this.profile = clone(p)
  }
  async loadMastery() {
    return new Map([...this.mastery].map(([k, v]) => [k, clone(v)]))
  }
  async putMastery(key: MasteryKey, s: MasteryState) {
    this.mastery.set(key, clone(s))
  }
  async appendAttempt(a: AttemptRecord) {
    const r = archiveOverflow([...this.attempts, clone(a)], this.aggregates, this.cap)
    this.attempts = r.attempts
    this.aggregates = r.aggregates
  }
  async countAttempts() {
    return this.attempts.length
  }
  async loadSession(day: number, sessionNo: number) {
    const r = this.sessions.get(sessionKey(day, sessionNo))
    return r ? clone(r) : null
  }
  async latestSessionNo(day: number) {
    const nos = [...this.sessions.values()].filter((s) => s.day === day).map((s) => s.sessionNo)
    return nos.length > 0 ? Math.max(...nos) : null
  }
  async putSession(r: SessionRecord) {
    this.sessions.set(sessionKey(r.day, r.sessionNo), clone(r))
  }
  async putGate(g: GateRecord) {
    this.gates.push(clone(g))
  }
  async exportAll(exportedAt: string): Promise<ExportBundle> {
    return clone({
      schemaVersion: SCHEMA_VERSION,
      exportedAt,
      profile: this.profile,
      mastery: [...this.mastery.entries()],
      attempts: this.attempts,
      attemptAggregates: this.aggregates,
      sessions: [...this.sessions.values()].sort((a, b) => a.day - b.day || a.sessionNo - b.sessionNo),
      gates: this.gates,
    })
  }
  async importAll(bundle: ExportBundle) {
    const b = clone(bundle)
    this.profile = b.profile
    this.mastery = new Map(b.mastery)
    this.attempts = b.attempts
    this.aggregates = b.attemptAggregates
    this.sessions = new Map(b.sessions.map((s) => [sessionKey(s.day, s.sessionNo), s]))
    this.gates = b.gates
  }
}
```

- [ ] **Step 6: 运行测试，确认通过**

Run: `npx vitest run src/storage/ && npx tsc --noEmit`
Expected: PASS；tsc 无输出

- [ ] **Step 7: 提交**

```bash
git add src/storage/
git commit -m "feat(storage): Repository 接口、内存实现、作答归档、导出包校验与契约测试" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: IndexedDB 实现

**Files:**
- Modify: `package.json`（devDependencies 增加 `fake-indexeddb`）
- Create: `src/storage/indexeddb.ts`
- Test: `src/storage/indexeddb.test.ts`

**Interfaces:**
- Consumes: Task 7 的全部类型、`archiveOverflow`、`repositoryContract`
- Produces:
  - `export const DB_NAME = 'ear-tr'`
  - `export const STORES = ['profile', 'mastery', 'attempts', 'attemptAggregates', 'sessions', 'gates'] as const`
  - `export async function openIndexedDbRepository(opts?: { name?: string; attemptCap?: number; factory?: IDBFactory }): Promise<Repository>`——打开失败或结构不符时抛 `StorageCorruptError`（带尽力读出的原始数据 JSON）

- [ ] **Step 1: 安装开发依赖**

```bash
npm install --save-dev fake-indexeddb@6
```

确认 `package.json` 的 `devDependencies` 出现 `fake-indexeddb`，`dependencies` 不变。

- [ ] **Step 2: 写失败的测试**

`src/storage/indexeddb.test.ts`：

```ts
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { repositoryContract } from './contract'
import { openIndexedDbRepository } from './indexeddb'
import { SCHEMA_VERSION, StorageCorruptError } from './types'

let n = 0
const fresh = () => ({ factory: new IDBFactory(), name: `test-${n++}` })

repositoryContract('IndexedDB 实现', async (opts) => openIndexedDbRepository({ ...fresh(), ...opts }))

describe('IndexedDB：持久化与损坏', () => {
  it('关闭后重新打开，数据还在', async () => {
    const env = fresh()
    const a = await openIndexedDbRepository(env)
    await a.saveProfile({ id: 'p', createdAtLocalDate: '2026-10-13', phaseId: 'P2', displayScheme: 'numeric', placement: { done: true, startPhase: 'P2' }, schemaVersion: SCHEMA_VERSION })
    const b = await openIndexedDbRepository(env)
    expect((await b.loadProfile())?.phaseId).toBe('P2')
  })

  it('数据库版本高于本程序：抛 StorageCorruptError，且带原始数据', async () => {
    const env = fresh()
    await new Promise<void>((resolve, reject) => {
      const req = env.factory.open(env.name, SCHEMA_VERSION + 5)
      req.onupgradeneeded = () => req.result.createObjectStore('profile')
      req.onsuccess = () => { req.result.close(); resolve() }
      req.onerror = () => reject(req.error)
    })
    await expect(openIndexedDbRepository(env)).rejects.toBeInstanceOf(StorageCorruptError)
  })

  it('Profile 记录结构不对：抛 StorageCorruptError，rawDump 里能看到原记录', async () => {
    const env = fresh()
    await openIndexedDbRepository(env)
    await new Promise<void>((resolve, reject) => {
      const req = env.factory.open(env.name, SCHEMA_VERSION)
      req.onsuccess = () => {
        const tx = req.result.transaction('profile', 'readwrite')
        tx.objectStore('profile').put({ broken: true }, 'profile')
        tx.oncomplete = () => { req.result.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
    const err = await openIndexedDbRepository(env).catch((e) => e)
    expect(err).toBeInstanceOf(StorageCorruptError)
    expect((err as StorageCorruptError).rawDump).toContain('broken')
  })
})
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `npx vitest run src/storage/indexeddb.test.ts`
Expected: FAIL —— 无法解析模块 `./indexeddb`

- [ ] **Step 4: 写实现**

`src/storage/indexeddb.ts`：

```ts
import type { MasteryKey } from '../curriculum/knowledgePoints'
import type { MasteryState } from '../scheduling/mastery'
import type { AttemptRecord, SessionRecord } from '../session/types'
import { archiveOverflow } from './archive'
import {
  ATTEMPT_CAP,
  SCHEMA_VERSION,
  StorageCorruptError,
  type AttemptAggregate,
  type ExportBundle,
  type GateRecord,
  type Profile,
  type Repository,
} from './types'

export const DB_NAME = 'ear-tr'
export const STORES = ['profile', 'mastery', 'attempts', 'attemptAggregates', 'sessions', 'gates'] as const
type StoreName = (typeof STORES)[number]

const PROFILE_KEY = 'profile'
const sessionKey = (day: number, sessionNo: number) => `${day}:${sessionNo}`

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/** 迁移：按版本串联（P-3 spec §4.3）。v1 = 建全部对象仓库 */
function upgrade(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore('profile')
    db.createObjectStore('mastery')
    db.createObjectStore('attempts', { autoIncrement: true })
    db.createObjectStore('attemptAggregates', { keyPath: 'key' })
    db.createObjectStore('sessions')
    db.createObjectStore('gates', { autoIncrement: true })
  }
}

function open(factory: IDBFactory, name: string, version: number | undefined): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = version === undefined ? factory.open(name) : factory.open(name, version)
    r.onupgradeneeded = (e) => upgrade(r.result, e.oldVersion)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

/** 尽力读出全部数据（不论版本），供损坏时导出副本 */
async function rawDump(factory: IDBFactory, name: string): Promise<string> {
  try {
    const db = await open(factory, name, undefined)
    const out: Record<string, unknown[]> = {}
    for (const store of Array.from(db.objectStoreNames)) {
      const tx = db.transaction(store, 'readonly')
      out[store] = await req(tx.objectStore(store).getAll())
    }
    db.close()
    return JSON.stringify(out)
  } catch (e) {
    return JSON.stringify({ error: String(e) })
  }
}

function isProfile(x: unknown): x is Profile {
  if (typeof x !== 'object' || x === null) return false
  const p = x as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.createdAtLocalDate === 'string' &&
    typeof p.phaseId === 'string' &&
    typeof p.displayScheme === 'string' &&
    typeof p.schemaVersion === 'number' &&
    typeof p.placement === 'object' &&
    p.placement !== null
  )
}

class IndexedDbRepository implements Repository {
  constructor(private readonly db: IDBDatabase, private readonly cap: number) {}

  private tx(stores: StoreName | StoreName[], mode: IDBTransactionMode) {
    return this.db.transaction(stores, mode)
  }

  async loadProfile() {
    const p = await req(this.tx('profile', 'readonly').objectStore('profile').get(PROFILE_KEY))
    return (p as Profile | undefined) ?? null
  }
  async saveProfile(p: Profile) {
    const tx = this.tx('profile', 'readwrite')
    tx.objectStore('profile').put(p, PROFILE_KEY)
    await done(tx)
  }
  async loadMastery() {
    const tx = this.tx('mastery', 'readonly')
    const store = tx.objectStore('mastery')
    const [keys, values] = await Promise.all([req(store.getAllKeys()), req(store.getAll())])
    return new Map(keys.map((k, i) => [k as MasteryKey, values[i] as MasteryState]))
  }
  async putMastery(key: MasteryKey, s: MasteryState) {
    const tx = this.tx('mastery', 'readwrite')
    tx.objectStore('mastery').put(s, key)
    await done(tx)
  }
  async appendAttempt(a: AttemptRecord) {
    const tx = this.tx(['attempts', 'attemptAggregates'], 'readwrite')
    const attempts = tx.objectStore('attempts')
    attempts.add(a)
    const count = await req(attempts.count())
    if (count > this.cap) {
      // 超出上限：最旧的按 MasteryKey 聚合后删除（主 spec §10.2）
      const overflowCount = count - this.cap
      const keys = (await req(attempts.getAllKeys(null, overflowCount))) as IDBValidKey[]
      const oldest = (await req(attempts.getAll(null, overflowCount))) as AttemptRecord[]
      const aggStore = tx.objectStore('attemptAggregates')
      const existing = (await req(aggStore.getAll())) as AttemptAggregate[]
      const { aggregates } = archiveOverflow(oldest, existing, 0)
      for (const agg of aggregates) aggStore.put(agg)
      for (const k of keys) attempts.delete(k)
    }
    await done(tx)
  }
  async countAttempts() {
    return req(this.tx('attempts', 'readonly').objectStore('attempts').count())
  }
  async loadSession(day: number, sessionNo: number) {
    const r = await req(this.tx('sessions', 'readonly').objectStore('sessions').get(sessionKey(day, sessionNo)))
    return (r as SessionRecord | undefined) ?? null
  }
  async latestSessionNo(day: number) {
    const all = (await req(this.tx('sessions', 'readonly').objectStore('sessions').getAll())) as SessionRecord[]
    const nos = all.filter((s) => s.day === day).map((s) => s.sessionNo)
    return nos.length > 0 ? Math.max(...nos) : null
  }
  async putSession(r: SessionRecord) {
    const tx = this.tx('sessions', 'readwrite')
    tx.objectStore('sessions').put(r, sessionKey(r.day, r.sessionNo))
    await done(tx)
  }
  async putGate(g: GateRecord) {
    const tx = this.tx('gates', 'readwrite')
    tx.objectStore('gates').add(g)
    await done(tx)
  }
  async exportAll(exportedAt: string): Promise<ExportBundle> {
    const tx = this.tx([...STORES], 'readonly')
    const masteryStore = tx.objectStore('mastery')
    const [profile, mKeys, mValues, attempts, attemptAggregates, sessions, gates] = await Promise.all([
      req(tx.objectStore('profile').get(PROFILE_KEY)),
      req(masteryStore.getAllKeys()),
      req(masteryStore.getAll()),
      req(tx.objectStore('attempts').getAll()),
      req(tx.objectStore('attemptAggregates').getAll()),
      req(tx.objectStore('sessions').getAll()),
      req(tx.objectStore('gates').getAll()),
    ])
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt,
      profile: (profile as Profile | undefined) ?? null,
      mastery: mKeys.map((k, i) => [k as MasteryKey, mValues[i] as MasteryState]),
      attempts: attempts as AttemptRecord[],
      attemptAggregates: (attemptAggregates as AttemptAggregate[]).sort((a, b) => a.key.localeCompare(b.key)),
      sessions: (sessions as SessionRecord[]).sort((a, b) => a.day - b.day || a.sessionNo - b.sessionNo),
      gates: gates as GateRecord[],
    }
  }
  async importAll(bundle: ExportBundle) {
    // 单一事务：清空并写入全部仓库；任何一步失败整个事务回滚，不改现有数据
    const tx = this.tx([...STORES], 'readwrite')
    for (const s of STORES) tx.objectStore(s).clear()
    if (bundle.profile) tx.objectStore('profile').put(bundle.profile, PROFILE_KEY)
    for (const [k, v] of bundle.mastery) tx.objectStore('mastery').put(v, k)
    for (const a of bundle.attempts) tx.objectStore('attempts').add(a)
    for (const g of bundle.attemptAggregates) tx.objectStore('attemptAggregates').put(g)
    for (const s of bundle.sessions) tx.objectStore('sessions').put(s, sessionKey(s.day, s.sessionNo))
    for (const g of bundle.gates) tx.objectStore('gates').add(g)
    await done(tx)
  }
}

/**
 * 打开 IndexedDB 仓库。版本高于本程序、缺仓库、Profile 结构不对时抛
 * StorageCorruptError（带原始数据）——绝不静默清空（主 spec §10.3）。
 */
export async function openIndexedDbRepository(
  opts: { name?: string; attemptCap?: number; factory?: IDBFactory } = {},
): Promise<Repository> {
  const factory = opts.factory ?? globalThis.indexedDB
  const name = opts.name ?? DB_NAME
  let db: IDBDatabase
  try {
    db = await open(factory, name, SCHEMA_VERSION)
  } catch (e) {
    throw new StorageCorruptError(`无法打开本地数据库：${String(e)}`, await rawDump(factory, name))
  }
  const missing = STORES.filter((s) => !db.objectStoreNames.contains(s))
  if (missing.length > 0) {
    db.close()
    throw new StorageCorruptError(`本地数据库缺少仓库：${missing.join('、')}`, await rawDump(factory, name))
  }
  const repo = new IndexedDbRepository(db, opts.attemptCap ?? ATTEMPT_CAP)
  const profile = await req(db.transaction('profile', 'readonly').objectStore('profile').get(PROFILE_KEY))
  if (profile !== undefined && !isProfile(profile)) {
    db.close()
    throw new StorageCorruptError('本地数据库里的 Profile 结构不对', await rawDump(factory, name))
  }
  return repo
}
```

> 若 `fake-indexeddb` 的 `IDBFactory.open` 在「版本低于现有版本」时报的是 `VersionError` 事件而不是抛出，上面的 `open` 会走 `onerror` → reject，被外层捕获为 `StorageCorruptError`，符合预期。若 `getAll(null, n)` 的签名报类型错误，改用 `IDBKeyRange` 为 `undefined` 的写法；不要改测试。

- [ ] **Step 5: 运行测试，确认通过**

Run: `npx vitest run src/storage/ && npx tsc --noEmit`
Expected: PASS（内存与 IndexedDB 两套契约都绿）；tsc 无输出

- [ ] **Step 6: 提交**

```bash
git add package.json package-lock.json src/storage/indexeddb.ts src/storage/indexeddb.test.ts
git commit -m "feat(storage): IndexedDB 实现，版本迁移与损坏检测" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 薄壳 `createRuntime`

**Files:**
- Create: `src/runtime/runtime.ts`
- Test: `src/runtime/runtime.test.ts`

**Interfaces:**
- Consumes: `createSession`/`resumeSession`/`reduce`/`createDrill`（session/machine）、`SessionState`/`SessionEvent`/`SessionEffect`/`SESSION_MINUTES`（session/types）、`dayIndex`/`sessionSeed`（session/time）、`Repository`/`Profile`/`SCHEMA_VERSION`（storage/types）、`buildSessionPlan`（scheduling/scheduler）、`MasteryState`/`MasteryKey`、`Curriculum`、`PlaybackPlan`
- Produces:
  - `export interface AudioPort { play(plan: PlaybackPlan): { startSec: number; endSec: number }; stopAll(): void; readonly currentTime: number }`
  - `export interface TimerPort { after(seconds: number, fn: () => void): () => void }`（返回取消函数）
  - `export interface RuntimeDeps { repo: Repository; audio: AudioPort; timer: TimerPort; curriculum: Curriculum; nowIso: () => string; todayLocalDate: () => string; newProfileId: () => string }`
  - `export interface RuntimeSnapshot { profile: Profile | null; session: SessionState | null; storage: 'ok' | 'readOnly'; lastError: string | null }`
  - `export interface Runtime { getSnapshot(): RuntimeSnapshot; subscribe(fn: (s: RuntimeSnapshot) => void): () => void; ensureProfile(): Promise<Profile>; todayStatus(): Promise<'notStarted' | 'inProgress' | 'mainDone'>; startToday(): Promise<void>; startExtra(): Promise<void>; startDrill(): Promise<void>; dispatch(event: SessionEvent): Promise<void> }`
  - `export function createRuntime(deps: RuntimeDeps): Runtime`

行为：

- `ensureProfile`：没有 Profile 时新建（`createdAtLocalDate = todayLocalDate()`、`phaseId: 'P1'`、`displayScheme: 'solfege'`、`placement: { done: false, startPhase: null }`）并保存。
- `startToday`：`day = dayIndex(profile.createdAtLocalDate, today)`；读第 0 场记录。未完成 → `resumeSession`；已完成 → 什么都不做；没有 → 用 `sessionSeed(profile.id, day, 0)` 生成计划、`createSession`、`putSession`。然后读掌握度到内存副本，派发 `start`。
- `startExtra`：仅当今天第 0 场已完成；`sessionNo = latestSessionNo(day) + 1`（若最新一场未完成则续起它）。
- `startDrill`：用当前（已结束的）会话 `createDrill`；没有错题则什么都不做。
- `dispatch`：调 `reduce`，按顺序执行副作用：
  - `play` → `audio.play(plan)`，用 `timer.after(endSec - audio.currentTime, …)` 在播完时派发 `contentPlayed`；保存取消函数。
  - `stopAudio` → 取消计时、`audio.stopAll()`。
  - `saveMastery` → 先更新内存副本，再 `repo.putMastery`。
  - `saveAttempt` / `saveSession` → 对应 `repo` 方法。
  - `advancePhase` → Profile 的 `phaseId = to`，`saveProfile`，`putGate({ phaseId: from, passedOnDay: day })`。
  - `itemError` → `lastError = message`（不中断）。
  - `ended` → 无额外动作（总结已在状态里）。
  - 任一 `repo` 调用失败：重试一次；仍失败 → `storage = 'readOnly'`，`lastError` 写明，之后的写入跳过，练习不中断（P-3 spec §5）。
- 每次 `dispatch` 结束通知订阅者。

- [ ] **Step 1: 写失败的测试**

`src/runtime/runtime.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { answerAsResponse } from '../exercises/generate'
import type { PlaybackPlan } from '../music/playback'
import { MemoryRepository } from '../storage/memory'
import type { Repository } from '../storage/types'
import { createRuntime, type AudioPort, type RuntimeDeps, type TimerPort } from './runtime'

const c = buildCurriculum()

function fakes() {
  const played: PlaybackPlan[] = []
  let stopped = 0
  const audio: AudioPort = {
    currentTime: 0,
    play: (plan) => { played.push(plan); return { startSec: 0, endSec: plan.totalDurSec } },
    stopAll: () => { stopped++ },
  }
  const pending: (() => void)[] = []
  const timer: TimerPort = {
    after: (_s, fn) => { pending.push(fn); return () => { const i = pending.indexOf(fn); if (i >= 0) pending.splice(i, 1) } },
  }
  const flush = () => { while (pending.length) pending.shift()!() }
  return { audio, timer, played, flush, stoppedCount: () => stopped }
}

function deps(repo: Repository, today = '2026-10-13'): RuntimeDeps & ReturnType<typeof fakes> {
  const f = fakes()
  return { ...f, repo, curriculum: c, nowIso: () => '2026-10-13T08:00:00.000Z', todayLocalDate: () => today, newProfileId: () => 'p-test' }
}

/** 一直答对，直到会话结束（或到 limit 道题为止） */
async function playThrough(rt: ReturnType<typeof createRuntime>, flush: () => void, limit = Infinity) {
  let n = 0
  while (rt.getSnapshot().session?.phase !== 'done' && n < limit) {
    flush() // 播完 → contentPlayed
    const s = rt.getSnapshot().session!
    if (s.phase === 'answering') {
      await rt.dispatch({ type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 500 })
      n++
      await rt.dispatch({ type: 'next' })
    }
  }
}

describe('createRuntime', () => {
  it('首次：建 Profile，开今天的主线会话，播放第一题', async () => {
    const repo = new MemoryRepository()
    const d = deps(repo)
    const rt = createRuntime(d)
    expect(await rt.todayStatus()).toBe('notStarted')
    await rt.startToday()
    expect((await repo.loadProfile())?.id).toBe('p-test')
    expect(rt.getSnapshot().session?.phase).toBe('presenting')
    expect(d.played).toHaveLength(1)
    expect(await rt.todayStatus()).toBe('inProgress')
  })

  it('完整跑完一场：作答、掌握度、会话记录都落盘；todayStatus 变为 mainDone', async () => {
    const repo = new MemoryRepository()
    const d = deps(repo)
    const rt = createRuntime(d)
    await rt.startToday()
    await playThrough(rt, d.flush)
    const s = rt.getSnapshot().session!
    expect(s.phase).toBe('done')
    expect(await repo.countAttempts()).toBe(s.progress.attempted)
    expect((await repo.loadMastery()).size).toBeGreaterThan(0)
    expect((await repo.loadSession(0, 0))?.completed).toBe(true)
    expect(await rt.todayStatus()).toBe('mainDone')
  })

  it('中途换一个 runtime（模拟杀掉页面）：从记录续起，不重复已答的题', async () => {
    const repo = new MemoryRepository()
    const d1 = deps(repo)
    const rt1 = createRuntime(d1)
    await rt1.startToday()
    await playThrough(rt1, d1.flush, 3)
    const answered = await repo.countAttempts()
    const indexBefore = (await repo.loadSession(0, 0))!.index

    const d2 = deps(repo)
    const rt2 = createRuntime(d2)
    await rt2.startToday()
    expect(rt2.getSnapshot().session?.current?.planIndex).toBe(indexBefore)
    await playThrough(rt2, d2.flush)
    expect(await repo.countAttempts()).toBeGreaterThan(answered)
    expect((await repo.loadSession(0, 0))?.completed).toBe(true)
  })

  it('中断：停播并取消计时；恢复后重出同一道题', async () => {
    const d = deps(new MemoryRepository())
    const rt = createRuntime(d)
    await rt.startToday()
    const first = rt.getSnapshot().session!.current!.exercise
    await rt.dispatch({ type: 'interrupted' })
    expect(d.stoppedCount()).toBe(1)
    expect(rt.getSnapshot().session?.phase).toBe('idle')
    await rt.dispatch({ type: 'start' })
    expect(rt.getSnapshot().session?.current?.exercise).toEqual(first)
  })

  it('加练：主线完成后开第 1 场', async () => {
    const repo = new MemoryRepository()
    const d = deps(repo)
    const rt = createRuntime(d)
    await rt.startToday()
    await playThrough(rt, d.flush)
    await rt.startExtra()
    expect(rt.getSnapshot().session?.sessionNo).toBe(1)
    expect(rt.getSnapshot().session?.phase).toBe('presenting')
  })

  it('落盘失败：重试一次后进入只读警告，练习继续', async () => {
    const repo = new MemoryRepository()
    let fail = false
    const flaky: Repository = new Proxy(repo, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver)
        if (typeof v !== 'function') return v
        return (...args: unknown[]) => {
          if (fail && String(prop).startsWith('put') || fail && prop === 'appendAttempt') return Promise.reject(new Error('disk full'))
          return v.apply(target, args)
        }
      },
    })
    const d = deps(flaky)
    const rt = createRuntime(d)
    await rt.startToday()
    fail = true
    await playThrough(rt, d.flush, 2)
    expect(rt.getSnapshot().storage).toBe('readOnly')
    expect(rt.getSnapshot().lastError).toMatch(/disk full/)
    expect(rt.getSnapshot().session?.phase).not.toBe('idle')
  })

  it('订阅者在每次 dispatch 后收到快照', async () => {
    const d = deps(new MemoryRepository())
    const rt = createRuntime(d)
    const seen: string[] = []
    rt.subscribe((s) => seen.push(s.session?.phase ?? 'none'))
    await rt.startToday()
    d.flush()
    expect(seen).toContain('presenting')
    expect(seen.at(-1)).toBe('answering')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/runtime/runtime.test.ts`
Expected: FAIL —— 无法解析模块 `./runtime`

- [ ] **Step 3: 写实现**

`src/runtime/runtime.ts`：

```ts
import type { Curriculum } from '../curriculum/curriculum'
import type { MasteryKey } from '../curriculum/knowledgePoints'
import type { PlaybackPlan } from '../music/playback'
import type { MasteryState } from '../scheduling/mastery'
import { buildSessionPlan } from '../scheduling/scheduler'
import { createDrill, createSession, reduce, resumeSession } from '../session/machine'
import { dayIndex, sessionSeed } from '../session/time'
import { SESSION_MINUTES, type SessionEffect, type SessionEvent, type SessionState } from '../session/types'
import { SCHEMA_VERSION, type Profile, type Repository } from '../storage/types'

export interface AudioPort {
  play(plan: PlaybackPlan): { startSec: number; endSec: number }
  stopAll(): void
  readonly currentTime: number
}

export interface TimerPort {
  /** 若干秒后调用 fn；返回取消函数 */
  after(seconds: number, fn: () => void): () => void
}

export interface RuntimeDeps {
  repo: Repository
  audio: AudioPort
  timer: TimerPort
  curriculum: Curriculum
  nowIso: () => string
  todayLocalDate: () => string
  newProfileId: () => string
}

export interface RuntimeSnapshot {
  profile: Profile | null
  session: SessionState | null
  storage: 'ok' | 'readOnly'
  lastError: string | null
}

export interface Runtime {
  getSnapshot(): RuntimeSnapshot
  subscribe(fn: (s: RuntimeSnapshot) => void): () => void
  ensureProfile(): Promise<Profile>
  todayStatus(): Promise<'notStarted' | 'inProgress' | 'mainDone'>
  startToday(): Promise<void>
  startExtra(): Promise<void>
  startDrill(): Promise<void>
  dispatch(event: SessionEvent): Promise<void>
}

/** 薄壳（P-3 spec §5）：持有状态与掌握度副本，按顺序执行状态机的副作用 */
export function createRuntime(deps: RuntimeDeps): Runtime {
  const { repo, audio, timer, curriculum } = deps
  let snapshot: RuntimeSnapshot = { profile: null, session: null, storage: 'ok', lastError: null }
  let mastery = new Map<MasteryKey, MasteryState>()
  let cancelTimer: (() => void) | null = null
  const listeners = new Set<(s: RuntimeSnapshot) => void>()

  const notify = () => {
    for (const fn of listeners) fn(snapshot)
  }
  const set = (patch: Partial<RuntimeSnapshot>) => {
    snapshot = { ...snapshot, ...patch }
  }

  /** 落盘：失败重试一次；仍失败进入只读警告，之后的写入跳过（练习不中断） */
  async function write(op: () => Promise<unknown>): Promise<void> {
    if (snapshot.storage === 'readOnly') return
    try {
      await op()
    } catch {
      try {
        await op()
      } catch (e) {
        set({ storage: 'readOnly', lastError: `进度暂时无法保存：${String((e as Error).message ?? e)}` })
      }
    }
  }

  async function ensureProfile(): Promise<Profile> {
    if (snapshot.profile) return snapshot.profile
    let p = await repo.loadProfile()
    if (!p) {
      p = {
        id: deps.newProfileId(),
        createdAtLocalDate: deps.todayLocalDate(),
        phaseId: 'P1',
        displayScheme: 'solfege',
        placement: { done: false, startPhase: null },
        schemaVersion: SCHEMA_VERSION,
      }
      await write(() => repo.saveProfile(p!))
    }
    set({ profile: p })
    return p
  }

  const today = (p: Profile) => dayIndex(p.createdAtLocalDate, deps.todayLocalDate())

  async function run(effect: SessionEffect): Promise<void> {
    switch (effect.type) {
      case 'play': {
        cancelTimer?.()
        const { endSec } = audio.play(effect.plan)
        cancelTimer = timer.after(Math.max(0, endSec - audio.currentTime), () => {
          cancelTimer = null
          void dispatch({ type: 'contentPlayed' })
        })
        return
      }
      case 'stopAudio':
        cancelTimer?.()
        cancelTimer = null
        audio.stopAll()
        return
      case 'saveMastery':
        mastery = new Map(mastery).set(effect.key, effect.state)
        return write(() => repo.putMastery(effect.key, effect.state))
      case 'saveAttempt':
        return write(() => repo.appendAttempt(effect.attempt))
      case 'saveSession':
        return write(() => repo.putSession(effect.record))
      case 'advancePhase': {
        const p = { ...(snapshot.profile ?? (await ensureProfile())), phaseId: effect.to }
        set({ profile: p })
        await write(() => repo.saveProfile(p))
        return write(() => repo.putGate({ phaseId: effect.from, passedOnDay: effect.day }))
      }
      case 'itemError':
        set({ lastError: effect.message })
        return
      case 'ended':
        return
    }
  }

  async function dispatch(event: SessionEvent): Promise<void> {
    const session = snapshot.session
    if (!session) return
    const { state, effects } = reduce(session, event, { curriculum, mastery, nowIso: deps.nowIso() })
    set({ session: state })
    for (const e of effects) await run(e)
    notify()
  }

  async function begin(state: SessionState): Promise<void> {
    mastery = await repo.loadMastery()
    set({ session: state })
    await dispatch({ type: 'start' })
  }

  async function openSession(sessionNo: number): Promise<void> {
    const p = await ensureProfile()
    const day = today(p)
    const record = await repo.loadSession(day, sessionNo)
    if (record?.completed) return
    if (record) return begin(resumeSession(record))
    const store = await repo.loadMastery()
    const plan = buildSessionPlan({
      curriculum,
      store,
      phaseId: p.phaseId,
      today: day,
      seed: sessionSeed(p.id, day, sessionNo),
      minutes: SESSION_MINUTES,
    })
    const state = createSession({ mode: 'session', day, sessionNo, phaseId: p.phaseId, plan })
    await write(() => repo.putSession({ ...state, plan, completed: false, index: 0 } as never))
    return begin(state)
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    ensureProfile,
    async todayStatus() {
      const p = await ensureProfile()
      const r = await repo.loadSession(today(p), 0)
      return !r ? 'notStarted' : r.completed ? 'mainDone' : 'inProgress'
    },
    startToday: () => openSession(0),
    async startExtra() {
      const p = await ensureProfile()
      const day = today(p)
      const main = await repo.loadSession(day, 0)
      if (!main?.completed) return
      const latest = (await repo.latestSessionNo(day)) ?? 0
      const latestRecord = await repo.loadSession(day, latest)
      return openSession(latestRecord?.completed ? latest + 1 : latest)
    },
    async startDrill() {
      const s = snapshot.session
      if (!s || s.phase !== 'done') return
      const drill = createDrill(s)
      if (!drill) return
      set({ session: drill })
      await dispatch({ type: 'start' })
    },
    dispatch,
  }
}
```

> 注意 `openSession` 里新建会话后写入的记录：应当用 `toRecord(state)`（`session/machine` 已导出）而不是手拼对象——实现时改为 `import { toRecord } from '../session/machine'` 并 `await write(() => repo.putSession(toRecord(state)))`，删掉 `as never` 的写法。这是本计划刻意留给实现者核对的一处：最终代码不得出现 `as never`。

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/runtime/ && npx tsc --noEmit`
Expected: PASS；tsc 无输出；`grep -n "as never" src/runtime/runtime.ts` 无输出

- [ ] **Step 5: 提交**

```bash
git add src/runtime/
git commit -m "feat(runtime): 薄壳——执行副作用、续起、加练、重练、落盘失败降级" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 主 spec 写回与完成检查

**Files:**
- Modify: `docs/superpowers/specs/2026-08-24-ear-training-design.md`（§10.1 实体、§16.2 FWD-1 状态）

- [ ] **Step 1: 写回主 spec**

在 FWD-1 段落的这一行之后：

```
**修法**：`onended` 里 splice，或 `play()` 开头按 `endSec` 清理过期项。
```

插入一行：

```
**状态（P-3a，已关闭）**：每个音的最后一个分音结束时，释放该音全部节点并移出 `active`；`AudioEngine.activeCount` 供测试断言连续播放不增长。
```

把 §10.1 的代码块：

```ts
Profile       { id, displayScheme, vocalRange, settings, createdAt }
MasteryRecord { kpId, modality, stability, difficulty,
                variationLevel, contextLevel, updatedAt }
Attempt       { at, kpId, modality, seed, params,
                correct, latencyMs, detail }
SessionRecord { date, plan, progressIndex, completedAt }
GateRecord    { phaseId, attempts, passedAt }
```

替换为：

```ts
Profile       { id, createdAtLocalDate, phaseId, displayScheme, placement, schemaVersion }
MasteryState  （按 MasteryKey 存，结构见 §7.1）
Attempt       { at, day, sessionNo, kpId, modality, spec, correct, latencyMs, detail }
SessionRecord { day, sessionNo, phaseId, plan, index, progress, boss, byTrack, reliefTriggered, completed }
GateRecord    { phaseId, passedOnDay }
AttemptAggregate { key, attempts, correct }   // 超出 5 万条的旧作答聚合
```

并在代码块之后加一行：

```
（P-3a 修订：`Attempt` 改存实时规格 `spec`——含档位与 seed，可复现该题；阶梯状态不落盘，由掌握度窗口推导。详见 P-3 spec §4.1。）
```

- [ ] **Step 2: 完成检查**

```bash
npx vitest run
npx tsc --noEmit
npx vite build
grep -rn "Math.random\|Date.now\|window\.\|document\.\|indexedDB" src/session/ src/storage/ --include=*.ts | grep -v "\.test\.ts" | grep -v "src/storage/indexeddb.ts" || echo "OK: session / storage 核心零 IO"
grep -rn "new Date()" src/session/ src/storage/ src/runtime/ --include=*.ts | grep -v "\.test\.ts" || echo "OK: 不读时钟"
grep -rn "from '../audio\|from '../ui\|from '../runtime\|from '../simulation" src/session/ src/storage/ --include=*.ts | grep -v "\.test\.ts" || echo "OK: 依赖方向正确"
```

Expected: 全部 PASS；tsc 无输出；构建成功；三条 grep 都输出 OK。

- [ ] **Step 3: 提交**

```bash
git add docs/superpowers/specs/2026-08-24-ear-training-design.md
git commit -m "docs(spec): P-3a 写回——关闭 FWD-1，更新 §10.1 实体" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 完成标准

1. `npx vitest run` 全绿
2. `npx tsc --noEmit` 无输出
3. `npx vite build` 成功
4. 仿真特征快照在搬迁前后逐字一致，仿真全部断言照常通过
5. 状态机单测覆盖：档位写入、回血、热身不计分、计分题更新链、实战关计数与替身、中断作废与重出、结束流程、`endEarly`、加练、重练不落盘、出题抛错不崩
6. 内存与 IndexedDB 两个实现通过同一套契约测试；IndexedDB 的持久化、版本过高、结构损坏都有测试
7. 壳层端到端：一整场会话跑完、杀掉重开续起、中断、加练、落盘失败降级
8. `session`、`storage`（IndexedDB 实现除外）零 IO；依赖方向正确
9. 主 spec 已写回：FWD-1 关闭、§10.1 实体更新

## 下一步

**P-3b**：手机界面与移动端整合——首次使用与分级测试、首页、练习页（四种作答控件、反馈）、今日总结、设置（皮肤、导出导入）、显示文案表、打拍计时、Wake Lock、iOS 音频启动、中断监听、FWD-5、§15.1 语境拼写；以及只有用户能做的真机验收。
