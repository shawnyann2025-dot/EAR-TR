# P-5 实战关 · 设计文档

> 主 spec：`docs/superpowers/specs/2026-08-24-ear-training-design.md` §8.2–§8.4、§13.1。P-3 spec 的实战关替身 D3（`BOSS_STANDIN_ACCURACY`）由本设计替换。
> 基于分支 `p4b-mic-ui`（P-3b、P-4b 尚待真机验收）。

## 1. 目标

五个阶段的实战关从替身变成真题：用 Web Audio 多轨合成的短曲（贝斯 + 和弦 + 旋律 + 简易鼓），学习者分句扒写；各部分正确率都达标才算通过，通过即升阶段。仿真里的 `BOSS_ABILITY_THRESHOLD` 改为针对真实关卡的「可答性」检查。

## 2. 已确认的决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **掌握度达标后解锁，首页单独挑战**：本阶段三模态全部达标（阻塞项为 0）后首页出现「挑战实战关」；关卡是独立流程，不占日常会话；通过即升阶段。日常会话的 boss 段保留为综合复习，不再决定升阶段 | 「一次通过」需要完整、有仪式感的独立场景 |
| D2 | **各部分 ≥ 90% 才算通过**；一次作答内已提交的部分不能改；没过显示逐项对照，可立即换新片段重试，**每天最多 3 次** | 16 小节听写全对过严；限次保留关卡分量 |
| D3 | **分句作答**：先听整曲，再按乐句（每句 2 小节）逐句填写；每句可无限重听；整曲重听最多 3 次 | 与真实扒谱一致，适合手机屏幕 |
| D4 | **一份 spec，两份计划**：P-5a 纯逻辑（鼓音色、片段模型与渲染、五个关卡生成器、判定、仿真可答性）；P-5b 界面与接入 | 与 P-3、P-4 一致 |

## 3. 片段与关卡（P-5a）

### 3.1 片段模型（`src/boss/types.ts`、`material.ts`、`generate.ts`、`render.ts`）

文件分工：`types.ts`（类型与常量）、`material.ts`（由课程静态推导已解锁素材）、`generate.ts`（五个关卡的生成器，入口 `generateBoss(c, phaseId, seed)`）、`render.ts`（片段 → `PlaybackPlan`）、`grade.ts`、`answerability.ts`；鼓的合成参数在 `src/audio/drums.ts`。`src/boss` 零 IO、不用随机数以外的非确定来源；只有 `simulation/runSimulation.ts` 依赖它。

```ts
interface MelodyNote {
  degree: ScaleDegree
  octave: number                  // 相对所在调「本位 do」（离 MELODY_CENTER_MIDI = 67 最近的 do）的八度数
  keyIndex: 0 | 1                 // 0 原调，1 转调后（仅 P5）
  atBeat: number                  // 从第一小节起的四分音符拍数（不含预备拍）
  durBeats: number
}

interface Piece {
  phaseId: PhaseId
  seed: number
  keys: Key[]                     // keys[0] 原调；P5 另有 keys[1] 新调
  modulationBar: number | null    // 新调开始的小节（0 起），P5 为 4；无转调为 null
  bpm: number                     // 感知拍速度（P1 为 80，其余 90）
  meterId: MeterId                // '2/4' | '3/4' | '4/4'
  bars: number
  melody: MelodyNote[]
  chords: string[] | null         // 每小节一个所在调的级数 id；无和声的关卡为 null
  rhythm: string[] | null         // 每小节一个音型 id，仅节奏是作答部分时（P4）；否则 null
  inversions: (0 | 1)[] | null    // 每小节和弦的转位（渲染低音用），仅 P4 且已解锁第一转位时有
  drums: boolean
}
```

- 没有单独的 `bass` 字段：低音由 `chords`（与 `inversions`）在渲染时推出。
- `renderPiece(piece): RenderedPiece`，`RenderedPiece = { plan: PlaybackPlan; countInSec: number; barSec: number; phrases: { startSec: number; endSec: number }[] }`。乐句按 `PHRASE_BARS = 2` 小节切分，窗口首尾相接、覆盖全曲、互不重叠；窗口的**小节号**不在这里，在 `BossChallenge.phrases`（见 §3.3），两者按下标对齐。
- `phrasePlan(r, i): PlaybackPlan`：取第 i 句的窗口，重定位到开头，前面接同一段预备拍；用于「重听本句」。
- 预备拍：4 个等距的踩镲，与拍号无关（只给速度，不泄露拍号）。
- 声部：旋律（`piano`）、和弦（`strings`，经 `voiceChord` 排列，增益 0.22）、低音（`piano`，和弦根音或第一转位的低音，4/4 在第 1、3 拍各一次）、鼓。和弦根音的下限为 MIDI 48。
- **待办（P-5b）**：弦乐层 0.22 的响度需在手机上实听确认，不够再调。
- 音区：旋律音域 −5…+11 半音（相对原调本位 do，跨度 ≤ 16 半音）；所有调用 `foldPlanToRange` 等 FWD-4 工具时须先过滤鼓事件（`isPitched`），鼓事件的 `freqHz` 为 0。

### 3.2 鼓音色（`src/audio/drums.ts`）

- 新增 `DrumId = 'kick' | 'snare' | 'hat'`，以 `PlaybackEvent.drum` 标记鼓事件（不新增 `TimbreId`，鼓不进音色变异轴；`planToVoices` 把它们滤出音色轴）：`kick` 正弦起音后快速下滑音高（150→50 Hz）；`snare` 带通白噪声（1800 Hz）；`hat` 高通白噪声（7000 Hz），极短。
- `AudioEngine` 增加一份共享、确定的白噪声 `AudioBuffer` 与 `AudioBufferSourceNode` 路径；鼓事件的 `freqHz` 与 `timbreId` 被忽略。
- 鼓型（在 `render.ts` 的 `drumBar`）：
  - P1：只在每小节第 1 拍落底鼓、每拍踩镲，**无军鼓**——拍号可听，但鼓型不泄露拍号；
  - 其余阶段：底鼓在每小节第一拍（4/4 再加第三拍），军鼓在反拍（2/4 第 2 拍；4/4 第 2、4 拍；3/4 无军鼓），踩镲每个感知拍一下（4/4 为八分音符）。

### 3.3 五个关卡生成器（`src/boss/generate.ts`）

每个生成器只用该阶段（含之前阶段）已解锁的素材；素材集合由课程静态推导（`bossMaterial`）。

| 阶段 | 片段 | 作答部分 |
|---|---|---|
| P1 | 8 小节；五声旋律（do re mi sol la）；拍号取已解锁的 2/4、3/4 与基础 4/4 之一；节奏只用四分与八分一对 | 旋律音级、拍号 |
| P2 | 16 小节大调旋律（七个音级）；节奏用已解锁音型 | 旋律音级 |
| P3 | 4 和弦循环（取已解锁的进行，循环到 8 小节）+ 旋律（每小节首音落在和弦音上） | 每小节和弦级数、旋律音级 |
| P4 | 流行歌片段 8 小节：已解锁的和弦（含七和弦）、旋律、节奏型；已解锁第一转位时部分小节取第一转位（低音随之变化，**答案仍是级数 id，不受转位影响**） | 每小节和弦、旋律音级、每小节节奏型 |
| P5 | 转调片段 8 小节：前 4 小节原调、后 4 小节新调；新调**只取属调或下属调**（原调主音 +7 或 +5 个半音），可含借用和弦 bVI、bVII 与 V/V；第 7 小节（下标 6）为新调的 V7（带出新调的 fi 或 te，确立新调） | 每小节和弦（按各自所在调的级数）、旋律音级（按所在调）、新调主音在原调中的音级 |

- 片段由 `seed` 决定（`makeRng`），同一 seed 同一片段。
- `modulationBar`（4）必须是 `PHRASE_BARS` 的整数倍，这样没有乐句跨越转调，「按所在调作答」对每一句都无歧义（有测试断言）。
- 旋律生成的约束（先逐音确定合法音高集合，再自后向前剔除无法衔接的、自前向后选取，因此不会无解）：
  - 音域跨度 ≤ 16 半音（−5…+11）；相邻两音的音程 ≤ 7 半音（纯五度）；
  - 每句以稳定音级（do、mi、sol）收尾，优先取该小节的和弦音；末音为主音 do；
  - **句末音落在拍上**（句末小节的音型只选最后一个音在拍上的）；
  - 有和声的小节，首音落在和弦音上；
  - 在 bVI、bVII、V/V 上，旋律避开与和弦音成小二度的音级；
  - 越界的随机游走反射而不是钳位。
- 答案（`types.ts`，平铺，不再有 `parts` 包层）：

```ts
interface BossAnswer {
  melody: string[][]     // 按乐句分组的旋律音级 id
  chords?: string[]      // 每小节
  rhythm?: string[]      // 每小节（P4）
  meter?: string         // P1
  newTonic?: string      // P5：新调主音在原调中的音级（字母表 re fa sol la，实际取 sol 或 fa）
}
type BossResponse = BossAnswer

interface Phrase { index: number; startBar: number; endBar: number /* 不含 */; melodyCount: number }

interface BossChallenge {
  piece: Piece
  parts: PartId[]        // 'melody' | 'chords' | 'rhythm' | 'meter' | 'newTonic'，本关要判定的部分
  phrases: Phrase[]      // 每句的小节范围与旋律音数（作答区长度）
  answer: BossAnswer
  alphabets: { melody: string[]; chords?: string[]; rhythm?: string[]; meter?: string[]; newTonic?: string[] }
}
```

- 每句的和弦、节奏答案是 `answer.chords.slice(startBar, endBar)` 等。P5 后半（第 5–8 小节）的和弦与旋律音级相对**新调**。

### 3.4 判定（`src/boss/grade.ts`）

- 旋律：逐句逐位比对，正确率 = 对的音数 / 总音数；作答缺失或长度不足的位置记错，多出的忽略。
- 和弦、节奏：逐小节比对。
- 拍号、新调主音：单题，对 = 1、错 = 0。
- `gradeBoss(ch: BossChallenge, r: BossResponse): BossGrade`，`BossGrade = { parts: Partial<Record<PartId, number>>; passed: boolean; marks: { melody: boolean[][]; chords?: boolean[]; rhythm?: boolean[]; meter?: boolean; newTonic?: boolean } }`。只判定 `ch.parts` 里的部分；`passed` = 每个部分 ≥ `BOSS_PASS_RATIO = 0.9`（容差 1e-12）。
- `marks` 是逐位对错，结果页的逐句对照（✓ / ✗）直接用它。
- 显示文案复用 `src/ui/labels.ts`（音级、和弦、音型、拍号）。P-5b 的提示映射：旋律 → `notate-melody`，和弦 → `notate-chords`，节奏 → `notate-patterns`，拍号 → `which-meter`，新调主音 → `new-tonic-degree`；`mode: 'major'`。
- **短部分宽限（用户裁定 2026-10-14）**：可作答位置 2–10 个的部分（和弦、节奏，每小节一个）允许错 1 个（8 小节对 7 个即通过）；单题部分（拍号、新调主音）仍须答对。常量 `SHORT_PART_MAX_POSITIONS = 10`、`SHORT_PART_ALLOWED_WRONG = 1`。

### 3.5 仿真可答性（`src/boss/answerability.ts`、`src/simulation/runSimulation.ts`）

- 去掉 `BOSS_ABILITY_THRESHOLD`。仿真到达关卡条件（阻塞项为 0）后，生成该阶段的真实关卡，虚拟学习者按每个作答位置对应知识点的能力（`positionKpIds`：旋律音级 → `degree:major:*`；和弦 → 对应和弦知识点；节奏 → 对应音型的所属知识点；拍号 → `rhythm:meter-2-4` / `meter-3-4` / 4/4 对应 `rhythm:beat-one`；新调主音 → `degree:modulation:shift`）、以固定难度（`BOSS_SPEC_LEVEL`）的听写题概率（`probabilityOf`，纯函数、不改能力）逐位抽样作答，再用 `gradeBoss` 判定。
- seed 的派生与 `runSimulation` 一致：`bossSeed = (Math.imul(params.seed ^ 0x5bd1e995, 31) + day * 7 + attempt) >>> 0`（`attempt < 3`，每个 `(seed, day, attempt)` 唯一）；关卡由 `makeRng(bossSeed)` 生成，作答用独立的 `makeRng(bossSeed ^ 0x9e3779b9)`，不消耗学习者的 rng。
- 每天最多 3 次尝试，与 D2 一致。
- **节奏风险**：已实测，结果与旧阈值相同（实战关不构成阻塞），节奏偏差为既有问题，用户裁定另议（见主 spec §13.1 的状态注记）。

## 4. 界面与接入（P-5b）

### 4.1 解锁

- 每次进入首页与会话结束时评估：`evaluateGate(c, mastery, phaseId, true).blockingKeys.length === 0` 即掌握度达标。
- 首页在「开始今天的练习」之外显示「挑战实战关」（达标时）；今日总结显示「掌握度已达标，可以挑战实战关」。
- 状态机结束流程不再评估关卡、不再升阶段（删除 `BOSS_STANDIN_ACCURACY`、`bossPassed`、结束流程里的 `advancePhase`）；`Tally boss` 计数可保留为统计。

### 4.2 关卡页

1. 说明：本关包含哪些部分、每句可无限重听、整曲最多再听 3 次、每部分 ≥ 90% 才通过。
2. 「听整曲」。
3. **P1 的拍号题紧接在「听整曲」之后、任何乐句页之前**：乐句页显示的每句音数会泄露拍号，所以拍号必须先答、答后锁定。
4. 逐句：显示「第 n / N 句」、该句的作答区（旋律音级序列——长度已知；按阶段加每小节和弦、每小节节奏型）、「重听本句」、「重听整曲（剩 k 次）」、「下一句」。已提交的句子不能返回修改。
5. 最后一页：新调主音题（P5）。P5 的作答区文案必须写明「第 5–8 小节按新调标注」。
6. 提交 → 结果：各部分百分比、是否通过、逐句对照（对 ✓ / 错 ✗）。
7. 通过 → 升阶段并写 `GateRecord`；没过 → 「换一段再试」（当天剩余次数），或回首页。

作答控件复用 P-3b 的 `SequenceControl`、`ChoiceControl` 与文案表。打拍不参与实战关（节奏以音型选择作答）。

### 4.3 存储

- 新实体 `BossAttempt { phaseId; day; seed; parts: Record<string, number>; passed; at }`。
- IndexedDB 新仓库 `bossAttempts`（autoIncrement），`SCHEMA_VERSION` 1 → 2；迁移只新增该仓库，旧数据不动。
- `Repository` 增加 `appendBossAttempt(a)`、`listBossAttempts(phaseId?)`；内存实现与 IndexedDB 实现跑同一套契约测试。
- 导出包增加 `bossAttempts`；v1 导出包导入时迁移为空列表；导入校验覆盖新记录。
- 运行时增加 `bossAttemptsToday(): Promise<number>` 与 `recordBossAttempt(result)`（通过时同时更新 `Profile.phaseId` 并写 `GateRecord`，与 P-3a 的 `advancePhase` 处理一致）。

### 4.4 中断

中途离开（切走、关页面）不算一次尝试、不占当天次数；进度不保存，回来重新开始新片段。

## 5. 测试

**P-5a**

- 五个生成器固定 seed 快照（音符、和弦、乐句窗口、答案）。
- 素材约束：旋律音级、和弦、音型只来自该阶段已解锁集合；小节数与乐句切分正确；音区在 MIDI 36–96。
- 渲染：声部分轨、鼓点落在拍网格上、乐句窗口首尾相接覆盖全曲。
- 判定：恰好 90% 过、89.9% 不过；任一部分不过整体不过；缺答记错。
- 鼓音色：假 AudioContext 下鼓事件创建噪声源与包络。
- 仿真：改用真实关卡可答性后全部仿真断言照常通过；若阶段完成天数超出目标，停下交用户裁定。

**P-5b**

- 解锁条件；关卡流程（听整曲 → 分句 → 整曲重听上限 → 提交 → 结果）；通过升阶段并写关卡记录；不过可重试、当天第 4 次被拒；中途离开不计次。
- IndexedDB v1 → v2 迁移保留旧数据；导出导入往返。

**真机验收（P-5b，只有用户能做）**

1. 混音里各声部（含鼓）都听得清，音量平衡。
2. 完成 P1 的人做 P1 关卡：难度合理（不靠猜也不是做不了）。
3. 分句重听的起止自然（落在小节线上）。
4. 手机上分句作答区好用。

## 6. 两份计划

| 计划 | 内容 | 合入条件 |
|---|---|---|
| P-5a | §3 全部 | vitest 全绿、tsc 无输出、vite build 成功；仿真节奏在目标内或经用户确认 |
| P-5b | §4 全部 | 同上，加 §5 真机验收；随 P-3b / P-4b 一起或其后合入 |

## 7. 写回主 spec

- §8.2–§8.4：实战关的形式、通过标准（各部分 ≥ 90%）、每天 3 次、分句作答。
- §10.1：`BossAttempt` 实体；`SCHEMA_VERSION = 2`。
- §13.1：仿真的实战关改为真实关卡可答性。
- P-3 spec D3：注明已由 P-5 替换。
