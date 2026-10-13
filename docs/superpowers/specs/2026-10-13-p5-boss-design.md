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

### 3.1 片段模型（`src/boss/piece.ts`）

```ts
interface Piece {
  key: Key
  bpm: number                     // 感知拍速度（与 P-2b-R 约定一致）
  meter: Meter
  bars: number
  melody: MelodyNote[]            // { degree: ScaleDegree; bar: number; atBeat: number; durBeats: number }
  chords: ChordSymbol[] | null    // 每小节一个和弦 id（如 'I'、'vi'、'bVII'），无和声的关卡为 null
  bass: 'root' | 'none'           // 贝斯走和弦根音（或转位指定的低音）
  drums: boolean
  modulation: { atBar: number; newKey: Key } | null   // 仅 P5
}
```

- `renderPiece(piece): { plan: PlaybackPlan; phrases: { startSec: number; endSec: number; bars: [number, number] }[] }`：乐句按 2 小节切分，窗口首尾相接、覆盖全曲、互不重叠。
- 声部：旋律（`voice` 或 `piano` 音色）、和弦（`strings`，经 `voiceChord` 排列，FWD-3 已落地）、贝斯（`piano` 低八度或专用低音）、鼓（新音色）。所有声部的音区限制沿用 FWD-4：最低 MIDI 36、最高 MIDI 96。

### 3.2 鼓音色（`src/audio/`）

- 新增 `DrumId = 'kick' | 'snare' | 'hat'`，以 `PlaybackEvent.drum` 标记鼓事件（不新增 `TimbreId`，鼓不进音色变异轴）：`kick` 正弦起音后快速下滑音高（150→50 Hz）；`snare` 带通白噪声（1800 Hz）；`hat` 高通白噪声（7000 Hz），极短。
- `AudioEngine` 增加一份共享的白噪声 `AudioBuffer` 与 `AudioBufferSourceNode` 路径；鼓事件的 `freqHz` 与 `timbreId` 被忽略。
- 鼓型（`src/boss/drums.ts`）：底鼓在每小节第一拍（4/4 再加第三拍），军鼓在反拍（2/4、4/4 的第 2、4 拍；3/4 无军鼓），踩镲每个感知拍一下（4/4 为八分音符）。

### 3.3 五个关卡生成器（`src/boss/generators.ts`）

每个生成器只用该阶段（含之前阶段）已解锁的素材；素材集合由课程静态推导（与 P-2b「由课程静态推导」一致）。

| 阶段 | 片段 | 作答部分 |
|---|---|---|
| P1 | 8 小节；五声旋律（do re mi sol la）；拍号取已解锁的 2/4、3/4 与基础 4/4 之一；节奏只用四分与八分一对 | 旋律音级、拍号 |
| P2 | 16 小节大调旋律（七个音级）；节奏用已解锁音型 | 旋律音级 |
| P3 | 4 和弦循环（取已解锁的进行，循环 2–4 次）+ 旋律（落在和弦音上为主） | 每小节和弦级数、旋律音级 |
| P4 | 流行歌片段：已解锁的和弦（含七和弦、转位）、旋律、节奏型 | 每小节和弦、旋律音级、每小节节奏型 |
| P5 | 转调片段：前半在原调、后半在新调（关系调或属/下属调），可含借用和弦 bVI、bVII 与 V/V | 每小节和弦（按各自所在调的级数）、旋律音级（按所在调）、新调主音在原调中的音级 |

- 片段由 `seed` 决定（`makeRng`），同一 seed 同一片段。
- 旋律生成的约束：每句以稳定音级（do、mi、sol）收尾；跳进不超过五度；末句收于主音。
- 答案：`BossAnswer = { parts: { melody?: string[][]; chords?: string[]; rhythm?: string[]; meter?: string; newTonicDegree?: string } }`，`melody` 按乐句分组（每句一个音级 id 序列）。

### 3.4 判定（`src/boss/grade.ts`）

- 旋律：逐句逐位比对，正确率 = 对的音数 / 总音数；作答长度不足的位置记错。
- 和弦、节奏：逐小节比对。
- 拍号、新调主音：单题，对 = 1、错 = 0。
- `gradeBoss(answer, response): { parts: Record<PartId, number>; passed: boolean }`，`passed` = 每个部分 ≥ `BOSS_PASS_RATIO = 0.9`。
- 显示文案复用 `src/ui/labels.ts`（音级、和弦、音型、拍号）。

### 3.5 仿真可答性（`src/simulation/`）

- 去掉 `BOSS_ABILITY_THRESHOLD`。仿真到达关卡条件（阻塞项为 0）后，生成该阶段的真实关卡（seed 由仿真 rng 派生），虚拟学习者按每个作答位置对应知识点的能力（旋律音级 → 对应 `degree:*` 的听写模态；和弦 → 对应和弦知识点的听写模态；节奏 → 对应音型；拍号 → `meter-*`）逐位抽样作答，再用 `gradeBoss` 判定。
- 每天最多 3 次尝试，与 D2 一致。
- **节奏风险**：替换后阶段完成天数可能变化。若超出主 spec §8.2 的周期目标（或现有仿真断言），停下交用户裁定，不擅自调参。

## 4. 界面与接入（P-5b）

### 4.1 解锁

- 每次进入首页与会话结束时评估：`evaluateGate(c, mastery, phaseId, true).blockingKeys.length === 0` 即掌握度达标。
- 首页在「开始今天的练习」之外显示「挑战实战关」（达标时）；今日总结显示「掌握度已达标，可以挑战实战关」。
- 状态机结束流程不再评估关卡、不再升阶段（删除 `BOSS_STANDIN_ACCURACY`、`bossPassed`、结束流程里的 `advancePhase`）；`Tally boss` 计数可保留为统计。

### 4.2 关卡页

1. 说明：本关包含哪些部分、每句可无限重听、整曲最多再听 3 次、每部分 ≥ 90% 才通过。
2. 「听整曲」。
3. 逐句：显示「第 n / N 句」、该句的作答区（旋律音级序列——长度已知；按阶段加每小节和弦、每小节节奏型）、「重听本句」、「重听整曲（剩 k 次）」、「下一句」。已提交的句子不能返回修改。
4. 最后一页：单题部分（拍号或新调主音）。
5. 提交 → 结果：各部分百分比、是否通过、逐句对照（对 ✓ / 错 ✗）。
6. 通过 → 升阶段并写 `GateRecord`；没过 → 「换一段再试」（当天剩余次数），或回首页。

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
