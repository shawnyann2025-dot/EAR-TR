# P-2b 题目生成器 · 设计文档

- 日期：2026-10-13
- 状态：已逐节评审通过，待转实现计划
- 上游：`docs/superpowers/specs/2026-08-24-ear-training-design.md`（主 spec，下称「主 spec」）§6、§9、§16；`docs/superpowers/plans/2026-10-12-roadmap.md` §2「P-2b」
- 下游：P-3 会话运行时（消费 `generate`/`grade`/`FeedbackPlan`），P-4 视唱（消费 `pitch` 作答格式）

---

## 1. 目标与范围

把调度器产出的 `ExerciseSpec` 渲染成可播放、可作答、可判定的题目：

```ts
generate(spec: ExerciseSpec, curriculum: Curriculum): Exercise
grade(exercise: Exercise, response: Response): GradeResult
```

两者都是纯函数：零 IO，随机性全部来自 `makeRng(spec.seed)`，同一输入必然产出同一输出（主 spec §7.4 的「凭 seed 可复现」）。

覆盖：课程里全部 61 个知识点 × 三个模态（听辨、唱、听写）。

不在范围：UI 渲染、音频播放、音高检测（P-4）、实战关（P-5）、会话状态机（P-3）。

### 1.1 已确认的决策

| 编号 | 决策 | 理由 |
|---|---|---|
| D1 | 一份 spec，三份实现计划：P-2b-T → P-2b-H → P-2b-R | 共享层随 T 轨一起落地；每份计划可独立合入 |
| D2 | 干扰项由课程**静态**推导，不依赖掌握度 store | `generate` 保持 `(spec, curriculum)` 的纯函数；重放与重练无需额外状态即可复现 |
| D3 | R 轨「唱」模态 = 点击打拍，按起音时刻真判定 | 不需麦克风，P-3 即可闭环；与 T/H 轨唱模态（P-3 自评、P-4 真判）分开 |
| D4 | 架构 = 类别×模态生成器 + 共享管线 + 数据表 | 只有「内容」一步因题型而异；知识点的音乐含义是数据，增加知识点 = 加一行表 |
| D5 | 听写整串一致才算对，`detail` 给逐位对错 | 掌握度只吃布尔值（主 spec §7.2） |
| D6 | 音区随机范围收窄到中心 ±1 个八度 | 主 spec §6.2 写的 ±2 八度会把持续低音推到 MIDI 12–18（FWD-4），手机放不出来。写回主 spec 为修订 |
| D7 | R 轨的语境 L0–L4 定义为节拍器逐级撤走 | 节奏不需要调中心；沿用主 spec §6.1「外部拐杖逐级撤走」的设计意图。写回主 spec 为扩展 |
| D8 | 进行类干扰池不足时用目标和弦的重排补足 | 小调进行池只有一个成员 |
| D9 | 力度合成规则 `gain = velocity × (accent ? 1.0 : 0.75)` | 解决 FWD-2：accent 与力度轴不再争同一个 `gain` |

---

## 2. 目录与依赖

```
src/exercises/
  types.ts          Exercise / AnswerFormat / Response / GradeResult / FeedbackPlan
  variation.ts      解析变异轴 → ResolvedVariation
  difficulty.ts     difficultyStep → 题内参数（数据表）
  pools.ts          干扰池推导与选项抽取
  context.ts        语境包装：T/H 用 music/tonalContext；R 用节拍器
  feedback.ts       replay / slow 两份反馈 plan
  grade.ts          判定
  generate.ts       管线入口 + 生成器注册表
  data/
    degrees.ts      T 轨知识点 → { mode, degree, pool }
    chords.ts       H 轨知识点 → { mode, chord | progression, pool }
    rhythms.ts      R 轨知识点 → 音型库 / 拍号 / pool
  generators/
    degree.ts       T 轨三模态（含转调）
    chord.ts        H 轨单和弦三模态（含品质、转位、低音线）
    progression.ts  H 轨整条进行三模态
    rhythm.ts       R 轨三模态（含拍号、beat 1、弱起、混合拍子）
```

依赖方向：`exercises/` → `music/`、`curriculum/`、`scheduling/exerciseSpec`。不得反向依赖，不得依赖 `audio/`。

落在 `music/` 的新增：
- `rhythm.ts`：`onsetsToNotes(onsets, midi, velocity)`（FWD-2 桥接）
- `register.ts`：`foldPlanToRange(plan, lo, hi)`（FWD-4 八度折叠）
- `chord.ts`：`voiceChord(chord, doMidi, bassMidi)`（FWD-3，H 轨计划落地；不改 `chordToMidi`）

---

## 3. 核心类型

```ts
type AnswerFormat =
  | { kind: 'choice'; options: AnswerOption[] }                      // 听辨
  | { kind: 'sequence'; length: number; alphabet: AnswerOption[] }   // 听写
  | { kind: 'pitch'; targets: PitchTarget[] }                        // T/H 唱
  | { kind: 'tap'; onsetsSec: number[]; toleranceSec: number }       // R 唱

interface AnswerOption {
  /** 语义 id：'re'、'V'、'q-ee-q-q'、'3/4'、'shift'。显示文案由显示层按 DisplayScheme 换皮 */
  id: string
}

interface PitchTarget {
  degree: ScaleDegree
  midi: number
  freqHz: number
  /** 主 spec §9：±50 音分 */
  centsTolerance: number
}

type Answer =
  | { kind: 'choice'; id: string }
  | { kind: 'sequence'; ids: string[] }
  | { kind: 'pitch'; targets: PitchTarget[] }
  | { kind: 'tap'; onsetsSec: number[] }

type Response =
  | { kind: 'choice'; id: string }
  | { kind: 'sequence'; ids: string[] }
  | { kind: 'pitch'; selfAssessedCorrect: boolean }   // P-2b/P-3；P-4 增加检测结果分支
  | { kind: 'tap'; tapsSec: number[] }

interface ResolvedVariation {
  key: Key
  timbreId: TimbreId
  centerMidi: number
  bpm: number
  velocity: number
  presentation: 'block' | 'arpeggio'
}

interface FeedbackPlan {
  /** 主 spec §6.4 第 1 条：主音（R 轨为一小节节拍器）→ 题目内容 */
  replay: PlaybackPlan
  /** 主 spec §6.4 第 3 条：同一内容按 SLOW_FACTOR 重新渲染 */
  slow: PlaybackPlan
}

/** 题干类型。文案由 UI 层给，这里只给语义 id */
type PromptId =
  | 'which-degree' | 'sing-degrees' | 'notate-melody'
  | 'did-it-modulate' | 'sing-new-tonic' | 'new-tonic-degree'
  | 'which-quality' | 'which-chord' | 'sing-arpeggio' | 'notate-chords'
  | 'which-progression' | 'sing-bassline' | 'notate-progression'
  | 'which-inversion' | 'which-bass-contour' | 'notate-bassline'
  | 'which-pattern' | 'tap-pattern' | 'notate-patterns'
  | 'which-meter' | 'tap-downbeats' | 'which-onset-is-beat-one'
  | 'which-pickup' | 'which-meter-sequence' | 'notate-meters'

interface Exercise {
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

interface GradeResult {
  correct: boolean
  detail:
    | { kind: 'choice' }
    | { kind: 'sequence'; positions: boolean[] }
    | { kind: 'pitch' }
    | { kind: 'tap'; offsetsSec: number[] }
}
```

**`Response` 与 `AnswerFormat` 一一对应。** 种类不匹配时 `grade` 抛错——那是调用方的 bug，不是学习者答错。

**运行时契约（主 spec FWD-8）**：调度器产出的 `spec.difficultyStep` 恒为 0。调用方必须先写入续起的阶梯档位再调 `generate`。`generate` 不做这件事，也无法检测漏写。

---

## 4. 管线

每道题四步。只有第 2 步因类别与模态而异。

1. **解析变异轴**（`variation.ts`）：按 `spec.variationLevel` 决定每条轴取默认值还是从 rng 抽取，产出 `ResolvedVariation`。
2. **内容生成**（`generators/*`）：按 (生成器类别, 模态) 从注册表取生成器，产出题目内容的音符（相对时刻，从 0 起）、`PromptId`、`AnswerFormat`、`Answer`。
3. **语境包装**（`context.ts`）：T/H 轨调用 `buildTonalContext({ key, level: spec.contextLevel, timbreId, doMidi, itemDurSec })`；R 轨调用节拍器语境（§7.1）。题目内容平移到 `leadInSec` 之后合并。合并后整份 plan 过 `foldPlanToRange(plan, 36, 96)`。
4. **反馈**（`feedback.ts`）：用第 2 步的内容复用生成 `replay` 与 `slow`，同样过折叠钳制。

rng 的消耗顺序固定为「变异轴 → 内容 → 选项打乱」，以保证快照稳定。改变消耗顺序等于改变全部快照，须在计划里显式说明。

生成器类别由知识点所在数据表的行决定，不由 `kind` 字段直接决定：`degree` 种类的普通音级与 `modulation:shift` 用不同生成器分支；`chord` 种类按行内的 `family` 字段分派到品质、功能和弦、转位、低音线四个分支；`prog` 种类走进行生成器；`rhythm` 种类按 `family` 分派到音型、拍号、beat 1、弱起、混合拍子五个分支。

---

## 5. 变异轴与音区钳制

按主 spec §6.2 的固定顺序开放，`variationLevel = n` 表示前 n 条轴开放。

| 轴 | 开放于 | 默认值 | 开放后取值 |
|---|---|---|---|
| 调 | 1 | C 大调；小调知识点用 a 小调 | 12 个主音均匀随机；调式由知识点决定，不随机 |
| 音色 | 2 | `piano` | 4 种均匀随机 |
| 音区 | 3 | 题目中心 MIDI 60 | 48–72 均匀随机整数（D6） |
| 速度 | 4 | 90 bpm | 70–110 均匀随机整数 |
| 力度 | 5 | 0.8 | 0.6–1.0 均匀随机 |
| 呈现方式 | 6 | `block` | `block` / `arpeggio` 随机；只作用于 H 轨单和弦题 |

`doMidi = doMidiForKey(key, centerMidi)`。

**FWD-4 两层钳制**：第一层是上表把音区中心收在 48–72；第二层是整份 plan（含语境与反馈）最后过 `foldPlanToRange(plan, 36, 96)`，任何越界事件按八度挪回区间。第一层管常态，第二层兜底语境持续低音（主音下移一个八度）与四音和弦转位的叠高。

**FWD-2 力度规则**（D9）：`gain = velocity × (accent ? 1.0 : 0.75)`。R 轨与旋律听写都经 `onsetsToNotes` 生成音符；语境自身的 `CONTEXT_GAIN`/`DRONE_GAIN` 不受力度轴影响。

---

## 6. `difficultyStep` 映射表

`difficulty.ts` 导出一张只读数据表，档位 0 最易、5 最难，越界档位钳到 0–5。

| 模态 | 参数 | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|---|
| 听辨 | 选项个数（不超过池大小，至少 2） | 2 | 3 | 4 | 5 | 6 | 全部 |
| 听辨 | 目标音/和弦时长（秒，按 90 bpm 基准缩放） | 1.0 | 0.9 | 0.8 | 0.7 | 0.6 | 0.5 |
| 听写 | T 轨旋律音数 | 3 | 4 | 5 | 6 | 7 | 8 |
| 听写 | H 轨和弦个数 | 2 | 3 | 3 | 4 | 4 | 5 |
| 听写 | R 轨小节数 | 1 | 1 | 2 | 2 | 2 | 4 |
| 唱 | T/H 目标音个数 | 1 | 1 | 2 | 2 | 3 | 3 |
| 打拍 | 容差（秒） | 0.12 | 0.11 | 0.10 | 0.08 | 0.07 | 0.06 |
| 打拍 | 小节数 | 1 | 1 | 1 | 2 | 2 | 2 |

唱模态的音高容差固定 50 音分（主 spec §9），不随档位变。语境强度不受 `difficultyStep` 影响，那是 `contextLevel` 的职责（主 spec §7.4.1）。

`SLOW_FACTOR = 0.6`：慢速反馈把 bpm 乘以它、把非节奏题的时值除以它。

---

## 7. 各轨道的题目内容

**干扰池**：每个知识点在数据表里属于一个池（`pool` 字段）。池成员 = 同池、且所在级在课程顺序上不晚于目标所在级的知识点（用 `stageOrderIndex`）。选项 = 目标 + 从池中其余成员按 rng 抽取，凑足 §6 的个数，再整体打乱。池不足时用全部成员，且保证至少 2 个选项（必要时按 D8 补足）。

### 7.1 语境

- **T/H 轨**：主 spec §6.1 的 L0–L4，沿用 `buildTonalContext`。
- **R 轨**（D7）：节拍器点击（主音高一个八度、短促）作为语境。

| 等级 | R 轨形式 |
|---|---|
| L0 | 两小节预备拍 + 全程节拍器 |
| L1 | 一小节预备拍 + 全程节拍器 |
| L2 | 一小节预备拍 + 只在每小节强拍响 |
| L3 | 只有一小节预备拍 |
| L4 | 一小节预备拍 + 前 40% 时长有节拍器，随后撤走 |

### 7.2 T 轨（音级，20 个点）

数据表把知识点名映射到 `{ mode, degree, pool }`。小调升 7 级映射到 `le`（主 spec §4 的枚举），显示成 `si` 是 §15.1 显示层的事。三个池：`major`（含 T7 的 fi/te/me）、`minor`（含 T6 的 si/fi）、`modulation`。

| 模态 | 普通音级 | `modulation:shift` |
|---|---|---|
| 听辨 | 单个目标音；从池中选 | 四小节短句：前两小节原调，后两小节随机留原调或转到下属调（IV）、属调（V）、关系小调（主音即原调 la）；选 `shift` / `stay` |
| 唱 | 1–3 个音，取自池且必含目标；`pitch` 目标 | 听完短句后唱出新主音（未转调则为原主音） |
| 听写 | 3–8 音等时值旋律，取自池、至少含一次目标、相邻音程 ≤ 7 半音 | 长度 1 的序列：新主音是原调的哪个音级（字母表 `do`/`fa`/`sol`/`la`） |

转调短句的旋律取两调各自的大调音阶音，以主音结尾，确保后两小节在新调里自足。

### 7.3 H 轨（和声，26 个点）

数据表按 `family` 分四类：

| family | 知识点 | 听辨 | 唱 | 听写 |
|---|---|---|---|---|
| `quality` | quality-maj / quality-min | 调内随机根音上放该品质和弦；在大三/小三间选 | 从根音起唱琶音前 1–3 个音 | N 个和弦的品质序列 |
| `functional` | I IV V vi ii、V7 Imaj7 ii7 vi7、i iv III VI VII、V-of-V、borrowed-bVI、borrowed-bVII | 单个和弦（呈现方式按变异轴）；从池中选级数 | 唱该和弦琶音前 1–3 个音 | 从主和弦起、含目标的 N 和弦进行，写级数序列 |
| `progression` | 三条大调进行、i-VI-III-VII | 整条进行；从池中选（不足按 D8 用目标和弦重排补足） | 唱根音低音线前 1–3 个音 | 逐和弦写级数（长度固定为进行长度，不随档位变） |
| `inversion` / `bassline` | inv-first / inv-second / bassline | 转位：I/IV/V 之一的原位/一转/二转，选转位；低音线：3–5 个带转位的和弦，从若干低音走向中选 | 唱低音音级前 1–3 个 | 转位：N 个和弦的转位序列；低音线：低音音级序列 |

功能和弦的池按调式分：`major-functional`（含副属与借用）、`minor-functional`。转位与低音线依赖 FWD-3 的 `voiceChord`：低音落在 `doMidi - 12` 附近的低音区，上方声部在 `doMidi` 附近密集排列。

### 7.4 R 轨（节奏，15 个点）

音高固定为主音，音色轴照常生效。数据表按 `family` 分五类：

| family | 知识点 | 听辨 | 打拍（唱模态） | 听写 |
|---|---|---|---|---|
| `pattern` | quarter、eighth-pair、dotted、rest、sixteenth、synco-8、triplet、tie-across-bar、synco-16 | 一小节音型；从池中选音型 id | 打出该音型（`tap`） | N 小节，写音型 id 序列（字母表 = 池中音型） |
| `meter` | meter-2-4、meter-3-4、meter-6-8 | 2–4 小节带强拍重音的片段；选拍号 | 只打每小节强拍 | N 小节该拍号音型的 id 序列 |
| `beat-one` | beat-one | 从小节中间起拍的片段；选「第几个音是第一拍」 | 只打每小节第一拍 | 长度 1 的序列：第一拍的音序号 |
| `anacrusis` | anacrusis | 带弱起的片段；选弱起长度（`none` / `half` / `one`） | 打出含弱起的音型 | N 小节音型序列，首小节为弱起小节 |
| `mixed-meter` | mixed-meter | 拍号交替的片段；选拍号组合（如 `3/4+2/4`） | 打每小节强拍 | 逐小节写拍号 |

音型库是一张数据表：每个音型有 id、拍号、事件列表（`RhythmEvent`），并标注它体现的知识点。池 = 不晚于目标所在级的知识点所拥有的全部音型。6/8 的音型遵守 FWD-6：`{ beatsPerBar: 6, beatUnit: 8 }`。

---

## 8. 判定

| 格式 | 判定规则 | `detail` |
|---|---|---|
| `choice` | `response.id === answer.id` | — |
| `sequence` | 长度相等且逐位相等 | 逐位布尔 |
| `pitch` | P-2b：取 `selfAssessedCorrect` | — |
| `tap` | 点击数等于目标起音数；把整串点击平移使首击对齐首个目标起音（消除反应延迟）后，每个偏差绝对值 ≤ `toleranceSec` | 逐个偏差秒数（平移后） |

`tap` 的点击数不等时 `correct=false`，`offsetsSec` 按较短长度给出。

---

## 9. 反馈

- `replay`：T/H 轨先放主音（`doMidi` 处的主音，0.6 秒），再放题目内容；R 轨先放一小节节拍器，再放内容。
- `slow`：同一内容按 `SLOW_FACTOR` 重新渲染（不含语境）。
- 「你选的」与「正确的」同时标在音阶条上属于显示层，P-3 用 `answer` 与 `response` 渲染，生成器不产出。

---

## 10. 错误处理

- 知识点不在任何数据表中、或数据表行缺字段：抛 `Error`，消息含 `describeSpec(spec)`。由「数据表覆盖测试」保证不会在线上发生。
- `Response` 种类与 `AnswerFormat` 不匹配：`grade` 抛错。
- 干扰池不足：按 §7 补足，不抛错。
- `difficultyStep` 越界：钳到 0–5，不抛错（与 `ladder.ts` 的 `clampStep` 一致）。

---

## 11. 测试策略

1. **共享层单测**：变异轴逐级开放（level n 时恰好前 n 轴变化）、`foldPlanToRange` 边界、力度规则、选项抽取（含目标、去重、个数、池不足补足）、`difficultyStep` 钳制。
2. **快照测试**：每个生成器分支固定 seed 的 `Exercise` 快照。
3. **属性测试**（对随机规格批量跑）：
   - `grade(ex, answerAsResponse(ex.answer)).correct === true`
   - plan、replay、slow 中所有事件音高在 MIDI 36–96 内
   - 同一 (spec, curriculum) 两次生成深度相等
   - 选项 id 互不重复且包含答案
4. **集成守卫**：取普通与慢学习者 180 天仿真的全部会话计划，用仿真 `trace` 拿到每道题的实时档位并写入规格，逐道 `generate` 不抛错。P-2b-T 只对 T 轨断言，P-2b-H 扩到 H，P-2b-R 扩到全量。
5. **数据表覆盖测试**：课程里每个知识点都恰好落在一张数据表的一行里；P-2b-T 只断言 T 轨，后两份计划逐步扩展。

---

## 12. 三份计划的切分

| 计划 | 内容 | 合入条件 |
|---|---|---|
| P-2b-T | FWD-2、FWD-4、§3 全部类型、§4 管线、§5 变异轴、§6 映射表、§7 干扰池与 T/H 语境、§8 判定、§9 反馈、T 轨全部生成器（含转调） | T 轨的快照、属性、覆盖、集成守卫全绿 |
| P-2b-H | FWD-3 `voiceChord`、H 轨四类生成器 | 测试扩到 H 轨后全绿 |
| P-2b-R | R 轨节拍器语境、音型库、R 轨五类生成器、`tap` 判定的端到端测试 | 测试扩到全量后全绿；P-2b 完成 |

每份计划的完成标准沿用 P-2：`npx vitest run` 全绿、`npx tsc --noEmit` 无输出、`npx vite build` 成功、`src/exercises/` 零 IO 自查。

---

## 13. 写回主 spec 的修订

P-2b-T 合入时写回：
- §6.2 音区「±2 个八度」→「±1 个八度，且整份 plan 八度折叠到 MIDI 36–96」（D6、FWD-4 关闭）
- §16.2 FWD-2 关闭，记录 D9 规则

P-2b-H 合入时写回：§16.2 FWD-3 关闭。

P-2b-R 合入时写回：§6.1 增补 R 轨语境定义（D7）；§16.2 FWD-6 状态更新。
