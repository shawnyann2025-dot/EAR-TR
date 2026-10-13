# P-4 视唱闭环 · 设计文档

> 主 spec：`docs/superpowers/specs/2026-08-24-ear-training-design.md` §9、§12。P-3 spec：`docs/superpowers/specs/2026-10-13-p3-session-storage-ui-design.md`。P-2b spec §14 的 P-4 约束。
> 基于分支 `p3b-mobile-ui`（P-3b 尚待真机验收）。

## 1. 目标

唱模态从自评升级为真判定：麦克风收音 → YIN 基频 → 稳定段 → 与目标音逐个比对（含八度折叠）。同时做音域测定，让唱题落在学习者音域内。权限被拒或浏览器不支持时回落到 P-3b 的自评。

## 2. 已确认的决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **先唱后听，自动收音**：语境播完即开始收音；唱满目标音个数或超时自动结束，也可点「唱完了」；判定后反馈里再播目标音 | 练 audiation（先在脑中想出音再唱），不是模仿跟唱 |
| D2 | **多目标音按顺序逐个比对，全对才算对**；反馈逐音标对错；掌握度只记对/错 | 与听写题判定一致；不让「唱对一半」推高门控 |
| D3 | **默认检测，设置里可切自评**；权限被拒 / 不支持时自动回落自评并提示一次 | 不方便出声的场景有正当出口；关卡要求三模态齐平（主 spec §8.3），不能把人卡死 |
| D4 | **整题按八度搬进音域**：生成器不动，唱题生成后整体移若干八度，使目标音落在音域中部；无麦克风时选声部预设 | 不改 `generate` 签名与仿真；只移八度不改调、不改内容 |
| D5 | **一份 spec，两份计划**：P-4a 纯算法（Node 可测透），P-4b 脏边界与界面（另加真机验收） | 与 P-3 一致；P-4a 可独立合入 |

## 3. 纯算法（P-4a，`src/pitch/`）

`src/pitch/` 零 IO：不得出现 `window.`、`document.`、`navigator.`、`AudioContext`、`Date.now`、`Math.random`。

### 3.1 YIN（`yin.ts`）

- 参数：采样率 48 000 Hz、帧长 2048、hop 512（主 spec §9.1）。
- `yinFrame(samples: Float32Array, sampleRate: number): PitchFrame`，`PitchFrame = { f0Hz: number | null; aperiodicity: number; rms: number }`。
- 标准 YIN：差分函数 → 累积均值归一化差分 d′ → 第一个低于阈值 `YIN_THRESHOLD = 0.15` 的局部极小 → 抛物线插值。找不到则取全局极小并标为无声（`f0Hz: null`）。
- 搜索范围 `F0_MIN_HZ = 60`、`F0_MAX_HZ = 1100`（覆盖男低到女高及其泛音误判余量）。

### 3.2 有声判定与稳定段（`segments.ts`）

- 有声帧：`f0Hz !== null`、`aperiodicity ≤ 0.15`、`rms ≥ VOICED_RMS_FACTOR × noiseRms`（`VOICED_RMS_FACTOR = 2`；`noiseRms` 来自 3 秒噪声基线，未知时取 0）。
- 段（连续有声帧组成的「运行」，收尾时再取稳定核）：
  - 八度折叠与参考音高：帧与参考相差整数个八度（k≠0）且偏差 ≤ `OCTAVE_FOLD_TOLERANCE_CENTS = 35` 时视为同一音高类（真实 YIN 八度误判落在 2× 附近几音分内；须 < 50，以免吞掉 do→ti 的 1125 音分）。参考音高的求法（切段判定与收尾共用）：先把运行内所有帧折到第一帧所在八度，取折叠后中位数，再把它移到含原始帧最多的八度；帧数恰好持平时取较低八度。故起音处少量 2f0 帧、或 50% 闪跳都不会改变八度。
  - 切段：折叠后偏离参考音高 > `SEGMENT_JUMP_CENTS = 80` 的帧先进入待定列表；待定帧持续 ≥ `SPLIT_PERSIST_SEC = 0.09` 才收尾当前运行（不含待定帧）并以待定帧开新运行；其间若来一帧不偏离的帧，待定帧并回运行（颤音峰或孤立误判）。无声持续 ≥ `GAP_SEC = 0.06` 也收尾（待定帧先并入）。
  - 平滑：收尾时把折叠后的帧换成相对中位数的音分，做窗长 `SMOOTH_SEC = 0.18`（约一个颤音周期）的居中滑动平均（在运行边缘对称收缩窗口，使线性滑音的斜率不被压平），使宽颤音不丢音。
  - 稳定核：平滑值中最长的连续窗口，要求极差 ≤ 2 × `SEGMENT_JITTER_CENTS`（30）且最小二乘斜率 ≤ `MAX_DRIFT_CENTS_PER_SEC = 120`（整段及前、后两半分别检查，避免被跳变污染的边缘帧拉低滑音斜率）；这样滑入、下垂、收尾下滑被修剪，慢滑音不成段。核长 × hop ≥ `MIN_SEGMENT_SEC = 0.15` 才输出，`startSec`/`endSec` 取核首帧/末帧 + hop，`medianHz` 取核内折叠后原始 Hz 的中位数。
- 增量式：`createSegmenter(opts)` 返回 `{ push(frame: PitchFrame, atSec: number): Segment | null; flush(): Segment | null; segments(): Segment[] }`，`Segment = { startSec; endSec; medianHz }`。`push`/`flush` 在一段收尾且合格时返回该段，否则 null；`segments()` 返回迄今全部合格段。

**已知局限：**
- 极宽且较慢的颤音（如 ±100 音分、4.5 Hz，周期 0.22 s 长于 `SMOOTH_SEC`）平滑后极差仍超限，该音不成段；±60 音分 4.5 Hz 与 ±100 音分 5.5 Hz 以上均正常。
- 连唱的半音若唱得比 `SEGMENT_JUMP_CENTS = 80` 更窄（如 75 音分），两音会合并成一段（来自规格常量，非实现缺陷）。

### 3.3 判定（`judge.ts`）

- `centsBetween(hz, targetHz) = 1200 × log2(hz / targetHz)`。
- 八度折叠（主 spec §9.3、P-2b §14）：`foldCents(c) = ((c + 600) mod 1200) − 600`（结果在 [−600, 600)）。
- `judgeSung(targets: PitchTarget[], sungHz: number[]): { correct: boolean; perTarget: boolean[]; centsOff: (number | null)[] }`：按顺序一一对应；第 i 个目标对应第 i 个稳定段；缺的记错（`centsOff` 为 null）；多唱的段忽略；每个 `|foldCents| ≤ target.centsTolerance`（50）才对；全对才 `correct`。

### 3.4 作答契约（`src/exercises/`）

- `Response` 的 `pitch` 增加检测分支：`{ kind: 'pitch'; sungHz: number[] }`；自评分支 `{ kind: 'pitch'; selfAssessedCorrect: boolean }` 保留。
- `GradeResult.detail` 的 `pitch` 改为 `{ kind: 'pitch'; perTarget?: boolean[]; centsOff?: (number | null)[] }`（自评时两字段缺省）。
- `grade` 遇到检测分支调用 `judgeSung`。依赖方向：`exercises` → `pitch`（纯）。

### 3.5 搬入音域（`range.ts`）

- `VocalRange = { lowMidi: number; highMidi: number }`。
- `fitToRange(exercise: Exercise, range: VocalRange | null): Exercise`：仅对 `format.kind === 'pitch'` 的题生效；取目标音 MIDI 的中点，找使其最接近音域中点的整八度移位 k（`12k` 半音）；`plan`、`feedback.replay`、`feedback.slow` 的所有事件频率乘 `2^k`，`format.targets` 与 `answer.targets` 的 `midi += 12k`、`freqHz ×= 2^k`；`range === null` 或 k = 0 时原样返回。纯函数，不修改输入。
- 目标跨度大于音域时照样按中点居中，余下交给八度折叠。
- 声部预设 `VOICE_PRESETS`：男低 41–62、男高 48–69、女低 53–74、女高 60–81（MIDI）。

### 3.6 音域测定（`rangeTest.ts`）

- `pickHeldNote(segments: Segment[]): number | null`：取最长稳定段的中位数，转 MIDI（取整到最近半音）。
- `validateRange(low, high): { ok: true; range } | { ok: false; reason }`：`high − low ≥ 7` 才通过（`MIN_RANGE_SEMITONES = 7`），否则提示重测。

## 4. 脏边界与界面（P-4b）

### 4.1 收音（`src/audio/`）

- `pitchWorklet.ts`（AudioWorkletProcessor）：只缓冲样本、每 hop 512 切出最近 2048 样本帧，经 `port` 把帧（与帧时刻）转发出去；**不在音频线程里跑 YIN**。YIN 在专用 Worker（或主线程）里对每帧调用 `yinFrame`，结果 `{ f0Hz, aperiodicity, rms, atSec }` 交给分段器。（P-4a 评审裁定：单帧 YIN 桌面约 1.3 ms，手机预计 4–6 ms，超过 128 样本渲染块的 2.67 ms 预算。）处理核心抽成纯函数 `frameSlicer` 单测。
- `AudioContext` 以 `sampleRate: 48000` 创建（96 kHz 设备上 `tauMax` 会被帧长截断，最低可测音升到约 94 Hz）。
- `MicCapture`：`getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })` → `MediaStreamSource` → worklet；`calibrate(3)` 收 3 秒算 `noiseRms`；`start(onFrame)` / `stop()`；失败分类为 `'denied' | 'unsupported' | 'error'`。
- 只在作答阶段收音；目标音只在反馈阶段播放——播放时不收音（主 spec §9 的「目标音播放期间暂停采集」）。

### 4.2 运行时与会话

- 状态机不变：检测结果仍以 `answer` 事件的 `Response` 进入。
- 壳层出题后对唱题应用 `fitToRange`：P-4b 在 `session/machine.ts` 的出题处接入一个可选的 `ReduceContext.transformExercise?: (ex) => Exercise`，壳层传入 `ex => fitToRange(ex, profile.vocalRange)`。作答记录里存的仍是规格（`spec`），复现时由同一音域重新搬移。

### 4.3 界面

- 唱题控件（检测模式）：进入 answering 自动开始收音，显示「正在听…」与已识别的音个数；唱满目标数或超时（`3 + 1.5 × 目标数` 秒）自动提交；「唱完了」提前提交；麦克风出错时本题改为自评控件。
- 反馈：逐音标对错（音阶条或音级列表上 ✓ / ✗），播放目标音；没有稳定段时提示「没听到你唱」。
- 首次使用：分级之后加音域测定（唱最低舒适音、最高舒适音；无麦克风或不愿出声时选声部预设）；可在设置里重测。
- 设置：「判定方式：音高检测 / 自评」；音域显示与「重新测定」。
- `Profile` 增加可选字段 `vocalRange: VocalRange | null`、`singMode: 'detect' | 'self'`（缺省 `'detect'`）、`micFallbackReason?: 'denied' | 'unsupported'`。可选字段不改 `SCHEMA_VERSION`；导出包校验把它们当可选字段。

### 4.4 回落

| 情况 | 处理 |
|---|---|
| 权限被拒 | `singMode` 视为自评，提示一次「没有麦克风权限，唱题改为自评」，记录原因 |
| AudioWorklet 不支持 | 同上，原因 `unsupported` |
| 题中收音出错 | 本题改自评，下一题重试检测 |
| 没唱 / 没有稳定段 | 判错，反馈「没听到你唱」并播目标音 |

## 5. 测试

**P-4a**

- YIN：合成正弦与富泛音音（80–1000 Hz）误差 ≤ ±5 音分；白噪声、静音判无声；缺基频音不报错八度。
- 稳定段：持续音、滑音、30 音分内颤音、间隙分段、短于 150 ms 不成段。
- 判定：±50 音分边界；上下一两个八度都判对；偏 49 / 51 音分；段数不足、多余、顺序。
- 搬入音域：只按整八度、整题一起移、无音域不移、不修改输入。
- 音域测定：取最长段、跨度过小重测。
- `grade` 检测分支与自评分支并存；导出包含新 detail 时仍能导入。

**P-4b**

- worklet 帧切分纯函数；`MicCapture` 用假 MediaStream 与假 worklet port 测权限拒绝、噪声基线、停止。
- 组件（jsdom）：自动开始与结束、「唱完了」、逐音反馈、音域测定页、判定方式设置、回落提示。

**真机验收（P-4b 合入前，只有用户能做）**

1. 唱 do、mi、sol：同八度与差一个八度都判对。
2. 故意唱偏半音：判错。
3. 男声、女声各测一次（条件允许）。
4. 做音域测定后，唱题的目标音高听起来舒适。
5. 拒绝麦克风权限：回落自评并有提示。

## 6. 两份计划

| 计划 | 内容 | 合入条件 |
|---|---|---|
| P-4a | §3 全部；`grade` 检测分支 | vitest 全绿、tsc 无输出、vite build 成功；`src/pitch/` 零 IO |
| P-4b | §4 全部 | 同上，加 §5 真机验收；P-4b 建在 P-3b 之上，随 P-3b 一起或在其后合入 |

## 7. 写回主 spec

- §9：补稳定段参数、逐音判定（D2）、先唱后听（D1）、搬入音域（D4）。
- §10.1：Profile 的 `vocalRange`、`singMode`。
- §12：题中收音出错的单题回落。
