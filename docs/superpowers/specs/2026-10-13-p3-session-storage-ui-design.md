# P-3 会话运行时、存储与最小界面 · 设计文档

- 日期：2026-10-13
- 状态：已逐节评审通过，待转实现计划
- 上游：主 spec `docs/superpowers/specs/2026-08-24-ear-training-design.md`（§6.4、§6.5、§7、§8.5、§10、§11、§12、§15.1、§16）；P-2b spec `docs/superpowers/specs/2026-10-13-p2b-exercise-generators-design.md`（§3 类型、§8 判定、§14 给 P-3 的约束）；路线图 `docs/superpowers/plans/2026-10-12-roadmap.md` §2「P-3」
- 目标：第一个可用产品——手机上打开即可按调度器真练一天，数据落盘，中断可续

---

## 1. 已确认的决策

| 编号 | 决策 | 理由 |
|---|---|---|
| D1 | 一份 spec，两份计划：P-3a（无界面的会话运行时 + 存储）→ P-3b（手机界面 + 移动端整合） | P-3a 全部可单测，先合入；P-3b 是第一个有界面的阶段，不确定性集中在这里 |
| D2 | 「今天」按本地日历日计；每天一场**主线**会话（中断可续），练完可开**加练**场 | 主 spec §1.3 的节奏；加练同样记录作答、更新掌握度，同日重复检索的 stability 增益本就接近 0（间隔效应），不会被刷 |
| D3 | P-5 之前，关卡的「实战关」一项用**本场实战关段正确率 ≥ 80%** 作替身；三模态齐平的掌握度门槛不变 | 真实关卡在 P-5；不设替身则用户要等到 P-5 才能升阶段 |
| D4 | 会话运行时 = **纯状态机 + 薄壳**：`reduce(state, event) → { state, effects }`，壳层执行副作用 | 全部规则可单测，风格与调度器一致；界面只订阅状态 |
| D5 | 存储：`Repository` 接口 + 内存实现 + IndexedDB 实现，不引第三方运行时库；测试引入开发依赖 `fake-indexeddb` | 主 spec §10.3「薄封装」；`fake-indexeddb` 只在测试中使用，不进生产包 |
| D6 | 界面用 React + 普通 CSS，不引 UI 库，移动端优先 | 已有 React；最小可用即可 |

不在 P-3 范围：真实音高判定（P-4，唱模态继续自评）、真实实战关（P-5）、离线安装与 Playwright 端到端（P-6）、音域测定（P-4，P-3 只留占位）。

---

## 2. 目录与依赖

```
src/session/     纯函数：状态机、日期与 seed、关卡替身、重练小会话（零 IO）
src/storage/     Repository 接口、内存实现、IndexedDB 实现、迁移、导出导入
src/runtime/     薄壳：把状态机的副作用接到 AudioEngine、Repository、时钟
src/ui/          React 页面与组件、显示文案表
src/audio/       既有；P-3a 修 FWD-1，P-3b 修 FWD-5
```

依赖方向：`session` → `exercises`、`scheduling`、`curriculum`、`music`（只读类型与纯函数）；`storage` → `session` 的类型；`runtime` → `session`、`storage`、`audio`；`ui` → `runtime`、`session` 的类型、`exercises` 的类型。`session` 与 `storage` 的核心逻辑零 IO（IndexedDB 实现除外）。

---

## 3. 会话运行时（P-3a，`src/session/`）

### 3.1 日期与 seed

- `dayIndex(createdAtLocalDate, todayLocalDate)`：两个本地日历日之差（天），与掌握度模型和仿真里的 `day` 同义。由壳层传入当天日期，`session` 内不读时钟。
- 会话 seed：由 `(profileId, day, sessionNo)` 确定性派生（`sessionNo` 0 为主线，1、2… 为加练）。

### 3.2 开场

壳层从存储读出 Profile、掌握度表，以及当天该场次的会话记录：

- 有未完成的会话记录 → **续起**：用记录里保存的计划与进度。
- 没有 → 调 `buildSessionPlan({ curriculum, store, phaseId, today: day, seed, minutes: 25 })` 生成计划，**连同计划本身落盘**。不能只存 seed：掌握度在会话中途会变，重算出的计划不同。

### 3.3 状态

```ts
interface SessionState {
  day: number
  sessionNo: number
  mode: 'session' | 'drill'          // drill = 重练小会话：不产生任何持久化副作用（3.8）
  phaseId: PhaseId
  plan: SessionPlan
  index: number                         // 下一道计划题的下标
  ladders: Record<MasteryKey, LadderState>   // 会话内阶梯（可续起，见 3.4）
  progress: SessionProgress             // 计分题的已答 / 答对，供回血判定
  boss: { attempted: number; correct: number }  // 实战关段计数（D3）
  reliefTriggered: boolean
  phase: 'idle' | 'presenting' | 'answering' | 'feedback' | 'done'
  current: CurrentItem | null           // 当前题：实时规格、Exercise、是否计分
  wrongThisSession: ExerciseSpec[]      // 本场答错的实时规格，供「重练刚才错的这组」
}
```

掌握度表不放进 `SessionState`：壳层持有内存副本，事件里按需带入（3.5）。

### 3.4 每道题的流程

把仿真 `runSimulation` 里已验证的逻辑搬成正式实现，**仿真随后改为复用它**（同一套函数，避免两份实现漂移）：

1. 取计划第 `index` 题。阶梯 = `ladders[key] ?? resumeLadder(mastery[key].window)`。
2. **把档位写进规格**：`spec = { ...planned, difficultyStep: ladder.step }`（P-2b §14 运行时契约）。
3. `needsRelief(progress)` 时：`spec = relieveSpec(spec)`，阶梯落到回血后的档位、连对清零，`reliefTriggered = true`。
4. `generate(spec, curriculum)` 出题 → 副作用「播放 `exercise.plan`」，进入 `presenting`；内容播完进入 `answering`。
5. 提交作答 → `grade(exercise, response)`：
   - 热身题（`segment === 'warmup'`）不计分：不改阶梯、不写作答、不写掌握度。
   - 计分题：`applyLadder` → `applyAttempt(state, correct, day, steppedLadder.step)`（记答后档位）→ `applyGating(…, requirementFor(…))`；更新 `progress`；实战关段的题同时更新 `boss`；答错的实时规格追加到 `wrongThisSession`。
   - 副作用：「写一条作答」「写回该 key 的掌握度」「写会话进度」；进入 `feedback`，反馈内容取 `exercise.feedback`。
6. `index` 在提交作答时就加 1，并随同一次「写会话进度」落盘（续起因此不会重出已答的题）；「下一题」只出第 `index` 道，计划用完进入结束流程（3.6）。

唱模态在 P-4 之前用自评作答（`{ kind: 'pitch', selfAssessedCorrect }`）。

### 3.5 事件与副作用

```ts
type SessionEvent =
  | { type: 'start' }
  | { type: 'contentPlayed' }
  | { type: 'answer'; response: Response; latencyMs: number }
  | { type: 'interrupted' }
  | { type: 'next' }
  | { type: 'endEarly' }

type SessionEffect =
  | { type: 'play'; plan: PlaybackPlan }
  | { type: 'stopAudio' }
  | { type: 'saveAttempt'; attempt: AttemptRecord }
  | { type: 'saveMastery'; key: MasteryKey; state: MasteryState }
  | { type: 'saveSession'; record: SessionRecord }
  | { type: 'advancePhase'; from: PhaseId; to: PhaseId; day: number }
  | { type: 'itemError'; spec: ExerciseSpec; message: string }
  | { type: 'ended'; summary: SessionSummary }

function reduce(
  state: SessionState,
  event: SessionEvent,
  ctx: { curriculum: Curriculum; mastery: MasteryStore },
): { state: SessionState; effects: SessionEffect[] }
```

状态机不持有 Profile：`advancePhase` 只声明「阶段从 `from` 推进到 `to`」，由壳层更新 `Profile.phaseId` 并写 `GateRecord`。`itemError` 报告某道计划题出题抛错（已被跳过），由壳层记错误日志。

`reduce` 是纯函数；掌握度表以只读形式经 `ctx` 传入，变化通过 `saveMastery` 副作用交给壳层（壳层同时更新自己的内存副本）。

### 3.6 中断

`interrupted`（来电、切后台、`AudioContext` 被挂起）：若当前题处于 `presenting` 或 `answering`，**作废**——不写作答、不改阶梯与计数；恢复后同一道计划题**重新出题**（同一实时规格、同一 seed）。主 spec §11：不处理会导致熟练度莫名下降。

### 3.7 会话结束

1. 跨天护栏：对 `unlockedKnowledgePoints(curriculum, phaseId)` 的每个 key，`isStagnant(state, day)` 时 `decompose` 并写回。
2. 关卡：`evaluateGate(curriculum, mastery, phaseId, bossPassed)`，其中 `bossPassed = boss.attempted > 0 && boss.correct / boss.attempted >= BOSS_STANDIN_ACCURACY`（0.8，D3）。过关则 Profile 的 `phaseId` 推进到 `nextPhase`，并记 `GateRecord`。
3. 生成 `SessionSummary`：计分题数、正确率、各轨道题数、是否触发回血、关卡评估（阻塞的 key 数、实战关是否达标、是否升阶段）。
4. 会话记录标记完成。

`endEarly`：同样执行 1、3、4，不评估关卡（不完整的会话不升阶段）。

### 3.8 加练与重练

- **加练**（D2）：当天主线完成后，`sessionNo + 1` 开一场新会话，流程完全相同（含关卡评估）。
- **重练刚才错的这组**（主 spec §6.5）：用 `wrongThisSession` 的实时规格（换新 seed）组成一个小会话；**不写作答、不写掌握度、不动阶梯**，只给即时巩固。状态机复用同一 `reduce`，以 `mode: 'drill'` 关闭所有持久化副作用。

### 3.9 FWD-1

`AudioEngine.play()` 在每个节点 `onended` 时把它从 `active` 中移除（或在 `play()` 开头按结束时刻清理过期项），使连续播放不再线性累积节点引用。单测用假 `AudioContext` 断言连续播放 N 次后 `active` 不增长。

---

## 4. 存储（P-3a，`src/storage/`）

### 4.1 实体

```ts
interface Profile {
  id: string
  createdAtLocalDate: string        // 'YYYY-MM-DD'，本地日历日
  phaseId: PhaseId
  displayScheme: DisplayScheme      // 'solfege' | 'numeric' | 'degree'
  placement: { done: boolean; startPhase: PhaseId | null }
  schemaVersion: number
}

interface AttemptRecord {
  at: string                        // ISO 时间戳（仅作记录，不参与任何判定）
  day: number
  sessionNo: number
  kpId: KnowledgePointId
  modality: Modality
  spec: ExerciseSpec                // 实时规格（含档位与 seed），可复现该题
  correct: boolean
  latencyMs: number
  detail: GradeResult['detail']
}

interface SessionRecord {
  day: number
  sessionNo: number
  phaseId: PhaseId
  plan: SessionPlan
  index: number
  progress: SessionProgress
  boss: { attempted: number; correct: number }
  byTrack: Record<Track, number>      // 各轨道计分题数
  reliefTriggered: boolean
  completed: boolean
}

interface GateRecord { phaseId: PhaseId; passedOnDay: number }   // 历史只追加，不覆盖
interface AttemptAggregate { key: MasteryKey; attempts: number; correct: number }
```

阶梯状态不落盘（由掌握度窗口推导，主 spec §7.4.1 的 P-2 修订）。

### 4.2 `Repository` 接口

```ts
interface Repository {
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
  exportAll(exportedAt: string): Promise<ExportBundle>   // 时间戳由调用方传入，存储层不读时钟
  importAll(bundle: ExportBundle): Promise<void>
}
```

### 4.3 实现

- **内存实现**：测试用；也是隐私模式下的降级（主 spec §12）。降级时界面顶部常驻警告「本次进度不会保存」。
- **IndexedDB 实现**：薄封装，原生 IndexedDB API。对象仓库：`profile`、`mastery`（键 = MasteryKey）、`attempts`（自增键）、`attemptAggregates`、`sessions`（键 = `day:sessionNo`）、`gates`。
- **Schema 版本与迁移**：`SCHEMA_VERSION = 1`；迁移函数表按版本串联（`migrations[v]` 把 v 升到 v+1），IndexedDB 的 `onupgradeneeded` 与导入都走同一张表。
- **作答归档**（主 spec §10.2）：`appendAttempt` 后若总数超过 `ATTEMPT_CAP = 50_000`，最旧的超出部分按 MasteryKey 聚合进 `attemptAggregates`（累加次数与对数）后删除。聚合表永久保留。

### 4.4 损坏与导出导入

- **不可用**：IndexedDB 不存在，或打开时失败且不是版本冲突（`VersionError`）→ 抛 `StorageUnavailableError`，壳层降级为内存仓库（主 spec §12）。
- **损坏**：版本号高于本程序、缺仓库、Profile 结构不对 → 抛 `StorageCorruptError`，其中带一份尽力读出的**原始数据导出字符串**（`rawDump`，按仓库存 `[key, value]` 对）。壳层让用户先下载这份损坏副本，确认后才重建。**绝不静默清空**（主 spec §10.3）。
- **导出**：`ExportBundle = { schemaVersion, exportedAt, profile, mastery, attempts, attemptAggregates, sessions, gates }`，一个 JSON 文件。
- **导入**：校验结构 → 迁移到当前版本 → **先自动导出当前数据**（交给壳层提供下载）→ 整体替换。任何一步失败都不改现有数据。

---

## 5. 薄壳（P-3a，`src/runtime/`）

`createRuntime(deps: RuntimeDeps)` 返回一个可订阅的 `Runtime`，其中 `RuntimeDeps = { repo, audio, timer, curriculum, nowIso, todayLocalDate, newProfileId }`（`audio: AudioPort`、`timer: TimerPort` 均为可注入的端口）。`Runtime` 的方法：`getSnapshot`、`subscribe`、`ensureProfile`、`todayStatus`、`startToday`、`startExtra`、`startDrill`、`dispatch`，以及档案与数据操作 `updateProfile(patch)`、`exportBundle()`、`importBundle(json)`。

- **档案缓存不会过期**：`Profile` 只经运行时修改。`updateProfile` 合并补丁、保存并通知；升阶段总是基于最新缓存（已在目标阶段则不重复保存、不重复记关卡）。
- **导入**：`importBundle(json)` 先 `parseBundle`（坏包抛 `StorageImportError`，不动任何数据），再自动导出当前数据（放在快照的 `lastBackup`），有进行中的会话先停播，然后 `importAll`，重置档案、会话与掌握度副本并重新加载档案。以上三个操作与其余入口走同一条串行队列。

- 持有 `SessionState` 与掌握度内存副本；`dispatch(event)` 调 `reduce`，按顺序执行副作用（播放、落盘、结束回调），然后通知订阅者。所有会改状态的操作经同一条队列串行执行。
- **快照**：`getSnapshot()` 里 `storageError` 是独立字段，专供「只读警告」展示，与 `lastError` 分开。
- **续起**：中断后界面用 `dispatch({type:'start'})` 恢复，不再调 `startToday`。
- **播放**：`audio.play(plan)`，在内容播完时派发 `contentPlayed`（按 `plan.totalDurSec` 与 `AudioContext` 时钟计时）。
- **落盘失败**：重试一次；仍失败则把运行时切到「只读警告」状态，界面提示「进度暂时无法保存，可导出备份」，练习不中断。
- **出题抛错**：理论上已被集成守卫排除；若发生，跳过该计划题并记一条错误日志，不写作答，不让整场会话崩掉。

P-3a 用假音频（记录调用、可手动推进时间）与内存存储测试整套壳层；真正的 `AudioContext`、Wake Lock、页面可见性事件在 P-3b 接入。

---

## 6. 手机界面（P-3b，`src/ui/`）

### 6.1 页面

| 页面 | 内容 |
|---|---|
| 首次使用 | 如实说明周期（约 6–9 个月，主 spec §8.5）；建议戴耳机；约 5 分钟分级测试（主 spec §7.7，`placement.ts` 的探针，每个探针出一道 recognize 题，`contextLevel` 0、`variationLevel` 0、`difficultyStep` 0）；分级结果写入 Profile 的 `phaseId`；音域测定占位（P-4） |
| 首页 | 开始或继续今天的主线会话；练完后显示「再练一场」；顶部显示当前阶段 |
| 练习页 | 上方：题干、重听；**答题控件全部在屏幕下 1/3**（主 spec §11）；控件按作答格式切换（6.2） |
| 今日总结 | 正确率、各轨道题数、关卡还差哪些（阻塞的 key 数）、实战关是否达标、是否升阶段 |
| 设置 | 显示皮肤（唱名 / 数字 / 级数）、导出、导入 |

### 6.2 作答控件

| 格式 | 控件 |
|---|---|
| `choice` | 一排按钮，按文案表显示 |
| `sequence` | 字母表键盘 + 作答槽，可删改，填满后提交 |
| `pitch` | 先播目标（重听可用），再点「唱对了 / 没唱对」（自评，主 spec §12） |
| `tap` | 一块大触控区；有 `patternIds` 时先显示音型 |

### 6.3 反馈（主 spec §6.4）

- 答对：简短确认，不打断节奏，进入下一题。
- 答错：自动播放 `feedback.replay`；T 轨在音阶条上同时标出「你选的」和「正确的」；「慢速再听」播放 `feedback.slow`；会话结束页提供「重练刚才错的这组」（3.8）。

### 6.4 显示文案表（P-2b §14）

`src/ui/labels.ts`：一张表覆盖所有可能出现的答案 id——音级（按显示皮肤）、和弦品质、功能和弦（大调与小调）、转位、低音线 id、进行（按 `-` 拆成和弦 id 再渲染，不查表）、音型词汇表、弱起 id、拍号与混合拍子组合 id、beat 1 序号、转调去向。覆盖测试：对 P-2b 生成器可能产出的全部 id 断言有文案。

**作答前不显示知识点名称或标签**（P-2b §14）。

**§15.1 语境拼写**：显示层按调式决定拼法——小调中的 `le` 显示为 `si`（和声小调导音）。

### 6.5 打拍计时（主 spec §11、P-2b §8）

- 全部用 `audioContext.currentTime`，绝不用 `Date.now()`。
- 零点 = `contentStartSec` 的**实际播放时刻**（播放起点 + `contentStartSec`），并减去 `audioContext.outputLatency`（不可用时取 `baseLatency`）。
- 作答窗口 = `format.windowSec` + 宽限 `TAP_WINDOW_GRACE_SEC = 0.3`。窗口结束后自动提交。

### 6.6 移动端整合

- 第一次点击时创建或恢复 `AudioContext`（iOS 要求用户手势）。
- 练习中申请 Wake Lock，页面隐藏时释放、恢复时重新申请。
- 监听 `visibilitychange` 与 `AudioContext` 的 `statechange`：页面隐藏或音频被挂起 → 派发 `interrupted`。
- **FWD-5**：音频层在目标音起音前淡出仍在发声的语境声部（`AudioEngine` 增加「在某时刻淡出其余声部」的能力，不动 music 层的 `GAP_SEC`）。

### 6.7 只有用户能做的验收（P-3b 合入前）

1. 手机戴耳机实听 P-1 遗留的 10 项（主 spec §16.3），含「人声」与「弦乐」两种音色能否分辨。分不出则改 `oscType`。
2. 真机完整练一场 25 分钟会话。
3. 练到中途杀掉页面再打开，能从中断处接着练。
4. 导出一份备份，再导入，进度不变。

---

## 7. 错误处理

| 情况 | 处理 |
|---|---|
| IndexedDB 不可用（`StorageUnavailableError`） | 自动降级为内存存储，顶部常驻警告 |
| 数据损坏 | 先让用户下载损坏副本，确认后重建；不静默清空 |
| 落盘失败 | 重试一次；仍失败进入「只读警告」状态，练习不中断，提示导出 |
| `AudioContext` 创建失败 | 明确提示浏览器不支持 |
| 出题抛错 | 跳过该题、记错误日志、不写作答 |
| 中断 | 当前题作废重出，不计错 |
| 导入失败 | 不改现有数据，提示原因 |

---

### 已知局限（P-3a）

本地日期在会话进行中跨天时，该会话沿用开场时的 `day`。前一天遗留的未完成会话**永不收尾**：不跑停滞护栏、不评估关卡；新的一天一律开新会话。

---

## 8. 测试

**P-3a**

- 状态机单测：阶梯续起并写入档位、回血、热身不计分、计分题的掌握度更新链、实战关计数与替身判定、中断作废与重出、结束流程（跨天护栏、关卡、升阶段、总结）、`endEarly` 不升阶段、加练、重练小会话不落盘。
- **与仿真对齐**：`runSimulation` 改为调用 `session` 的同一套逐题函数；仿真全部断言保持通过（这是对搬迁正确性的守卫）。
- 存储契约测试：内存实现与 IndexedDB 实现（`fake-indexeddb`）跑同一套——读写往返、迁移、损坏检测、50,000 条归档、导出导入往返、导入失败不改数据。
- 壳层端到端：内存存储 + 假音频，从开场跑完一整场会话，再从中途记录续起跑完。
- FWD-1：连续播放后 `active` 不增长。

**P-3b**

- 文案表覆盖测试。
- 四种作答控件、反馈面板、打拍计时换算的组件测试（jsdom）。
- 6.7 的真机验收清单。

---

## 9. 两份计划

| 计划 | 内容 | 合入条件 |
|---|---|---|
| P-3a | §3、§4、§5、FWD-1；仿真改为复用会话逐题函数 | vitest 全绿、tsc 无输出、vite build 成功；`session`、`storage`（IndexedDB 实现除外）零 IO |
| P-3b | §6 全部、FWD-5、§15.1 语境拼写 | 同上，加上 6.7 的真机验收由用户完成 |

---

## 10. 写回主 spec

P-3a 合入时：§16.2 FWD-1 关闭；§10.1 实体按本 spec §4.1 更新（`Attempt` 改存实时规格）。

P-3b 合入时：§16.2 FWD-5 关闭；§15.1 标记已解决；§16.3 记录实听结果。
