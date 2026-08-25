# P-2 掌握度模型、调度器与课程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立课程数据、掌握度模型与自适应调度器，并用虚拟学习者仿真跑满 180 个虚拟日，在编写任何 UI 之前验证整套课程与调度逻辑成立。

**Architecture:** 三个新目录全部是纯函数、零 IO。`curriculum/` 是声明式课程数据加查询与校验；`scheduling/` 是掌握度状态机、门控、难度阶梯与会话计划生成；`simulation/` 是验收物——喂入模拟学习者跑 180 天并断言课程能走完、难度不发散、交错规则每日满足、护栏确实触发。调度器输出 `ExerciseSpec`（题目规格），**不渲染题目**——渲染是 P-2b 生成器的事。

**Tech Stack:** TypeScript (strict) + Vitest。不新增任何运行时依赖。

**Spec:** `docs/superpowers/specs/2026-08-24-ear-training-design.md`（§5 知识点、§7 掌握度模型与调度器、§8 课程、§13.1 虚拟学习者仿真）

## Global Constraints

以下要求适用于本计划的每一个任务，逐条抄自 spec：

- **全部新代码零 IO、纯函数**：不得 import 任何浏览器 API、不得读写存储、不得使用 `Math.random()`、不得使用 `Date.now()`（spec §3.2）。
- **所有随机必须来自显式传入的 seeded RNG**（`src/music/rng.ts` 的 `makeRng`），同一 seed 必须产生同一结果（spec §3.2）。
- **课程是数据不是代码**（spec §3.2）：三轨道、阶段、关卡阈值全部写成结构化配置，改课程不改逻辑。
- **底层统一使用首调音级（movable do），小调采用 la 基唱名**（spec §4.1）。
- **`Scheduler(mastery, curriculum, today, seed, minutes) → SessionPlan` 是纯函数**（spec §3.2、§7.4），session 开始时一次性生成，凭 seed 可复现，不边练边算。
- **一个知识点要「毕业」必须听辨、唱、听写三个模态都过阈值**（spec §8.3）。不提供关卡逃生口。
- **快慢两套难度机制不得混淆**（spec §7.4.1）：`variationLevel`/`contextLevel` 是跨天的慢机制，落盘；2-down-1-up 阶梯是题间的快机制，不落盘。**快机制永远不修改 `variationLevel` 或 `contextLevel`。**
- **语境等级方向**：`contextLevel` 0 = L0 = 完整终止式 = **最强语境 = 最容易**；4 = L4 = 语境中途撤走 = 最难（spec §6.1）。「加强语境」= 减小 `contextLevel`。
- TypeScript `strict: true`，`noUnusedLocals` / `noUnusedParameters` 已开启。
- 不新增 npm 依赖。

## P-1 已有的可用导出

本计划消费这些既有符号，它们已实现并全部有测试：

```ts
// src/music/key.ts
type PitchClass, Mode, Key, ScaleDegree
const SCALE_DEGREES, DEGREE_SEMITONES, MAJOR_SCALE_DEGREES, NATURAL_MINOR_DEGREES
function doReference, degreeToPitchClass, tonicDegree

// src/music/rng.ts
interface Rng { next(): number; int(maxExclusive: number): number; pick<T>(items: readonly T[]): T }
function makeRng(seed: number): Rng

// src/music/tonalContext.ts
type ContextLevel = 0 | 1 | 2 | 3 | 4
```

## 建模决策（spec 未说死、本计划定下的）

**决策 1：阶段不是「新知识点集合」，而是「新知识点 + 对已有知识点的语境/变异要求」。**
理由：spec §8.1 的 T4「大调全音阶随机，语境降至 L2–L3」不引入任何新音级——T3 之后七个大调音级已齐全，T4 做的是把语境要求从 L0/L1 提到 L2/L3。若把阶段建模成单纯的知识点集合，T4 无法表达。

**决策 2：调式进知识点 id——`degree:major:mi` 与 `degree:minor:mi` 是两个知识点。**
理由：la 基唱名下，`mi` 在大调里是第 3 级（主三和弦成员，稳定），在小调里是第 5 级（属音，倾向性完全不同）。听辨它们是两种技能，掌握度必须分开追踪，否则大调练熟会伪装成小调也会。

**决策 3：`ExerciseSpec` 只描述规格，不含任何可播放内容。**
理由：渲染属于 P-2b 生成器。P-2 的验收物是仿真，仿真只需要规格。本计划用一条集成守卫测试堵住「规格没人能渲染」的风险（Task 16）。

**决策 4：升级与关卡的信号是「阶梯档位」，不是原始正确率。这是对 spec §7.3 的一处修正。**

spec §7.3 写的升级条件是「stability 过阈值 **且** 最近窗口正确率 > 90%」。**这个条件永远不可能满足**，因为它与 spec §2.9 直接冲突：

2-down-1-up 阶梯按设计把观测正确率稳定在约 71%——学习者一变强，阶梯就加难度把正确率压回去。于是窗口正确率会长期锁在 71% 附近，>90% 的门槛永不触及。升级不会发生，`variationLevel` 与 `contextLevel` 永远停在 0，关卡永远不通过。这不是参数没调好，是判据选错了对象。

**根源**：原始正确率测的是「阶梯把难度顶到哪」，不是「学习者有多强」。一个在档位 5 上保持 71% 的学习者，远强于一个在档位 0 上保持 71% 的。

**修正**：把阶梯档位记进 `AttemptOutcome`，升级与关卡改用**窗口内的平均档位**作判据。档位高说明学习者在同一 `variationLevel`/`contextLevel` 下已能吃住更难的变体，此时提升等级才有意义。原始正确率保留在 `windowAccuracy` 里供诊断与护栏用，但不再当升级判据。

这条修正会在 P-2 完成后写回 spec §7.3。

---

### Task 1: 知识点标识与类型

掌握度追踪的原子单位。id 是结构化字符串，因为它要当 IndexedDB 的 key（P-3）与仿真的 Map key，字符串比对象稳定。

**Files:**
- Create: `src/curriculum/knowledgePoints.ts`
- Test: `src/curriculum/knowledgePoints.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type Track = 'T' | 'H' | 'R'`
  - `type Modality = 'recognize' | 'sing' | 'notate'`
  - `const MODALITIES: readonly Modality[]`
  - `type KnowledgePointKind = 'degree' | 'chord' | 'prog' | 'rhythm'`
  - `type KnowledgePointId = string`
  - `type MasteryKey = string`
  - `interface KnowledgePoint { id: KnowledgePointId; kind: KnowledgePointKind; track: Track; label: string; prerequisites: KnowledgePointId[] }`
  - `trackOfKind(kind: KnowledgePointKind): Track`
  - `makeKpId(kind: KnowledgePointKind, name: string): KnowledgePointId`
  - `parseKpId(id: KnowledgePointId): { kind: KnowledgePointKind; name: string }`
  - `masteryKey(kpId: KnowledgePointId, modality: Modality): MasteryKey`
  - `parseMasteryKey(key: MasteryKey): { kpId: KnowledgePointId; modality: Modality }`

- [ ] **Step 1: 写失败的测试**

`src/curriculum/knowledgePoints.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  MODALITIES,
  makeKpId,
  masteryKey,
  parseKpId,
  parseMasteryKey,
  trackOfKind,
  type KnowledgePointKind,
} from './knowledgePoints'

const KINDS: KnowledgePointKind[] = ['degree', 'chord', 'prog', 'rhythm']

describe('trackOfKind', () => {
  it('音级归 T 轨，和弦与进行归 H 轨，节奏归 R 轨', () => {
    expect(trackOfKind('degree')).toBe('T')
    expect(trackOfKind('chord')).toBe('H')
    expect(trackOfKind('prog')).toBe('H')
    expect(trackOfKind('rhythm')).toBe('R')
  })

  it('四种知识点类型都有归属轨道', () => {
    for (const kind of KINDS) {
      expect(['T', 'H', 'R']).toContain(trackOfKind(kind))
    }
  })
})

describe('makeKpId / parseKpId', () => {
  it('往返一致', () => {
    for (const kind of KINDS) {
      for (const name of ['major:mi', 'V7', 'I-V-vi-IV', 'synco-8']) {
        expect(parseKpId(makeKpId(kind, name))).toEqual({ kind, name })
      }
    }
  })

  it('id 形如 kind:name', () => {
    expect(makeKpId('degree', 'major:mi')).toBe('degree:major:mi')
    expect(makeKpId('prog', 'I-V-vi-IV')).toBe('prog:I-V-vi-IV')
  })

  it('name 中含冒号时仍能正确切分（只切第一个冒号）', () => {
    // degree:major:mi 的 name 是 major:mi，不是 major
    expect(parseKpId('degree:major:mi').name).toBe('major:mi')
  })

  it('无冒号的 id 抛错', () => {
    expect(() => parseKpId('degree')).toThrow()
  })

  it('未知 kind 抛错', () => {
    expect(() => parseKpId('bogus:x')).toThrow()
  })
})

describe('masteryKey / parseMasteryKey', () => {
  it('往返一致', () => {
    for (const modality of MODALITIES) {
      const key = masteryKey('degree:major:mi', modality)
      expect(parseMasteryKey(key)).toEqual({ kpId: 'degree:major:mi', modality })
    }
  })

  it('同一知识点的三个模态产生三个互不相同的 key', () => {
    const keys = MODALITIES.map((m) => masteryKey('chord:V7', m))
    expect(new Set(keys).size).toBe(3)
  })

  it('MODALITIES 恰好是三个模态', () => {
    expect([...MODALITIES]).toEqual(['recognize', 'sing', 'notate'])
  })
})
```

「name 中含冒号时只切第一个冒号」这条不是凑数——`degree:major:mi` 是本计划决策 2 的直接产物，用 `split(':')` 天真实现会把它切成三段。

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/curriculum/knowledgePoints.test.ts`
Expected: FAIL — 无法解析模块 `./knowledgePoints`

- [ ] **Step 3: 写实现**

`src/curriculum/knowledgePoints.ts`：

```ts
/** 三条并行轨道：T 音级、H 和声、R 节奏（spec §6.3） */
export type Track = 'T' | 'H' | 'R'

/** 三个模态。一个知识点要毕业必须三者齐平（spec §8.3） */
export type Modality = 'recognize' | 'sing' | 'notate'

export const MODALITIES: readonly Modality[] = ['recognize', 'sing', 'notate']

export type KnowledgePointKind = 'degree' | 'chord' | 'prog' | 'rhythm'

const KIND_TRACK: Record<KnowledgePointKind, Track> = {
  degree: 'T',
  chord: 'H',
  prog: 'H',
  rhythm: 'R',
}

/** 形如 `${kind}:${name}`，例如 `degree:major:mi`、`prog:I-V-vi-IV` */
export type KnowledgePointId = string

/** 形如 `${kpId}@${modality}`，掌握度状态的唯一键 */
export type MasteryKey = string

export interface KnowledgePoint {
  id: KnowledgePointId
  kind: KnowledgePointKind
  track: Track
  /** 中文显示名，供 UI 与调试输出用 */
  label: string
  prerequisites: KnowledgePointId[]
}

export function trackOfKind(kind: KnowledgePointKind): Track {
  return KIND_TRACK[kind]
}

export function makeKpId(kind: KnowledgePointKind, name: string): KnowledgePointId {
  return `${kind}:${name}`
}

/**
 * 只在第一个冒号处切分——name 本身可以含冒号
 * （`degree:major:mi` 的 name 是 `major:mi`）。
 */
export function parseKpId(id: KnowledgePointId): {
  kind: KnowledgePointKind
  name: string
} {
  const idx = id.indexOf(':')
  if (idx < 0) throw new Error(`知识点 id 必须形如 kind:name，收到 ${id}`)
  const kind = id.slice(0, idx)
  if (!(kind in KIND_TRACK)) {
    throw new Error(`未知的知识点类型 ${kind}（id: ${id}）`)
  }
  return { kind: kind as KnowledgePointKind, name: id.slice(idx + 1) }
}

export function masteryKey(kpId: KnowledgePointId, modality: Modality): MasteryKey {
  return `${kpId}@${modality}`
}

export function parseMasteryKey(key: MasteryKey): {
  kpId: KnowledgePointId
  modality: Modality
} {
  const idx = key.lastIndexOf('@')
  if (idx < 0) throw new Error(`掌握度 key 必须形如 kpId@modality，收到 ${key}`)
  const modality = key.slice(idx + 1)
  if (!MODALITIES.includes(modality as Modality)) {
    throw new Error(`未知模态 ${modality}（key: ${key}）`)
  }
  return { kpId: key.slice(0, idx), modality: modality as Modality }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/curriculum/knowledgePoints.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(curriculum): 知识点标识与类型"
```

---

### Task 2: 三轨道知识点数据

spec §8.1 的三张表落成数据。这是纯数据文件，但它的正确性决定整个课程——所以测试断言的是覆盖度与结构，而非逐条重复数据。

**Files:**
- Create: `src/curriculum/tracks.ts`
- Test: `src/curriculum/tracks.test.ts`

**Interfaces:**
- Consumes: `knowledgePoints.ts` 的 `KnowledgePoint`, `KnowledgePointId`, `Track`, `makeKpId`, `trackOfKind`
- Produces:
  - `const ALL_KNOWLEDGE_POINTS: readonly KnowledgePoint[]`
  - `knowledgePointsOfTrack(track: Track): KnowledgePoint[]`

- [ ] **Step 1: 写失败的测试**

`src/curriculum/tracks.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { ALL_KNOWLEDGE_POINTS, knowledgePointsOfTrack } from './tracks'
import { parseKpId, trackOfKind } from './knowledgePoints'

describe('ALL_KNOWLEDGE_POINTS', () => {
  it('id 互不重复', () => {
    const ids = ALL_KNOWLEDGE_POINTS.map((kp) => kp.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个知识点的 track 与其 kind 推出的轨道一致', () => {
    for (const kp of ALL_KNOWLEDGE_POINTS) {
      expect(kp.track).toBe(trackOfKind(parseKpId(kp.id).kind))
      expect(kp.track).toBe(trackOfKind(kp.kind))
    }
  })

  it('每个知识点都有非空中文标签', () => {
    for (const kp of ALL_KNOWLEDGE_POINTS) {
      expect(kp.label.length).toBeGreaterThan(0)
    }
  })

  it('前置知识点全部存在于本表内，且不自引用', () => {
    const ids = new Set(ALL_KNOWLEDGE_POINTS.map((kp) => kp.id))
    for (const kp of ALL_KNOWLEDGE_POINTS) {
      for (const pre of kp.prerequisites) {
        expect(ids.has(pre)).toBe(true)
        expect(pre).not.toBe(kp.id)
      }
    }
  })

  it('三条轨道都有知识点，且合起来等于全集', () => {
    const t = knowledgePointsOfTrack('T')
    const h = knowledgePointsOfTrack('H')
    const r = knowledgePointsOfTrack('R')
    expect(t.length).toBeGreaterThan(0)
    expect(h.length).toBeGreaterThan(0)
    expect(r.length).toBeGreaterThan(0)
    expect(t.length + h.length + r.length).toBe(ALL_KNOWLEDGE_POINTS.length)
  })

  it('大调七音级与小调七音级都齐全，且互为不同的知识点', () => {
    const ids = new Set(ALL_KNOWLEDGE_POINTS.map((kp) => kp.id))
    for (const d of ['do', 're', 'mi', 'fa', 'sol', 'la', 'ti']) {
      expect(ids.has(`degree:major:${d}`)).toBe(true)
    }
    for (const d of ['la', 'ti', 'do', 're', 'mi', 'fa', 'sol']) {
      expect(ids.has(`degree:minor:${d}`)).toBe(true)
    }
    // 决策 2：同名音级在两个调式下是两个知识点
    expect(ids.has('degree:major:mi')).toBe(true)
    expect(ids.has('degree:minor:mi')).toBe(true)
  })

  it('H 轨含三条 spec §8.1 H5 点名的流行进行', () => {
    const ids = new Set(ALL_KNOWLEDGE_POINTS.map((kp) => kp.id))
    expect(ids.has('prog:I-V-vi-IV')).toBe(true)
    expect(ids.has('prog:vi-IV-I-V')).toBe(true)
    expect(ids.has('prog:I-vi-IV-V')).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/curriculum/tracks.test.ts`
Expected: FAIL — 无法解析模块 `./tracks`

- [ ] **Step 3: 写实现**

`src/curriculum/tracks.ts`：

```ts
import {
  makeKpId,
  trackOfKind,
  type KnowledgePoint,
  type KnowledgePointId,
  type KnowledgePointKind,
  type Track,
} from './knowledgePoints'

function kp(
  kind: KnowledgePointKind,
  name: string,
  label: string,
  prerequisites: KnowledgePointId[] = [],
): KnowledgePoint {
  return { id: makeKpId(kind, name), kind, track: trackOfKind(kind), label, prerequisites }
}

const D = (name: string) => makeKpId('degree', name)
const C = (name: string) => makeKpId('chord', name)

/**
 * T 轨 · 音级（spec §8.1）
 *
 * 调式进 id：la 基唱名下 `mi` 在大调是第 3 级（稳定），在小调是第 5 级
 * （属音，倾向性完全不同）。听辨它们是两种技能，掌握度必须分开追踪。
 */
const TONAL: KnowledgePoint[] = [
  // T1 主三和弦骨架
  kp('degree', 'major:do', '大调 do（主音）'),
  kp('degree', 'major:mi', '大调 mi（三级）'),
  kp('degree', 'major:sol', '大调 sol（属音）'),
  // T2 五声
  kp('degree', 'major:re', '大调 re（二级）', [D('major:do'), D('major:mi')]),
  kp('degree', 'major:la', '大调 la（六级）', [D('major:sol')]),
  // T3 补全大调
  kp('degree', 'major:fa', '大调 fa（下属，倾向 mi）', [D('major:mi'), D('major:sol')]),
  kp('degree', 'major:ti', '大调 ti（导音，倾向 do）', [D('major:do'), D('major:la')]),
  // T5 自然小调（la 基）
  kp('degree', 'minor:la', '小调 la（主音）', [D('major:la')]),
  kp('degree', 'minor:do', '小调 do（三级）', [D('minor:la')]),
  kp('degree', 'minor:mi', '小调 mi（属音）', [D('minor:la')]),
  kp('degree', 'minor:ti', '小调 ti（二级）', [D('minor:la'), D('minor:do')]),
  kp('degree', 'minor:re', '小调 re（四级）', [D('minor:do')]),
  kp('degree', 'minor:fa', '小调 fa（六级）', [D('minor:mi')]),
  kp('degree', 'minor:sol', '小调 sol（七级）', [D('minor:mi')]),
  // T6 和声/旋律小调
  kp('degree', 'minor:si', '小调升 7 级（和声小调导音）', [D('minor:sol'), D('minor:la')]),
  kp('degree', 'minor:fi', '小调升 6 级（旋律小调）', [D('minor:fa')]),
  // T7 常见变化音
  kp('degree', 'major:fi', '大调升 4 级 fi', [D('major:fa'), D('major:sol')]),
  kp('degree', 'major:te', '大调降 7 级 te', [D('major:ti'), D('major:la')]),
  kp('degree', 'major:me', '大调降 3 级 me', [D('major:mi'), D('major:re')]),
  // T8 转调
  kp('degree', 'modulation:shift', '调中心是否移动', [D('major:ti'), D('minor:si')]),
]

/** H 轨 · 和声（spec §8.1） */
const HARMONY: KnowledgePoint[] = [
  // H1 品质
  kp('chord', 'quality-maj', '大三和弦'),
  kp('chord', 'quality-min', '小三和弦'),
  // H2 主要功能
  kp('chord', 'I', 'I 级（主）', [C('quality-maj')]),
  kp('chord', 'IV', 'IV 级（下属）', [C('quality-maj'), C('I')]),
  kp('chord', 'V', 'V 级（属）', [C('quality-maj'), C('I')]),
  // H3 次要功能
  kp('chord', 'vi', 'vi 级', [C('quality-min'), C('I')]),
  kp('chord', 'ii', 'ii 级', [C('quality-min'), C('IV')]),
  // H4 七和弦
  kp('chord', 'V7', '属七和弦', [C('V')]),
  kp('chord', 'Imaj7', '大七和弦 Imaj7', [C('I')]),
  kp('chord', 'ii7', '小七和弦 ii7', [C('ii')]),
  kp('chord', 'vi7', '小七和弦 vi7', [C('vi')]),
  // H5 整条进行
  kp('prog', 'I-V-vi-IV', '进行 I–V–vi–IV', [C('I'), C('V'), C('vi'), C('IV')]),
  kp('prog', 'vi-IV-I-V', '进行 vi–IV–I–V', [C('I'), C('V'), C('vi'), C('IV')]),
  kp('prog', 'I-vi-IV-V', '进行 I–vi–IV–V', [C('I'), C('V'), C('vi'), C('IV')]),
  // H6 转位与低音线
  kp('chord', 'inv-first', '第一转位', [C('I'), C('IV'), C('V')]),
  kp('chord', 'inv-second', '第二转位', [C('inv-first')]),
  kp('chord', 'bassline', '低音线走向', [C('inv-first')]),
  // H7 小调进行
  kp('chord', 'i', 'i 级（小调主）', [C('quality-min')]),
  kp('chord', 'iv', 'iv 级（小调下属）', [C('i')]),
  kp('chord', 'VI', 'VI 级（小调）', [C('i')]),
  kp('chord', 'VII', 'VII 级（小调）', [C('i')]),
  kp('prog', 'i-VI-III-VII', '小调进行 i–VI–III–VII', [C('i'), C('VI'), C('VII')]),
  // H8 借用与副属
  kp('chord', 'V-of-V', '副属 V/V', [C('V'), C('ii')]),
  kp('chord', 'borrowed-bVI', '借用 ♭VI', [C('VI'), C('I')]),
  kp('chord', 'borrowed-bVII', '借用 ♭VII', [C('VII'), C('I')]),
]

/** R 轨 · 节奏（spec §8.1） */
const RHYTHM: KnowledgePoint[] = [
  // R1 拍点与拍号
  kp('rhythm', 'beat-one', '找 beat 1'),
  kp('rhythm', 'meter-2-4', '2/4 拍', [makeKpId('rhythm', 'beat-one')]),
  kp('rhythm', 'meter-3-4', '3/4 拍', [makeKpId('rhythm', 'beat-one')]),
  // R2 基本组合
  kp('rhythm', 'quarter', '四分音符', [makeKpId('rhythm', 'beat-one')]),
  kp('rhythm', 'eighth-pair', '八分音符组合', [makeKpId('rhythm', 'quarter')]),
  // R3 附点与休止
  kp('rhythm', 'dotted', '附点节奏', [makeKpId('rhythm', 'eighth-pair')]),
  kp('rhythm', 'rest', '休止符', [makeKpId('rhythm', 'quarter')]),
  // R4 十六分
  kp('rhythm', 'sixteenth', '十六分组合', [makeKpId('rhythm', 'eighth-pair')]),
  // R5 切分
  kp('rhythm', 'synco-8', '八分切分', [makeKpId('rhythm', 'eighth-pair'), makeKpId('rhythm', 'dotted')]),
  // R6 三连音与复合拍
  kp('rhythm', 'triplet', '三连音', [makeKpId('rhythm', 'eighth-pair')]),
  kp('rhythm', 'meter-6-8', '6/8 复合拍', [makeKpId('rhythm', 'triplet'), makeKpId('rhythm', 'meter-3-4')]),
  // R7 弱起与连线
  kp('rhythm', 'anacrusis', '弱起', [makeKpId('rhythm', 'beat-one'), makeKpId('rhythm', 'quarter')]),
  kp('rhythm', 'tie-across-bar', '跨小节连线', [makeKpId('rhythm', 'synco-8')]),
  // R8 混合拍子与复杂切分
  kp('rhythm', 'mixed-meter', '混合拍子', [makeKpId('rhythm', 'meter-6-8'), makeKpId('rhythm', 'meter-2-4')]),
  kp('rhythm', 'synco-16', '十六分切分', [makeKpId('rhythm', 'synco-8'), makeKpId('rhythm', 'sixteenth')]),
]

export const ALL_KNOWLEDGE_POINTS: readonly KnowledgePoint[] = [
  ...TONAL,
  ...HARMONY,
  ...RHYTHM,
]

export function knowledgePointsOfTrack(track: Track): KnowledgePoint[] {
  return ALL_KNOWLEDGE_POINTS.filter((kp) => kp.track === track)
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/curriculum/tracks.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(curriculum): 三轨道知识点数据"
```

---

### Task 3: 阶段与关卡数据

spec §8.1 的分级（T1–T8 / H1–H8 / R1–R8）与 §8.2 的阶段（P1–P5）。**阶段既能引入新知识点，也能提高对已有知识点的语境/变异要求**（建模决策 1）。

**Files:**
- Create: `src/curriculum/stages.ts`
- Test: `src/curriculum/stages.test.ts`

**Interfaces:**
- Consumes: `knowledgePoints.ts` 的 `KnowledgePointId`, `Track`；`music/tonalContext.ts` 的 `ContextLevel`
- Produces:
  - `type VariationLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6`
  - `type StageId = string`
  - `type PhaseId = 'P1' | 'P2' | 'P3' | 'P4' | 'P5'`
  - `interface Stage { id: StageId; track: Track; label: string; introduces: KnowledgePointId[]; requiresContextLevel: ContextLevel; requiresVariationLevel: VariationLevel; prerequisiteStages: StageId[] }`
  - `interface GateSpec { stabilityThreshold: number; windowAccuracy: number; requiresBoss: boolean }`
  - `interface Phase { id: PhaseId; label: string; stages: StageId[]; gate: GateSpec }`
  - `const ALL_STAGES: readonly Stage[]`
  - `const ALL_PHASES: readonly Phase[]`
  - `const PHASE_ORDER: readonly PhaseId[]`

- [ ] **Step 1: 写失败的测试**

`src/curriculum/stages.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { ALL_PHASES, ALL_STAGES, PHASE_ORDER } from './stages'
import { ALL_KNOWLEDGE_POINTS } from './tracks'

const stageById = new Map(ALL_STAGES.map((s) => [s.id, s]))

describe('ALL_STAGES', () => {
  it('id 互不重复，且三轨各八级共 24 级', () => {
    const ids = ALL_STAGES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(24)
  })

  it('id 形如 T1..T8 / H1..H8 / R1..R8，且与 track 字段一致', () => {
    for (const stage of ALL_STAGES) {
      expect(stage.id).toMatch(/^[THR][1-8]$/)
      expect(stage.id[0]).toBe(stage.track)
    }
  })

  it('引入的知识点全部存在，且每个知识点恰好被引入一次', () => {
    const known = new Set(ALL_KNOWLEDGE_POINTS.map((kp) => kp.id))
    const introduced: string[] = []
    for (const stage of ALL_STAGES) {
      for (const id of stage.introduces) {
        expect(known.has(id)).toBe(true)
        introduced.push(id)
      }
    }
    expect(new Set(introduced).size).toBe(introduced.length)
    // 无孤立知识点：每个都被某一级引入
    expect(new Set(introduced).size).toBe(known.size)
  })

  it('引入的知识点其 track 必须等于所在级的 track', () => {
    const trackOf = new Map(ALL_KNOWLEDGE_POINTS.map((kp) => [kp.id, kp.track]))
    for (const stage of ALL_STAGES) {
      for (const id of stage.introduces) {
        expect(trackOf.get(id)).toBe(stage.track)
      }
    }
  })

  it('前置级存在，且序号严格小于本级（无环、无前向引用）', () => {
    for (const stage of ALL_STAGES) {
      for (const pre of stage.prerequisiteStages) {
        expect(stageById.has(pre)).toBe(true)
        const preStage = stageById.get(pre)!
        expect(preStage.track).toBe(stage.track)
        expect(Number(pre.slice(1))).toBeLessThan(Number(stage.id.slice(1)))
      }
    }
  })

  it('同一轨道内语境与变异要求单调不减', () => {
    for (const track of ['T', 'H', 'R'] as const) {
      const stages = ALL_STAGES.filter((s) => s.track === track).sort(
        (a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)),
      )
      for (let i = 1; i < stages.length; i++) {
        expect(stages[i].requiresContextLevel).toBeGreaterThanOrEqual(
          stages[i - 1].requiresContextLevel,
        )
        expect(stages[i].requiresVariationLevel).toBeGreaterThanOrEqual(
          stages[i - 1].requiresVariationLevel,
        )
      }
    }
  })

  it('T4 不引入新知识点，只提高语境要求（建模决策 1）', () => {
    const t3 = stageById.get('T3')!
    const t4 = stageById.get('T4')!
    expect(t4.introduces).toHaveLength(0)
    expect(t4.requiresContextLevel).toBeGreaterThan(t3.requiresContextLevel)
  })
})

describe('ALL_PHASES', () => {
  it('恰好五个阶段，顺序为 P1..P5', () => {
    expect(ALL_PHASES.map((p) => p.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5'])
    expect([...PHASE_ORDER]).toEqual(['P1', 'P2', 'P3', 'P4', 'P5'])
  })

  it('每一级恰好属于一个阶段，且全部 24 级都被覆盖', () => {
    const assigned = ALL_PHASES.flatMap((p) => p.stages)
    expect(new Set(assigned).size).toBe(assigned.length)
    expect(new Set(assigned)).toEqual(new Set(ALL_STAGES.map((s) => s.id)))
  })

  it('阶段内的级全部存在，且一个级的前置级不得排在更晚的阶段', () => {
    const phaseIndexOfStage = new Map<string, number>()
    ALL_PHASES.forEach((p, i) => p.stages.forEach((s) => phaseIndexOfStage.set(s, i)))
    for (const stage of ALL_STAGES) {
      expect(phaseIndexOfStage.has(stage.id)).toBe(true)
      for (const pre of stage.prerequisiteStages) {
        expect(phaseIndexOfStage.get(pre)!).toBeLessThanOrEqual(
          phaseIndexOfStage.get(stage.id)!,
        )
      }
    }
  })

  it('每个阶段都要求过实战关，且阈值为正（spec §8.3 无逃生口）', () => {
    for (const phase of ALL_PHASES) {
      expect(phase.gate.requiresBoss).toBe(true)
      expect(phase.gate.stabilityThreshold).toBeGreaterThan(0)
      expect(phase.gate.meanStepThreshold).toBeGreaterThan(0)
      // 档位范围是 0–5，阈值必须留出余量，否则关卡不可达
      expect(phase.gate.meanStepThreshold).toBeLessThanOrEqual(4)
    }
  })

  it('关卡阈值随阶段递增', () => {
    for (let i = 1; i < ALL_PHASES.length; i++) {
      expect(ALL_PHASES[i].gate.stabilityThreshold).toBeGreaterThan(
        ALL_PHASES[i - 1].gate.stabilityThreshold,
      )
      expect(ALL_PHASES[i].gate.meanStepThreshold).toBeGreaterThanOrEqual(
        ALL_PHASES[i - 1].gate.meanStepThreshold,
      )
    }
  })

  it('P1 覆盖 T1–T2 / H1–H2 / R1–R2（spec §8.2）', () => {
    const p1 = ALL_PHASES[0]
    expect(new Set(p1.stages)).toEqual(new Set(['T1', 'T2', 'H1', 'H2', 'R1', 'R2']))
  })
})
```

「每个知识点恰好被引入一次」与「全部 24 级都被覆盖」这两条是课程数据的核心校验——漏一个知识点它就永远不会被调度到，而这在没有测试时完全无声。

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/curriculum/stages.test.ts`
Expected: FAIL — 无法解析模块 `./stages`

- [ ] **Step 3: 写实现**

`src/curriculum/stages.ts`：

```ts
import type { ContextLevel } from '../music/tonalContext'
import type { KnowledgePointId, Track } from './knowledgePoints'

/** 当前开放到第几个变异轴（spec §6.2）。0 = 全固定，6 = 全部六轴开放。 */
export type VariationLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** 形如 T1..T8 / H1..H8 / R1..R8 */
export type StageId = string

export type PhaseId = 'P1' | 'P2' | 'P3' | 'P4' | 'P5'

export const PHASE_ORDER: readonly PhaseId[] = ['P1', 'P2', 'P3', 'P4', 'P5']

export interface Stage {
  id: StageId
  track: Track
  label: string
  /**
   * 本级新引入的知识点。可以为空——例如 T4 不引入新音级，
   * 只把语境要求从 L1 提到 L3（建模决策 1）。
   */
  introduces: KnowledgePointId[]
  /** 本级要求达到的语境强度。数值越大语境越弱、越难（spec §6.1） */
  requiresContextLevel: ContextLevel
  requiresVariationLevel: VariationLevel
  prerequisiteStages: StageId[]
}

export interface GateSpec {
  /** 该阶段全部知识点在三个模态上都需达到的 stability（天） */
  stabilityThreshold: number
  /**
   * 窗口平均阶梯档位下限（档位范围 0–5）。
   *
   * 用平均档位而非正确率，理由同 gating（建模决策 4）：2-down-1-up 把
   * 观测正确率锁在约 71%，任何高于它的正确率门槛都会让关卡永不可过。
   */
  meanStepThreshold: number
  /** spec §8.3：无逃生口，实战关必过 */
  requiresBoss: boolean
}

export interface Phase {
  id: PhaseId
  label: string
  stages: StageId[]
  gate: GateSpec
}

const D = (name: string): KnowledgePointId => `degree:${name}`
const C = (name: string): KnowledgePointId => `chord:${name}`
const P = (name: string): KnowledgePointId => `prog:${name}`
const R = (name: string): KnowledgePointId => `rhythm:${name}`

export const ALL_STAGES: readonly Stage[] = [
  // ---- T 轨 · 音级 ----
  {
    id: 'T1', track: 'T', label: '主三和弦骨架 do mi sol',
    introduces: [D('major:do'), D('major:mi'), D('major:sol')],
    requiresContextLevel: 0, requiresVariationLevel: 0, prerequisiteStages: [],
  },
  {
    id: 'T2', track: 'T', label: '五声 + re la',
    introduces: [D('major:re'), D('major:la')],
    requiresContextLevel: 1, requiresVariationLevel: 1, prerequisiteStages: ['T1'],
  },
  {
    id: 'T3', track: 'T', label: '补全大调 + fa ti',
    introduces: [D('major:fa'), D('major:ti')],
    requiresContextLevel: 1, requiresVariationLevel: 2, prerequisiteStages: ['T2'],
  },
  {
    id: 'T4', track: 'T', label: '大调全音阶随机，语境降至 L2–L3',
    introduces: [],
    requiresContextLevel: 3, requiresVariationLevel: 3, prerequisiteStages: ['T3'],
  },
  {
    id: 'T5', track: 'T', label: '自然小调（la 基）',
    introduces: [
      D('minor:la'), D('minor:do'), D('minor:mi'),
      D('minor:ti'), D('minor:re'), D('minor:fa'), D('minor:sol'),
    ],
    requiresContextLevel: 3, requiresVariationLevel: 3, prerequisiteStages: ['T4'],
  },
  {
    id: 'T6', track: 'T', label: '和声/旋律小调的升 6、升 7',
    introduces: [D('minor:si'), D('minor:fi')],
    requiresContextLevel: 3, requiresVariationLevel: 4, prerequisiteStages: ['T5'],
  },
  {
    id: 'T7', track: 'T', label: '常见变化音 fi te me',
    introduces: [D('major:fi'), D('major:te'), D('major:me')],
    requiresContextLevel: 4, requiresVariationLevel: 5, prerequisiteStages: ['T6'],
  },
  {
    id: 'T8', track: 'T', label: '转调听辨',
    introduces: [D('modulation:shift')],
    requiresContextLevel: 4, requiresVariationLevel: 6, prerequisiteStages: ['T7'],
  },

  // ---- H 轨 · 和声 ----
  {
    id: 'H1', track: 'H', label: '大三 / 小三',
    introduces: [C('quality-maj'), C('quality-min')],
    requiresContextLevel: 0, requiresVariationLevel: 0, prerequisiteStages: [],
  },
  {
    id: 'H2', track: 'H', label: 'I IV V 功能识别',
    introduces: [C('I'), C('IV'), C('V')],
    requiresContextLevel: 1, requiresVariationLevel: 1, prerequisiteStages: ['H1'],
  },
  {
    id: 'H3', track: 'H', label: '+ vi ii',
    introduces: [C('vi'), C('ii')],
    requiresContextLevel: 2, requiresVariationLevel: 2, prerequisiteStages: ['H2'],
  },
  {
    id: 'H4', track: 'H', label: 'V7 及常用七和弦',
    introduces: [C('V7'), C('Imaj7'), C('ii7'), C('vi7')],
    requiresContextLevel: 2, requiresVariationLevel: 3, prerequisiteStages: ['H3'],
  },
  {
    id: 'H5', track: 'H', label: '整条进行识别',
    introduces: [P('I-V-vi-IV'), P('vi-IV-I-V'), P('I-vi-IV-V')],
    requiresContextLevel: 3, requiresVariationLevel: 3, prerequisiteStages: ['H4'],
  },
  {
    id: 'H6', track: 'H', label: '转位与低音线',
    introduces: [C('inv-first'), C('inv-second'), C('bassline')],
    requiresContextLevel: 3, requiresVariationLevel: 4, prerequisiteStages: ['H5'],
  },
  {
    id: 'H7', track: 'H', label: '小调进行',
    introduces: [C('i'), C('iv'), C('VI'), C('VII'), P('i-VI-III-VII')],
    requiresContextLevel: 3, requiresVariationLevel: 5, prerequisiteStages: ['H6'],
  },
  {
    id: 'H8', track: 'H', label: '借用和弦、副属',
    introduces: [C('V-of-V'), C('borrowed-bVI'), C('borrowed-bVII')],
    requiresContextLevel: 4, requiresVariationLevel: 6, prerequisiteStages: ['H7'],
  },

  // ---- R 轨 · 节奏 ----
  {
    id: 'R1', track: 'R', label: '找 beat 1、强弱拍、拍号',
    introduces: [R('beat-one'), R('meter-2-4'), R('meter-3-4')],
    requiresContextLevel: 0, requiresVariationLevel: 0, prerequisiteStages: [],
  },
  {
    id: 'R2', track: 'R', label: '四分 + 八分基本组合',
    introduces: [R('quarter'), R('eighth-pair')],
    requiresContextLevel: 0, requiresVariationLevel: 1, prerequisiteStages: ['R1'],
  },
  {
    id: 'R3', track: 'R', label: '附点与休止',
    introduces: [R('dotted'), R('rest')],
    requiresContextLevel: 1, requiresVariationLevel: 2, prerequisiteStages: ['R2'],
  },
  {
    id: 'R4', track: 'R', label: '十六分组合',
    introduces: [R('sixteenth')],
    requiresContextLevel: 1, requiresVariationLevel: 3, prerequisiteStages: ['R3'],
  },
  {
    id: 'R5', track: 'R', label: '切分',
    introduces: [R('synco-8')],
    requiresContextLevel: 2, requiresVariationLevel: 3, prerequisiteStages: ['R4'],
  },
  {
    id: 'R6', track: 'R', label: '三连音、6/8 复合拍',
    introduces: [R('triplet'), R('meter-6-8')],
    requiresContextLevel: 2, requiresVariationLevel: 4, prerequisiteStages: ['R5'],
  },
  {
    id: 'R7', track: 'R', label: '弱起、跨小节连线',
    introduces: [R('anacrusis'), R('tie-across-bar')],
    requiresContextLevel: 3, requiresVariationLevel: 5, prerequisiteStages: ['R6'],
  },
  {
    id: 'R8', track: 'R', label: '混合拍子、复杂切分',
    introduces: [R('mixed-meter'), R('synco-16')],
    requiresContextLevel: 4, requiresVariationLevel: 6, prerequisiteStages: ['R7'],
  },
]

/**
 * 关卡阈值随阶段递增：越往后要求记忆越牢固。
 * spec §8.3：三模态齐平 + 实战关一次通过，无逃生口。
 */
export const ALL_PHASES: readonly Phase[] = [
  {
    id: 'P1', label: '找到调中心',
    stages: ['T1', 'T2', 'H1', 'H2', 'R1', 'R2'],
    gate: { stabilityThreshold: 6, meanStepThreshold: 1.5, requiresBoss: true },
  },
  {
    id: 'P2', label: '大调站稳',
    stages: ['T3', 'T4', 'H3', 'R3', 'R4'],
    gate: { stabilityThreshold: 9, meanStepThreshold: 1.8, requiresBoss: true },
  },
  {
    id: 'P3', label: '和声感',
    stages: ['T5', 'H4', 'H5', 'R5'],
    gate: { stabilityThreshold: 12, meanStepThreshold: 2, requiresBoss: true },
  },
  {
    id: 'P4', label: '实战扒谱',
    stages: ['T6', 'T7', 'H6', 'H7', 'R6', 'R7'],
    gate: { stabilityThreshold: 16, meanStepThreshold: 2.2, requiresBoss: true },
  },
  {
    id: 'P5', label: '进阶',
    stages: ['T8', 'H8', 'R8'],
    gate: { stabilityThreshold: 20, meanStepThreshold: 2.5, requiresBoss: true },
  },
]
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/curriculum/stages.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 运行全部测试与类型检查**

```bash
npx vitest run
npx tsc --noEmit
```

Expected: 全部 PASS，tsc 无输出

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(curriculum): 阶段与关卡数据"
```

---

### Task 4: 课程组装与查询

把三份数据装成一个可查询的 `Curriculum`。调度器全部通过这层访问课程，不直接读数据文件。

**关键语义**：某知识点在某阶段的语境/变异要求，等于**该知识点所在轨道上、当前已解锁的最高一级**的要求——不是引入它那一级的要求。这正是建模决策 1 的落地：T4 把 T1–T3 引入的全部音级的语境要求一起提到 L3。

**Files:**
- Create: `src/curriculum/curriculum.ts`
- Test: `src/curriculum/curriculum.test.ts`

**Interfaces:**
- Consumes: `knowledgePoints.ts`；`tracks.ts` 的 `ALL_KNOWLEDGE_POINTS`；`stages.ts` 的 `ALL_STAGES`, `ALL_PHASES`, `PHASE_ORDER`, `Stage`, `Phase`, `PhaseId`, `StageId`, `VariationLevel`
- Produces:
  - `interface Curriculum { knowledgePoints: ReadonlyMap<KnowledgePointId, KnowledgePoint>; stages: ReadonlyMap<StageId, Stage>; phases: readonly Phase[]; phaseOfStage: ReadonlyMap<StageId, PhaseId> }`
  - `interface LevelRequirement { contextLevel: ContextLevel; variationLevel: VariationLevel }`
  - `buildCurriculum(): Curriculum`
  - `phaseIndex(phaseId: PhaseId): number`
  - `phaseAt(index: number): PhaseId`
  - `stagesUpTo(c: Curriculum, phaseId: PhaseId): Stage[]`
  - `unlockedKnowledgePoints(c: Curriculum, phaseId: PhaseId): KnowledgePointId[]`
  - `knowledgePointsOfPhase(c: Curriculum, phaseId: PhaseId): KnowledgePointId[]`
  - `requirementFor(c: Curriculum, kpId: KnowledgePointId, phaseId: PhaseId): LevelRequirement`
  - `phaseOfKnowledgePoint(c: Curriculum, kpId: KnowledgePointId): PhaseId`

- [ ] **Step 1: 写失败的测试**

`src/curriculum/curriculum.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  buildCurriculum,
  knowledgePointsOfPhase,
  phaseAt,
  phaseIndex,
  phaseOfKnowledgePoint,
  requirementFor,
  stagesUpTo,
  unlockedKnowledgePoints,
} from './curriculum'
import { ALL_KNOWLEDGE_POINTS } from './tracks'
import { ALL_STAGES, PHASE_ORDER } from './stages'

const c = buildCurriculum()

describe('buildCurriculum', () => {
  it('索引覆盖全部知识点与全部级', () => {
    expect(c.knowledgePoints.size).toBe(ALL_KNOWLEDGE_POINTS.length)
    expect(c.stages.size).toBe(ALL_STAGES.length)
    expect(c.phaseOfStage.size).toBe(ALL_STAGES.length)
  })

  it('每次调用返回等价结果（纯函数）', () => {
    const other = buildCurriculum()
    expect([...other.knowledgePoints.keys()].sort()).toEqual(
      [...c.knowledgePoints.keys()].sort(),
    )
  })
})

describe('phaseIndex / phaseAt', () => {
  it('往返一致', () => {
    PHASE_ORDER.forEach((id, i) => {
      expect(phaseIndex(id)).toBe(i)
      expect(phaseAt(i)).toBe(id)
    })
  })
})

describe('stagesUpTo / unlockedKnowledgePoints', () => {
  it('P1 只含 P1 的级', () => {
    expect(new Set(stagesUpTo(c, 'P1').map((s) => s.id))).toEqual(
      new Set(['T1', 'T2', 'H1', 'H2', 'R1', 'R2']),
    )
  })

  it('解锁集合随阶段单调增长', () => {
    let prev = 0
    for (const phase of PHASE_ORDER) {
      const n = unlockedKnowledgePoints(c, phase).length
      expect(n).toBeGreaterThanOrEqual(prev)
      prev = n
    }
  })

  it('走到 P5 时全部知识点都已解锁', () => {
    expect(new Set(unlockedKnowledgePoints(c, 'P5'))).toEqual(
      new Set(ALL_KNOWLEDGE_POINTS.map((kp) => kp.id)),
    )
  })

  it('knowledgePointsOfPhase 只给该阶段新引入的', () => {
    const p1 = new Set(knowledgePointsOfPhase(c, 'P1'))
    const p2 = new Set(knowledgePointsOfPhase(c, 'P2'))
    expect(p1.has('degree:major:do')).toBe(true)
    expect(p2.has('degree:major:do')).toBe(false)
    expect(p2.has('degree:major:fa')).toBe(true)
  })
})

describe('requirementFor', () => {
  it('要求取自该轨道已解锁的最高一级，而非引入该点那一级', () => {
    // do 在 T1 引入（L0），但 P2 解锁了 T4（L3），故此时 do 的要求也是 L3
    expect(requirementFor(c, 'degree:major:do', 'P1').contextLevel).toBe(1) // T2
    expect(requirementFor(c, 'degree:major:do', 'P2').contextLevel).toBe(3) // T4
  })

  it('要求随阶段单调不减', () => {
    for (const kpId of unlockedKnowledgePoints(c, 'P1')) {
      let prevCtx = -1
      let prevVar = -1
      for (const phase of PHASE_ORDER) {
        const req = requirementFor(c, kpId, phase)
        expect(req.contextLevel).toBeGreaterThanOrEqual(prevCtx)
        expect(req.variationLevel).toBeGreaterThanOrEqual(prevVar)
        prevCtx = req.contextLevel
        prevVar = req.variationLevel
      }
    }
  })

  it('未知知识点抛错', () => {
    expect(() => requirementFor(c, 'degree:nope', 'P1')).toThrow()
  })
})

describe('phaseOfKnowledgePoint', () => {
  it('返回引入该知识点的那个阶段', () => {
    expect(phaseOfKnowledgePoint(c, 'degree:major:do')).toBe('P1')
    expect(phaseOfKnowledgePoint(c, 'degree:minor:la')).toBe('P3')
    expect(phaseOfKnowledgePoint(c, 'chord:V-of-V')).toBe('P5')
  })
})
```

「要求取自该轨道已解锁的最高一级」这条测试是建模决策 1 的守卫。写成「取引入那一级的要求」的天真实现会让它红。

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/curriculum/curriculum.test.ts`
Expected: FAIL — 无法解析模块 `./curriculum`

- [ ] **Step 3: 写实现**

`src/curriculum/curriculum.ts`：

```ts
import type { ContextLevel } from '../music/tonalContext'
import type { KnowledgePoint, KnowledgePointId } from './knowledgePoints'
import {
  ALL_PHASES,
  ALL_STAGES,
  PHASE_ORDER,
  type Phase,
  type PhaseId,
  type Stage,
  type StageId,
  type VariationLevel,
} from './stages'
import { ALL_KNOWLEDGE_POINTS } from './tracks'

export interface Curriculum {
  knowledgePoints: ReadonlyMap<KnowledgePointId, KnowledgePoint>
  stages: ReadonlyMap<StageId, Stage>
  phases: readonly Phase[]
  phaseOfStage: ReadonlyMap<StageId, PhaseId>
}

export interface LevelRequirement {
  contextLevel: ContextLevel
  variationLevel: VariationLevel
}

export function buildCurriculum(): Curriculum {
  const knowledgePoints = new Map(ALL_KNOWLEDGE_POINTS.map((kp) => [kp.id, kp]))
  const stages = new Map(ALL_STAGES.map((s) => [s.id, s]))
  const phaseOfStage = new Map<StageId, PhaseId>()
  for (const phase of ALL_PHASES) {
    for (const stageId of phase.stages) phaseOfStage.set(stageId, phase.id)
  }
  return { knowledgePoints, stages, phases: ALL_PHASES, phaseOfStage }
}

export function phaseIndex(phaseId: PhaseId): number {
  const i = PHASE_ORDER.indexOf(phaseId)
  if (i < 0) throw new Error(`未知阶段 ${phaseId}`)
  return i
}

export function phaseAt(index: number): PhaseId {
  const id = PHASE_ORDER[index]
  if (!id) throw new Error(`阶段下标越界: ${index}`)
  return id
}

/** 截至该阶段（含）已解锁的全部级 */
export function stagesUpTo(c: Curriculum, phaseId: PhaseId): Stage[] {
  const limit = phaseIndex(phaseId)
  return ALL_STAGES.filter((s) => {
    const p = c.phaseOfStage.get(s.id)
    return p !== undefined && phaseIndex(p) <= limit
  })
}

/** 截至该阶段（含）已引入的全部知识点 */
export function unlockedKnowledgePoints(
  c: Curriculum,
  phaseId: PhaseId,
): KnowledgePointId[] {
  return stagesUpTo(c, phaseId).flatMap((s) => s.introduces)
}

/** 仅该阶段新引入的知识点 */
export function knowledgePointsOfPhase(
  c: Curriculum,
  phaseId: PhaseId,
): KnowledgePointId[] {
  const phase = c.phases.find((p) => p.id === phaseId)
  if (!phase) throw new Error(`未知阶段 ${phaseId}`)
  return phase.stages.flatMap((id) => c.stages.get(id)?.introduces ?? [])
}

/**
 * 某知识点在某阶段的语境/变异要求。
 *
 * 取该知识点所在轨道上、截至当前阶段已解锁的**最高一级**的要求——
 * 不是引入它那一级的要求。这是建模决策 1 的落地：T4 不引入新音级，
 * 但把 T1–T3 引入的全部音级的语境要求一起提到 L3。
 * 同轨道内要求单调不减（由 stages.test.ts 保证），故取最后一级即最高。
 */
export function requirementFor(
  c: Curriculum,
  kpId: KnowledgePointId,
  phaseId: PhaseId,
): LevelRequirement {
  const kp = c.knowledgePoints.get(kpId)
  if (!kp) throw new Error(`未知知识点 ${kpId}`)
  const unlocked = stagesUpTo(c, phaseId).filter((s) => s.track === kp.track)
  if (unlocked.length === 0) {
    throw new Error(`知识点 ${kpId} 所在轨道 ${kp.track} 在 ${phaseId} 尚无解锁的级`)
  }
  const highest = unlocked.reduce((a, b) =>
    Number(b.id.slice(1)) > Number(a.id.slice(1)) ? b : a,
  )
  return {
    contextLevel: highest.requiresContextLevel,
    variationLevel: highest.requiresVariationLevel,
  }
}

/** 引入该知识点的阶段 */
export function phaseOfKnowledgePoint(
  c: Curriculum,
  kpId: KnowledgePointId,
): PhaseId {
  for (const stage of ALL_STAGES) {
    if (stage.introduces.includes(kpId)) {
      const phase = c.phaseOfStage.get(stage.id)
      if (!phase) throw new Error(`级 ${stage.id} 未归属任何阶段`)
      return phase
    }
  }
  throw new Error(`知识点 ${kpId} 未被任何级引入`)
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/curriculum/curriculum.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(curriculum): 课程组装与查询"
```

---

### Task 5: 课程数据校验

spec §13 要求的课程校验。Task 2/3 的测试已覆盖单文件内的一致性；本任务补的是**跨文件、跨轨道的依赖顺序**——一个知识点的前置不得在更晚的级才被引入。这类错误在没有校验时完全无声：调度器会引入一个前置未满足的知识点，学习者撞上一道他没有基础的题。

**Files:**
- Create: `src/curriculum/validate.ts`
- Test: `src/curriculum/validate.test.ts`

**Interfaces:**
- Consumes: `curriculum.ts` 的 `Curriculum`, `buildCurriculum`, `phaseIndex`；`stages.ts` 的 `ALL_STAGES`, `StageId`
- Produces:
  - `interface CurriculumProblem { code: string; message: string }`
  - `validateCurriculum(c: Curriculum): CurriculumProblem[]`
  - `stageOrderIndex(c: Curriculum, stageId: StageId): number`

- [ ] **Step 1: 写失败的测试**

`src/curriculum/validate.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from './curriculum'
import { stageOrderIndex, validateCurriculum } from './validate'
import type { Curriculum } from './curriculum'
import type { KnowledgePoint } from './knowledgePoints'

const c = buildCurriculum()

/** 复制课程并替换一个知识点，用于制造已知错误 */
function withKnowledgePoint(base: Curriculum, kp: KnowledgePoint): Curriculum {
  const kps = new Map(base.knowledgePoints)
  kps.set(kp.id, kp)
  return { ...base, knowledgePoints: kps }
}

describe('validateCurriculum', () => {
  it('真实课程数据零问题', () => {
    expect(validateCurriculum(c)).toEqual([])
  })

  it('抓出前置知识点在更晚的级才引入的情况', () => {
    // do 在 T1 引入；把它的前置改成 T7 才引入的 major:me
    const broken = withKnowledgePoint(c, {
      ...c.knowledgePoints.get('degree:major:do')!,
      prerequisites: ['degree:major:me'],
    })
    const problems = validateCurriculum(broken)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.some((p) => p.code === 'prerequisite-introduced-later')).toBe(true)
    expect(problems[0].message).toContain('degree:major:do')
  })

  it('抓出前置知识点不存在的情况', () => {
    const broken = withKnowledgePoint(c, {
      ...c.knowledgePoints.get('chord:V7')!,
      prerequisites: ['chord:does-not-exist'],
    })
    const problems = validateCurriculum(broken)
    expect(problems.some((p) => p.code === 'prerequisite-missing')).toBe(true)
  })

  it('抓出自引用', () => {
    const broken = withKnowledgePoint(c, {
      ...c.knowledgePoints.get('chord:V7')!,
      prerequisites: ['chord:V7'],
    })
    expect(validateCurriculum(broken).some((p) => p.code === 'self-prerequisite')).toBe(
      true,
    )
  })

  it('允许前置与该知识点在同一级引入', () => {
    // inv-second 的前置 inv-first 同在 H6，这是合法的
    expect(
      validateCurriculum(c).some((p) => p.message.includes('chord:inv-second')),
    ).toBe(false)
  })

  it('抓出未被任何级引入的孤立知识点', () => {
    const kps = new Map(c.knowledgePoints)
    kps.set('degree:orphan', {
      id: 'degree:orphan', kind: 'degree', track: 'T',
      label: '孤儿', prerequisites: [],
    })
    expect(
      validateCurriculum({ ...c, knowledgePoints: kps }).some(
        (p) => p.code === 'orphan-knowledge-point',
      ),
    ).toBe(true)
  })
})

describe('stageOrderIndex', () => {
  it('按阶段优先、同阶段内按级号排序', () => {
    expect(stageOrderIndex(c, 'T1')).toBeLessThan(stageOrderIndex(c, 'T3'))
    // T3 在 P2、H2 在 P1，故 H2 更靠前
    expect(stageOrderIndex(c, 'H2')).toBeLessThan(stageOrderIndex(c, 'T3'))
  })

  it('未知级抛错', () => {
    expect(() => stageOrderIndex(c, 'Z9')).toThrow()
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/curriculum/validate.test.ts`
Expected: FAIL — 无法解析模块 `./validate`

- [ ] **Step 3: 写实现**

`src/curriculum/validate.ts`：

```ts
import { phaseIndex, type Curriculum } from './curriculum'
import { ALL_STAGES, type StageId } from './stages'

export interface CurriculumProblem {
  code: string
  message: string
}

/**
 * 级在全课程中的绝对顺序：先按所属阶段，同阶段内按级号。
 * 三条轨道并行推进，所以「顺序」只在跨阶段时严格，同阶段内的级视为并列。
 */
export function stageOrderIndex(c: Curriculum, stageId: StageId): number {
  const phase = c.phaseOfStage.get(stageId)
  if (!phase) throw new Error(`未知的级 ${stageId}`)
  return phaseIndex(phase) * 100 + Number(stageId.slice(1))
}

export function validateCurriculum(c: Curriculum): CurriculumProblem[] {
  const problems: CurriculumProblem[] = []

  // 每个知识点由哪一级引入
  const introducedBy = new Map<string, StageId>()
  for (const stage of ALL_STAGES) {
    for (const id of stage.introduces) introducedBy.set(id, stage.id)
  }

  for (const kp of c.knowledgePoints.values()) {
    const ownStage = introducedBy.get(kp.id)
    if (!ownStage) {
      problems.push({
        code: 'orphan-knowledge-point',
        message: `知识点 ${kp.id} 未被任何级引入，将永远不会被调度到`,
      })
      continue
    }
    const ownOrder = stageOrderIndex(c, ownStage)

    for (const pre of kp.prerequisites) {
      if (pre === kp.id) {
        problems.push({
          code: 'self-prerequisite',
          message: `知识点 ${kp.id} 把自己列为前置`,
        })
        continue
      }
      if (!c.knowledgePoints.has(pre)) {
        problems.push({
          code: 'prerequisite-missing',
          message: `知识点 ${kp.id} 的前置 ${pre} 不存在`,
        })
        continue
      }
      const preStage = introducedBy.get(pre)
      if (!preStage) {
        problems.push({
          code: 'prerequisite-missing',
          message: `知识点 ${kp.id} 的前置 ${pre} 未被任何级引入`,
        })
        continue
      }
      // 允许同一级（如 H6 的 inv-first → inv-second），禁止更晚
      if (stageOrderIndex(c, preStage) > ownOrder) {
        problems.push({
          code: 'prerequisite-introduced-later',
          message:
            `知识点 ${kp.id}（${ownStage}）的前置 ${pre} 在更晚的 ${preStage} 才引入`,
        })
      }
    }
  }

  return problems
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/curriculum/validate.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(curriculum): 跨文件依赖顺序校验"
```

---

### Task 6: 掌握度状态与更新规则

spec §7.1、§7.2。每个 `(知识点, 模态)` 组合一份独立状态。

**核心是那个 `(1 − R)` 因子**：在接近遗忘时成功检索，stability 增长最多。这不是任意倍数，是间隔效应的机制（spec §2.6）。它的直接推论是——**同一天重复答对同一题，stability 完全不增长**（Δt=0 → R=1 → 增益为 0）。集中练习不产生持久记忆，这正是要的行为。

**Files:**
- Create: `src/scheduling/mastery.ts`
- Test: `src/scheduling/mastery.test.ts`

**Interfaces:**
- Consumes: `curriculum/stages.ts` 的 `VariationLevel`；`music/tonalContext.ts` 的 `ContextLevel`
- Produces:
  - `interface AttemptOutcome { correct: boolean; day: number; difficultyStep: number }`
  - `interface MasteryState { stability: number; difficulty: number; variationLevel: VariationLevel; contextLevel: ContextLevel; window: AttemptOutcome[]; lastSeenDay: number | null }`
  - `type MasteryStore = ReadonlyMap<MasteryKey, MasteryState>`
  - 常量 `WINDOW_SIZE`, `DUE_THRESHOLD`, `MIN_STABILITY`, `INITIAL_STABILITY`, `INITIAL_DIFFICULTY`, `GAIN_A`, `LAPSE_C`, `DIFFICULTY_UP`, `DIFFICULTY_DOWN`
  - `initialMastery(): MasteryState`
  - `retrievability(state: MasteryState, today: number): number`
  - `isDue(state: MasteryState, today: number): boolean`
  - `applyAttempt(state: MasteryState, correct: boolean, today: number, difficultyStep: number): MasteryState`
  - `getMastery(store: MasteryStore, key: MasteryKey): MasteryState`

**注意 `difficultyStep` 参数**：每次尝试都要记下它是在哪个阶梯档位上做的。这是建模决策 4 的落地——升级判据用的是窗口内的平均档位，不是原始正确率。少记这个字段，Task 7 的门控就无从判断。

- [ ] **Step 1: 写失败的测试**

`src/scheduling/mastery.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  DUE_THRESHOLD,
  MIN_STABILITY,
  applyAttempt,
  getMastery,
  initialMastery,
  isDue,
  retrievability,
} from './mastery'

describe('initialMastery', () => {
  it('从未练过：lastSeenDay 为 null，两个等级都从 0 起', () => {
    const s = initialMastery()
    expect(s.lastSeenDay).toBeNull()
    expect(s.variationLevel).toBe(0)
    expect(s.contextLevel).toBe(0)
    expect(s.window).toEqual([])
    expect(s.stability).toBeGreaterThan(0)
  })
})

describe('retrievability', () => {
  it('从未练过时为 0（视为完全不可提取，必然到期）', () => {
    expect(retrievability(initialMastery(), 0)).toBe(0)
    expect(isDue(initialMastery(), 0)).toBe(true)
  })

  it('刚练过（同一天）为 1', () => {
    const s = applyAttempt(initialMastery(), true, 5, 0)
    expect(retrievability(s, 5)).toBeCloseTo(1, 10)
    expect(isDue(s, 5)).toBe(false)
  })

  it('随时间单调递减', () => {
    const s = applyAttempt(initialMastery(), true, 0, 0)
    let prev = Infinity
    for (const day of [0, 1, 2, 5, 10, 30]) {
      const r = retrievability(s, day)
      expect(r).toBeLessThanOrEqual(prev)
      prev = r
    }
  })

  it('stability 越大，同样天数后的可提取性越高', () => {
    const weak = { ...applyAttempt(initialMastery(), true, 0, 0), stability: 2 }
    const strong = { ...weak, stability: 20 }
    expect(retrievability(strong, 5)).toBeGreaterThan(retrievability(weak, 5))
  })

  it('isDue 的门槛就是 DUE_THRESHOLD', () => {
    const s = { ...applyAttempt(initialMastery(), true, 0, 0), stability: 10 }
    // R = exp(-d/10)；令 R 恰好略低于阈值
    const day = -10 * Math.log(DUE_THRESHOLD) + 0.01
    expect(retrievability(s, day)).toBeLessThan(DUE_THRESHOLD)
    expect(isDue(s, day)).toBe(true)
  })
})

describe('applyAttempt', () => {
  it('答对：stability 增长，difficulty 不上升', () => {
    const before = applyAttempt(initialMastery(), true, 0, 0)
    const after = applyAttempt(before, true, 10, 0)
    expect(after.stability).toBeGreaterThan(before.stability)
    expect(after.difficulty).toBeLessThanOrEqual(before.difficulty)
  })

  it('答错：stability 衰减但不低于下限，difficulty 上升', () => {
    let s = applyAttempt(initialMastery(), true, 0, 0)
    s = applyAttempt(s, true, 10, 0)
    const before = s
    const after = applyAttempt(before, false, 20, 0)
    expect(after.stability).toBeLessThan(before.stability)
    expect(after.stability).toBeGreaterThanOrEqual(MIN_STABILITY)
    expect(after.difficulty).toBeGreaterThan(before.difficulty)
  })

  it('连续答错时 stability 不会跌破下限', () => {
    let s = initialMastery()
    for (let day = 0; day < 30; day++) s = applyAttempt(s, false, day, 0)
    expect(s.stability).toBeGreaterThanOrEqual(MIN_STABILITY)
    expect(s.difficulty).toBeLessThanOrEqual(1)
  })

  it('同一天重复答对，stability 不再增长（间隔效应的机制）', () => {
    const first = applyAttempt(initialMastery(), true, 7, 0)
    const second = applyAttempt(first, true, 7, 0)
    const third = applyAttempt(second, true, 7, 0)
    expect(second.stability).toBeCloseTo(first.stability, 10)
    expect(third.stability).toBeCloseTo(first.stability, 10)
  })

  it('间隔越久后答对，stability 增长越多', () => {
    const base = applyAttempt(initialMastery(), true, 0, 0)
    const soon = applyAttempt(base, true, 1, 0)
    const late = applyAttempt(base, true, 20, 0)
    expect(late.stability - base.stability).toBeGreaterThan(
      soon.stability - base.stability,
    )
  })

  it('窗口保留最近 20 次，且不修改输入状态', () => {
    let s = initialMastery()
    const snapshot = { ...s, window: [...s.window] }
    for (let day = 0; day < 30; day++) s = applyAttempt(s, day % 2 === 0, day, 0)
    expect(s.window).toHaveLength(20)
    expect(s.window[s.window.length - 1].day).toBe(29)
    expect(snapshot.window).toEqual([])
  })

  it('窗口记录每次尝试所在的阶梯档位（建模决策 4 的依据）', () => {
    let s = initialMastery()
    s = applyAttempt(s, true, 0, 3)
    s = applyAttempt(s, false, 1, 4)
    expect(s.window.map((a) => a.difficultyStep)).toEqual([3, 4])
  })

  it('阶梯档位不影响 stability 的算法，只被记录', () => {
    const atZero = applyAttempt(initialMastery(), true, 0, 0)
    const atFive = applyAttempt(initialMastery(), true, 0, 5)
    expect(atFive.stability).toBeCloseTo(atZero.stability, 10)
  })

  it('lastSeenDay 更新为本次尝试日', () => {
    expect(applyAttempt(initialMastery(), true, 42, 0).lastSeenDay).toBe(42)
  })

  it('difficulty 始终落在 0–1', () => {
    let s = initialMastery()
    for (let day = 0; day < 60; day++) s = applyAttempt(s, day % 7 === 0, day, 0)
    expect(s.difficulty).toBeGreaterThanOrEqual(0)
    expect(s.difficulty).toBeLessThanOrEqual(1)
  })
})

describe('getMastery', () => {
  it('缺失的 key 返回初始状态而非 undefined', () => {
    expect(getMastery(new Map(), 'degree:major:do@recognize')).toEqual(initialMastery())
  })
})
```

「同一天重复答对 stability 不增长」与「间隔越久增长越多」这两条一起，是 spec §2.6 那个 `(1 − R)` 因子的行为守卫。把它去掉换成固定倍数，两条都会红。

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/scheduling/mastery.test.ts`
Expected: FAIL — 无法解析模块 `./mastery`

- [ ] **Step 3: 写实现**

`src/scheduling/mastery.ts`：

```ts
import type { ContextLevel } from '../music/tonalContext'
import type { MasteryKey } from '../curriculum/knowledgePoints'
import type { VariationLevel } from '../curriculum/stages'

export interface AttemptOutcome {
  correct: boolean
  /** 绝对天数。仿真里是虚拟日，线上是自 Profile 创建起的天数 */
  day: number
  /**
   * 这次尝试是在哪个阶梯档位上做的。
   *
   * 必须记录：升级判据用的是窗口内的平均档位而非原始正确率（建模决策 4）。
   * 阶梯把观测正确率锁在约 71%，用原始正确率当判据会让升级永不发生。
   */
  difficultyStep: number
}

export interface MasteryState {
  /** 遗忘时间常数（天） */
  stability: number
  /** 该点对该用户的难度 0–1 */
  difficulty: number
  /** 当前开放到第几个变异轴（spec §6.2） */
  variationLevel: VariationLevel
  /** 当前语境强度 L0–L4，数值越大越难（spec §6.1） */
  contextLevel: ContextLevel
  /** 最近 WINDOW_SIZE 次尝试 */
  window: AttemptOutcome[]
  /** 从未练过时为 null */
  lastSeenDay: number | null
}

export type MasteryStore = ReadonlyMap<MasteryKey, MasteryState>

export const WINDOW_SIZE = 20
/** R 跌破此值即到期待复习（spec §7.1） */
export const DUE_THRESHOLD = 0.85
export const MIN_STABILITY = 0.5
export const INITIAL_STABILITY = 1
export const INITIAL_DIFFICULTY = 0.3
/** 答对时的 stability 增益系数 */
export const GAIN_A = 1.6
/** 答错时的 stability 衰减系数 */
export const LAPSE_C = 0.5
export const DIFFICULTY_UP = 0.08
export const DIFFICULTY_DOWN = 0.02

export function initialMastery(): MasteryState {
  return {
    stability: INITIAL_STABILITY,
    difficulty: INITIAL_DIFFICULTY,
    variationLevel: 0,
    contextLevel: 0,
    window: [],
    lastSeenDay: null,
  }
}

/**
 * 可提取性 R(t) = exp(−Δt / stability)。
 * 从未练过时返回 0——视为完全不可提取，故必然到期。
 */
export function retrievability(state: MasteryState, today: number): number {
  if (state.lastSeenDay === null) return 0
  const elapsed = Math.max(0, today - state.lastSeenDay)
  return Math.exp(-elapsed / state.stability)
}

export function isDue(state: MasteryState, today: number): boolean {
  return retrievability(state, today) < DUE_THRESHOLD
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

/**
 * 应用一次尝试，返回新状态（不修改输入）。
 *
 * 答对时的增益含 (1 − R) 因子：接近遗忘临界时成功检索，增益最大
 * （spec §2.6）。其直接推论是同一天重复答对（Δt=0 → R=1）增益为零——
 * 集中练习不产生持久记忆，这正是要的行为。
 */
export function applyAttempt(
  state: MasteryState,
  correct: boolean,
  today: number,
  difficultyStep: number,
): MasteryState {
  const r = retrievability(state, today)

  const stability = correct
    ? state.stability * (1 + GAIN_A * (1 - state.difficulty) * (1 - r))
    : Math.max(MIN_STABILITY, state.stability * LAPSE_C)

  const difficulty = clamp01(
    correct ? state.difficulty - DIFFICULTY_DOWN : state.difficulty + DIFFICULTY_UP,
  )

  // difficultyStep 只被记录，不参与 stability 的算法——
  // 它是 Task 7 门控的判据来源（建模决策 4）
  const window = [...state.window, { correct, day: today, difficultyStep }].slice(
    -WINDOW_SIZE,
  )

  return { ...state, stability, difficulty, window, lastSeenDay: today }
}

/** 缺失的 key 视为从未练过 */
export function getMastery(store: MasteryStore, key: MasteryKey): MasteryState {
  return store.get(key) ?? initialMastery()
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/scheduling/mastery.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 运行全部测试与类型检查**

```bash
npx vitest run
npx tsc --noEmit
```

Expected: 全部 PASS，tsc 无输出

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(scheduling): 掌握度状态与更新规则"
```

---

### Task 7: 变异与语境门控

spec §7.3。**慢机制**——跨天移动，落盘。

**升级判据按建模决策 4 修正**：不是「窗口正确率 >90%」（那个阈值与 2-down-1-up 的 71% 收敛点直接冲突，永不可达），而是 stability 过阈值 **且** 窗口内**平均阶梯档位**过阈值。档位高说明学习者在当前 `variationLevel`/`contextLevel` 下已能吃住更难的变体，此时提升等级才有意义。

三个必须做对的细节：
- **升级判据用平均档位，不用原始正确率**。用正确率会让升级永不发生。
- **升级不得越过当前阶段的要求上限**。P1 的学习者不该被推到 L4——那是 P4 的要求。
- **回退是必需的**。没有它，用户会永久卡在挫败区然后卸载（spec §7.3）。

**Files:**
- Create: `src/scheduling/gating.ts`
- Test: `src/scheduling/gating.test.ts`

**Interfaces:**
- Consumes: `mastery.ts` 的 `MasteryState`, `AttemptOutcome`, `initialMastery`；`curriculum/curriculum.ts` 的 `LevelRequirement`
- Produces:
  - 常量 `VARIATION_STABILITY_THRESHOLDS`, `CONTEXT_STABILITY_THRESHOLDS`, `PROMOTE_MEAN_STEP`, `MIN_WINDOW_FOR_PROMOTION`, `DEMOTE_TRAILING_ERRORS`
  - `windowAccuracy(window: AttemptOutcome[]): number`（供诊断与护栏用，不再是升级判据）
  - `meanLadderStep(window: AttemptOutcome[]): number`
  - `trailingErrors(window: AttemptOutcome[]): number`
  - `applyGating(state: MasteryState, cap: LevelRequirement): MasteryState`

- [ ] **Step 1: 写失败的测试**

`src/scheduling/gating.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  CONTEXT_STABILITY_THRESHOLDS,
  DEMOTE_TRAILING_ERRORS,
  MIN_WINDOW_FOR_PROMOTION,
  PROMOTE_MEAN_STEP,
  VARIATION_STABILITY_THRESHOLDS,
  applyGating,
  meanLadderStep,
  trailingErrors,
  windowAccuracy,
} from './gating'
import { initialMastery, type AttemptOutcome, type MasteryState } from './mastery'
import type { LevelRequirement } from '../curriculum/curriculum'

const CAP: LevelRequirement = { contextLevel: 4, variationLevel: 6 }

/** 构造窗口：给定每次尝试的对错与阶梯档位 */
function win(pattern: boolean[], step = PROMOTE_MEAN_STEP): AttemptOutcome[] {
  return pattern.map((correct, i) => ({ correct, day: i, difficultyStep: step }))
}

function state(over: Partial<MasteryState>): MasteryState {
  return { ...initialMastery(), lastSeenDay: 0, ...over }
}

describe('windowAccuracy / meanLadderStep / trailingErrors', () => {
  it('空窗口：正确率 0、平均档位 0、尾部错误 0', () => {
    expect(windowAccuracy([])).toBe(0)
    expect(meanLadderStep([])).toBe(0)
    expect(trailingErrors([])).toBe(0)
  })

  it('正确率是窗口内正确数占比', () => {
    expect(windowAccuracy(win([true, true, true, false]))).toBeCloseTo(0.75, 10)
  })

  it('平均档位是窗口内档位的均值', () => {
    const window: AttemptOutcome[] = [
      { correct: true, day: 0, difficultyStep: 1 },
      { correct: true, day: 1, difficultyStep: 3 },
      { correct: false, day: 2, difficultyStep: 5 },
    ]
    expect(meanLadderStep(window)).toBeCloseTo(3, 10)
  })

  it('尾部错误数只数末尾连续的错误', () => {
    expect(trailingErrors(win([false, false, true, false, false]))).toBe(2)
    expect(trailingErrors(win([false, false, true]))).toBe(0)
  })
})

describe('applyGating 升级', () => {
  it('stability 与平均档位都达标时提升变异等级', () => {
    const s = state({
      stability: VARIATION_STABILITY_THRESHOLDS[0],
      window: win(Array(MIN_WINDOW_FOR_PROMOTION).fill(true)),
    })
    expect(applyGating(s, CAP).variationLevel).toBe(1)
  })

  it('窗口太短时不升级，哪怕档位很高', () => {
    const s = state({
      stability: VARIATION_STABILITY_THRESHOLDS[0] * 10,
      window: win(Array(MIN_WINDOW_FOR_PROMOTION - 1).fill(true), 5),
    })
    expect(applyGating(s, CAP).variationLevel).toBe(0)
  })

  it('平均档位不足时不升级，哪怕 stability 很高且全对', () => {
    // 全对但一直卡在档位 0：说明阶梯没能把难度顶上去，还不该升级
    const s = state({
      stability: 100,
      window: win(Array(MIN_WINDOW_FOR_PROMOTION).fill(true), 0),
    })
    expect(applyGating(s, CAP).variationLevel).toBe(0)
  })

  it('平均档位达标即可升级，不要求高正确率（建模决策 4）', () => {
    // 正确率约 70%——正是 2-down-1-up 的收敛点，但档位高，应当升级
    const pattern = [true, true, false, true, true, false, true, true, true, false]
    const s = state({
      stability: VARIATION_STABILITY_THRESHOLDS[0],
      window: win(pattern, PROMOTE_MEAN_STEP + 1),
    })
    expect(windowAccuracy(win(pattern))).toBeLessThan(0.9)
    expect(applyGating(s, CAP).variationLevel).toBe(1)
  })

  it('一次最多升一级', () => {
    const s = state({
      stability: 1000,
      window: win(Array(MIN_WINDOW_FOR_PROMOTION).fill(true), 5),
    })
    const next = applyGating(s, CAP)
    expect(next.variationLevel).toBe(1)
    expect(next.contextLevel).toBeLessThanOrEqual(1)
  })

  it('不得越过当前阶段的要求上限', () => {
    const s = state({
      stability: 1000,
      variationLevel: 2,
      contextLevel: 1,
      window: win(Array(MIN_WINDOW_FOR_PROMOTION).fill(true), 5),
    })
    const cap: LevelRequirement = { contextLevel: 1, variationLevel: 2 }
    const next = applyGating(s, cap)
    expect(next.variationLevel).toBe(2)
    expect(next.contextLevel).toBe(1)
  })

  it('语境等级达标时也会提升', () => {
    const s = state({
      stability: CONTEXT_STABILITY_THRESHOLDS[0],
      variationLevel: 6,
      window: win(Array(MIN_WINDOW_FOR_PROMOTION).fill(true)),
    })
    expect(applyGating(s, CAP).contextLevel).toBe(1)
  })
})

describe('applyGating 回退', () => {
  it('尾部连续错误达到阈值时回退', () => {
    const s = state({
      variationLevel: 3,
      contextLevel: 2,
      window: win([true, true, ...Array(DEMOTE_TRAILING_ERRORS).fill(false)]),
    })
    const next = applyGating(s, CAP)
    expect(next.variationLevel + next.contextLevel).toBe(
      s.variationLevel + s.contextLevel - 1,
    )
  })

  it('回退优先于升级：尾部连错时哪怕档位达标也不升级', () => {
    const s = state({
      stability: 1000,
      variationLevel: 2,
      contextLevel: 2,
      window: win(
        [...Array(MIN_WINDOW_FOR_PROMOTION).fill(true), ...Array(DEMOTE_TRAILING_ERRORS).fill(false)],
        5,
      ),
    })
    const next = applyGating(s, CAP)
    expect(next.contextLevel).toBe(1)
    expect(next.variationLevel).toBe(2)
  })

  it('两级都不为 0 时优先回退语境（语境是更硬的那条阶梯）', () => {
    const s = state({
      variationLevel: 3,
      contextLevel: 3,
      window: win(Array(DEMOTE_TRAILING_ERRORS).fill(false)),
    })
    const next = applyGating(s, CAP)
    expect(next.contextLevel).toBe(2)
    expect(next.variationLevel).toBe(3)
  })

  it('语境已在 0 时回退变异等级', () => {
    const s = state({
      variationLevel: 2,
      contextLevel: 0,
      window: win(Array(DEMOTE_TRAILING_ERRORS).fill(false)),
    })
    const next = applyGating(s, CAP)
    expect(next.variationLevel).toBe(1)
    expect(next.contextLevel).toBe(0)
  })

  it('两级都已在 0 时不再回退，也不抛错', () => {
    const s = state({
      variationLevel: 0,
      contextLevel: 0,
      window: win(Array(DEMOTE_TRAILING_ERRORS * 2).fill(false)),
    })
    const next = applyGating(s, CAP)
    expect(next.variationLevel).toBe(0)
    expect(next.contextLevel).toBe(0)
  })

  it('不修改输入状态', () => {
    const s = state({
      variationLevel: 3,
      contextLevel: 3,
      window: win(Array(DEMOTE_TRAILING_ERRORS).fill(false)),
    })
    applyGating(s, CAP)
    expect(s.variationLevel).toBe(3)
    expect(s.contextLevel).toBe(3)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/scheduling/gating.test.ts`
Expected: FAIL — 无法解析模块 `./gating`

- [ ] **Step 3: 写实现**

`src/scheduling/gating.ts`：

```ts
import type { ContextLevel } from '../music/tonalContext'
import type { LevelRequirement } from '../curriculum/curriculum'
import type { VariationLevel } from '../curriculum/stages'
import type { AttemptOutcome, MasteryState } from './mastery'

/** 升到变异等级 i+1 所需的 stability（天） */
export const VARIATION_STABILITY_THRESHOLDS: readonly number[] = [2, 4, 7, 11, 16, 24]

/** 升到语境等级 i+1 所需的 stability（天）。比变异更严——语境是更硬的阶梯。 */
export const CONTEXT_STABILITY_THRESHOLDS: readonly number[] = [3, 6, 10, 15]

/**
 * 升级所需的窗口平均阶梯档位（档位范围 0–5）。
 *
 * 这里**不**用原始正确率作判据（建模决策 4）：2-down-1-up 按设计把观测
 * 正确率锁在约 71%（spec §2.9），任何高于它的正确率门槛都永不可达，
 * 升级将永不发生。平均档位才是「学习者在当前等级下能吃住多难的变体」
 * 的正确度量。
 */
export const PROMOTE_MEAN_STEP = 2
export const MIN_WINDOW_FOR_PROMOTION = 8
export const DEMOTE_TRAILING_ERRORS = 3

/** 供诊断与护栏使用。不再是升级判据。 */
export function windowAccuracy(window: AttemptOutcome[]): number {
  if (window.length === 0) return 0
  return window.filter((a) => a.correct).length / window.length
}

/** 窗口内的平均阶梯档位——升级判据 */
export function meanLadderStep(window: AttemptOutcome[]): number {
  if (window.length === 0) return 0
  return window.reduce((sum, a) => sum + a.difficultyStep, 0) / window.length
}

/** 窗口末尾连续错误的个数 */
export function trailingErrors(window: AttemptOutcome[]): number {
  let n = 0
  for (let i = window.length - 1; i >= 0; i--) {
    if (window[i].correct) break
    n++
  }
  return n
}

/**
 * 慢机制：跨天移动变异等级与语境等级（spec §7.3，按建模决策 4 修正判据）。
 *
 * 升级需 stability 过阈值 **且** 窗口平均阶梯档位过阈值且窗口足够长，
 * 一次最多升一级，且不得越过当前阶段的要求上限 `cap`——
 * P1 的学习者不该被推到 L4。
 *
 * 回退在尾部连续错误达阈值时触发，且优先于升级判定。缺少回退，
 * 用户会永久卡在挫败区。两级都不为 0 时优先回退语境：
 * 它是更硬的那条阶梯，先松开它收益最大。
 */
export function applyGating(state: MasteryState, cap: LevelRequirement): MasteryState {
  if (trailingErrors(state.window) >= DEMOTE_TRAILING_ERRORS) {
    if (state.contextLevel > 0) {
      return { ...state, contextLevel: (state.contextLevel - 1) as ContextLevel }
    }
    if (state.variationLevel > 0) {
      return { ...state, variationLevel: (state.variationLevel - 1) as VariationLevel }
    }
    return { ...state }
  }

  const eligible =
    state.window.length >= MIN_WINDOW_FOR_PROMOTION &&
    meanLadderStep(state.window) >= PROMOTE_MEAN_STEP

  if (!eligible) return { ...state }

  // 先尝试变异轴：它更便宜，且是抗特异性的主力（spec §2.8）
  const varThreshold = VARIATION_STABILITY_THRESHOLDS[state.variationLevel]
  if (
    varThreshold !== undefined &&
    state.variationLevel < cap.variationLevel &&
    state.stability >= varThreshold
  ) {
    return { ...state, variationLevel: (state.variationLevel + 1) as VariationLevel }
  }

  const ctxThreshold = CONTEXT_STABILITY_THRESHOLDS[state.contextLevel]
  if (
    ctxThreshold !== undefined &&
    state.contextLevel < cap.contextLevel &&
    state.stability >= ctxThreshold
  ) {
    return { ...state, contextLevel: (state.contextLevel + 1) as ContextLevel }
  }

  return { ...state }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/scheduling/gating.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(scheduling): 变异与语境门控"
```

---

### Task 8: 题目规格

调度器的输出单元。它**只描述规格，不含任何可播放内容**——渲染是 P-2b 生成器的事（建模决策 3）。

**Files:**
- Create: `src/scheduling/exerciseSpec.ts`
- Test: `src/scheduling/exerciseSpec.test.ts`

**Interfaces:**
- Consumes: `curriculum/knowledgePoints.ts` 的 `KnowledgePointId`, `Modality`, `Track`；`curriculum/stages.ts` 的 `VariationLevel`；`music/tonalContext.ts` 的 `ContextLevel`
- Produces:
  - `type SessionSegment = 'warmup' | 'review' | 'focus' | 'introduce' | 'boss'`
  - `const SESSION_SEGMENTS: readonly SessionSegment[]`
  - `interface ExerciseSpec { kpId; modality; track; contextLevel; variationLevel; difficultyStep; seed; segment }`
  - `const ITEM_SECONDS: Record<Modality, number>`
  - `itemSeconds(spec: ExerciseSpec): number`
  - `isWellFormedSpec(spec: ExerciseSpec): boolean`
  - `describeSpec(spec: ExerciseSpec): string`

- [ ] **Step 1: 写失败的测试**

`src/scheduling/exerciseSpec.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  ITEM_SECONDS,
  SESSION_SEGMENTS,
  describeSpec,
  isWellFormedSpec,
  itemSeconds,
  type ExerciseSpec,
} from './exerciseSpec'
import { MODALITIES } from '../curriculum/knowledgePoints'

const OK: ExerciseSpec = {
  kpId: 'degree:major:mi',
  modality: 'recognize',
  track: 'T',
  contextLevel: 1,
  variationLevel: 2,
  difficultyStep: 0,
  seed: 12345,
  segment: 'focus',
}

describe('ITEM_SECONDS', () => {
  it('三个模态都有时长，且唱与听写长于听辨', () => {
    for (const m of MODALITIES) expect(ITEM_SECONDS[m]).toBeGreaterThan(0)
    expect(ITEM_SECONDS.sing).toBeGreaterThan(ITEM_SECONDS.recognize)
    expect(ITEM_SECONDS.notate).toBeGreaterThan(ITEM_SECONDS.recognize)
  })

  it('itemSeconds 取自模态', () => {
    expect(itemSeconds(OK)).toBe(ITEM_SECONDS.recognize)
    expect(itemSeconds({ ...OK, modality: 'notate' })).toBe(ITEM_SECONDS.notate)
  })
})

describe('SESSION_SEGMENTS', () => {
  it('恰好五个分段', () => {
    expect([...SESSION_SEGMENTS]).toEqual([
      'warmup', 'review', 'focus', 'introduce', 'boss',
    ])
  })
})

describe('isWellFormedSpec', () => {
  it('合法规格通过', () => {
    expect(isWellFormedSpec(OK)).toBe(true)
  })

  it('语境等级越界不通过', () => {
    expect(isWellFormedSpec({ ...OK, contextLevel: 5 as ExerciseSpec['contextLevel'] })).toBe(false)
    expect(isWellFormedSpec({ ...OK, contextLevel: -1 as ExerciseSpec['contextLevel'] })).toBe(false)
  })

  it('变异等级越界不通过', () => {
    expect(isWellFormedSpec({ ...OK, variationLevel: 7 as ExerciseSpec['variationLevel'] })).toBe(false)
  })

  it('难度档为负不通过', () => {
    expect(isWellFormedSpec({ ...OK, difficultyStep: -1 })).toBe(false)
  })

  it('seed 非整数不通过（生成器需要确定性整数种子）', () => {
    expect(isWellFormedSpec({ ...OK, seed: 1.5 })).toBe(false)
  })

  it('kpId 为空不通过', () => {
    expect(isWellFormedSpec({ ...OK, kpId: '' })).toBe(false)
  })

  it('track 与 kpId 的类型不符不通过', () => {
    // degree:* 属 T 轨，标成 H 轨是错的
    expect(isWellFormedSpec({ ...OK, track: 'H' })).toBe(false)
  })
})

describe('describeSpec', () => {
  it('输出含知识点、模态与两个等级，便于仿真失败时定位', () => {
    const s = describeSpec(OK)
    expect(s).toContain('degree:major:mi')
    expect(s).toContain('recognize')
    expect(s).toContain('L1')
    expect(s).toContain('V2')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/scheduling/exerciseSpec.test.ts`
Expected: FAIL — 无法解析模块 `./exerciseSpec`

- [ ] **Step 3: 写实现**

`src/scheduling/exerciseSpec.ts`：

```ts
import type { ContextLevel } from '../music/tonalContext'
import {
  parseKpId,
  trackOfKind,
  type KnowledgePointId,
  type Modality,
  type Track,
} from '../curriculum/knowledgePoints'
import type { VariationLevel } from '../curriculum/stages'

export type SessionSegment = 'warmup' | 'review' | 'focus' | 'introduce' | 'boss'

export const SESSION_SEGMENTS: readonly SessionSegment[] = [
  'warmup',
  'review',
  'focus',
  'introduce',
  'boss',
]

/**
 * 调度器的输出单元。只描述规格，不含任何可播放内容——
 * 渲染由 P-2b 的生成器按 (spec, seed) 产出（建模决策 3）。
 */
export interface ExerciseSpec {
  kpId: KnowledgePointId
  modality: Modality
  track: Track
  /** 慢机制给出的语境强度 */
  contextLevel: ContextLevel
  /** 慢机制给出的变异等级 */
  variationLevel: VariationLevel
  /** 快机制（2-down-1-up）给出的单题难度档，0 最易 */
  difficultyStep: number
  /** 生成器用的确定性整数种子 */
  seed: number
  segment: SessionSegment
}

/** 单题预估耗时（秒），含语境播放、作答与反馈 */
export const ITEM_SECONDS: Record<Modality, number> = {
  recognize: 12,
  sing: 20,
  notate: 25,
}

export function itemSeconds(spec: ExerciseSpec): number {
  return ITEM_SECONDS[spec.modality]
}

export function isWellFormedSpec(spec: ExerciseSpec): boolean {
  if (spec.kpId.length === 0) return false
  if (!Number.isInteger(spec.seed)) return false
  if (!Number.isInteger(spec.difficultyStep) || spec.difficultyStep < 0) return false
  if (spec.contextLevel < 0 || spec.contextLevel > 4) return false
  if (spec.variationLevel < 0 || spec.variationLevel > 6) return false
  if (!SESSION_SEGMENTS.includes(spec.segment)) return false
  if (!(spec.modality in ITEM_SECONDS)) return false
  try {
    if (trackOfKind(parseKpId(spec.kpId).kind) !== spec.track) return false
  } catch {
    return false
  }
  return true
}

/** 供仿真断言失败时输出定位信息 */
export function describeSpec(spec: ExerciseSpec): string {
  return `${spec.kpId}@${spec.modality} L${spec.contextLevel} V${spec.variationLevel} d${spec.difficultyStep} [${spec.segment}]`
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/scheduling/exerciseSpec.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(scheduling): 题目规格类型"
```

---

### Task 9: 2-down-1-up 单题难度阶梯

spec §7.4.1 的**快机制**——题间即时调整，不落盘，**永远不修改 `variationLevel` 或 `contextLevel`**。

连对 2 次升一档、错 1 次降一档，收敛于约 71% 正确率（spec §2.9）。这个数字不是拍脑袋的：它是 2-down-1-up 阶梯法的已知收敛点，正好落在合意困难区间。

**Files:**
- Create: `src/scheduling/ladder.ts`
- Test: `src/scheduling/ladder.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - 常量 `LADDER_MIN_STEP`, `LADDER_MAX_STEP`, `LADDER_UP_AFTER`
  - `interface LadderState { step: number; consecutiveCorrect: number }`
  - `initialLadder(step?: number): LadderState`
  - `applyLadder(state: LadderState, correct: boolean): LadderState`

- [ ] **Step 1: 写失败的测试**

`src/scheduling/ladder.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  LADDER_MAX_STEP,
  LADDER_MIN_STEP,
  LADDER_UP_AFTER,
  applyLadder,
  initialLadder,
} from './ladder'

describe('initialLadder', () => {
  it('默认从最低档起', () => {
    expect(initialLadder()).toEqual({ step: LADDER_MIN_STEP, consecutiveCorrect: 0 })
  })

  it('起始档被钳制在合法范围内', () => {
    expect(initialLadder(999).step).toBe(LADDER_MAX_STEP)
    expect(initialLadder(-5).step).toBe(LADDER_MIN_STEP)
  })
})

describe('applyLadder', () => {
  it('答对一次不升档，只累计', () => {
    const s = applyLadder(initialLadder(2), true)
    expect(s.step).toBe(2)
    expect(s.consecutiveCorrect).toBe(1)
  })

  it('连对 LADDER_UP_AFTER 次升一档并清零计数', () => {
    let s = initialLadder(2)
    for (let i = 0; i < LADDER_UP_AFTER; i++) s = applyLadder(s, true)
    expect(s.step).toBe(3)
    expect(s.consecutiveCorrect).toBe(0)
  })

  it('答错立即降一档并清零计数', () => {
    let s = applyLadder(initialLadder(3), true)
    s = applyLadder(s, false)
    expect(s.step).toBe(2)
    expect(s.consecutiveCorrect).toBe(0)
  })

  it('答错打断连对计数', () => {
    let s = initialLadder(2)
    s = applyLadder(s, true)
    s = applyLadder(s, false)
    s = applyLadder(s, true)
    expect(s.step).toBe(1) // 降了一次，之后只对了一次
    expect(s.consecutiveCorrect).toBe(1)
  })

  it('档位不越界', () => {
    let high = initialLadder(LADDER_MAX_STEP)
    for (let i = 0; i < 20; i++) high = applyLadder(high, true)
    expect(high.step).toBe(LADDER_MAX_STEP)

    let low = initialLadder(LADDER_MIN_STEP)
    for (let i = 0; i < 20; i++) low = applyLadder(low, false)
    expect(low.step).toBe(LADDER_MIN_STEP)
  })

  it('不修改输入状态', () => {
    const s = initialLadder(2)
    applyLadder(s, true)
    expect(s).toEqual({ step: 2, consecutiveCorrect: 0 })
  })
})
```

阶梯是否真的收敛到约 71%，由 Task 16 的仿真在真实作答概率模型下断言——这里只测机制。

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/scheduling/ladder.test.ts`
Expected: FAIL — 无法解析模块 `./ladder`

- [ ] **Step 3: 写实现**

`src/scheduling/ladder.ts`：

```ts
export const LADDER_MIN_STEP = 0
export const LADDER_MAX_STEP = 5
/** 连对多少次升一档。2 是 2-down-1-up 的定义。 */
export const LADDER_UP_AFTER = 2

export interface LadderState {
  step: number
  consecutiveCorrect: number
}

function clampStep(step: number): number {
  return Math.min(LADDER_MAX_STEP, Math.max(LADDER_MIN_STEP, Math.round(step)))
}

export function initialLadder(step: number = LADDER_MIN_STEP): LadderState {
  return { step: clampStep(step), consecutiveCorrect: 0 }
}

/**
 * 快机制：题间即时调整单题难度档（spec §7.4.1）。
 *
 * 2-down-1-up 收敛于约 71% 正确率（spec §2.9），正好落在合意困难区间。
 * 它调的是选项集大小、播放速度、旋律音数、音程跨度这类**单题内**参数，
 * **永远不修改 variationLevel 或 contextLevel**——那是慢机制的领地。
 */
export function applyLadder(state: LadderState, correct: boolean): LadderState {
  if (!correct) {
    return { step: clampStep(state.step - 1), consecutiveCorrect: 0 }
  }
  const consecutive = state.consecutiveCorrect + 1
  if (consecutive >= LADDER_UP_AFTER) {
    return { step: clampStep(state.step + 1), consecutiveCorrect: 0 }
  }
  return { step: state.step, consecutiveCorrect: consecutive }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/scheduling/ladder.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(scheduling): 2-down-1-up 单题难度阶梯"
```

---

### Task 10: 防挫败护栏

spec §7.5。两条独立的护栏：

1. **会话内**正确率跌破 55% → 强制降难度并插入已掌握的知识点回血
2. **跨天**某知识点连续 3 天无进展 → 触发拆解：加强语境（`contextLevel` 减小）、降变异、降难度档

注意方向：`contextLevel` 数值越小语境越强、越容易，所以「加强语境」是**减小** `contextLevel`。

**Files:**
- Create: `src/scheduling/guardrails.ts`
- Test: `src/scheduling/guardrails.test.ts`

**Interfaces:**
- Consumes: `mastery.ts` 的 `MasteryState`；`exerciseSpec.ts` 的 `ExerciseSpec`
- Produces:
  - 常量 `SESSION_ACCURACY_FLOOR`, `MIN_ITEMS_BEFORE_RELIEF`, `STAGNATION_DAYS`, `STAGNATION_MIN_ATTEMPTS`, `STAGNATION_ACCURACY`
  - `interface SessionProgress { attempted: number; correct: number }`
  - `sessionAccuracy(progress: SessionProgress): number`
  - `needsRelief(progress: SessionProgress): boolean`
  - `relieveSpec(spec: ExerciseSpec): ExerciseSpec`
  - `isStagnant(state: MasteryState, today: number): boolean`
  - `decompose(state: MasteryState): MasteryState`

- [ ] **Step 1: 写失败的测试**

`src/scheduling/guardrails.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  MIN_ITEMS_BEFORE_RELIEF,
  STAGNATION_DAYS,
  decompose,
  isStagnant,
  needsRelief,
  relieveSpec,
  sessionAccuracy,
} from './guardrails'
import { initialMastery, type AttemptOutcome, type MasteryState } from './mastery'
import type { ExerciseSpec } from './exerciseSpec'

const SPEC: ExerciseSpec = {
  kpId: 'degree:major:mi',
  modality: 'recognize',
  track: 'T',
  contextLevel: 3,
  variationLevel: 4,
  difficultyStep: 3,
  seed: 1,
  segment: 'focus',
}

describe('sessionAccuracy / needsRelief', () => {
  it('零尝试时正确率为 1，不触发护栏（避免开局即降难度）', () => {
    expect(sessionAccuracy({ attempted: 0, correct: 0 })).toBe(1)
    expect(needsRelief({ attempted: 0, correct: 0 })).toBe(false)
  })

  it('样本不足时不触发，哪怕全错', () => {
    const n = MIN_ITEMS_BEFORE_RELIEF - 1
    expect(needsRelief({ attempted: n, correct: 0 })).toBe(false)
  })

  it('样本足够且正确率跌破下限时触发', () => {
    const n = MIN_ITEMS_BEFORE_RELIEF
    expect(needsRelief({ attempted: n, correct: 0 })).toBe(true)
  })

  it('正确率高于下限时不触发', () => {
    expect(needsRelief({ attempted: 20, correct: 18 })).toBe(false)
  })
})

describe('relieveSpec', () => {
  it('同时降低难度档、变异等级与语境等级', () => {
    const r = relieveSpec(SPEC)
    expect(r.difficultyStep).toBeLessThan(SPEC.difficultyStep)
    expect(r.variationLevel).toBeLessThan(SPEC.variationLevel)
    // 语境等级减小 = 语境增强 = 更容易
    expect(r.contextLevel).toBeLessThan(SPEC.contextLevel)
  })

  it('已在最低档时不越界', () => {
    const floor = { ...SPEC, contextLevel: 0 as const, variationLevel: 0 as const, difficultyStep: 0 }
    const r = relieveSpec(floor)
    expect(r.contextLevel).toBe(0)
    expect(r.variationLevel).toBe(0)
    expect(r.difficultyStep).toBe(0)
  })

  it('不改变知识点、模态与轨道', () => {
    const r = relieveSpec(SPEC)
    expect(r.kpId).toBe(SPEC.kpId)
    expect(r.modality).toBe(SPEC.modality)
    expect(r.track).toBe(SPEC.track)
  })

  it('不修改输入', () => {
    relieveSpec(SPEC)
    expect(SPEC.difficultyStep).toBe(3)
  })
})

describe('isStagnant', () => {
  function withWindow(window: AttemptOutcome[], lastSeenDay: number): MasteryState {
    return { ...initialMastery(), window, lastSeenDay }
  }

  function attempt(correct: boolean, day: number): AttemptOutcome {
    return { correct, day, difficultyStep: 0 }
  }

  it('从未练过不算停滞', () => {
    expect(isStagnant(initialMastery(), 10)).toBe(false)
  })

  it('近 N 天内尝试够多且正确率很低时判为停滞', () => {
    const window: AttemptOutcome[] = []
    for (let day = 8; day <= 10; day++) {
      for (let i = 0; i < 3; i++) window.push(attempt(false, day))
    }
    expect(isStagnant(withWindow(window, 10), 10)).toBe(true)
  })

  it('正确率不低时不算停滞', () => {
    const window: AttemptOutcome[] = []
    for (let day = 8; day <= 10; day++) {
      for (let i = 0; i < 3; i++) window.push(attempt(true, day))
    }
    expect(isStagnant(withWindow(window, 10), 10)).toBe(false)
  })

  it('尝试次数不足时不算停滞', () => {
    expect(isStagnant(withWindow([attempt(false, 10)], 10), 10)).toBe(false)
  })

  it('只看最近 STAGNATION_DAYS 天，更早的失败不计入', () => {
    const window: AttemptOutcome[] = []
    for (let i = 0; i < 12; i++) window.push(attempt(false, 0))
    expect(isStagnant(withWindow(window, 0), STAGNATION_DAYS + 5)).toBe(false)
  })
})

describe('decompose', () => {
  it('加强语境（contextLevel 减小）并降低变异等级', () => {
    const s: MasteryState = { ...initialMastery(), contextLevel: 3, variationLevel: 4 }
    const d = decompose(s)
    expect(d.contextLevel).toBeLessThan(s.contextLevel)
    expect(d.variationLevel).toBeLessThan(s.variationLevel)
  })

  it('已在最低时不越界', () => {
    const s: MasteryState = { ...initialMastery(), contextLevel: 0, variationLevel: 0 }
    const d = decompose(s)
    expect(d.contextLevel).toBe(0)
    expect(d.variationLevel).toBe(0)
  })

  it('清空窗口，让拆解后的表现重新积累（否则旧的失败会立刻再次触发回退）', () => {
    const s: MasteryState = {
      ...initialMastery(),
      contextLevel: 2,
      window: [
        { correct: false, day: 1, difficultyStep: 0 },
        { correct: false, day: 2, difficultyStep: 0 },
      ],
    }
    expect(decompose(s).window).toEqual([])
  })

  it('不修改输入', () => {
    const s: MasteryState = { ...initialMastery(), contextLevel: 3, variationLevel: 4 }
    decompose(s)
    expect(s.contextLevel).toBe(3)
  })
})
```

「拆解时清空窗口」不是细节：不清空的话，窗口里那串失败会在下一次 `applyGating` 立刻再次触发回退，把已经拆解过的知识点一路推到底。

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/scheduling/guardrails.test.ts`
Expected: FAIL — 无法解析模块 `./guardrails`

- [ ] **Step 3: 写实现**

`src/scheduling/guardrails.ts`：

```ts
import type { ContextLevel } from '../music/tonalContext'
import type { VariationLevel } from '../curriculum/stages'
import type { ExerciseSpec } from './exerciseSpec'
import { windowAccuracy } from './gating'
import type { MasteryState } from './mastery'

/** 会话内正确率跌破此值触发回血（spec §7.5） */
export const SESSION_ACCURACY_FLOOR = 0.55
/** 样本不足时不触发，避免开局连错两题就降难度 */
export const MIN_ITEMS_BEFORE_RELIEF = 10

/** 连续多少天无进展触发拆解（spec §7.5） */
export const STAGNATION_DAYS = 3
export const STAGNATION_MIN_ATTEMPTS = 6
export const STAGNATION_ACCURACY = 0.4

export interface SessionProgress {
  attempted: number
  correct: number
}

/** 零尝试时返回 1，避免开局即判定为需要回血 */
export function sessionAccuracy(progress: SessionProgress): number {
  if (progress.attempted === 0) return 1
  return progress.correct / progress.attempted
}

export function needsRelief(progress: SessionProgress): boolean {
  if (progress.attempted < MIN_ITEMS_BEFORE_RELIEF) return false
  return sessionAccuracy(progress) < SESSION_ACCURACY_FLOOR
}

/**
 * 会话内回血：把一道题降到更容易的形态。
 * 语境等级**减小**即语境增强（spec §6.1：L0 最强）。
 */
export function relieveSpec(spec: ExerciseSpec): ExerciseSpec {
  return {
    ...spec,
    difficultyStep: Math.max(0, spec.difficultyStep - 1),
    variationLevel: Math.max(0, spec.variationLevel - 1) as VariationLevel,
    contextLevel: Math.max(0, spec.contextLevel - 1) as ContextLevel,
  }
}

/** 最近 STAGNATION_DAYS 天内练得够多但正确率仍很低 */
export function isStagnant(state: MasteryState, today: number): boolean {
  if (state.lastSeenDay === null) return false
  const since = today - STAGNATION_DAYS
  const recent = state.window.filter((a) => a.day > since)
  if (recent.length < STAGNATION_MIN_ATTEMPTS) return false
  return windowAccuracy(recent) < STAGNATION_ACCURACY
}

/**
 * 拆解：把知识点降到更简单的形态重新爬（spec §7.5）。
 *
 * 清空窗口是必需的——不清空的话，窗口里那串失败会在下一次 applyGating
 * 立刻再次触发回退，把已经拆解过的知识点一路推到底。
 */
export function decompose(state: MasteryState): MasteryState {
  return {
    ...state,
    contextLevel: Math.max(0, state.contextLevel - 1) as ContextLevel,
    variationLevel: Math.max(0, state.variationLevel - 1) as VariationLevel,
    window: [],
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/scheduling/guardrails.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(scheduling): 防挫败护栏"
```

---

### Task 11: 关卡判定

spec §8.3：**三模态齐平**——该阶段全部知识点在听辨、唱、听写三个模态上都过阈值，**且**实战关一次通过。不允许靠听辨刷满而唱不出来。**无逃生口**，不提供「卡满 N 周强制解锁」。

实战关本身在 P-5 实现，本任务只把「是否已通过」当作外部输入。

**Files:**
- Create: `src/scheduling/gate.ts`
- Test: `src/scheduling/gate.test.ts`

**Interfaces:**
- Consumes: `curriculum/curriculum.ts` 的 `Curriculum`, `knowledgePointsOfPhase`, `phaseIndex`, `phaseAt`；`curriculum/knowledgePoints.ts` 的 `MODALITIES`, `masteryKey`；`curriculum/stages.ts` 的 `PhaseId`；`mastery.ts` 的 `MasteryStore`, `getMastery`；`gating.ts` 的 `windowAccuracy`
- Produces:
  - `interface GateEvaluation { passed: boolean; blockingKeys: MasteryKey[]; bossSatisfied: boolean }`
  - `evaluateGate(c: Curriculum, store: MasteryStore, phaseId: PhaseId, bossPassed: boolean): GateEvaluation`
  - `nextPhase(phaseId: PhaseId): PhaseId | null`

- [ ] **Step 1: 写失败的测试**

`src/scheduling/gate.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { evaluateGate, nextPhase } from './gate'
import { buildCurriculum, knowledgePointsOfPhase } from '../curriculum/curriculum'
import { MODALITIES, masteryKey } from '../curriculum/knowledgePoints'
import { initialMastery, type MasteryState } from './mastery'
import { ALL_PHASES } from '../curriculum/stages'

const c = buildCurriculum()
const P1_GATE = ALL_PHASES[0].gate

function mastered(): MasteryState {
  return {
    ...initialMastery(),
    stability: P1_GATE.stabilityThreshold * 2,
    lastSeenDay: 0,
    window: Array.from({ length: 20 }, (_, i) => ({
      correct: true,
      day: i,
      difficultyStep: P1_GATE.meanStepThreshold + 1,
    })),
  }
}

function storeWith(over: Record<string, MasteryState> = {}) {
  const store = new Map<string, MasteryState>()
  for (const kpId of knowledgePointsOfPhase(c, 'P1')) {
    for (const m of MODALITIES) store.set(masteryKey(kpId, m), mastered())
  }
  for (const [k, v] of Object.entries(over)) store.set(k, v)
  return store
}

describe('evaluateGate', () => {
  it('三模态齐平且实战关通过时过关', () => {
    const result = evaluateGate(c, storeWith(), 'P1', true)
    expect(result.passed).toBe(true)
    expect(result.blockingKeys).toEqual([])
    expect(result.bossSatisfied).toBe(true)
  })

  it('实战关未过则不过关，无逃生口', () => {
    const result = evaluateGate(c, storeWith(), 'P1', false)
    expect(result.passed).toBe(false)
    expect(result.bossSatisfied).toBe(false)
  })

  it('听辨刷满但唱不出来时不过关，且指出是哪个 key 卡住', () => {
    const kpId = knowledgePointsOfPhase(c, 'P1')[0]
    const singKey = masteryKey(kpId, 'sing')
    const result = evaluateGate(c, storeWith({ [singKey]: initialMastery() }), 'P1', true)
    expect(result.passed).toBe(false)
    expect(result.blockingKeys).toContain(singKey)
  })

  it('stability 达标但平均阶梯档位不足时不过关', () => {
    const kpId = knowledgePointsOfPhase(c, 'P1')[0]
    const key = masteryKey(kpId, 'notate')
    const weak: MasteryState = {
      ...mastered(),
      window: Array.from({ length: 20 }, (_, i) => ({
        correct: true,
        day: i,
        difficultyStep: 0,
      })),
    }
    const result = evaluateGate(c, storeWith({ [key]: weak }), 'P1', true)
    expect(result.passed).toBe(false)
    expect(result.blockingKeys).toContain(key)
  })

  it('正确率约 71% 但档位达标时仍能过关（建模决策 4）', () => {
    // 2-down-1-up 的收敛点是 71%——若关卡卡正确率，它将永不可过
    const kpId = knowledgePointsOfPhase(c, 'P1')[0]
    const key = masteryKey(kpId, 'sing')
    const realistic: MasteryState = {
      ...mastered(),
      window: Array.from({ length: 20 }, (_, i) => ({
        correct: i % 7 !== 0,
        day: i,
        difficultyStep: P1_GATE.meanStepThreshold + 1,
      })),
    }
    const result = evaluateGate(c, storeWith({ [key]: realistic }), 'P1', true)
    expect(result.blockingKeys).not.toContain(key)
  })

  it('空的掌握度库下，该阶段每个知识点的三个模态全部卡住', () => {
    const result = evaluateGate(c, new Map(), 'P1', true)
    expect(result.passed).toBe(false)
    expect(result.blockingKeys.length).toBe(
      knowledgePointsOfPhase(c, 'P1').length * MODALITIES.length,
    )
  })
})

describe('nextPhase', () => {
  it('依次推进，P5 之后为 null', () => {
    expect(nextPhase('P1')).toBe('P2')
    expect(nextPhase('P4')).toBe('P5')
    expect(nextPhase('P5')).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/scheduling/gate.test.ts`
Expected: FAIL — 无法解析模块 `./gate`

- [ ] **Step 3: 写实现**

`src/scheduling/gate.ts`：

```ts
import {
  knowledgePointsOfPhase,
  phaseAt,
  phaseIndex,
  type Curriculum,
} from '../curriculum/curriculum'
import {
  MODALITIES,
  masteryKey,
  type MasteryKey,
} from '../curriculum/knowledgePoints'
import { PHASE_ORDER, type PhaseId } from '../curriculum/stages'
import { meanLadderStep } from './gating'
import { getMastery, type MasteryStore } from './mastery'

export interface GateEvaluation {
  passed: boolean
  /** 尚未达标的 (知识点, 模态) —— 直接告诉用户卡在哪 */
  blockingKeys: MasteryKey[]
  bossSatisfied: boolean
}

/**
 * spec §8.3：三模态齐平 + 实战关一次通过。
 * 不允许靠听辨刷满而唱不出来（spec §2.4）。无逃生口。
 */
export function evaluateGate(
  c: Curriculum,
  store: MasteryStore,
  phaseId: PhaseId,
  bossPassed: boolean,
): GateEvaluation {
  const phase = c.phases.find((p) => p.id === phaseId)
  if (!phase) throw new Error(`未知阶段 ${phaseId}`)

  const blockingKeys: MasteryKey[] = []
  for (const kpId of knowledgePointsOfPhase(c, phaseId)) {
    for (const modality of MODALITIES) {
      const key = masteryKey(kpId, modality)
      const state = getMastery(store, key)
      const strongEnough = state.stability >= phase.gate.stabilityThreshold
      // 用平均阶梯档位而非正确率（建模决策 4）：2-down-1-up 把观测正确率
      // 锁在约 71%，卡正确率会让关卡永不可过
      const hardEnough =
        meanLadderStep(state.window) >= phase.gate.meanStepThreshold
      if (!strongEnough || !hardEnough) blockingKeys.push(key)
    }
  }

  const bossSatisfied = phase.gate.requiresBoss ? bossPassed : true
  return {
    passed: blockingKeys.length === 0 && bossSatisfied,
    blockingKeys,
    bossSatisfied,
  }
}

export function nextPhase(phaseId: PhaseId): PhaseId | null {
  const i = phaseIndex(phaseId)
  return i + 1 < PHASE_ORDER.length ? phaseAt(i + 1) : null
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/scheduling/gate.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 运行全部测试与类型检查**

```bash
npx vitest run
npx tsc --noEmit
```

Expected: 全部 PASS，tsc 无输出

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(scheduling): 关卡判定，三模态齐平"
```

---

### Task 12: 候选池与分段配额

spec §7.4 的前半：今天有哪些题可排、每段分多少时间。

**模态选择是本任务最要紧的设计**：
- **复习段**选该知识点三个模态中**可提取性最低**的那个——最接近遗忘的先救。
- **焦点段**选**stability 最低**的那个——拖后腿的模态优先。这条直接让「三模态齐平」的关卡变得可达；若焦点段总选最强的模态，听辨会一路刷满而唱永远不达标，关卡就成了死锁。

**Files:**
- Create: `src/scheduling/candidates.ts`
- Test: `src/scheduling/candidates.test.ts`

**Interfaces:**
- Consumes: `curriculum/curriculum.ts`；`curriculum/knowledgePoints.ts`；`curriculum/stages.ts`；`mastery.ts`；`exerciseSpec.ts`；`music/rng.ts` 的 `Rng`
- Produces:
  - `interface SchedulerInput { curriculum: Curriculum; store: MasteryStore; phaseId: PhaseId; today: number; seed: number; minutes: number }`
  - 常量 `WARMUP_SECONDS`, `SEGMENT_RATIOS`, `MAX_NEW_PER_SESSION`
  - `hasBeenIntroduced(store: MasteryStore, kpId: KnowledgePointId): boolean`
  - `weakestModality(store: MasteryStore, kpId: KnowledgePointId): Modality`
  - `staleastModality(store: MasteryStore, kpId: KnowledgePointId, today: number): Modality`
  - `buildCandidates(input: SchedulerInput, rng: Rng): Record<SessionSegment, ExerciseSpec[]>`
  - `allocateBudget(minutes: number, hasCandidates: Record<SessionSegment, boolean>): Record<SessionSegment, number>`

- [ ] **Step 1: 写失败的测试**

`src/scheduling/candidates.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  MAX_NEW_PER_SESSION,
  WARMUP_SECONDS,
  allocateBudget,
  buildCandidates,
  hasBeenIntroduced,
  staleastModality,
  weakestModality,
  type SchedulerInput,
} from './candidates'
import { buildCurriculum, knowledgePointsOfPhase } from '../curriculum/curriculum'
import { MODALITIES, masteryKey } from '../curriculum/knowledgePoints'
import { initialMastery, type MasteryState } from './mastery'
import { isWellFormedSpec, type SessionSegment } from './exerciseSpec'
import { makeRng } from '../music/rng'

const c = buildCurriculum()
const P1_KPS = knowledgePointsOfPhase(c, 'P1')

function seen(over: Partial<MasteryState> = {}): MasteryState {
  return { ...initialMastery(), lastSeenDay: 0, ...over }
}

function input(store: Map<string, MasteryState>, over: Partial<SchedulerInput> = {}): SchedulerInput {
  return { curriculum: c, store, phaseId: 'P1', today: 10, seed: 7, minutes: 25, ...over }
}

describe('hasBeenIntroduced', () => {
  it('掌握度库里没有任何模态记录时为 false', () => {
    expect(hasBeenIntroduced(new Map(), P1_KPS[0])).toBe(false)
  })

  it('任一模态有记录即为 true', () => {
    const store = new Map([[masteryKey(P1_KPS[0], 'sing'), seen()]])
    expect(hasBeenIntroduced(store, P1_KPS[0])).toBe(true)
  })
})

describe('weakestModality / staleastModality', () => {
  it('weakestModality 选 stability 最低的模态（拖后腿的优先）', () => {
    const kpId = P1_KPS[0]
    const store = new Map([
      [masteryKey(kpId, 'recognize'), seen({ stability: 30 })],
      [masteryKey(kpId, 'sing'), seen({ stability: 2 })],
      [masteryKey(kpId, 'notate'), seen({ stability: 15 })],
    ])
    expect(weakestModality(store, kpId)).toBe('sing')
  })

  it('staleastModality 选可提取性最低的模态（最接近遗忘的先救）', () => {
    const kpId = P1_KPS[0]
    const store = new Map([
      [masteryKey(kpId, 'recognize'), seen({ stability: 10, lastSeenDay: 9 })],
      [masteryKey(kpId, 'sing'), seen({ stability: 10, lastSeenDay: 0 })],
      [masteryKey(kpId, 'notate'), seen({ stability: 10, lastSeenDay: 8 })],
    ])
    expect(staleastModality(store, kpId, 10)).toBe('sing')
  })

  it('全部未练过时返回 recognize（必须先认得出，才谈得上唱得出）', () => {
    expect(weakestModality(new Map(), P1_KPS[0])).toBe('recognize')
  })
})

describe('allocateBudget', () => {
  const all: Record<SessionSegment, boolean> = {
    warmup: true, review: true, focus: true, introduce: true, boss: true,
  }

  it('热身是固定时长，不参与比例分配', () => {
    expect(allocateBudget(25, all).warmup).toBe(WARMUP_SECONDS)
  })

  it('其余四段之和等于扣除热身后的剩余时间', () => {
    const b = allocateBudget(25, all)
    const rest = b.review + b.focus + b.introduce + b.boss
    expect(rest).toBeCloseTo(25 * 60 - WARMUP_SECONDS, 6)
  })

  it('无候选的段其配额并入焦点段', () => {
    const withAll = allocateBudget(25, all)
    const noBoss = allocateBudget(25, { ...all, boss: false })
    expect(noBoss.boss).toBe(0)
    expect(noBoss.focus).toBeCloseTo(withAll.focus + withAll.boss, 6)
  })

  it('复习与引入都无候选时，配额全部并入焦点', () => {
    const b = allocateBudget(25, { ...all, review: false, introduce: false })
    expect(b.review).toBe(0)
    expect(b.introduce).toBe(0)
    expect(b.focus).toBeCloseTo(25 * 60 - WARMUP_SECONDS, 6)
  })

  it('时长过短时不产生负配额', () => {
    const b = allocateBudget(1, all)
    for (const seg of Object.keys(b) as SessionSegment[]) {
      expect(b[seg]).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('buildCandidates', () => {
  it('全新学习者：无复习候选，有引入候选，且引入数受限', () => {
    const cand = buildCandidates(input(new Map()), makeRng(1))
    expect(cand.review).toHaveLength(0)
    expect(cand.introduce.length).toBeGreaterThan(0)
    expect(cand.introduce.length).toBeLessThanOrEqual(MAX_NEW_PER_SESSION)
  })

  it('引入的知识点其前置必须已被引入过', () => {
    const cand = buildCandidates(input(new Map()), makeRng(1))
    for (const spec of cand.introduce) {
      const kp = c.knowledgePoints.get(spec.kpId)!
      expect(kp.prerequisites).toEqual([])
    }
  })

  it('引入段一律用 recognize 模态', () => {
    const cand = buildCandidates(input(new Map()), makeRng(1))
    for (const spec of cand.introduce) expect(spec.modality).toBe('recognize')
  })

  it('已到期的知识点进复习段', () => {
    const store = new Map<string, MasteryState>()
    for (const m of MODALITIES) {
      store.set(masteryKey(P1_KPS[0], m), seen({ stability: 1, lastSeenDay: 0 }))
    }
    const cand = buildCandidates(input(store), makeRng(1))
    expect(cand.review.some((s) => s.kpId === P1_KPS[0])).toBe(true)
  })

  it('复习段按可提取性升序，最接近遗忘的排最前', () => {
    const store = new Map<string, MasteryState>()
    for (const kpId of P1_KPS) {
      for (const m of MODALITIES) {
        store.set(masteryKey(kpId, m), seen({ stability: 1, lastSeenDay: 0 }))
      }
    }
    store.set(masteryKey(P1_KPS[1], 'sing'), seen({ stability: 0.5, lastSeenDay: 0 }))
    const cand = buildCandidates(input(store), makeRng(1))
    expect(cand.review[0].kpId).toBe(P1_KPS[1])
  })

  it('该阶段知识点尚未全部引入时不排实战关', () => {
    const cand = buildCandidates(input(new Map()), makeRng(1))
    expect(cand.boss).toHaveLength(0)
  })

  it('全部引入后才有实战关候选', () => {
    const store = new Map<string, MasteryState>()
    for (const kpId of P1_KPS) {
      for (const m of MODALITIES) store.set(masteryKey(kpId, m), seen({ stability: 5 }))
    }
    const cand = buildCandidates(input(store), makeRng(1))
    expect(cand.boss.length).toBeGreaterThan(0)
    for (const spec of cand.boss) expect(spec.segment).toBe('boss')
  })

  it('热身段非空且用唱模态、最强语境', () => {
    const cand = buildCandidates(input(new Map()), makeRng(1))
    expect(cand.warmup.length).toBeGreaterThan(0)
    for (const spec of cand.warmup) {
      expect(spec.modality).toBe('sing')
      expect(spec.contextLevel).toBe(0)
    }
  })

  it('所有候选都是良构规格，且等级不超过当前阶段的要求上限', () => {
    const store = new Map<string, MasteryState>()
    for (const kpId of P1_KPS) {
      for (const m of MODALITIES) {
        store.set(masteryKey(kpId, m), seen({ stability: 5, contextLevel: 4, variationLevel: 6 }))
      }
    }
    const cand = buildCandidates(input(store), makeRng(1))
    for (const list of Object.values(cand)) {
      for (const spec of list) {
        expect(isWellFormedSpec(spec)).toBe(true)
        // P1 的 T 轨最高是 T2：L1 / V1
        if (spec.track === 'T') expect(spec.contextLevel).toBeLessThanOrEqual(1)
      }
    }
  })

  it('同一 seed 产出完全相同的候选', () => {
    const a = buildCandidates(input(new Map()), makeRng(99))
    const b = buildCandidates(input(new Map()), makeRng(99))
    expect(a).toEqual(b)
  })

  it('规格里的 difficultyStep 一律为 0（快机制由会话运行时推进，不落盘）', () => {
    const cand = buildCandidates(input(new Map()), makeRng(1))
    for (const list of Object.values(cand)) {
      for (const spec of list) expect(spec.difficultyStep).toBe(0)
    }
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/scheduling/candidates.test.ts`
Expected: FAIL — 无法解析模块 `./candidates`

- [ ] **Step 3: 写实现**

`src/scheduling/candidates.ts`：

```ts
import type { ContextLevel } from '../music/tonalContext'
import type { Rng } from '../music/rng'
import {
  knowledgePointsOfPhase,
  requirementFor,
  unlockedKnowledgePoints,
  type Curriculum,
} from '../curriculum/curriculum'
import {
  MODALITIES,
  masteryKey,
  type KnowledgePointId,
  type Modality,
} from '../curriculum/knowledgePoints'
import type { PhaseId, VariationLevel } from '../curriculum/stages'
import {
  SESSION_SEGMENTS,
  itemSeconds,
  type ExerciseSpec,
  type SessionSegment,
} from './exerciseSpec'
import {
  getMastery,
  isDue,
  retrievability,
  type MasteryStore,
} from './mastery'

export interface SchedulerInput {
  curriculum: Curriculum
  store: MasteryStore
  phaseId: PhaseId
  today: number
  seed: number
  minutes: number
}

/** 热身固定时长（spec §7.4）：调性内化，跟唱音阶、找主音，不计分 */
export const WARMUP_SECONDS = 120

/** 扣除热身后，其余四段的时间占比（spec §7.4） */
export const SEGMENT_RATIOS: Record<
  Exclude<SessionSegment, 'warmup'>,
  number
> = { review: 0.4, focus: 0.4, introduce: 0.1, boss: 0.1 }

/** 一次会话最多引入几个新知识点（spec §7.4） */
export const MAX_NEW_PER_SESSION = 2

const SEED_RANGE = 2 ** 31

export function hasBeenIntroduced(
  store: MasteryStore,
  kpId: KnowledgePointId,
): boolean {
  return MODALITIES.some((m) => store.has(masteryKey(kpId, m)))
}

/**
 * stability 最低的模态——拖后腿的优先。
 *
 * 这条直接让「三模态齐平」的关卡变得可达：若焦点段总选最强的模态，
 * 听辨会一路刷满而唱永远不达标，关卡就成了死锁。
 */
export function weakestModality(
  store: MasteryStore,
  kpId: KnowledgePointId,
): Modality {
  let best: Modality = 'recognize'
  let lowest = Infinity
  for (const m of MODALITIES) {
    const s = getMastery(store, masteryKey(kpId, m)).stability
    if (s < lowest) {
      lowest = s
      best = m
    }
  }
  return best
}

/** 可提取性最低的模态——最接近遗忘的先救 */
export function staleastModality(
  store: MasteryStore,
  kpId: KnowledgePointId,
  today: number,
): Modality {
  let best: Modality = 'recognize'
  let lowest = Infinity
  for (const m of MODALITIES) {
    const r = retrievability(getMastery(store, masteryKey(kpId, m)), today)
    if (r < lowest) {
      lowest = r
      best = m
    }
  }
  return best
}

/**
 * 分配各段时间预算（秒）。热身是固定时长，不参与比例分配；
 * 无候选的段其配额并入焦点段（spec §7.4）。
 */
export function allocateBudget(
  minutes: number,
  hasCandidates: Record<SessionSegment, boolean>,
): Record<SessionSegment, number> {
  const warmup = hasCandidates.warmup ? WARMUP_SECONDS : 0
  const remaining = Math.max(0, minutes * 60 - warmup)

  const budget: Record<SessionSegment, number> = {
    warmup,
    review: 0,
    focus: 0,
    introduce: 0,
    boss: 0,
  }

  let spilled = 0
  for (const seg of ['review', 'focus', 'introduce', 'boss'] as const) {
    const share = remaining * SEGMENT_RATIOS[seg]
    if (hasCandidates[seg]) budget[seg] = share
    else spilled += share
  }
  budget.focus += spilled
  return budget
}

function specFor(
  input: SchedulerInput,
  kpId: KnowledgePointId,
  modality: Modality,
  segment: SessionSegment,
  rng: Rng,
  contextOverride?: ContextLevel,
): ExerciseSpec {
  const { curriculum, store, phaseId } = input
  const kp = curriculum.knowledgePoints.get(kpId)
  if (!kp) throw new Error(`未知知识点 ${kpId}`)
  const state = getMastery(store, masteryKey(kpId, modality))
  const cap = requirementFor(curriculum, kpId, phaseId)
  return {
    kpId,
    modality,
    track: kp.track,
    contextLevel:
      contextOverride ??
      (Math.min(state.contextLevel, cap.contextLevel) as ContextLevel),
    variationLevel: Math.min(
      state.variationLevel,
      cap.variationLevel,
    ) as VariationLevel,
    // 快机制由会话运行时推进，不落盘（spec §7.4.1），故计划里一律从 0 起
    difficultyStep: 0,
    seed: rng.int(SEED_RANGE),
    segment,
  }
}

/** 用预算把候选填满，返回实际排入的题 */
function fillToBudget(candidates: ExerciseSpec[], budgetSec: number): ExerciseSpec[] {
  const picked: ExerciseSpec[] = []
  let used = 0
  for (const spec of candidates) {
    const cost = itemSeconds(spec)
    if (used + cost > budgetSec) break
    picked.push(spec)
    used += cost
  }
  return picked
}

export function buildCandidates(
  input: SchedulerInput,
  rng: Rng,
): Record<SessionSegment, ExerciseSpec[]> {
  const { curriculum, store, phaseId, today } = input
  const unlocked = unlockedKnowledgePoints(curriculum, phaseId)
  const introduced = unlocked.filter((id) => hasBeenIntroduced(store, id))
  const phaseKps = knowledgePointsOfPhase(curriculum, phaseId)

  // 热身：该阶段第一个已解锁的 T 轨知识点，唱模态，最强语境，不计分
  const warmupKp =
    unlocked.find((id) => curriculum.knowledgePoints.get(id)?.track === 'T') ??
    unlocked[0]
  const warmup = warmupKp ? [specFor(input, warmupKp, 'sing', 'warmup', rng, 0)] : []

  // 复习：到期的，按可提取性升序
  const reviewPairs = introduced
    .map((kpId) => {
      const modality = staleastModality(store, kpId, today)
      const state = getMastery(store, masteryKey(kpId, modality))
      return { kpId, modality, r: retrievability(state, today), due: isDue(state, today) }
    })
    .filter((x) => x.due)
    .sort((a, b) => a.r - b.r)
  const review = reviewPairs.map((x) =>
    specFor(input, x.kpId, x.modality, 'review', rng),
  )

  // 焦点：当前阶段已引入的知识点，选最弱的模态
  const focus = phaseKps
    .filter((id) => hasBeenIntroduced(store, id))
    .map((kpId) => specFor(input, kpId, weakestModality(store, kpId), 'focus', rng))

  // 引入：尚未引入、且前置全部已引入的，一次最多 MAX_NEW_PER_SESSION 个
  const introduce = unlocked
    .filter((id) => !hasBeenIntroduced(store, id))
    .filter((id) => {
      const kp = curriculum.knowledgePoints.get(id)
      return (kp?.prerequisites ?? []).every((pre) => hasBeenIntroduced(store, pre))
    })
    .slice(0, MAX_NEW_PER_SESSION)
    .map((kpId) => specFor(input, kpId, 'recognize', 'introduce', rng))

  // 实战关：只在该阶段知识点全部引入后才排
  const allIntroduced =
    phaseKps.length > 0 && phaseKps.every((id) => hasBeenIntroduced(store, id))
  const boss = allIntroduced
    ? phaseKps.map((kpId) =>
        specFor(input, kpId, weakestModality(store, kpId), 'boss', rng),
      )
    : []

  const pools: Record<SessionSegment, ExerciseSpec[]> = {
    warmup,
    review,
    focus,
    introduce,
    boss,
  }

  const hasCandidates = Object.fromEntries(
    SESSION_SEGMENTS.map((seg) => [seg, pools[seg].length > 0]),
  ) as Record<SessionSegment, boolean>

  const budget = allocateBudget(input.minutes, hasCandidates)

  return Object.fromEntries(
    SESSION_SEGMENTS.map((seg) => [seg, fillToBudget(pools[seg], budget[seg])]),
  ) as Record<SessionSegment, ExerciseSpec[]>
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/scheduling/candidates.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(scheduling): 候选池与分段配额"
```

---

### Task 13: 强制交错与会话计划

spec §7.4 的后半。三条交错规则（spec §2.5 的落地）：

- 同一知识点连续出现 ≤ 2 次
- 同一模态连续 ≤ 3 题
- 三条轨道必须交替，不允许单日单轨

交错**只作用于计分的四段**（复习/焦点/引入/实战关）；热身固定排在最前，不参与交错。

**Files:**
- Create: `src/scheduling/scheduler.ts`
- Test: `src/scheduling/scheduler.test.ts`

**Interfaces:**
- Consumes: `candidates.ts` 的 `SchedulerInput`, `buildCandidates`；`exerciseSpec.ts`；`music/rng.ts` 的 `makeRng`
- Produces:
  - 常量 `MAX_SAME_KP_RUN`, `MAX_SAME_MODALITY_RUN`, `MAX_SAME_TRACK_RUN`
  - `interface SessionPlan { day: number; seed: number; phaseId: PhaseId; items: ExerciseSpec[] }`
  - `interleave(specs: ExerciseSpec[], rng: Rng): ExerciseSpec[]`
  - `checkInterleaving(items: ExerciseSpec[]): string[]`
  - `buildSessionPlan(input: SchedulerInput): SessionPlan`

- [ ] **Step 1: 写失败的测试**

`src/scheduling/scheduler.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  MAX_SAME_KP_RUN,
  MAX_SAME_MODALITY_RUN,
  MAX_SAME_TRACK_RUN,
  buildSessionPlan,
  checkInterleaving,
  interleave,
} from './scheduler'
import { buildCurriculum, knowledgePointsOfPhase } from '../curriculum/curriculum'
import { MODALITIES, masteryKey } from '../curriculum/knowledgePoints'
import { initialMastery, type MasteryState } from './mastery'
import { isWellFormedSpec, type ExerciseSpec } from './exerciseSpec'
import { makeRng } from '../music/rng'
import type { SchedulerInput } from './candidates'

const c = buildCurriculum()
const P1_KPS = knowledgePointsOfPhase(c, 'P1')

function fullStore(): Map<string, MasteryState> {
  const store = new Map<string, MasteryState>()
  for (const kpId of P1_KPS) {
    for (const m of MODALITIES) {
      store.set(masteryKey(kpId, m), {
        ...initialMastery(),
        stability: 2,
        lastSeenDay: 0,
      })
    }
  }
  return store
}

function input(store: Map<string, MasteryState>): SchedulerInput {
  return { curriculum: c, store, phaseId: 'P1', today: 10, seed: 7, minutes: 25 }
}

function spec(over: Partial<ExerciseSpec>): ExerciseSpec {
  return {
    kpId: 'degree:major:do', modality: 'recognize', track: 'T',
    contextLevel: 0, variationLevel: 0, difficultyStep: 0,
    seed: 1, segment: 'focus', ...over,
  }
}

describe('checkInterleaving', () => {
  it('空列表与单题无违规', () => {
    expect(checkInterleaving([])).toEqual([])
    expect(checkInterleaving([spec({})])).toEqual([])
  })

  it('同一知识点连续超限时报出', () => {
    const items = Array.from({ length: MAX_SAME_KP_RUN + 1 }, () => spec({}))
    expect(checkInterleaving(items).some((p) => p.includes('知识点'))).toBe(true)
  })

  it('同一模态连续超限时报出', () => {
    const items = Array.from({ length: MAX_SAME_MODALITY_RUN + 1 }, (_, i) =>
      spec({ kpId: `degree:major:x${i}`, modality: 'sing' }),
    )
    expect(checkInterleaving(items).some((p) => p.includes('模态'))).toBe(true)
  })

  it('同一轨道连续超限时报出', () => {
    const items = Array.from({ length: MAX_SAME_TRACK_RUN + 1 }, (_, i) =>
      spec({ kpId: `degree:major:x${i}`, track: 'T', modality: MODALITIES[i % 3] }),
    )
    expect(checkInterleaving(items).some((p) => p.includes('轨道'))).toBe(true)
  })

  it('合规序列无违规', () => {
    const items = [
      spec({ kpId: 'a', track: 'T', modality: 'recognize' }),
      spec({ kpId: 'b', track: 'H', modality: 'sing' }),
      spec({ kpId: 'c', track: 'R', modality: 'notate' }),
      spec({ kpId: 'd', track: 'T', modality: 'recognize' }),
    ]
    expect(checkInterleaving(items)).toEqual([])
  })
})

describe('interleave', () => {
  it('不增不减，是原集合的一个排列', () => {
    const items = P1_KPS.map((kpId, i) =>
      spec({ kpId, track: c.knowledgePoints.get(kpId)!.track, modality: MODALITIES[i % 3] }),
    )
    const out = interleave(items, makeRng(3))
    expect(out).toHaveLength(items.length)
    expect(new Set(out.map((s) => s.kpId + s.modality))).toEqual(
      new Set(items.map((s) => s.kpId + s.modality)),
    )
  })

  it('三轨道混合输入时输出满足全部交错规则', () => {
    const items: ExerciseSpec[] = []
    for (let i = 0; i < 12; i++) {
      items.push(spec({ kpId: `degree:major:t${i}`, track: 'T', modality: 'recognize' }))
      items.push(spec({ kpId: `chord:h${i}`, track: 'H', modality: 'sing' }))
      items.push(spec({ kpId: `rhythm:r${i}`, track: 'R', modality: 'notate' }))
    }
    expect(checkInterleaving(interleave(items, makeRng(5)))).toEqual([])
  })

  it('同一 seed 产出相同排列', () => {
    const items = P1_KPS.map((kpId) =>
      spec({ kpId, track: c.knowledgePoints.get(kpId)!.track }),
    )
    expect(interleave(items, makeRng(11))).toEqual(interleave(items, makeRng(11)))
  })

  it('输入本身无法满足规则时仍返回全部题目，不丢题也不死循环', () => {
    // 全部同一知识点同一模态，任何排列都违规
    const items = Array.from({ length: 10 }, () => spec({}))
    const out = interleave(items, makeRng(1))
    expect(out).toHaveLength(10)
  })
})

describe('buildSessionPlan', () => {
  it('热身排在最前，且只有一段热身', () => {
    const plan = buildSessionPlan(input(fullStore()))
    expect(plan.items[0].segment).toBe('warmup')
    expect(plan.items.filter((s) => s.segment === 'warmup')).toHaveLength(1)
  })

  it('计分段满足全部交错规则', () => {
    const plan = buildSessionPlan(input(fullStore()))
    const scored = plan.items.filter((s) => s.segment !== 'warmup')
    expect(checkInterleaving(scored)).toEqual([])
  })

  it('不允许单日单轨：至少覆盖两条轨道', () => {
    const plan = buildSessionPlan(input(fullStore()))
    const tracks = new Set(plan.items.map((s) => s.track))
    expect(tracks.size).toBeGreaterThanOrEqual(2)
  })

  it('全部题目都是良构规格', () => {
    const plan = buildSessionPlan(input(fullStore()))
    for (const spec of plan.items) expect(isWellFormedSpec(spec)).toBe(true)
  })

  it('同一 seed 与同一状态产出完全相同的计划（纯函数、可复现）', () => {
    const a = buildSessionPlan(input(fullStore()))
    const b = buildSessionPlan(input(fullStore()))
    expect(a).toEqual(b)
  })

  it('不同 seed 通常产出不同的计划', () => {
    const a = buildSessionPlan({ ...input(fullStore()), seed: 1 })
    const b = buildSessionPlan({ ...input(fullStore()), seed: 2 })
    expect(a.items.map((s) => s.seed)).not.toEqual(b.items.map((s) => s.seed))
  })

  it('计划带上日期与阶段，供落盘后续练', () => {
    const plan = buildSessionPlan(input(fullStore()))
    expect(plan.day).toBe(10)
    expect(plan.phaseId).toBe('P1')
    expect(plan.seed).toBe(7)
  })

  it('总时长不超过给定分钟数', () => {
    const plan = buildSessionPlan(input(fullStore()))
    const total = plan.items.reduce(
      (sum, s) => sum + ({ recognize: 12, sing: 20, notate: 25 } as const)[s.modality],
      0,
    )
    expect(total).toBeLessThanOrEqual(25 * 60)
  })
})
```

「输入本身无法满足规则时仍返回全部题目，不丢题也不死循环」这条是贪心交错最容易出的两种 bug——要么无限重试，要么静默丢题。

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/scheduling/scheduler.test.ts`
Expected: FAIL — 无法解析模块 `./scheduler`

- [ ] **Step 3: 写实现**

`src/scheduling/scheduler.ts`：

```ts
import { makeRng, type Rng } from '../music/rng'
import type { PhaseId } from '../curriculum/stages'
import { buildCandidates, type SchedulerInput } from './candidates'
import type { ExerciseSpec } from './exerciseSpec'

/** spec §7.4 的三条强制交错规则（spec §2.5 的落地） */
export const MAX_SAME_KP_RUN = 2
export const MAX_SAME_MODALITY_RUN = 3
export const MAX_SAME_TRACK_RUN = 2

export interface SessionPlan {
  day: number
  seed: number
  phaseId: PhaseId
  items: ExerciseSpec[]
}

/** 检查一串题目是否满足交错规则，返回违规描述（空数组表示合规） */
export function checkInterleaving(items: ExerciseSpec[]): string[] {
  const problems: string[] = []
  let kpRun = 0
  let modalityRun = 0
  let trackRun = 0

  for (let i = 0; i < items.length; i++) {
    const prev = items[i - 1]
    kpRun = prev && prev.kpId === items[i].kpId ? kpRun + 1 : 1
    modalityRun = prev && prev.modality === items[i].modality ? modalityRun + 1 : 1
    trackRun = prev && prev.track === items[i].track ? trackRun + 1 : 1

    if (kpRun > MAX_SAME_KP_RUN) {
      problems.push(`第 ${i} 题：知识点 ${items[i].kpId} 连续出现 ${kpRun} 次`)
    }
    if (modalityRun > MAX_SAME_MODALITY_RUN) {
      problems.push(`第 ${i} 题：模态 ${items[i].modality} 连续出现 ${modalityRun} 次`)
    }
    if (trackRun > MAX_SAME_TRACK_RUN) {
      problems.push(`第 ${i} 题：轨道 ${items[i].track} 连续出现 ${trackRun} 次`)
    }
  }
  return problems
}

/** 某题接在给定尾部之后会违反几条规则 */
function violationCount(
  tail: ExerciseSpec[],
  candidate: ExerciseSpec,
): number {
  let n = 0
  const runOf = <K extends keyof ExerciseSpec>(field: K): number => {
    let run = 0
    for (let i = tail.length - 1; i >= 0; i--) {
      if (tail[i][field] !== candidate[field]) break
      run++
    }
    return run
  }
  if (runOf('kpId') + 1 > MAX_SAME_KP_RUN) n++
  if (runOf('modality') + 1 > MAX_SAME_MODALITY_RUN) n++
  if (runOf('track') + 1 > MAX_SAME_TRACK_RUN) n++
  return n
}

/**
 * 贪心交错：每一步挑一个不违规的候选；若全都违规，挑违规最少的。
 *
 * 「挑违规最少的」这条兜底是必需的——输入本身可能无法满足规则
 * （例如某天只有一个知识点到期），此时必须仍然把题排完，
 * 既不能丢题，也不能死循环重试。
 */
export function interleave(specs: ExerciseSpec[], rng: Rng): ExerciseSpec[] {
  const remaining = [...specs]
  // 先打乱，让同等优先的候选之间的选择也由 seed 决定
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    ;[remaining[i], remaining[j]] = [remaining[j], remaining[i]]
  }

  const out: ExerciseSpec[] = []
  while (remaining.length > 0) {
    let bestIndex = 0
    let bestScore = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const score = violationCount(out, remaining[i])
      if (score < bestScore) {
        bestScore = score
        bestIndex = i
        if (score === 0) break
      }
    }
    out.push(remaining[bestIndex])
    remaining.splice(bestIndex, 1)
  }
  return out
}

/**
 * 生成一次会话的计划。纯函数：同一状态 + 同一 seed 必然产出同一计划，
 * 供落盘后中断可续（spec §7.4）。热身固定排在最前，不参与交错。
 */
export function buildSessionPlan(input: SchedulerInput): SessionPlan {
  const rng = makeRng(input.seed)
  const pools = buildCandidates(input, rng)

  const scored = [
    ...pools.review,
    ...pools.focus,
    ...pools.introduce,
    ...pools.boss,
  ]

  return {
    day: input.today,
    seed: input.seed,
    phaseId: input.phaseId,
    items: [...pools.warmup, ...interleave(scored, rng)],
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/scheduling/scheduler.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 运行全部测试与类型检查**

```bash
npx vitest run
npx tsc --noEmit
```

Expected: 全部 PASS，tsc 无输出

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(scheduling): 强制交错与会话计划"
```

---

### Task 14: 冷启动分级测试

spec §7.7。约 5 分钟的阶梯法定位起点。

**对本程序的目标用户尤其关键**：会乐器但耳朵弱的人，让他从「分辨高音低音」开始，第二天就不会再打开。

**Files:**
- Create: `src/scheduling/placement.ts`
- Test: `src/scheduling/placement.test.ts`

**Interfaces:**
- Consumes: `curriculum/curriculum.ts` 的 `Curriculum`, `phaseAt`, `phaseIndex`；`curriculum/validate.ts` 的 `stageOrderIndex`；`curriculum/stages.ts` 的 `ALL_STAGES`, `PhaseId`
- Produces:
  - 常量 `PLACEMENT_MAX_PROBES`, `PLACEMENT_STOP_AFTER_FAILURES`
  - `interface PlacementState { probes: KnowledgePointId[]; results: boolean[] }`
  - `placementProbeOrder(c: Curriculum): KnowledgePointId[]`
  - `initialPlacement(c: Curriculum): PlacementState`
  - `nextProbe(state: PlacementState): KnowledgePointId | null`
  - `recordProbe(state: PlacementState, correct: boolean): PlacementState`
  - `placementResult(c: Curriculum, state: PlacementState): PhaseId`

- [ ] **Step 1: 写失败的测试**

`src/scheduling/placement.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  PLACEMENT_MAX_PROBES,
  PLACEMENT_STOP_AFTER_FAILURES,
  initialPlacement,
  nextProbe,
  placementProbeOrder,
  placementResult,
  recordProbe,
  type PlacementState,
} from './placement'
import { buildCurriculum, phaseOfKnowledgePoint } from '../curriculum/curriculum'

const c = buildCurriculum()

function runProbes(answers: boolean[]): PlacementState {
  let state = initialPlacement(c)
  for (const correct of answers) {
    if (nextProbe(state) === null) break
    state = recordProbe(state, correct)
  }
  return state
}

describe('placementProbeOrder', () => {
  it('探针数量不超过上限', () => {
    expect(placementProbeOrder(c).length).toBeLessThanOrEqual(PLACEMENT_MAX_PROBES)
  })

  it('探针互不重复，且都是真实知识点', () => {
    const probes = placementProbeOrder(c)
    expect(new Set(probes).size).toBe(probes.length)
    for (const id of probes) expect(c.knowledgePoints.has(id)).toBe(true)
  })

  it('由易到难：所属阶段单调不减', () => {
    const probes = placementProbeOrder(c)
    let prev = -1
    for (const id of probes) {
      const idx = ['P1', 'P2', 'P3', 'P4', 'P5'].indexOf(phaseOfKnowledgePoint(c, id))
      expect(idx).toBeGreaterThanOrEqual(prev)
      prev = idx
    }
  })

  it('第一个探针属于 P1', () => {
    expect(phaseOfKnowledgePoint(c, placementProbeOrder(c)[0])).toBe('P1')
  })
})

describe('nextProbe / recordProbe', () => {
  it('全新状态给出第一个探针', () => {
    expect(nextProbe(initialPlacement(c))).toBe(placementProbeOrder(c)[0])
  })

  it('连续失败达阈值后停止', () => {
    const state = runProbes(Array(PLACEMENT_STOP_AFTER_FAILURES).fill(false))
    expect(nextProbe(state)).toBeNull()
  })

  it('失败被正确打断后不停止', () => {
    const answers: boolean[] = []
    for (let i = 0; i < PLACEMENT_STOP_AFTER_FAILURES - 1; i++) answers.push(false)
    answers.push(true)
    expect(nextProbe(runProbes(answers))).not.toBeNull()
  })

  it('答完全部探针后停止', () => {
    expect(nextProbe(runProbes(Array(PLACEMENT_MAX_PROBES).fill(true)))).toBeNull()
  })

  it('不修改输入状态', () => {
    const s = initialPlacement(c)
    recordProbe(s, true)
    expect(s.results).toEqual([])
  })
})

describe('placementResult', () => {
  it('一题未答对时从 P1 起', () => {
    expect(placementResult(c, runProbes([false, false]))).toBe('P1')
  })

  it('全部答对时给到最后一个探针所属阶段', () => {
    const state = runProbes(Array(PLACEMENT_MAX_PROBES).fill(true))
    const probes = placementProbeOrder(c)
    expect(placementResult(c, state)).toBe(
      phaseOfKnowledgePoint(c, probes[probes.length - 1]),
    )
  })

  it('答对前几题后失败，起点是最后一个答对的探针所属阶段', () => {
    const probes = placementProbeOrder(c)
    const answers = [true, true, ...Array(PLACEMENT_STOP_AFTER_FAILURES).fill(false)]
    expect(placementResult(c, runProbes(answers))).toBe(
      phaseOfKnowledgePoint(c, probes[1]),
    )
  })

  it('空状态返回 P1（未做分级测试的用户从头开始）', () => {
    expect(placementResult(c, initialPlacement(c))).toBe('P1')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/scheduling/placement.test.ts`
Expected: FAIL — 无法解析模块 `./placement`

- [ ] **Step 3: 写实现**

`src/scheduling/placement.ts`：

```ts
import {
  phaseAt,
  phaseIndex,
  phaseOfKnowledgePoint,
  type Curriculum,
} from '../curriculum/curriculum'
import type { KnowledgePointId } from '../curriculum/knowledgePoints'
import { stageOrderIndex } from '../curriculum/validate'
import { ALL_STAGES, type PhaseId } from '../curriculum/stages'

/** 约 5 分钟能做完的题量（spec §7.7） */
export const PLACEMENT_MAX_PROBES = 12
export const PLACEMENT_STOP_AFTER_FAILURES = 2

export interface PlacementState {
  probes: KnowledgePointId[]
  results: boolean[]
}

/**
 * 由易到难的探针序列：按级的全课程顺序，每级取第一个引入的知识点。
 * 级数多于探针上限时按等间隔抽取，保证首尾都在。
 */
export function placementProbeOrder(c: Curriculum): KnowledgePointId[] {
  const ordered = [...ALL_STAGES]
    .filter((s) => s.introduces.length > 0)
    .sort((a, b) => stageOrderIndex(c, a.id) - stageOrderIndex(c, b.id))

  if (ordered.length <= PLACEMENT_MAX_PROBES) {
    return ordered.map((s) => s.introduces[0])
  }

  const picked: KnowledgePointId[] = []
  for (let i = 0; i < PLACEMENT_MAX_PROBES; i++) {
    const idx = Math.round((i * (ordered.length - 1)) / (PLACEMENT_MAX_PROBES - 1))
    picked.push(ordered[idx].introduces[0])
  }
  return [...new Set(picked)]
}

export function initialPlacement(c: Curriculum): PlacementState {
  return { probes: placementProbeOrder(c), results: [] }
}

function trailingFailures(results: boolean[]): number {
  let n = 0
  for (let i = results.length - 1; i >= 0 && !results[i]; i--) n++
  return n
}

export function nextProbe(state: PlacementState): KnowledgePointId | null {
  if (state.results.length >= state.probes.length) return null
  if (trailingFailures(state.results) >= PLACEMENT_STOP_AFTER_FAILURES) return null
  return state.probes[state.results.length]
}

export function recordProbe(state: PlacementState, correct: boolean): PlacementState {
  return { ...state, results: [...state.results, correct] }
}

/**
 * 起点 = 最后一个答对的探针所属阶段；一题未对则从 P1 起。
 * 只前进不后退——宁可让学习者多复习，也不要把他推到听不懂的地方。
 */
export function placementResult(c: Curriculum, state: PlacementState): PhaseId {
  let best = 0
  for (let i = 0; i < state.results.length; i++) {
    if (!state.results[i]) continue
    const probe = state.probes[i]
    if (probe === undefined) continue
    best = Math.max(best, phaseIndex(phaseOfKnowledgePoint(c, probe)))
  }
  return phaseAt(best)
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/scheduling/placement.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(scheduling): 冷启动分级测试"
```

---

### Task 15: 虚拟学习者

仿真的作答模型。**它必须会学习**——能力随练习提升，否则课程永远走不完，仿真也就证明不了任何事。

作答概率用心理测量学的标准形式：`P(对) = 猜对率 + (1 − 猜对率) × logistic(斜率 × (能力 − 题目要求))`。题目要求由语境等级、变异等级、难度档、模态共同决定。

**Files:**
- Create: `src/simulation/virtualLearner.ts`
- Test: `src/simulation/virtualLearner.test.ts`

**Interfaces:**
- Consumes: `curriculum/knowledgePoints.ts` 的 `MasteryKey`, `Modality`, `masteryKey`；`scheduling/exerciseSpec.ts` 的 `ExerciseSpec`；`music/rng.ts` 的 `makeRng`
- Produces:
  - 常量 `MODALITY_DEMAND`, `LOGISTIC_SLOPE`
  - `interface LearnerParams { seed: number; baseAbility: number; learningRate: number; errorLearningRate: number; guessRate: number }`
  - `interface VirtualLearner { abilityOf(key: MasteryKey): number; probabilityOf(spec: ExerciseSpec, ladderStep: number): number; answer(spec: ExerciseSpec, ladderStep: number): boolean }`
  - `demandOf(spec: ExerciseSpec, ladderStep: number): number`
  - `makeVirtualLearner(params: LearnerParams): VirtualLearner`
  - `AVERAGE_LEARNER`, `FAST_LEARNER`, `SLOW_LEARNER`（三份预设参数）

- [ ] **Step 1: 写失败的测试**

`src/simulation/virtualLearner.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  AVERAGE_LEARNER,
  FAST_LEARNER,
  SLOW_LEARNER,
  demandOf,
  makeVirtualLearner,
} from './virtualLearner'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'
import { masteryKey } from '../curriculum/knowledgePoints'

const EASY: ExerciseSpec = {
  kpId: 'degree:major:do', modality: 'recognize', track: 'T',
  contextLevel: 0, variationLevel: 0, difficultyStep: 0,
  seed: 1, segment: 'focus',
}
const HARD: ExerciseSpec = {
  ...EASY, contextLevel: 4, variationLevel: 6, difficultyStep: 5, modality: 'notate',
}

describe('demandOf', () => {
  it('难题的要求高于易题', () => {
    expect(demandOf(HARD, 5)).toBeGreaterThan(demandOf(EASY, 0))
  })

  it('语境等级、变异等级、难度档各自单调增加要求', () => {
    expect(demandOf({ ...EASY, contextLevel: 2 }, 0)).toBeGreaterThan(demandOf(EASY, 0))
    expect(demandOf({ ...EASY, variationLevel: 3 }, 0)).toBeGreaterThan(demandOf(EASY, 0))
    expect(demandOf(EASY, 3)).toBeGreaterThan(demandOf(EASY, 0))
  })

  it('唱与听写的要求高于听辨', () => {
    expect(demandOf({ ...EASY, modality: 'sing' }, 0)).toBeGreaterThan(demandOf(EASY, 0))
    expect(demandOf({ ...EASY, modality: 'notate' }, 0)).toBeGreaterThan(demandOf(EASY, 0))
  })

  it('要求落在 0–1', () => {
    for (const spec of [EASY, HARD]) {
      for (const step of [0, 5]) {
        expect(demandOf(spec, step)).toBeGreaterThanOrEqual(0)
        expect(demandOf(spec, step)).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('makeVirtualLearner', () => {
  it('作答概率落在猜对率与 1 之间', () => {
    const l = makeVirtualLearner(AVERAGE_LEARNER)
    for (const spec of [EASY, HARD]) {
      const p = l.probabilityOf(spec, 0)
      expect(p).toBeGreaterThanOrEqual(AVERAGE_LEARNER.guessRate)
      expect(p).toBeLessThanOrEqual(1)
    }
  })

  it('易题的作答概率高于难题', () => {
    const l = makeVirtualLearner(AVERAGE_LEARNER)
    expect(l.probabilityOf(EASY, 0)).toBeGreaterThan(l.probabilityOf(HARD, 5))
  })

  it('会学习：反复作答后同一题的正确概率上升', () => {
    const l = makeVirtualLearner(AVERAGE_LEARNER)
    const before = l.probabilityOf(EASY, 0)
    for (let i = 0; i < 60; i++) l.answer(EASY, 0)
    expect(l.probabilityOf(EASY, 0)).toBeGreaterThan(before)
  })

  it('学习是按 (知识点, 模态) 分开的，练听辨不会让唱变强', () => {
    const l = makeVirtualLearner(AVERAGE_LEARNER)
    const singKey = masteryKey(EASY.kpId, 'sing')
    const before = l.abilityOf(singKey)
    for (let i = 0; i < 60; i++) l.answer(EASY, 0)
    expect(l.abilityOf(singKey)).toBeCloseTo(before, 10)
  })

  it('能力不超过 1', () => {
    const l = makeVirtualLearner({ ...AVERAGE_LEARNER, learningRate: 0.9 })
    for (let i = 0; i < 500; i++) l.answer(EASY, 0)
    expect(l.abilityOf(masteryKey(EASY.kpId, 'recognize'))).toBeLessThanOrEqual(1)
  })

  it('同一 seed 产出完全相同的作答序列', () => {
    const a = makeVirtualLearner(AVERAGE_LEARNER)
    const b = makeVirtualLearner(AVERAGE_LEARNER)
    const seqA = Array.from({ length: 50 }, () => a.answer(HARD, 2))
    const seqB = Array.from({ length: 50 }, () => b.answer(HARD, 2))
    expect(seqA).toEqual(seqB)
  })

  it('快学习者比慢学习者学得快', () => {
    const fast = makeVirtualLearner(FAST_LEARNER)
    const slow = makeVirtualLearner(SLOW_LEARNER)
    for (let i = 0; i < 40; i++) {
      fast.answer(EASY, 0)
      slow.answer(EASY, 0)
    }
    const key = masteryKey(EASY.kpId, 'recognize')
    expect(fast.abilityOf(key)).toBeGreaterThan(slow.abilityOf(key))
  })

  it('三份预设的参数都合法', () => {
    for (const p of [AVERAGE_LEARNER, FAST_LEARNER, SLOW_LEARNER]) {
      expect(p.guessRate).toBeGreaterThanOrEqual(0)
      expect(p.guessRate).toBeLessThan(1)
      expect(p.learningRate).toBeGreaterThan(0)
      expect(p.learningRate).toBeGreaterThan(p.errorLearningRate)
    }
  })
})
```

「练听辨不会让唱变强」这条守的是模型的诚实性：如果虚拟学习者的能力是全局一个数，仿真就会轻松通过「三模态齐平」的关卡，而真实学习者不会——那样的仿真证明不了关卡可达。

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/simulation/virtualLearner.test.ts`
Expected: FAIL — 无法解析模块 `./virtualLearner`

- [ ] **Step 3: 写实现**

`src/simulation/virtualLearner.ts`：

```ts
import { makeRng } from '../music/rng'
import {
  masteryKey,
  type MasteryKey,
  type Modality,
} from '../curriculum/knowledgePoints'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'

/** 唱与听写比听辨更难——多一层产出或记忆负担（spec §6.3） */
export const MODALITY_DEMAND: Record<Modality, number> = {
  recognize: 0,
  sing: 0.15,
  notate: 0.12,
}

/** logistic 斜率：越大，能力与要求的差距对正确率影响越陡 */
export const LOGISTIC_SLOPE = 8

export interface LearnerParams {
  seed: number
  /** 初始能力 0–1 */
  baseAbility: number
  /** 答对后的能力提升系数 */
  learningRate: number
  /** 答错后的能力提升系数（更小，但不为零——错也能学到东西） */
  errorLearningRate: number
  /** 选择题猜对率 */
  guessRate: number
}

export interface VirtualLearner {
  abilityOf(key: MasteryKey): number
  probabilityOf(spec: ExerciseSpec, ladderStep: number): number
  /** 作答并内部更新能力 */
  answer(spec: ExerciseSpec, ladderStep: number): boolean
}

/** 题目要求，归一化到 0–1 */
export function demandOf(spec: ExerciseSpec, ladderStep: number): number {
  const raw =
    0.3 * (spec.contextLevel / 4) +
    0.2 * (spec.variationLevel / 6) +
    0.2 * (Math.max(0, ladderStep) / 5) +
    MODALITY_DEMAND[spec.modality]
  return Math.min(1, Math.max(0, raw))
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

export function makeVirtualLearner(params: LearnerParams): VirtualLearner {
  const rng = makeRng(params.seed)
  const ability = new Map<MasteryKey, number>()

  const abilityOf = (key: MasteryKey): number =>
    ability.get(key) ?? params.baseAbility

  const probabilityOf = (spec: ExerciseSpec, ladderStep: number): number => {
    const key = masteryKey(spec.kpId, spec.modality)
    const gap = abilityOf(key) - demandOf(spec, ladderStep)
    return params.guessRate + (1 - params.guessRate) * logistic(LOGISTIC_SLOPE * gap)
  }

  const answer = (spec: ExerciseSpec, ladderStep: number): boolean => {
    const key = masteryKey(spec.kpId, spec.modality)
    const correct = rng.next() < probabilityOf(spec, ladderStep)
    // 能力按 (知识点, 模态) 分开增长——练听辨不会让唱变强
    const rate = correct ? params.learningRate : params.errorLearningRate
    const current = abilityOf(key)
    ability.set(key, current + rate * (1 - current))
    return correct
  }

  return { abilityOf, probabilityOf, answer }
}

export const AVERAGE_LEARNER: LearnerParams = {
  seed: 20260825,
  baseAbility: 0.25,
  learningRate: 0.035,
  errorLearningRate: 0.012,
  guessRate: 0.15,
}

export const FAST_LEARNER: LearnerParams = {
  ...AVERAGE_LEARNER,
  seed: 20260826,
  baseAbility: 0.4,
  learningRate: 0.07,
  errorLearningRate: 0.025,
}

export const SLOW_LEARNER: LearnerParams = {
  ...AVERAGE_LEARNER,
  seed: 20260827,
  baseAbility: 0.12,
  learningRate: 0.014,
  errorLearningRate: 0.005,
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/simulation/virtualLearner.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(simulation): 虚拟学习者作答模型"
```

---

### Task 16: 仿真运行器与验收断言

**本计划的验收物。** spec §13.1：调度器与掌握度模型都是纯函数，故可喂入模拟学习者跑 180 个虚拟日，在编写任何 UI 之前验证整套课程与调度逻辑是否成立。

**实战关在仿真里的替身**：真正的实战关在 P-5 实现。仿真用「该阶段全部 key 的平均能力是否过阈值」代替，并在代码里注明这是替身，不是实现。

**Files:**
- Create: `src/simulation/runSimulation.ts`
- Test: `src/simulation/runSimulation.test.ts`

**Interfaces:**
- Consumes: 前十五个任务的全部产物
- Produces:
  - 常量 `BOSS_ABILITY_THRESHOLD`
  - `interface DayRecord { day; phaseId; itemCount; correct; interleavingProblems; reliefTriggered; decomposedKeys }`
  - `interface SimulationParams { learner: LearnerParams; days: number; minutesPerDay: number; seed: number }`
  - `interface SimulationResult { days: DayRecord[]; finalStore: Map<MasteryKey, MasteryState>; finalPhase: PhaseId; phaseCompletionDay: Partial<Record<PhaseId, number>>; ladderAccuracy: number }`
  - `runSimulation(params: SimulationParams): SimulationResult`

- [ ] **Step 1: 写失败的测试**

`src/simulation/runSimulation.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { runSimulation } from './runSimulation'
import {
  AVERAGE_LEARNER,
  FAST_LEARNER,
  SLOW_LEARNER,
} from './virtualLearner'
import {
  buildCurriculum,
  phaseIndex,
  unlockedKnowledgePoints,
} from '../curriculum/curriculum'
import { validateCurriculum } from '../curriculum/validate'
import { MODALITIES, masteryKey } from '../curriculum/knowledgePoints'
import { isWellFormedSpec } from '../scheduling/exerciseSpec'
import { buildSessionPlan } from '../scheduling/scheduler'

const c = buildCurriculum()
const BASE = { days: 180, minutesPerDay: 25, seed: 4242 }

const average = runSimulation({ ...BASE, learner: AVERAGE_LEARNER })
const fast = runSimulation({ ...BASE, learner: FAST_LEARNER })
const slow = runSimulation({ ...BASE, learner: SLOW_LEARNER })

describe('课程数据本身无问题', () => {
  it('validateCurriculum 零问题', () => {
    expect(validateCurriculum(c)).toEqual([])
  })
})

describe('无死锁', () => {
  it('每一天都排出了题，没有空转的日子', () => {
    for (const day of average.days) {
      expect(day.itemCount).toBeGreaterThan(0)
    }
  })

  it('普通学习者 180 天内推进了至少两个阶段', () => {
    expect(phaseIndex(average.finalPhase)).toBeGreaterThanOrEqual(2)
  })

  it('已解锁的知识点在三个模态上都被练到过', () => {
    for (const kpId of unlockedKnowledgePoints(c, 'P1')) {
      for (const m of MODALITIES) {
        expect(average.finalStore.has(masteryKey(kpId, m))).toBe(true)
      }
    }
  })
})

describe('交错规则每日均满足', () => {
  it('180 天里没有任何一天违反交错规则', () => {
    const offending = average.days.filter((d) => d.interleavingProblems.length > 0)
    expect(offending.map((d) => ({ day: d.day, problems: d.interleavingProblems })))
      .toEqual([])
  })

  it('快慢学习者同样满足', () => {
    for (const run of [fast, slow]) {
      expect(run.days.every((d) => d.interleavingProblems.length === 0)).toBe(true)
    }
  })
})

describe('难度不发散、不塌缩', () => {
  it('没有任何 key 的语境或变异等级越出合法范围', () => {
    for (const state of average.finalStore.values()) {
      expect(state.contextLevel).toBeGreaterThanOrEqual(0)
      expect(state.contextLevel).toBeLessThanOrEqual(4)
      expect(state.variationLevel).toBeGreaterThanOrEqual(0)
      expect(state.variationLevel).toBeLessThanOrEqual(6)
    }
  })

  it('stability 保持有限且为正', () => {
    for (const state of average.finalStore.values()) {
      expect(Number.isFinite(state.stability)).toBe(true)
      expect(state.stability).toBeGreaterThan(0)
    }
  })

  it('普通学习者的整体正确率落在合理区间，既不无聊也不崩溃', () => {
    const attempted = average.days.reduce((s, d) => s + d.itemCount, 0)
    const correct = average.days.reduce((s, d) => s + d.correct, 0)
    const accuracy = correct / attempted
    expect(accuracy).toBeGreaterThan(0.5)
    expect(accuracy).toBeLessThan(0.95)
  })
})

describe('2-down-1-up 收敛于约 71%', () => {
  it('阶梯稳态段的正确率接近理论收敛点', () => {
    // spec §2.9：2-down-1-up 收敛于约 70.7%
    expect(average.ladderAccuracy).toBeGreaterThan(0.6)
    expect(average.ladderAccuracy).toBeLessThan(0.82)
  })
})

describe('防挫败护栏确实触发', () => {
  it('低能力学习者触发过会话内回血', () => {
    expect(slow.days.some((d) => d.reliefTriggered)).toBe(true)
  })

  it('低能力学习者触发过拆解', () => {
    expect(slow.days.some((d) => d.decomposedKeys.length > 0)).toBe(true)
  })

  it('高能力学习者基本不触发回血', () => {
    const rate = fast.days.filter((d) => d.reliefTriggered).length / fast.days.length
    expect(rate).toBeLessThan(0.1)
  })
})

describe('快慢学习者的周期落在合理区间', () => {
  it('快学习者推进得比慢学习者远', () => {
    expect(phaseIndex(fast.finalPhase)).toBeGreaterThan(phaseIndex(slow.finalPhase))
  })

  it('快学习者过 P1 的天数少于慢学习者（若两者都过了）', () => {
    const f = fast.phaseCompletionDay.P1
    const s = slow.phaseCompletionDay.P1
    if (f !== undefined && s !== undefined) expect(f).toBeLessThan(s)
    expect(f).toBeDefined()
  })

  it('没有人在头几天就过完 P1——课程不是速成的', () => {
    expect(fast.phaseCompletionDay.P1!).toBeGreaterThan(7)
  })
})

describe('集成守卫：调度器输出的规格可被生成器消费', () => {
  it('每一天每一道题都是良构规格', () => {
    for (const learner of [AVERAGE_LEARNER, SLOW_LEARNER]) {
      const run = runSimulation({ ...BASE, days: 30, learner })
      expect(run.days.length).toBe(30)
    }
    // 直接对计划再走一遍，逐题校验
    const plan = buildSessionPlan({
      curriculum: c,
      store: average.finalStore,
      phaseId: average.finalPhase,
      today: 999,
      seed: 1,
      minutes: 25,
    })
    for (const spec of plan.items) {
      expect(isWellFormedSpec(spec)).toBe(true)
      expect(c.knowledgePoints.has(spec.kpId)).toBe(true)
    }
  })
})

describe('确定性', () => {
  it('同一参数跑两次结果完全一致', () => {
    const a = runSimulation({ ...BASE, days: 40, learner: AVERAGE_LEARNER })
    const b = runSimulation({ ...BASE, days: 40, learner: AVERAGE_LEARNER })
    expect(a.days.map((d) => d.correct)).toEqual(b.days.map((d) => d.correct))
    expect(a.finalPhase).toBe(b.finalPhase)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/simulation/runSimulation.test.ts`
Expected: FAIL — 无法解析模块 `./runSimulation`

- [ ] **Step 3: 写实现**

`src/simulation/runSimulation.ts`：

```ts
import {
  buildCurriculum,
  knowledgePointsOfPhase,
  requirementFor,
  unlockedKnowledgePoints,
  type Curriculum,
} from '../curriculum/curriculum'
import {
  MODALITIES,
  masteryKey,
  type MasteryKey,
} from '../curriculum/knowledgePoints'
import type { PhaseId } from '../curriculum/stages'
import { evaluateGate, nextPhase } from '../scheduling/gate'
import { applyGating } from '../scheduling/gating'
import {
  decompose,
  isStagnant,
  needsRelief,
  relieveSpec,
  type SessionProgress,
} from '../scheduling/guardrails'
import { applyLadder, initialLadder, type LadderState } from '../scheduling/ladder'
import {
  applyAttempt,
  getMastery,
  type MasteryState,
} from '../scheduling/mastery'
import { buildSessionPlan, checkInterleaving } from '../scheduling/scheduler'
import {
  makeVirtualLearner,
  type LearnerParams,
  type VirtualLearner,
} from './virtualLearner'

/**
 * 实战关在仿真里的替身：该阶段全部 key 的平均能力过阈值即视为通过。
 * 真正的实战关（多轨合成的模拟音乐片段）在 P-5 实现——这里只是让
 * 仿真能推进阶段，不是实战关的实现。
 */
export const BOSS_ABILITY_THRESHOLD = 0.62

export interface DayRecord {
  day: number
  phaseId: PhaseId
  itemCount: number
  correct: number
  interleavingProblems: string[]
  reliefTriggered: boolean
  decomposedKeys: MasteryKey[]
}

export interface SimulationParams {
  learner: LearnerParams
  days: number
  minutesPerDay: number
  seed: number
}

export interface SimulationResult {
  days: DayRecord[]
  finalStore: Map<MasteryKey, MasteryState>
  finalPhase: PhaseId
  phaseCompletionDay: Partial<Record<PhaseId, number>>
  /** 阶梯稳态段（后半程、档位 ≥1）的正确率，用于验证 2-down-1-up 的收敛点 */
  ladderAccuracy: number
}

function bossPasses(
  curriculum: Curriculum,
  learner: VirtualLearner,
  phaseId: PhaseId,
): boolean {
  const kps = knowledgePointsOfPhase(curriculum, phaseId)
  if (kps.length === 0) return true
  let sum = 0
  let n = 0
  for (const kpId of kps) {
    for (const m of MODALITIES) {
      sum += learner.abilityOf(masteryKey(kpId, m))
      n++
    }
  }
  return n > 0 && sum / n >= BOSS_ABILITY_THRESHOLD
}

export function runSimulation(params: SimulationParams): SimulationResult {
  const curriculum = buildCurriculum()
  const learner = makeVirtualLearner(params.learner)
  const store = new Map<MasteryKey, MasteryState>()
  const days: DayRecord[] = []
  const phaseCompletionDay: Partial<Record<PhaseId, number>> = {}

  let phaseId: PhaseId = 'P1'
  let ladderAttempts = 0
  let ladderCorrect = 0

  for (let day = 0; day < params.days; day++) {
    const plan = buildSessionPlan({
      curriculum,
      store,
      phaseId,
      today: day,
      seed: params.seed + day,
      minutes: params.minutesPerDay,
    })

    const scored = plan.items.filter((s) => s.segment !== 'warmup')
    const interleavingProblems = checkInterleaving(scored)

    // 阶梯状态是会话内的，不落盘（spec §7.4.1）
    const ladders = new Map<MasteryKey, LadderState>()
    const progress: SessionProgress = { attempted: 0, correct: 0 }
    let reliefTriggered = false
    let correctToday = 0

    for (const planned of scored) {
      const spec = needsRelief(progress)
        ? ((reliefTriggered = true), relieveSpec(planned))
        : planned

      const key = masteryKey(spec.kpId, spec.modality)
      const ladder = ladders.get(key) ?? initialLadder(spec.difficultyStep)
      const correct = learner.answer(spec, ladder.step)

      // 只统计档位 ≥1 的尝试：档位 0 是地板，阶梯在那里无法下降，
      // 计入会把收敛点向上拉偏
      if (ladder.step >= 1) {
        ladderAttempts++
        if (correct) ladderCorrect++
      }

      ladders.set(key, applyLadder(ladder, correct))

      const cap = requirementFor(curriculum, spec.kpId, phaseId)
      // 记下这次尝试所在的阶梯档位——门控用它当升级判据（建模决策 4）
      const updated = applyAttempt(getMastery(store, key), correct, day, ladder.step)
      store.set(key, applyGating(updated, cap))

      progress.attempted++
      if (correct) {
        progress.correct++
        correctToday++
      }
    }

    // 跨天护栏：停滞的知识点触发拆解
    const decomposedKeys: MasteryKey[] = []
    for (const kpId of unlockedKnowledgePoints(curriculum, phaseId)) {
      for (const m of MODALITIES) {
        const key = masteryKey(kpId, m)
        const state = store.get(key)
        if (state && isStagnant(state, day)) {
          store.set(key, decompose(state))
          decomposedKeys.push(key)
        }
      }
    }

    days.push({
      day,
      phaseId,
      itemCount: scored.length,
      correct: correctToday,
      interleavingProblems,
      reliefTriggered,
      decomposedKeys,
    })

    // 关卡判定：三模态齐平 + 实战关（spec §8.3）
    const gate = evaluateGate(
      curriculum,
      store,
      phaseId,
      bossPasses(curriculum, learner, phaseId),
    )
    if (gate.passed) {
      phaseCompletionDay[phaseId] = day
      const next = nextPhase(phaseId)
      if (next) phaseId = next
    }
  }

  return {
    days,
    finalStore: store,
    finalPhase: phaseId,
    phaseCompletionDay,
    ladderAccuracy: ladderAttempts > 0 ? ladderCorrect / ladderAttempts : 0,
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/simulation/runSimulation.test.ts`
Expected: PASS，全部通过

**若某条断言不通过，先不要改断言。** 这些断言逐条对应 spec §13.1 的验收要求，改断言等于放弃验收。正确的做法是调模型参数——`GAIN_A`、`LAPSE_C`、门控阈值、`BOSS_ABILITY_THRESHOLD`、学习者预设参数——直到课程真的能走通。**参数是可调的，验收要求不是。** 若调遍参数仍不通过，那说明模型或课程本身有结构问题，此时停下来报告，不要靠放宽断言蒙混过去。

- [ ] **Step 5: 运行全部测试与类型检查**

```bash
npx vitest run
npx tsc --noEmit
npx vite build
```

Expected: 全部 PASS，tsc 无输出，构建成功

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(simulation): 虚拟学习者仿真与验收断言"
```

---

## 完成标准

P-2 完成的判据：

1. `npx vitest run` 全绿
2. `npx tsc --noEmit` 无输出
3. `npx vite build` 成功
4. `validateCurriculum` 对真实课程数据返回零问题
5. 仿真的全部验收断言通过，且**未通过放宽断言达成**
6. 新增代码零 IO：

```bash
grep -rn "Math.random\|Date.now\|window\.\|document\." src/curriculum/ src/scheduling/ src/simulation/ || echo "OK: 三个新目录保持纯净"
```

## 交付物

- `src/curriculum/`：知识点、三轨道数据、阶段与关卡、组装查询、跨文件校验
- `src/scheduling/`：掌握度模型、门控、题目规格、难度阶梯、防挫败护栏、关卡判定、候选池与配额、交错与会话计划、冷启动分级
- `src/simulation/`：虚拟学习者、仿真运行器与 spec §13.1 的全部验收断言

## 下一步

**P-2b 题目生成器**：把 `ExerciseSpec` 渲染成可听的题目——`(spec, seed) → { plan: PlaybackPlan, correctAnswer, options }`，三轨道 × 三模态共九类生成器，消费 P-1 的 `music/` 与 P-2 的规格类型。

**P-2b 开工前必须先处理的两条前向约束**（spec §16.2）：
- **FWD-4 音区钳制**：开放音区变异轴后，语境持续低音会掉到 MIDI 18（约 23 Hz），手机发不出。钳制要做在 `centerMidi` 入口或整个 plan 上。
- **FWD-2 `accent` 与力度轴争 `gain`**：`TimedOnset → NoteSpec` 的桥接函数尚不存在，R 轨生成器落地前必须先定合成规则。
