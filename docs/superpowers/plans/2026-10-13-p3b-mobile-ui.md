# P-3b 手机界面与移动端整合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在手机浏览器里真练一天：首次使用与分级测试、首页、练习页（四种作答控件与反馈）、今日总结、设置（皮肤、导出导入），接上 P-3a 的运行时；修 FWD-5，落实 §15.1 语境拼写。

**Architecture:** `src/ui/` 是 React 组件层，只通过 `Runtime`（P-3a）读写会话与存储。纯逻辑（文案表、打拍换算、分级探针规格）放独立的 `.ts` 文件单测；组件用 jsdom + Testing Library 测。`src/ui/platform.ts` 是唯一的组装点：打开存储（失败降级到内存）、懒创建音频（首次用户手势时）、浏览器计时器，产出 `Runtime`。音频层补「语境尾音截断」（FWD-5）、输出延迟与状态监听。

**Tech Stack:** React 19、TypeScript、vitest + jsdom；新增开发依赖 `@testing-library/react@16`、`@testing-library/dom@10`。

**Spec:** `docs/superpowers/specs/2026-10-13-p3-session-storage-ui-design.md`（P-3 spec）§6、§7、§8 P-3b、§9 第二行；`docs/superpowers/specs/2026-10-13-p2b-exercise-generators-design.md` §14（界面约束）；主 spec `docs/superpowers/specs/2026-08-24-ear-training-design.md` §6.4、§7.7、§8.5、§11、§12、§15.1、§16.2 FWD-5、§16.3。

## Global Constraints

- 打拍计时全部用 `AudioContext.currentTime`，绝不用 `Date.now()`（主 spec §11）。打拍零点 = 播放起点 + `contentStartSec` + 输出延迟（`outputLatency`，不可用时取 `baseLatency`，都不可用取 0）；作答窗口 = `format.windowSec` + `TAP_WINDOW_GRACE_SEC = 0.3`，窗口结束自动提交。
- **作答前不显示知识点名称或标签**（P-2b §14）。题干只用 `PROMPT_TEXT` 的中性文案。唱模态显示要唱的音级，`sing-new-tonic` 例外（新主音靠耳朵找，显示即泄题）。
- 进行类选项按 `-` 拆成和弦 id 再渲染，不按整串查表（P-2b §14）。
- §15.1：小调（`mode === 'minor'`）里的 `le` 显示为 `si`（数字 `♯5`、级数 `♯^5`）。
- 答题控件全部在屏幕下 1/3（主 spec §11）：练习页的作答区容器 `.answer-zone` 固定在视口底部、高度 `33vh`。
- `AudioContext` 只在用户手势里创建或恢复（iOS）。
- 依赖方向：`ui` → `runtime`、`session`/`exercises`/`storage` 的类型与纯函数、`music`、`curriculum`、`scheduling` 的纯函数。只有 `src/ui/platform.ts` 可以 import `audio/AudioEngine` 与 `storage/indexeddb`、`storage/memory` 的实现（`DevHarness.tsx` 沿用既有例外）。
- P-3a 的约束保持：`src/session/`、`src/storage/`（`indexeddb.ts` 除外）零 IO。
- 测试命令：`npx vitest run <path>`；全量 `npx vitest run`；类型 `npx tsc --noEmit`；构建 `npx vite build`。组件测试文件以 `.test.tsx` 结尾，首行写 `// @vitest-environment jsdom`。
- 每个任务结束提交一次，提交信息以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾；不要提交 `.superpowers/` 下的任何文件，不要 `git add -f`。

## File Structure

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/music/playback.ts`（改） | 新增 `PlayOptions` | 1 |
| `src/audio/voices.ts`、`AudioEngine.ts`（改） | FWD-5 截尾、输出延迟、状态监听 | 1 |
| `src/session/types.ts`、`machine.ts`（改） | `play` 副作用带 `contentStartSec` | 1 |
| `src/runtime/runtime.ts`（改） | `AudioPort.play(plan, opts)`、快照 `playback` | 1 |
| `src/ui/labels.ts` | 题干文案、答案文案、§15.1 | 2 |
| `src/ui/tapTiming.ts` | 打拍换算（纯函数） | 3 |
| `src/ui/controls/*.tsx` | 四种作答控件 + `AnswerArea` | 4 |
| `src/ui/FeedbackPanel.tsx` | 反馈面板与音阶条 | 5 |
| `src/storage/indexeddb.ts`（改） | `deleteIndexedDb` | 6 |
| `src/ui/platform.ts`、`RuntimeContext.tsx` | 组装、懒音频、React 绑定 | 6 |
| `src/ui/pages/{Home,Practice,Summary,Settings,StorageProblem}.tsx`、`Shell.tsx`、`App.tsx`、`download.ts` | 页面与路由 | 7 |
| `src/ui/placementProbe.ts`、`pages/Onboarding.tsx` | 首次使用与分级测试 | 8 |
| `src/ui/mobile.ts`、`styles.css`、`main.tsx`、`index.html` | Wake Lock、中断监听、样式、入口 | 9 |
| 文档 | 写回、真机验收清单 | 10 |

---

### Task 1: 音频层——FWD-5 截尾、输出延迟、状态监听；播放信息穿过运行时

**Files:**
- Modify: `src/music/playback.ts`、`src/audio/voices.ts`、`src/audio/AudioEngine.ts`、`src/session/types.ts`、`src/session/machine.ts`、`src/runtime/runtime.ts`
- Test: `src/audio/trimContextTails.test.ts`（新建）、`src/audio/AudioEngine.test.ts`（末尾追加）、`src/session/machine.test.ts`（追加一条）、`src/runtime/runtime.test.ts`（追加一条）

**Interfaces:**
- Produces:
  - `src/music/playback.ts`：`export interface PlayOptions { cutContextAtSec?: number }`（相对计划起点的秒数：此前本该结束的声部，释音尾巴截到这里）
  - `src/audio/voices.ts`：`export const MIN_TAIL_SEC = 0.02`；`export function trimContextTails(voices: readonly Voice[], cutAbsSec: number): Voice[]`
  - `AudioEngine.play(plan, delaySec = 0.12, opts: PlayOptions = {})`；`get state(): AudioContextState`；`get outputLatencySec(): number`；`onStateChange(fn: (state: AudioContextState) => void): () => void`
  - `SessionEffect` 的 `play` 变为 `{ type: 'play'; plan: PlaybackPlan; contentStartSec: number }`
  - `AudioPort.play(plan: PlaybackPlan, opts?: PlayOptions): { startSec: number; endSec: number }`
  - `RuntimeSnapshot.playback: { startSec: number; contentStartSec: number } | null`（`play` 时设置，`stopAudio` 时清空，初值与导入重置都为 `null`）

- [ ] **Step 1: 写失败的测试**

`src/audio/trimContextTails.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import type { PlaybackPlan } from '../music/playback'
import { MIN_TAIL_SEC, planToVoices, trimContextTails } from './voices'
import { TIMBRES } from './timbres'

const ev = (atSec: number, durSec: number) => ({ atSec, durSec, freqHz: 440, timbreId: 'strings' as const, gain: 0.5 })
const plan: PlaybackPlan = {
  events: [ev(0, 1.65), ev(0, 4), ev(2.0, 0.5)], // 终止式末和弦、持续低音、目标音
  totalDurSec: 4,
}

describe('trimContextTails（FWD-5）', () => {
  it('cut 之前本该结束的声部：释音截到 cut；持续低音与目标音不动', () => {
    const start = 10
    const voices = planToVoices(plan, start)
    const out = trimContextTails(voices, start + 2.0)
    expect(voices[0].stopSec).toBeCloseTo(start + 1.65 + TIMBRES.strings.env.releaseSec)
    expect(out[0].stopSec).toBeCloseTo(start + 2.0)
    expect(out[1]).toEqual(voices[1])
    expect(out[2]).toEqual(voices[2])
  })

  it('事件恰在 cut 处结束：至少保留 MIN_TAIL_SEC 的尾巴，避免爆音', () => {
    const voices = planToVoices({ events: [ev(0, 2)], totalDurSec: 2 }, 0)
    expect(trimContextTails(voices, 2)[0].stopSec).toBeCloseTo(2 + MIN_TAIL_SEC)
  })

  it('不修改输入', () => {
    const voices = planToVoices(plan, 0)
    const before = voices.map((v) => v.stopSec)
    trimContextTails(voices, 2)
    expect(voices.map((v) => v.stopSec)).toEqual(before)
  })
})
```

在 `src/audio/AudioEngine.test.ts` 末尾追加（文件内已有 `makeFakeContext`、`AudioEngine`、`notesToPlan`）：

```ts
describe('P-3b：截尾、延迟、状态', () => {
  it('play 带 cutContextAtSec 时，语境振荡器的 stop 时刻被截到 cut', () => {
    const { ctx, created } = makeFakeContext()
    const engine = new AudioEngine(ctx as unknown as AudioContext)
    const p = notesToPlan([{ midi: 60, atSec: 0, durSec: 1.65 }], 'strings')
    const { startSec, endSec } = engine.play(p, 0.1, { cutContextAtSec: 2.0 })
    const stopArg = created.oscillators[0].stop.mock.calls[0][0] as number
    expect(stopArg).toBeCloseTo(startSec + 2.0)
    expect(endSec).toBeCloseTo(startSec + 2.0)
  })

  it('outputLatencySec：优先 outputLatency，其次 baseLatency，都没有为 0', () => {
    const mk = (extra: object) => new AudioEngine({ currentTime: 0, state: 'running', ...extra } as unknown as AudioContext)
    expect(mk({ outputLatency: 0.03, baseLatency: 0.01 }).outputLatencySec).toBe(0.03)
    expect(mk({ outputLatency: 0, baseLatency: 0.01 }).outputLatencySec).toBe(0.01)
    expect(mk({}).outputLatencySec).toBe(0)
  })

  it('onStateChange 订阅 statechange，返回的函数解除订阅', () => {
    const listeners = new Set<() => void>()
    const ctx = {
      currentTime: 0,
      state: 'running',
      addEventListener: (_: string, h: () => void) => listeners.add(h),
      removeEventListener: (_: string, h: () => void) => listeners.delete(h),
    }
    const engine = new AudioEngine(ctx as unknown as AudioContext)
    const seen: string[] = []
    const off = engine.onStateChange((s) => seen.push(s))
    ctx.state = 'suspended'
    for (const h of listeners) h()
    expect(seen).toEqual(['suspended'])
    off()
    expect(listeners.size).toBe(0)
  })
})
```

在 `src/session/machine.test.ts` 的 `describe('出题'` 块里追加：

```ts
  it('play 副作用带上题目内容起点', () => {
    const r = reduce(freshSession(), { type: 'start' }, ctx())
    const play = r.effects[0]
    if (play.type !== 'play') throw new Error('应先 play')
    expect(play.contentStartSec).toBe(r.state.current!.exercise.contentStartSec)
  })
```

在 `src/runtime/runtime.test.ts` 末尾追加（沿用文件里的 `deps`、`MemoryRepository`、`createRuntime`、打拍用的 flush 约定；`fakes()` 里 `audio.play` 返回的 `startSec` 若不是 0，把期望改成 fake 实际返回的值）：

```ts
describe('播放信息', () => {
  it('play 时把 cutContextAtSec 交给音频，并在快照里给出 playback；中断后清空', async () => {
    const d = deps(new MemoryRepository())
    const optsSeen: unknown[] = []
    const play = d.audio.play
    d.audio.play = (plan, opts) => {
      optsSeen.push(opts)
      return play(plan, opts)
    }
    const rt = createRuntime(d)
    await rt.startToday()
    const s = rt.getSnapshot()
    const csec = s.session!.current!.exercise.contentStartSec
    expect(optsSeen.at(-1)).toEqual({ cutContextAtSec: csec })
    expect(s.playback).toEqual({ startSec: 0, contentStartSec: csec })
    await rt.dispatch({ type: 'interrupted' })
    expect(rt.getSnapshot().playback).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/audio src/session/machine.test.ts src/runtime`
Expected: FAIL —— `trimContextTails` 不存在、`play` 不接受第三参数、`contentStartSec` / `playback` 未定义

- [ ] **Step 3: 写实现**

`src/music/playback.ts` 末尾追加：

```ts
/** 播放选项（音频层解释，music 层只声明） */
export interface PlayOptions {
  /** 相对计划起点的秒数：此前本该结束的声部，释音尾巴截到这里（FWD-5） */
  cutContextAtSec?: number
}
```

`src/audio/voices.ts` 末尾追加：

```ts
/** 截尾后至少保留的释音（秒），避免爆音 */
export const MIN_TAIL_SEC = 0.02

/**
 * FWD-5：在 cutAbsSec 之前本该结束的声部（语境），把释音尾巴截到 cutAbsSec，
 * 免得溢入题目内容。跨过 cutAbsSec 仍在发声的声部（L2/L4 的持续低音）与题目内容不动。
 * 纯函数，不修改输入。
 */
export function trimContextTails(voices: readonly Voice[], cutAbsSec: number): Voice[] {
  return voices.map((v) => {
    const eventEnd = v.stopSec - v.timbre.env.releaseSec
    if (eventEnd > cutAbsSec + 1e-9 || v.stopSec <= cutAbsSec) return v
    return { ...v, stopSec: Math.min(v.stopSec, Math.max(cutAbsSec, eventEnd + MIN_TAIL_SEC)) }
  })
}
```

`src/audio/AudioEngine.ts`：import 改为

```ts
import type { PlaybackPlan, PlayOptions } from '../music/playback'
import { planToVoices, trimContextTails, type Voice } from './voices'
```

（`planEndSec` 不再使用则删掉其 import。）`play` 替换为下面这段，并在类里加三个成员：

```ts
  play(
    plan: PlaybackPlan,
    delaySec: number = DEFAULT_DELAY_SEC,
    opts: PlayOptions = {},
  ): { startSec: number; endSec: number } {
    const startSec = this.ctx.currentTime + delaySec
    let voices = planToVoices(plan, startSec)
    if (opts.cutContextAtSec !== undefined) {
      voices = trimContextTails(voices, startSec + opts.cutContextAtSec)
    }
    for (const voice of voices) this.spawn(voice)
    return { startSec, endSec: voices.reduce((max, v) => Math.max(max, v.stopSec), startSec) }
  }

  get state(): AudioContextState {
    return this.ctx.state
  }

  /** 输出延迟（秒）：outputLatency → baseLatency → 0（P-3 spec §6.5） */
  get outputLatencySec(): number {
    const o = (this.ctx as { outputLatency?: number }).outputLatency
    if (typeof o === 'number' && Number.isFinite(o) && o > 0) return o
    const b = (this.ctx as { baseLatency?: number }).baseLatency
    return typeof b === 'number' && Number.isFinite(b) && b > 0 ? b : 0
  }

  /** 监听 AudioContext 状态变化（被系统挂起即视为中断，P-3 spec §6.6） */
  onStateChange(fn: (state: AudioContextState) => void): () => void {
    const handler = () => fn(this.ctx.state)
    this.ctx.addEventListener('statechange', handler)
    return () => this.ctx.removeEventListener('statechange', handler)
  }
```

`src/session/types.ts`：`play` 副作用改为

```ts
  | { type: 'play'; plan: PlaybackPlan; contentStartSec: number }
```

`src/session/machine.ts` 的 `present` 里：

```ts
      effects: [...effects, { type: 'play', plan: current.exercise.plan, contentStartSec: current.exercise.contentStartSec }],
```

`src/runtime/runtime.ts`：
- `import type { PlaybackPlan, PlayOptions } from '../music/playback'`
- `AudioPort.play(plan: PlaybackPlan, opts?: PlayOptions): { startSec: number; endSec: number }`
- `RuntimeSnapshot` 增加 `/** 当前题的播放起点与内容起点（打拍零点用）；无播放时为 null */ playback: { startSec: number; contentStartSec: number } | null`；初始快照与 `importBundle` 的重置里都设为 `null`
- `run` 的 `play` 分支：

```ts
      case 'play': {
        cancelTimer?.()
        const { startSec, endSec } = audio.play(effect.plan, { cutContextAtSec: effect.contentStartSec })
        set({ playback: { startSec, contentStartSec: effect.contentStartSec } })
        cancelTimer = timer.after(Math.max(0, endSec - audio.currentTime), () => {
          cancelTimer = null
          dispatch({ type: 'contentPlayed' }).catch((e) => set({ lastError: describe(e) }))
        })
        return
      }
```

- `stopAudio` 分支在 `audio.stopAll()` 之后加 `set({ playback: null })`。

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS（仿真特征快照不受影响）；tsc 无输出

- [ ] **Step 5: 提交**

```bash
git add src/music/playback.ts src/audio/ src/session/types.ts src/session/machine.ts src/session/machine.test.ts src/runtime/
git commit -m "feat(audio): FWD-5 语境尾音截断、输出延迟与状态监听；播放信息穿过运行时" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 文案表——题干、答案、§15.1 语境拼写

**Files:**
- Create: `src/ui/labels.ts`
- Test: `src/ui/labels.test.ts`

**Interfaces:**
- Consumes: `PromptId`（exercises/generate）、`Mode`/`ScaleDegree`/`SCALE_DEGREES`（music/key）、`displayDegree`/`DisplayScheme`（music/display）
- Produces:
  - `export const PROMPT_TEXT: Record<PromptId, string>`
  - `export interface LabelContext { scheme: DisplayScheme; mode: Mode; prompt: PromptId }`
  - `export function degreeLabel(id: string, scheme: DisplayScheme, mode: Mode): string`（未知 id 抛错）
  - `export function chordLabel(id: string): string`、`export function patternLabel(id: string): string`
  - `export function labelFor(id: string, ctx: LabelContext): string`（未知 id 抛错，信息含 prompt 与 id）
  - `export function showsSingTargets(prompt: PromptId): boolean`（`sing-new-tonic` 为 false）

- [ ] **Step 1: 写失败的测试**

`src/ui/labels.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { MODALITIES } from '../curriculum/knowledgePoints'
import type { VariationLevel } from '../curriculum/stages'
import { ALL_KNOWLEDGE_POINTS } from '../curriculum/tracks'
import { generate } from '../exercises/generate'
import type { ContextLevel } from '../music/tonalContext'
import { PROMPT_TEXT, chordLabel, degreeLabel, labelFor, patternLabel, showsSingTargets } from './labels'

describe('degreeLabel 与 §15.1', () => {
  it('大调按皮肤显示', () => {
    expect(degreeLabel('mi', 'solfege', 'major')).toBe('mi')
    expect(degreeLabel('mi', 'numeric', 'major')).toBe('3')
    expect(degreeLabel('fi', 'degree', 'major')).toBe('♯^4')
  })
  it('小调里的 le 显示为 si（升 7 级）', () => {
    expect(degreeLabel('le', 'solfege', 'minor')).toBe('si')
    expect(degreeLabel('le', 'numeric', 'minor')).toBe('♯5')
    expect(degreeLabel('le', 'degree', 'minor')).toBe('♯^5')
    expect(degreeLabel('le', 'solfege', 'major')).toBe('le')
  })
  it('未知音级抛错', () => {
    expect(() => degreeLabel('xx', 'solfege', 'major')).toThrow()
  })
})

describe('和弦、进行、音型', () => {
  it('和弦 id 的 b 前缀渲染为 ♭', () => {
    expect(chordLabel('bVII')).toBe('♭VII')
    expect(chordLabel('V/V')).toBe('V/V')
    expect(() => chordLabel('IX')).toThrow()
  })
  it('进行按 - 拆开渲染，不查整串', () => {
    expect(labelFor('V-vi-IV-I', { scheme: 'solfege', mode: 'major', prompt: 'which-progression' })).toBe('V → vi → IV → I')
  })
  it('音型：小节线、连线、弱起', () => {
    expect(patternLabel('q-ee-q-q')).toBe('♩ ♫ ♩ ♩')
    expect(patternLabel('q-q-q-e|q-q-q-q')).toBe('♩ ♩ ♩ ♪ | ♩ ♩ ♩ ♩')
    expect(patternLabel('q-q-q-e~q-q-q')).toBe('♩ ♩ ♩ ♪‿♩ ♩ ♩')
    expect(patternLabel('half')).toBe('弱起半拍')
  })
  it('低音线按音级渲染', () => {
    expect(labelFor('do-ti-la-fa', { scheme: 'numeric', mode: 'major', prompt: 'which-bass-contour' })).toBe('1 – 7 – 6 – 4')
  })
})

describe('题干', () => {
  it('每个题型都有中性题干，且不含知识点 id', () => {
    for (const [prompt, text] of Object.entries(PROMPT_TEXT)) {
      expect(text.length, prompt).toBeGreaterThan(0)
      expect(text, prompt).not.toMatch(/degree:|chord:|prog:|rhythm:/)
    }
  })
  it('sing-new-tonic 不显示要唱的音级，其余唱模态显示', () => {
    expect(showsSingTargets('sing-new-tonic')).toBe(false)
    expect(showsSingTargets('sing-degrees')).toBe(true)
  })
})

describe('覆盖：生成器可能产出的全部答案 id 都有文案（P-3 spec §6.4）', () => {
  it('全部知识点 × 模态 × 语境 × 变异 × 档位 × 种子', () => {
    const c = buildCurriculum()
    let checked = 0
    for (const kp of ALL_KNOWLEDGE_POINTS)
      for (const modality of MODALITIES)
        for (let v = 0; v <= 6; v++)
          for (let cl = 0; cl <= 4; cl++)
            for (let step = 0; step <= 5; step++)
              for (let seed = 0; seed < 3; seed++) {
                let ex
                try {
                  ex = generate(
                    { kpId: kp.id, modality, track: kp.track, contextLevel: cl as ContextLevel, variationLevel: v as VariationLevel, difficultyStep: step, seed, segment: 'focus' },
                    c,
                  )
                } catch {
                  continue // 该组合不在课程范围内
                }
                const ctx = { scheme: 'solfege' as const, mode: ex.resolved.key.mode, prompt: ex.prompt }
                const f = ex.format
                const ids =
                  f.kind === 'choice' ? f.options.map((o) => o.id)
                  : f.kind === 'sequence' ? f.alphabet.map((o) => o.id)
                  : f.kind === 'tap' ? (f.patternIds ?? [])
                  : []
                for (const id of ids) {
                  for (const scheme of ['solfege', 'numeric', 'degree'] as const) {
                    expect(labelFor(id, { ...ctx, scheme }).length).toBeGreaterThan(0)
                  }
                  checked++
                }
                if (f.kind === 'pitch') for (const t of f.targets) expect(degreeLabel(t.degree, 'solfege', ctx.mode).length).toBeGreaterThan(0)
              }
    expect(checked).toBeGreaterThan(1000)
  }, 120_000)
})
```

（`ContextLevel` 的导出位置以仓库为准：若不在 `music/tonalContext`，改成实际位置。）

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/ui/labels.test.ts`
Expected: FAIL —— 无法解析模块 `./labels`

- [ ] **Step 3: 写实现**

`src/ui/labels.ts`：

```ts
import type { PromptId } from '../exercises/generate'
import { displayDegree, type DisplayScheme } from '../music/display'
import { SCALE_DEGREES, type Mode, type ScaleDegree } from '../music/key'

/**
 * 显示文案表（P-3 spec §6.4、P-2b §14）。
 * 作答前只显示题干，绝不显示知识点名称或标签。
 */
export const PROMPT_TEXT: Record<PromptId, string> = {
  'which-degree': '目标音是哪个音级？',
  'sing-degrees': '听完语境后，唱出下面的音级',
  'notate-melody': '依次写出你听到的音级',
  'did-it-modulate': '这段音乐转调了吗？',
  'sing-new-tonic': '唱出新调的主音',
  'new-tonic-degree': '新主音是原调的哪个音级？',
  'which-quality': '这个和弦是大三还是小三？',
  'which-chord': '这是哪个和弦？',
  'sing-arpeggio': '唱出下面的分解和弦',
  'notate-chords': '依次写出你听到的和弦',
  'notate-qualities': '依次写出每个和弦的大小',
  'which-progression': '这是哪条和弦进行？',
  'sing-bassline': '唱出下面的低音线',
  'notate-progression': '写出这条和弦进行',
  'which-inversion': '这个和弦是哪个转位？',
  'which-bass-contour': '低音线是哪一条？',
  'notate-bassline': '依次写出低音的音级',
  'notate-inversions': '依次写出每个和弦的转位',
  'which-pattern': '你听到的是哪个节奏型？',
  'tap-pattern': '跟着节拍器，打出下面的节奏',
  'notate-patterns': '依次写出你听到的节奏型',
  'which-meter': '这是几拍子？',
  'tap-downbeats': '边听边在每小节的第一拍点一下',
  'which-onset-is-beat-one': '第几个音是第一拍？',
  'which-pickup': '这段节奏有没有弱起？',
  'which-meter-sequence': '拍号是怎么变化的？',
  'notate-meters': '依次写出每段的拍号',
}

type LabelKind =
  | 'degree' | 'degreeLine' | 'modulation' | 'quality' | 'chord' | 'progression'
  | 'inversion' | 'onsetOrdinal' | 'meter' | 'meterSequence' | 'pickup' | 'pattern' | 'none'

const KIND: Record<PromptId, LabelKind> = {
  'which-degree': 'degree', 'sing-degrees': 'none', 'notate-melody': 'degree',
  'did-it-modulate': 'modulation', 'sing-new-tonic': 'none', 'new-tonic-degree': 'degree',
  'which-quality': 'quality', 'which-chord': 'chord', 'sing-arpeggio': 'none',
  'notate-chords': 'chord', 'notate-qualities': 'quality',
  'which-progression': 'progression', 'sing-bassline': 'none', 'notate-progression': 'chord',
  'which-inversion': 'inversion', 'which-bass-contour': 'degreeLine', 'notate-bassline': 'degree',
  'notate-inversions': 'inversion',
  'which-pattern': 'pattern', 'tap-pattern': 'pattern', 'notate-patterns': 'pattern',
  'which-meter': 'meter', 'tap-downbeats': 'none', 'which-onset-is-beat-one': 'onsetOrdinal',
  'which-pickup': 'pickup', 'which-meter-sequence': 'meterSequence', 'notate-meters': 'meter',
}

export interface LabelContext {
  scheme: DisplayScheme
  mode: Mode
  prompt: PromptId
}

const isDegree = (id: string): id is ScaleDegree => (SCALE_DEGREES as readonly string[]).includes(id)

/** §15.1：小调（la 基）里半音 8 是升 7 级，拼作 si */
const MINOR_LE: Record<DisplayScheme, string> = { solfege: 'si', numeric: '♯5', degree: '♯^5' }

export function degreeLabel(id: string, scheme: DisplayScheme, mode: Mode): string {
  if (!isDegree(id)) throw new Error(`未知音级 ${id}`)
  if (mode === 'minor' && id === 'le') return MINOR_LE[scheme]
  return displayDegree(id, scheme)
}

const CHORD_IDS = new Set([
  'I', 'ii', 'iii', 'IV', 'V', 'vi', 'Imaj7', 'ii7', 'V7', 'vi7', 'V/V', 'bVI', 'bVII',
  'i', 'iv', 'v', 'III', 'VI', 'VII',
])

export function chordLabel(id: string): string {
  if (!CHORD_IDS.has(id)) throw new Error(`未知和弦 ${id}`)
  return id.replace(/^b/, '♭')
}

const QUALITY: Record<string, string> = { maj: '大三和弦', min: '小三和弦' }
const INVERSION: Record<string, string> = { root: '原位', first: '第一转位', second: '第二转位' }
const MODULATION: Record<string, string> = { shift: '转调了', stay: '没转调' }
const PICKUP: Record<string, string> = { none: '无弱起', half: '弱起半拍', one: '弱起一拍' }
const METERS = new Set(['2/4', '3/4', '4/4', '6/8'])

/** 音型词汇表（P-2b §14） */
const PATTERN_TOKEN: Record<string, string> = {
  q: '♩', ee: '♫', e: '♪', dq: '♩.', h: '𝅗𝅥', r: '𝄽', s: '𝅘𝅥𝅯', ssss: '𝅘𝅥𝅯𝅘𝅥𝅯𝅘𝅥𝅯𝅘𝅥𝅯', trip: '³♪♪♪',
}

function table(t: Record<string, string>, id: string, what: string): string {
  const v = t[id]
  if (v === undefined) throw new Error(`未知${what} ${id}`)
  return v
}

export function patternLabel(id: string): string {
  if (id in PICKUP) return PICKUP[id]
  return id
    .split('|')
    .map((bar) =>
      bar
        .split('-')
        .map((tok) => tok.split('~').map((t) => table(PATTERN_TOKEN, t, '音型')).join('‿'))
        .join(' '),
    )
    .join(' | ')
}

function meterLabel(id: string): string {
  if (!METERS.has(id)) throw new Error(`未知拍号 ${id}`)
  return id
}

export function labelFor(id: string, ctx: LabelContext): string {
  try {
    switch (KIND[ctx.prompt]) {
      case 'degree':
        return degreeLabel(id, ctx.scheme, ctx.mode)
      case 'degreeLine':
        return id.split('-').map((d) => degreeLabel(d, ctx.scheme, ctx.mode)).join(' – ')
      case 'modulation':
        return table(MODULATION, id, '转调选项')
      case 'quality':
        return table(QUALITY, id, '和弦性质')
      case 'chord':
        return chordLabel(id)
      case 'progression':
        return id.split('-').map(chordLabel).join(' → ')
      case 'inversion':
        return table(INVERSION, id, '转位')
      case 'onsetOrdinal':
        if (!/^\d+$/.test(id)) throw new Error(`未知序号 ${id}`)
        return `第 ${id} 个音`
      case 'meter':
        return meterLabel(id)
      case 'meterSequence':
        return id.split('+').map(meterLabel).join(' → ')
      case 'pickup':
        return table(PICKUP, id, '弱起')
      case 'pattern':
        return patternLabel(id)
      case 'none':
        throw new Error('该题型没有可选答案')
    }
  } catch (e) {
    throw new Error(`文案表缺项（${ctx.prompt}）：${(e as Error).message}`)
  }
}

/** 唱模态是否显示要唱的音级。新主音靠耳朵找，显示即泄题 */
export function showsSingTargets(prompt: PromptId): boolean {
  return prompt !== 'sing-new-tonic'
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/ui/labels.test.ts && npx tsc --noEmit`
Expected: PASS。若覆盖测试报「文案表缺项」，把缺的 id 补进对应的表（`CHORD_IDS`、`PATTERN_TOKEN` 等），不要放宽测试。

- [ ] **Step 5: 提交**

```bash
git add src/ui/labels.ts src/ui/labels.test.ts
git commit -m "feat(ui): 显示文案表——题干、答案、§15.1 语境拼写与覆盖测试" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 打拍计时换算

**Files:**
- Create: `src/ui/tapTiming.ts`
- Test: `src/ui/tapTiming.test.ts`

**Interfaces:**
- Produces:
  - `export const TAP_WINDOW_GRACE_SEC = 0.3`
  - `export interface TapClock { playStartSec: number; contentStartSec: number; latencySec: number }`
  - `export function contentZeroCtxSec(c: TapClock): number`（= `playStartSec + contentStartSec + latencySec`）
  - `export function tapsRelativeToContent(tapCtxTimes: readonly number[], c: TapClock): number[]`
  - `export function tapWindowEndCtxSec(c: TapClock, windowSec: number): number`

- [ ] **Step 1: 写失败的测试**

`src/ui/tapTiming.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { TAP_WINDOW_GRACE_SEC, contentZeroCtxSec, tapWindowEndCtxSec, tapsRelativeToContent } from './tapTiming'

const clock = { playStartSec: 10, contentStartSec: 2, latencySec: 0.05 }

describe('打拍换算（P-3 spec §6.5）', () => {
  it('零点 = 播放起点 + 内容起点 + 输出延迟', () => {
    expect(contentZeroCtxSec(clock)).toBeCloseTo(12.05)
  })
  it('点击时刻换算成相对内容起点的秒数（声音晚 latency 才到耳朵）', () => {
    expect(tapsRelativeToContent([12.05, 12.55, 13.1], clock).map((x) => +x.toFixed(3))).toEqual([0, 0.5, 1.05])
  })
  it('内容开始前的点击为负数，原样保留交给判定', () => {
    expect(tapsRelativeToContent([11.95], clock)[0]).toBeCloseTo(-0.1)
  })
  it('窗口结束 = 零点 + windowSec + 宽限 0.3', () => {
    expect(TAP_WINDOW_GRACE_SEC).toBe(0.3)
    expect(tapWindowEndCtxSec(clock, 4)).toBeCloseTo(16.35)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/ui/tapTiming.test.ts`
Expected: FAIL —— 无法解析模块

- [ ] **Step 3: 写实现**

`src/ui/tapTiming.ts`：

```ts
/**
 * 打拍计时（主 spec §11、P-2b §8、P-3 spec §6.5）。
 * 所有时刻都是 AudioContext.currentTime 的秒数——绝不用 Date.now()。
 */
export const TAP_WINDOW_GRACE_SEC = 0.3

export interface TapClock {
  /** AudioEngine.play 返回的 startSec */
  playStartSec: number
  /** Exercise.contentStartSec */
  contentStartSec: number
  /** 输出延迟：声音从排程时刻到达耳朵的时间 */
  latencySec: number
}

/** 学习者「听到」题目内容起点的 AudioContext 时刻 */
export function contentZeroCtxSec(c: TapClock): number {
  return c.playStartSec + c.contentStartSec + c.latencySec
}

export function tapsRelativeToContent(tapCtxTimes: readonly number[], c: TapClock): number[] {
  const zero = contentZeroCtxSec(c)
  return tapCtxTimes.map((t) => t - zero)
}

export function tapWindowEndCtxSec(c: TapClock, windowSec: number): number {
  return contentZeroCtxSec(c) + windowSec + TAP_WINDOW_GRACE_SEC
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/ui/tapTiming.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/ui/tapTiming.ts src/ui/tapTiming.test.ts
git commit -m "feat(ui): 打拍计时换算" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 四种作答控件与 `AnswerArea`

**Files:**
- Modify: `package.json`（devDependencies：`@testing-library/react@16`、`@testing-library/dom@10`）
- Create: `src/ui/controls/ChoiceControl.tsx`、`SequenceControl.tsx`、`PitchControl.tsx`、`TapControl.tsx`、`AnswerArea.tsx`
- Test: `src/ui/controls/controls.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `labelFor`/`degreeLabel`/`patternLabel`/`showsSingTargets`；Task 3 的 `TapClock`/`tapsRelativeToContent`/`tapWindowEndCtxSec`；`Exercise`/`Response`（exercises/generate）；`DisplayScheme`
- Produces:
  - `ChoiceControl(props: { ids: string[]; label: (id: string) => string; enabled: boolean; onAnswer: (id: string) => void })`
  - `SequenceControl(props: { length: number; alphabet: string[]; label: (id: string) => string; enabled: boolean; onSubmit: (ids: string[]) => void })`
  - `PitchControl(props: { targetsText: string | null; enabled: boolean; onPlayTarget: () => void; onAssess: (correct: boolean) => void })`——点过「听目标」后自评按钮才可用
  - `TapControl(props: { patternText: string | null; enabled: boolean; tapCount: number; onTap: () => void })`
  - `export interface AnswerClock { now(): number; latencySec: number }`
  - `AnswerArea(props: AnswerAreaProps)`，`AnswerAreaProps = { exercise: Exercise; scheme: DisplayScheme; phase: 'presenting' | 'answering' | 'other'; playback: { startSec: number; contentStartSec: number } | null; clock: AnswerClock; schedule: (seconds: number, fn: () => void) => () => void; onPlayTarget: () => void; onResponse: (r: Response) => void }`
    - `choice`/`sequence`/`pitch`：只在 `phase === 'answering'` 时可用
    - `tap`：`presenting` 与 `answering` 都收点击（边听边打）；记录 `clock.now()`；到 `tapWindowEndCtxSec` 时（用 `schedule` 定时）若已在 `answering` 立即提交，否则等进入 `answering` 时提交；只提交一次
    - 调用方以 `key` 区分题目，换题时内部状态重置

- [ ] **Step 1: 安装测试依赖**

```bash
npm install --save-dev @testing-library/react@16 @testing-library/dom@10
```

- [ ] **Step 2: 写失败的测试**

`src/ui/controls/controls.test.tsx`：

```tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCurriculum } from '../../curriculum/curriculum'
import { MODALITIES } from '../../curriculum/knowledgePoints'
import { ALL_KNOWLEDGE_POINTS } from '../../curriculum/tracks'
import { generate, type Exercise } from '../../exercises/generate'
import { AnswerArea } from './AnswerArea'
import { ChoiceControl } from './ChoiceControl'
import { PitchControl } from './PitchControl'
import { SequenceControl } from './SequenceControl'

afterEach(cleanup)
const c = buildCurriculum()
const label = (id: string) => `L:${id}`

describe('ChoiceControl', () => {
  it('按文案显示；禁用时点不动；可用时回调 id', () => {
    const onAnswer = vi.fn()
    const { rerender } = render(<ChoiceControl ids={['do', 'mi']} label={label} enabled={false} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: 'L:mi' }))
    expect(onAnswer).not.toHaveBeenCalled()
    rerender(<ChoiceControl ids={['do', 'mi']} label={label} enabled onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: 'L:mi' }))
    expect(onAnswer).toHaveBeenCalledWith('mi')
  })
})

describe('SequenceControl', () => {
  it('填槽、删除、填满后才能提交', () => {
    const onSubmit = vi.fn()
    render(<SequenceControl length={2} alphabet={['do', 're']} label={label} enabled onSubmit={onSubmit} />)
    const submit = screen.getByRole('button', { name: '提交' })
    expect(submit).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: 'L:re' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.click(screen.getByRole('button', { name: 'L:do' }))
    fireEvent.click(screen.getByRole('button', { name: 'L:re' }))
    expect(submit).toHaveProperty('disabled', false)
    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledWith(['do', 're'])
  })
})

describe('PitchControl', () => {
  it('先听目标，自评按钮才可用', () => {
    const onAssess = vi.fn()
    const onPlayTarget = vi.fn()
    render(<PitchControl targetsText="mi" enabled onPlayTarget={onPlayTarget} onAssess={onAssess} />)
    fireEvent.click(screen.getByRole('button', { name: '唱对了' }))
    expect(onAssess).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '听目标' }))
    expect(onPlayTarget).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '没唱对' }))
    expect(onAssess).toHaveBeenCalledWith(false)
    expect(screen.getByText('mi')).toBeTruthy()
  })
})

/** 在课程里找一道指定格式的题 */
function exerciseOf(kind: Exercise['format']['kind']): Exercise {
  for (const kp of ALL_KNOWLEDGE_POINTS)
    for (const modality of MODALITIES)
      for (let seed = 0; seed < 5; seed++) {
        try {
          const ex = generate({ kpId: kp.id, modality, track: kp.track, contextLevel: 1, variationLevel: 1, difficultyStep: 1, seed, segment: 'focus' }, c)
          if (ex.format.kind === kind) return ex
        } catch {
          // 该组合不在课程范围内
        }
      }
  throw new Error(`找不到 ${kind} 题`)
}

describe('AnswerArea：打拍', () => {
  it('presenting 时就收点击；窗口到点且已进入 answering 时提交相对内容起点的时刻，只提交一次', () => {
    const ex = exerciseOf('tap')
    if (ex.format.kind !== 'tap') throw new Error()
    let now = 0
    const timers: { fn: () => void }[] = []
    const schedule = (_s: number, fn: () => void) => {
      const t = { fn }
      timers.push(t)
      return () => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1) }
    }
    const onResponse = vi.fn()
    const playback = { startSec: 1, contentStartSec: ex.contentStartSec }
    const props = { exercise: ex, scheme: 'solfege' as const, playback, clock: { now: () => now, latencySec: 0 }, schedule, onPlayTarget: vi.fn(), onResponse }
    const { rerender } = render(<AnswerArea {...props} phase="presenting" />)
    now = 1 + ex.contentStartSec + 0.5
    fireEvent.pointerDown(screen.getByRole('button', { name: /点击/ }))
    // 窗口到点但仍在 presenting：先不提交
    act(() => timers.splice(0).forEach((t) => t.fn()))
    expect(onResponse).not.toHaveBeenCalled()
    rerender(<AnswerArea {...props} phase="answering" />)
    expect(onResponse).toHaveBeenCalledTimes(1)
    const r = onResponse.mock.calls[0][0]
    expect(r.kind).toBe('tap')
    expect(r.tapsSec[0]).toBeCloseTo(0.5)
    rerender(<AnswerArea {...props} phase="answering" />)
    expect(onResponse).toHaveBeenCalledTimes(1)
  })
})

describe('AnswerArea：选择题只在 answering 可用', () => {
  it('presenting 时按钮禁用，answering 时回调选项 id', () => {
    const ex = exerciseOf('choice')
    if (ex.format.kind !== 'choice') throw new Error()
    const onResponse = vi.fn()
    const props = { exercise: ex, scheme: 'solfege' as const, playback: null, clock: { now: () => 0, latencySec: 0 }, schedule: () => () => {}, onPlayTarget: vi.fn(), onResponse }
    const { rerender } = render(<AnswerArea {...props} phase="presenting" />)
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(onResponse).not.toHaveBeenCalled()
    rerender(<AnswerArea {...props} phase="answering" />)
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(onResponse).toHaveBeenCalledWith({ kind: 'choice', id: ex.format.options[0].id })
  })
})
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `npx vitest run src/ui/controls`
Expected: FAIL —— 无法解析模块

- [ ] **Step 4: 写实现**

`src/ui/controls/ChoiceControl.tsx`：

```tsx
export function ChoiceControl(props: { ids: string[]; label: (id: string) => string; enabled: boolean; onAnswer: (id: string) => void }) {
  return (
    <div className="choice-grid">
      {props.ids.map((id) => (
        <button key={id} type="button" className="answer-btn" disabled={!props.enabled} onClick={() => props.enabled && props.onAnswer(id)}>
          {props.label(id)}
        </button>
      ))}
    </div>
  )
}
```

`src/ui/controls/SequenceControl.tsx`：

```tsx
import { useState } from 'react'

export function SequenceControl(props: { length: number; alphabet: string[]; label: (id: string) => string; enabled: boolean; onSubmit: (ids: string[]) => void }) {
  const [slots, setSlots] = useState<string[]>([])
  const full = slots.length === props.length
  return (
    <div className="sequence">
      <div className="slots" aria-label="作答槽">
        {Array.from({ length: props.length }, (_, i) => (
          <span key={i} className={`slot${slots[i] ? ' filled' : ''}`}>{slots[i] ? props.label(slots[i]) : '·'}</span>
        ))}
      </div>
      <div className="choice-grid">
        {props.alphabet.map((id) => (
          <button key={id} type="button" className="answer-btn" disabled={!props.enabled || full} onClick={() => setSlots((s) => (s.length < props.length ? [...s, id] : s))}>
            {props.label(id)}
          </button>
        ))}
      </div>
      <div className="row">
        <button type="button" disabled={!props.enabled || slots.length === 0} onClick={() => setSlots((s) => s.slice(0, -1))}>删除</button>
        <button type="button" className="primary" disabled={!props.enabled || !full} onClick={() => props.onSubmit(slots)}>提交</button>
      </div>
    </div>
  )
}
```

`src/ui/controls/PitchControl.tsx`：

```tsx
import { useState } from 'react'

/** 唱模态自评（主 spec §12）：先听目标，再判断自己唱对没有 */
export function PitchControl(props: { targetsText: string | null; enabled: boolean; onPlayTarget: () => void; onAssess: (correct: boolean) => void }) {
  const [heard, setHeard] = useState(false)
  const canAssess = props.enabled && heard
  return (
    <div className="pitch">
      {props.targetsText && <p className="targets">{props.targetsText}</p>}
      <button type="button" disabled={!props.enabled} onClick={() => { setHeard(true); props.onPlayTarget() }}>听目标</button>
      <div className="row">
        <button type="button" className="answer-btn" disabled={!canAssess} onClick={() => canAssess && props.onAssess(true)}>唱对了</button>
        <button type="button" className="answer-btn" disabled={!canAssess} onClick={() => canAssess && props.onAssess(false)}>没唱对</button>
      </div>
    </div>
  )
}
```

`src/ui/controls/TapControl.tsx`：

```tsx
export function TapControl(props: { patternText: string | null; enabled: boolean; tapCount: number; onTap: () => void }) {
  return (
    <div className="tap">
      {props.patternText && <p className="pattern">{props.patternText}</p>}
      <button
        type="button"
        className="tap-pad"
        disabled={!props.enabled}
        onPointerDown={(e) => { e.preventDefault(); if (props.enabled) props.onTap() }}
      >
        点击（{props.tapCount}）
      </button>
    </div>
  )
}
```

`src/ui/controls/AnswerArea.tsx`：

```tsx
import { useEffect, useRef, useState } from 'react'
import type { Exercise, Response } from '../../exercises/generate'
import type { DisplayScheme } from '../../music/display'
import { degreeLabel, labelFor, patternLabel, showsSingTargets } from '../labels'
import { tapWindowEndCtxSec, tapsRelativeToContent, type TapClock } from '../tapTiming'
import { ChoiceControl } from './ChoiceControl'
import { PitchControl } from './PitchControl'
import { SequenceControl } from './SequenceControl'
import { TapControl } from './TapControl'

export interface AnswerClock {
  /** AudioContext.currentTime */
  now(): number
  latencySec: number
}

export interface AnswerAreaProps {
  exercise: Exercise
  scheme: DisplayScheme
  phase: 'presenting' | 'answering' | 'other'
  playback: { startSec: number; contentStartSec: number } | null
  clock: AnswerClock
  schedule: (seconds: number, fn: () => void) => () => void
  onPlayTarget: () => void
  onResponse: (r: Response) => void
}

export function AnswerArea(props: AnswerAreaProps) {
  const { exercise, scheme, phase } = props
  const ctx = { scheme, mode: exercise.resolved.key.mode, prompt: exercise.prompt }
  const label = (id: string) => labelFor(id, ctx)
  const answering = phase === 'answering'
  const f = exercise.format

  switch (f.kind) {
    case 'choice':
      return <ChoiceControl ids={f.options.map((o) => o.id)} label={label} enabled={answering} onAnswer={(id) => props.onResponse({ kind: 'choice', id })} />
    case 'sequence':
      return <SequenceControl length={f.length} alphabet={f.alphabet.map((o) => o.id)} label={label} enabled={answering} onSubmit={(ids) => props.onResponse({ kind: 'sequence', ids })} />
    case 'pitch': {
      const text = showsSingTargets(exercise.prompt) ? f.targets.map((t) => degreeLabel(t.degree, scheme, ctx.mode)).join(' ') : null
      return <PitchControl targetsText={text} enabled={answering} onPlayTarget={props.onPlayTarget} onAssess={(ok) => props.onResponse({ kind: 'pitch', selfAssessedCorrect: ok })} />
    }
    case 'tap':
      return <TapArea {...props} windowSec={f.windowSec} patternText={f.patternIds ? f.patternIds.map(patternLabel).join('  ') : null} />
  }
}

function TapArea(props: AnswerAreaProps & { windowSec: number; patternText: string | null }) {
  const taps = useRef<number[]>([])
  const submitted = useRef(false)
  const [count, setCount] = useState(0)
  const [windowOver, setWindowOver] = useState(false)
  const { playback, clock, schedule, windowSec, phase, onResponse } = props
  const startSec = playback?.startSec
  const contentStartSec = playback?.contentStartSec

  // 窗口结束定时（P-3 spec §6.5）
  useEffect(() => {
    if (startSec === undefined || contentStartSec === undefined) return
    const end = tapWindowEndCtxSec({ playStartSec: startSec, contentStartSec, latencySec: clock.latencySec }, windowSec)
    return schedule(Math.max(0, end - clock.now()), () => setWindowOver(true))
  }, [startSec, contentStartSec, windowSec, clock, schedule])

  // 窗口已过且进入 answering：提交一次
  useEffect(() => {
    if (!windowOver || phase !== 'answering' || submitted.current) return
    if (startSec === undefined || contentStartSec === undefined) return
    submitted.current = true
    const tc: TapClock = { playStartSec: startSec, contentStartSec, latencySec: clock.latencySec }
    onResponse({ kind: 'tap', tapsSec: tapsRelativeToContent(taps.current, tc) })
  }, [windowOver, phase, startSec, contentStartSec, clock, onResponse])

  const collecting = (phase === 'presenting' || phase === 'answering') && !submitted.current
  return (
    <TapControl
      patternText={props.patternText}
      enabled={collecting}
      tapCount={count}
      onTap={() => { taps.current.push(clock.now()); setCount((n) => n + 1) }}
    />
  )
}
```

（`clock`、`schedule`、`onResponse` 若由调用方每次渲染新建，窗口定时器会被反复重排——调用方必须用 `useMemo`/`useCallback` 让它们稳定；Task 7 与 Task 8 的调用方照此实现。本任务的测试用的是稳定引用。）

- [ ] **Step 5: 运行测试，确认通过**

Run: `npx vitest run src/ui && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add package.json package-lock.json src/ui/controls/
git commit -m "feat(ui): 四种作答控件与 AnswerArea（打拍边听边收、窗口到点提交）" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 反馈面板与音阶条

**Files:**
- Create: `src/ui/FeedbackPanel.tsx`
- Test: `src/ui/FeedbackPanel.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `labelFor`/`degreeLabel`；`Exercise`/`GradeResult`/`Response`；`SCALE_DEGREES`、`DEGREE_SEMITONES`（music/key）
- Produces:
  - `export const CORRECT_ADVANCE_MS = 700`
  - `FeedbackPanel(props: { exercise: Exercise; grade: GradeResult; response: Response | null; scheme: DisplayScheme; onSlow: () => void; onReplay: () => void; onNext: () => void })`
    - 答对：显示「答对了」与「下一题」（自动前进由练习页负责）
    - 答错：显示「正确答案：…」（choice / sequence 用文案；tap 显示「节奏没对上」；pitch 显示「再听一遍目标」）、「再听一遍」、「慢速再听」、「下一题」
    - T 轨的 choice 题且答案是音级：显示 `ScaleBar`，标出「你选的」与「正确的」
  - `ScaleBar(props: { degrees: string[]; chosen: string | null; correct: string; scheme: DisplayScheme; mode: Mode })`：按半音排序，`.scale-cell` 带 `data-mark="chosen" | "correct" | "both"`

- [ ] **Step 1: 写失败的测试**

`src/ui/FeedbackPanel.test.tsx`：

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { generate } from '../exercises/generate'
import { FeedbackPanel, ScaleBar } from './FeedbackPanel'

afterEach(cleanup)
const c = buildCurriculum()
const degreeEx = generate({ kpId: 'degree:major:mi', modality: 'recognize', track: 'T', contextLevel: 1, variationLevel: 1, difficultyStep: 2, seed: 3, segment: 'focus' }, c)

describe('FeedbackPanel', () => {
  it('答错：显示正确答案、音阶条、慢速再听与下一题', () => {
    if (degreeEx.answer.kind !== 'choice' || degreeEx.format.kind !== 'choice') throw new Error('应为选择题')
    const correct = degreeEx.answer.id
    const wrong = degreeEx.format.options.find((o) => o.id !== correct)!.id
    const onSlow = vi.fn()
    const onNext = vi.fn()
    render(
      <FeedbackPanel exercise={degreeEx} grade={{ correct: false, detail: { kind: 'choice' } }} response={{ kind: 'choice', id: wrong }} scheme="solfege" onSlow={onSlow} onReplay={vi.fn()} onNext={onNext} />,
    )
    expect(screen.getByText(/正确答案/)).toBeTruthy()
    expect(document.querySelector('[data-mark="chosen"]')?.textContent).toBe(wrong)
    expect(document.querySelector('[data-mark="correct"]')?.textContent).toBe(correct)
    fireEvent.click(screen.getByRole('button', { name: '慢速再听' }))
    fireEvent.click(screen.getByRole('button', { name: '下一题' }))
    expect(onSlow).toHaveBeenCalled()
    expect(onNext).toHaveBeenCalled()
  })

  it('答对：只显示确认与下一题', () => {
    render(<FeedbackPanel exercise={degreeEx} grade={{ correct: true, detail: { kind: 'choice' } }} response={null} scheme="solfege" onSlow={vi.fn()} onReplay={vi.fn()} onNext={vi.fn()} />)
    expect(screen.getByText('答对了')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '慢速再听' })).toBeNull()
  })
})

describe('ScaleBar', () => {
  it('同一个音既是所选又是正确时标 both；按半音排序', () => {
    render(<ScaleBar degrees={['sol', 'do', 'mi']} chosen="mi" correct="mi" scheme="numeric" mode="major" />)
    const cells = [...document.querySelectorAll('.scale-cell')].map((e) => e.textContent)
    expect(cells).toEqual(['1', '3', '5'])
    expect(document.querySelector('[data-mark="both"]')?.textContent).toBe('3')
  })
})
```

（若该 seed 下 `degree:major:mi` 的选项里没有别的音级可选——不会发生，选项至少两个——或格式不是 choice，换一个 seed 并保留全部断言。）

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/ui/FeedbackPanel.test.tsx`
Expected: FAIL —— 无法解析模块

- [ ] **Step 3: 写实现**

`src/ui/FeedbackPanel.tsx`：

```tsx
import type { Exercise, GradeResult, Response } from '../exercises/generate'
import type { DisplayScheme } from '../music/display'
import { DEGREE_SEMITONES, SCALE_DEGREES, type Mode, type ScaleDegree } from '../music/key'
import { degreeLabel, labelFor } from './labels'

/** 答对后自动进入下一题的延迟（主 spec §6.4：不打断节奏） */
export const CORRECT_ADVANCE_MS = 700

const isDegree = (id: string): id is ScaleDegree => (SCALE_DEGREES as readonly string[]).includes(id)

export function ScaleBar(props: { degrees: string[]; chosen: string | null; correct: string; scheme: DisplayScheme; mode: Mode }) {
  const sorted = props.degrees.filter(isDegree).sort((a, b) => DEGREE_SEMITONES[a] - DEGREE_SEMITONES[b])
  return (
    <div className="scale-bar" aria-label="音阶条">
      {sorted.map((d) => {
        const isChosen = d === props.chosen
        const isCorrect = d === props.correct
        const mark = isChosen && isCorrect ? 'both' : isChosen ? 'chosen' : isCorrect ? 'correct' : undefined
        return (
          <span key={d} className="scale-cell" data-mark={mark}>
            {degreeLabel(d, props.scheme, props.mode)}
          </span>
        )
      })}
    </div>
  )
}

function answerText(ex: Exercise, scheme: DisplayScheme): string {
  const ctx = { scheme, mode: ex.resolved.key.mode, prompt: ex.prompt }
  switch (ex.answer.kind) {
    case 'choice':
      return labelFor(ex.answer.id, ctx)
    case 'sequence':
      return ex.answer.ids.map((id) => labelFor(id, ctx)).join('  ')
    case 'tap':
      return '节奏没对上'
    case 'pitch':
      return '再听一遍目标'
  }
}

export function FeedbackPanel(props: {
  exercise: Exercise
  grade: GradeResult
  response: Response | null
  scheme: DisplayScheme
  onSlow: () => void
  onReplay: () => void
  onNext: () => void
}) {
  const { exercise: ex, grade } = props
  if (grade.correct) {
    return (
      <div className="feedback ok">
        <p>答对了</p>
        <button type="button" onClick={props.onNext}>下一题</button>
      </div>
    )
  }
  const chosen = props.response?.kind === 'choice' ? props.response.id : null
  const bar =
    ex.spec.track === 'T' && ex.format.kind === 'choice' && ex.answer.kind === 'choice' && isDegree(ex.answer.id)
      ? { degrees: ex.format.options.map((o) => o.id), correct: ex.answer.id }
      : null
  return (
    <div className="feedback wrong">
      <p>正确答案：{answerText(ex, props.scheme)}</p>
      {bar && <ScaleBar degrees={bar.degrees} chosen={chosen} correct={bar.correct} scheme={props.scheme} mode={ex.resolved.key.mode} />}
      <div className="row">
        <button type="button" onClick={props.onReplay}>再听一遍</button>
        <button type="button" onClick={props.onSlow}>慢速再听</button>
        <button type="button" className="primary" onClick={props.onNext}>下一题</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/ui && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/ui/FeedbackPanel.tsx src/ui/FeedbackPanel.test.tsx
git commit -m "feat(ui): 反馈面板与音阶条" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 组装点——存储降级、损坏重建、懒音频、React 绑定

**Files:**
- Modify: `src/storage/indexeddb.ts`（新增 `deleteIndexedDb`）
- Create: `src/ui/platform.ts`、`src/ui/RuntimeContext.tsx`
- Test: `src/storage/indexeddb.test.ts`（追加一条）、`src/ui/platform.test.ts`

**Interfaces:**
- Consumes: `openIndexedDbRepository`/`DB_NAME`、`MemoryRepository`、`StorageCorruptError`/`StorageUnavailableError`/`Repository`、`createRuntime`/`Runtime`/`AudioPort`/`TimerPort`/`RuntimeSnapshot`、`createAudioEngine`/`AudioEngine`、`localDateString`、`buildCurriculum`、`PlayOptions`
- Produces:
  - `export function deleteIndexedDb(opts?: { name?: string; factory?: IDBFactory }): Promise<void>`（`onblocked` → reject）
  - `export interface LazyAudio extends AudioPort { unlock(): Promise<void>; readonly ready: boolean; readonly latencySec: number; onStateChange(fn: (state: AudioContextState) => void): () => void }`——`unlock` 在用户手势里调用，首次创建引擎并 `resume()`；未 unlock 前 `play` 抛 `Error('音频尚未启用')`；`currentTime` 未就绪时为 0；引擎创建前注册的 `onStateChange` 回调，创建后生效
  - `export function createLazyAudio(factory?: () => AudioEngine): LazyAudio`
  - `export const browserTimer: TimerPort`
  - `export type BootResult = { kind: 'ready'; runtime: Runtime; audio: LazyAudio; storageWarning: string | null } | { kind: 'corrupt'; message: string; rawDump: string; rebuild: () => Promise<BootResult> }`
  - `export interface BootDeps { openRepo?: () => Promise<Repository>; deleteDb?: () => Promise<void>; audio?: LazyAudio; timer?: TimerPort; now?: () => Date; randomId?: () => string }`
  - `export async function boot(deps?: BootDeps): Promise<BootResult>`——`StorageUnavailableError` → 内存仓库 + 警告「本地存储不可用：本次练习的进度不会保存（可在设置里导出备份）」；`StorageCorruptError` → `corrupt`；`rebuild` = 删库后重新 `boot`；其他错误原样抛出
  - `RuntimeContext.tsx`：`RuntimeProvider(props: { runtime: Runtime; audio: LazyAudio; children: ReactNode })`、`useRuntime(): { runtime: Runtime; audio: LazyAudio }`、`useSnapshot(): RuntimeSnapshot`

- [ ] **Step 1: 写失败的测试**

在 `src/storage/indexeddb.test.ts` 顶部的 import 里加入 `deleteIndexedDb`，末尾追加：

```ts
describe('deleteIndexedDb', () => {
  it('删库后重新打开是空库', async () => {
    const env = fresh()
    const a = await openIndexedDbRepository(env)
    await a.saveProfile({ id: 'p', createdAtLocalDate: '2026-10-13', phaseId: 'P1', displayScheme: 'solfege', placement: { done: true, startPhase: 'P1' }, schemaVersion: SCHEMA_VERSION })
    await deleteIndexedDb(env)
    const b = await openIndexedDbRepository(env)
    expect(await b.loadProfile()).toBeNull()
  })
})
```

（`openIndexedDbRepository` 打开时会注册 `onversionchange` 关闭自己，所以删库不会被自己挡住。）

`src/ui/platform.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import type { AudioEngine } from '../audio/AudioEngine'
import { MemoryRepository } from '../storage/memory'
import { StorageCorruptError, StorageUnavailableError } from '../storage/types'
import { boot, createLazyAudio } from './platform'

const fixedNow = () => new Date(2026, 9, 13, 9, 0)

describe('boot', () => {
  it('正常：拿到 runtime，没有警告', async () => {
    const r = await boot({ openRepo: async () => new MemoryRepository(), now: fixedNow, randomId: () => 'p1' })
    expect(r.kind).toBe('ready')
    if (r.kind !== 'ready') return
    expect(r.storageWarning).toBeNull()
    expect((await r.runtime.ensureProfile()).createdAtLocalDate).toBe('2026-10-13')
  })

  it('IndexedDB 不可用：降级为内存仓库并给出警告', async () => {
    const r = await boot({ openRepo: async () => { throw new StorageUnavailableError('无') }, now: fixedNow, randomId: () => 'p1' })
    expect(r.kind).toBe('ready')
    if (r.kind === 'ready') expect(r.storageWarning).toMatch(/不会保存/)
  })

  it('数据损坏：给出原始数据；rebuild 删库后重新打开', async () => {
    let opens = 0
    const deleteDb = vi.fn(async () => {})
    const r = await boot({
      openRepo: async () => { if (opens++ === 0) throw new StorageCorruptError('坏了', '{"raw":1}'); return new MemoryRepository() },
      deleteDb, now: fixedNow, randomId: () => 'p1',
    })
    expect(r.kind).toBe('corrupt')
    if (r.kind !== 'corrupt') return
    expect(r.rawDump).toBe('{"raw":1}')
    const again = await r.rebuild()
    expect(deleteDb).toHaveBeenCalled()
    expect(again.kind).toBe('ready')
  })

  it('其他错误原样抛出', async () => {
    await expect(boot({ openRepo: async () => { throw new Error('x') } })).rejects.toThrow('x')
  })
})

describe('createLazyAudio', () => {
  function fakeEngine() {
    const handlers: ((s: AudioContextState) => void)[] = []
    const engine = {
      currentTime: 5,
      outputLatencySec: 0.02,
      resume: vi.fn(async () => {}),
      play: vi.fn(() => ({ startSec: 5.1, endSec: 6 })),
      stopAll: vi.fn(),
      onStateChange: (fn: (s: AudioContextState) => void) => { handlers.push(fn); return () => {} },
    }
    return { engine: engine as unknown as AudioEngine, raw: engine, handlers }
  }

  it('unlock 前 play 抛错；unlock 只建一次引擎；之后转发并带上播放选项', async () => {
    const { engine, raw } = fakeEngine()
    const factory = vi.fn(() => engine)
    const a = createLazyAudio(factory)
    expect(a.ready).toBe(false)
    expect(a.currentTime).toBe(0)
    expect(() => a.play({ events: [], totalDurSec: 0 })).toThrow('音频尚未启用')
    await a.unlock()
    await a.unlock()
    expect(factory).toHaveBeenCalledTimes(1)
    expect(raw.resume).toHaveBeenCalledTimes(2)
    expect(a.ready).toBe(true)
    expect(a.latencySec).toBe(0.02)
    a.play({ events: [], totalDurSec: 0 }, { cutContextAtSec: 1 })
    expect(raw.play).toHaveBeenCalledWith({ events: [], totalDurSec: 0 }, undefined, { cutContextAtSec: 1 })
  })

  it('引擎创建前注册的状态监听，创建后生效', async () => {
    const { engine, handlers } = fakeEngine()
    const a = createLazyAudio(() => engine)
    const seen: string[] = []
    a.onStateChange((s) => seen.push(s))
    await a.unlock()
    handlers.forEach((h) => h('suspended'))
    expect(seen).toEqual(['suspended'])
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/ui/platform.test.ts src/storage/indexeddb.test.ts`
Expected: FAIL —— `deleteIndexedDb`、`./platform` 不存在

- [ ] **Step 3: 写实现**

`src/storage/indexeddb.ts` 末尾追加：

```ts
/** 删除整个数据库（损坏后用户确认重建时用）。其他标签页占用时 reject */
export function deleteIndexedDb(opts: { name?: string; factory?: IDBFactory } = {}): Promise<void> {
  const factory = opts.factory ?? globalThis.indexedDB
  const name = opts.name ?? DB_NAME
  return new Promise((resolve, reject) => {
    if (!factory) {
      resolve()
      return
    }
    const r = factory.deleteDatabase(name)
    r.onsuccess = () => resolve()
    r.onerror = () => reject(r.error)
    r.onblocked = () => reject(new Error('另一个标签页正在使用本地数据库，请关闭其他标签页后重试'))
  })
}
```

`src/ui/platform.ts`：

```ts
import { createAudioEngine, type AudioEngine } from '../audio/AudioEngine'
import { buildCurriculum } from '../curriculum/curriculum'
import type { PlaybackPlan, PlayOptions } from '../music/playback'
import { createRuntime, type AudioPort, type Runtime, type TimerPort } from '../runtime/runtime'
import { localDateString } from '../session/time'
import { deleteIndexedDb, openIndexedDbRepository } from '../storage/indexeddb'
import { MemoryRepository } from '../storage/memory'
import { StorageCorruptError, StorageUnavailableError, type Repository } from '../storage/types'

/**
 * 唯一的组装点（P-3b）：打开存储（失败降级）、懒创建音频、浏览器计时器 → Runtime。
 * 只有这里可以 import 音频引擎与存储实现。
 */

export interface LazyAudio extends AudioPort {
  /** 必须在用户手势里调用（iOS） */
  unlock(): Promise<void>
  readonly ready: boolean
  readonly latencySec: number
  onStateChange(fn: (state: AudioContextState) => void): () => void
}

export function createLazyAudio(factory: () => AudioEngine = createAudioEngine): LazyAudio {
  let engine: AudioEngine | null = null
  const listeners = new Set<(s: AudioContextState) => void>()
  const offs = new Map<(s: AudioContextState) => void, () => void>()
  const need = (): AudioEngine => {
    if (!engine) throw new Error('音频尚未启用')
    return engine
  }
  return {
    async unlock() {
      if (!engine) {
        engine = factory()
        for (const fn of listeners) offs.set(fn, engine.onStateChange(fn))
      }
      await engine.resume()
    },
    get ready() {
      return engine !== null
    },
    get latencySec() {
      return engine ? engine.outputLatencySec : 0
    },
    get currentTime() {
      return engine ? engine.currentTime : 0
    },
    play(plan: PlaybackPlan, opts?: PlayOptions) {
      return need().play(plan, undefined, opts)
    },
    stopAll() {
      engine?.stopAll()
    },
    onStateChange(fn) {
      listeners.add(fn)
      if (engine) offs.set(fn, engine.onStateChange(fn))
      return () => {
        listeners.delete(fn)
        offs.get(fn)?.()
        offs.delete(fn)
      }
    },
  }
}

export const browserTimer: TimerPort = {
  after(seconds, fn) {
    const id = setTimeout(fn, seconds * 1000)
    return () => clearTimeout(id)
  },
}

export type BootResult =
  | { kind: 'ready'; runtime: Runtime; audio: LazyAudio; storageWarning: string | null }
  | { kind: 'corrupt'; message: string; rawDump: string; rebuild: () => Promise<BootResult> }

export interface BootDeps {
  openRepo?: () => Promise<Repository>
  deleteDb?: () => Promise<void>
  audio?: LazyAudio
  timer?: TimerPort
  now?: () => Date
  randomId?: () => string
}

export async function boot(deps: BootDeps = {}): Promise<BootResult> {
  const openRepo = deps.openRepo ?? (() => openIndexedDbRepository())
  const deleteDb = deps.deleteDb ?? (() => deleteIndexedDb())
  const now = deps.now ?? (() => new Date())
  const randomId = deps.randomId ?? (() => crypto.randomUUID())

  let repo: Repository
  let storageWarning: string | null = null
  try {
    repo = await openRepo()
  } catch (e) {
    if (e instanceof StorageUnavailableError) {
      repo = new MemoryRepository()
      storageWarning = '本地存储不可用：本次练习的进度不会保存（可在设置里导出备份）'
    } else if (e instanceof StorageCorruptError) {
      return {
        kind: 'corrupt',
        message: e.message,
        rawDump: e.rawDump,
        rebuild: async () => {
          await deleteDb()
          return boot(deps)
        },
      }
    } else {
      throw e
    }
  }

  const audio = deps.audio ?? createLazyAudio()
  const runtime = createRuntime({
    repo,
    audio,
    timer: deps.timer ?? browserTimer,
    curriculum: buildCurriculum(),
    nowIso: () => now().toISOString(),
    todayLocalDate: () => localDateString(now()),
    newProfileId: randomId,
  })
  return { kind: 'ready', runtime, audio, storageWarning }
}
```

`src/ui/RuntimeContext.tsx`：

```tsx
import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { Runtime, RuntimeSnapshot } from '../runtime/runtime'
import type { LazyAudio } from './platform'

interface Ctx {
  runtime: Runtime
  audio: LazyAudio
}

const RuntimeCtx = createContext<Ctx | null>(null)

export function RuntimeProvider(props: { runtime: Runtime; audio: LazyAudio; children: ReactNode }) {
  return <RuntimeCtx.Provider value={{ runtime: props.runtime, audio: props.audio }}>{props.children}</RuntimeCtx.Provider>
}

export function useRuntime(): Ctx {
  const v = useContext(RuntimeCtx)
  if (!v) throw new Error('useRuntime 必须在 RuntimeProvider 里使用')
  return v
}

export function useSnapshot(): RuntimeSnapshot {
  const { runtime } = useRuntime()
  const subscribe = useCallback(
    (fn: () => void) => {
      const off = runtime.subscribe(() => fn())
      return () => {
        off()
      }
    },
    [runtime],
  )
  return useSyncExternalStore(subscribe, runtime.getSnapshot)
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/ui src/storage && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/storage/indexeddb.ts src/storage/indexeddb.test.ts src/ui/platform.ts src/ui/platform.test.ts src/ui/RuntimeContext.tsx
git commit -m "feat(ui): 组装点——存储降级、损坏重建、懒音频与 React 绑定" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 页面——首页、练习、总结、设置、存储问题；路由

**Files:**
- Create: `src/ui/download.ts`、`src/ui/pages/Home.tsx`、`Practice.tsx`、`Summary.tsx`、`Settings.tsx`、`StorageProblem.tsx`、`src/ui/Shell.tsx`
- Modify: `src/ui/App.tsx`
- Test: `src/ui/pages/pages.test.tsx`

**Interfaces:**
- Consumes: Task 4 的 `AnswerArea`/`AnswerClock`；Task 5 的 `FeedbackPanel`/`CORRECT_ADVANCE_MS`；Task 6 的 `useRuntime`/`useSnapshot`/`RuntimeProvider`/`boot`/`BootResult`；Task 2 的 `PROMPT_TEXT`；`buildCurriculum`（阶段 `label`）
- Produces:
  - `download.ts`：`export function downloadText(filename: string, text: string): void`
  - `Home(props: { onOpenSettings: () => void })`：顶部「P1 · 阶段 label」与「设置」；按 `todayStatus` 显示「开始今天的练习」/「继续今天的练习」/「再练一场」；点击先 `audio.unlock()` 再 `startToday()` / `startExtra()`
  - `Practice()`：题干、「第 n / N 题」、「重听」（非打拍题，answering 时可用）、「结束本场」（`endEarly`）；`.answer-zone` 里放 `AnswerArea`（`key` = `${day}:${sessionNo}:${planIndex}:${seed}`）或 `FeedbackPanel`；答对后 `CORRECT_ADVANCE_MS` 自动派发 `next`；答错自动播放 `feedback.replay`；`phase === 'idle'` 显示「继续」（`unlock` 后派发 `start`）；作答延迟 = `(audio.currentTime − 进入 answering 时的 audio.currentTime) × 1000`
  - `Summary(props: { onHome: () => void })`：正确率（取整百分比）、各轨道题数、关卡「还差 N 项」/「已达标」、实战关是否达标、升阶段提示；本场有错题时「重练刚才错的这组」（`startDrill`）
  - `Settings(props: { onBack: () => void })`：显示皮肤（`updateProfile`）；「导出备份」；`<label>导入备份<input type="file"></label>`（`importBundle`；成功后「下载导入前的自动备份」；失败显示「导入失败：原因」）
  - `StorageProblem(props: { result: Extract<BootResult, { kind: 'corrupt' }>; onRebuilt: (r: BootResult) => void })`：先「下载损坏数据副本」，之后「重建」才可用
  - `Shell(props: { storageWarning: string | null })`：路由——Profile 未加载 → 加载中；设置标志 → 设置；会话存在且 `phase !== 'done'` → 练习；会话 `done` 且总结未关闭 → 总结；否则首页。顶部常驻 `storageWarning` 与快照的 `storageError`
  - `App()`：`boot()` → 加载中 / `StorageProblem` / `RuntimeProvider` + `Shell`；`location.hash === '#dev'` 时渲染 `DevHarness`

- [ ] **Step 1: 写失败的测试**

`src/ui/pages/pages.test.tsx`：

```tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaybackPlan } from '../../music/playback'
import type { TimerPort } from '../../runtime/runtime'
import { MemoryRepository } from '../../storage/memory'
import { SCHEMA_VERSION } from '../../storage/types'
import { labelFor } from '../labels'
import { boot, type LazyAudio } from '../platform'
import { RuntimeProvider } from '../RuntimeContext'
import { Shell } from '../Shell'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function fakeAudio(): LazyAudio {
  return {
    ready: true,
    latencySec: 0,
    currentTime: 0,
    async unlock() {},
    play: (plan: PlaybackPlan) => ({ startSec: 0, endSec: plan.totalDurSec }),
    stopAll() {},
    onStateChange: () => () => {},
  }
}

function manualTimer() {
  const pending: (() => void)[] = []
  const timer: TimerPort = {
    after: (_s, fn) => {
      pending.push(fn)
      return () => { const i = pending.indexOf(fn); if (i >= 0) pending.splice(i, 1) }
    },
  }
  /** 让排队的「播完」回调触发，并等 runtime 的串行队列跑完 */
  const flush = async () => {
    await act(async () => {
      while (pending.length) pending.shift()!()
      for (let i = 0; i < 5; i++) await Promise.resolve()
    })
  }
  return { timer, flush }
}

async function setup(profileId = 'p') {
  const repo = new MemoryRepository()
  await repo.saveProfile({ id: profileId, createdAtLocalDate: '2026-10-13', phaseId: 'P1', displayScheme: 'solfege', placement: { done: true, startPhase: 'P1' }, schemaVersion: SCHEMA_VERSION })
  const audio = fakeAudio()
  const { timer, flush } = manualTimer()
  const r = await boot({ openRepo: async () => repo, audio, timer, now: () => new Date(2026, 9, 13, 9), randomId: () => profileId })
  if (r.kind !== 'ready') throw new Error('boot 失败')
  render(<RuntimeProvider runtime={r.runtime} audio={audio}><Shell storageWarning={null} /></RuntimeProvider>)
  return { runtime: r.runtime, flush, repo }
}

async function clickStart() {
  const btn = await screen.findByRole('button', { name: '开始今天的练习' })
  await act(async () => { fireEvent.click(btn) })
}

describe('首页 → 练习页', () => {
  it('显示阶段；开始后进入练习页；选择题播完前不可点', async () => {
    const { runtime, flush } = await setup()
    expect(await screen.findByText(/P1 ·/)).toBeTruthy()
    await clickStart()
    const s = runtime.getSnapshot().session!
    expect(s.phase).toBe('presenting')
    expect(screen.getByText(/第 1 \//)).toBeTruthy()
    const ex = s.current!.exercise
    if (ex.format.kind !== 'choice') throw new Error('首题应为选择题（热身题）；若不是，换 setup 的 profileId')
    const name = labelFor(ex.format.options[0].id, { scheme: 'solfege', mode: ex.resolved.key.mode, prompt: ex.prompt })
    expect(screen.getAllByRole('button', { name })[0]).toHaveProperty('disabled', true)
    await flush()
    expect(screen.getAllByRole('button', { name })[0]).toHaveProperty('disabled', false)
  })

  it('答对后显示「答对了」，0.7 秒后自动进入下一题', async () => {
    const { runtime, flush } = await setup()
    await clickStart()
    await flush()
    const ex = runtime.getSnapshot().session!.current!.exercise
    if (ex.format.kind !== 'choice' || ex.answer.kind !== 'choice') throw new Error('首题应为选择题')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const ctx = { scheme: 'solfege' as const, mode: ex.resolved.key.mode, prompt: ex.prompt }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: labelFor((ex.answer as { id: string }).id, ctx) })) })
    expect(screen.getByText('答对了')).toBeTruthy()
    await act(async () => { vi.advanceTimersByTime(800) })
    vi.useRealTimers()
    await flush()
    expect(runtime.getSnapshot().session!.current!.planIndex).toBe(1)
  })

  it('结束本场 → 总结页 → 回到首页显示「再练一场」', async () => {
    const { runtime } = await setup()
    await clickStart()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '结束本场' })) })
    expect(runtime.getSnapshot().session!.phase).toBe('done')
    expect(await screen.findByText(/今日总结/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '回到首页' })) })
    expect(await screen.findByRole('button', { name: '再练一场' })).toBeTruthy()
  })

  it('中断后显示「继续」，点击后重出同一道题', async () => {
    const { runtime } = await setup()
    await clickStart()
    const before = runtime.getSnapshot().session!.current!.exercise
    await act(async () => { await runtime.dispatch({ type: 'interrupted' }) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '继续' })) })
    expect(runtime.getSnapshot().session!.current!.exercise).toEqual(before)
  })
})

describe('设置页', () => {
  it('切换显示皮肤写入 Profile；导出触发下载', async () => {
    const created: Blob[] = []
    URL.createObjectURL = vi.fn((b: Blob) => { created.push(b); return 'blob:x' }) as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    const { repo } = await setup()
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '设置' })) })
    await act(async () => { fireEvent.click(screen.getByLabelText('数字')) })
    expect((await repo.loadProfile())!.displayScheme).toBe('numeric')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '导出备份' })) })
    expect(created).toHaveLength(1)
    expect(JSON.parse(await created[0].text()).schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('导入坏文件：提示原因，数据不变', async () => {
    const { repo } = await setup()
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '设置' })) })
    const input = screen.getByLabelText('导入备份') as HTMLInputElement
    const file = new File(['not json'], 'x.json', { type: 'application/json' })
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
    expect(await screen.findByText(/导入失败/)).toBeTruthy()
    expect((await repo.loadProfile())!.id).toBe('p')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/ui/pages`
Expected: FAIL —— 无法解析模块

- [ ] **Step 3: 写实现**

`src/ui/download.ts`：

```ts
/** 让浏览器下载一段文本（导出备份、损坏副本） */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
```

`src/ui/pages/Home.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { buildCurriculum } from '../../curriculum/curriculum'
import { useRuntime, useSnapshot } from '../RuntimeContext'

const curriculum = buildCurriculum()
type Status = 'notStarted' | 'inProgress' | 'mainDone'

export function Home(props: { onOpenSettings: () => void }) {
  const { runtime, audio } = useRuntime()
  const snap = useSnapshot()
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void runtime.todayStatus().then((s) => {
      if (alive) setStatus(s)
    })
    return () => {
      alive = false
    }
  }, [runtime, snap.session])

  const phaseId = snap.profile?.phaseId
  const phaseLabel = curriculum.phases.find((p) => p.id === phaseId)?.label ?? ''

  async function go(extra: boolean) {
    try {
      await audio.unlock()
      if (extra) await runtime.startExtra()
      else await runtime.startToday()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <main className="page home">
      <header className="topbar">
        <span>{phaseId} · {phaseLabel}</span>
        <button type="button" onClick={props.onOpenSettings}>设置</button>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="home-actions">
        {status === 'notStarted' && <button type="button" className="primary big" onClick={() => void go(false)}>开始今天的练习</button>}
        {status === 'inProgress' && <button type="button" className="primary big" onClick={() => void go(false)}>继续今天的练习</button>}
        {status === 'mainDone' && (
          <>
            <p>今天的主线已经练完。</p>
            <button type="button" className="primary big" onClick={() => void go(true)}>再练一场</button>
          </>
        )}
      </div>
    </main>
  )
}
```

`src/ui/pages/Practice.tsx`：

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Response } from '../../exercises/generate'
import type { AnswerClock } from '../controls/AnswerArea'
import { AnswerArea } from '../controls/AnswerArea'
import { CORRECT_ADVANCE_MS, FeedbackPanel } from '../FeedbackPanel'
import { PROMPT_TEXT } from '../labels'
import { useRuntime, useSnapshot } from '../RuntimeContext'

const schedule = (seconds: number, fn: () => void) => {
  const id = setTimeout(fn, seconds * 1000)
  return () => clearTimeout(id)
}

export function Practice() {
  const { runtime, audio } = useRuntime()
  const snap = useSnapshot()
  const session = snap.session!
  const cur = session.current
  const scheme = snap.profile?.displayScheme ?? 'solfege'
  const [lastResponse, setLastResponse] = useState<Response | null>(null)
  const answeringSince = useRef(0)
  const clock = useMemo<AnswerClock>(() => ({ now: () => audio.currentTime, get latencySec() { return audio.latencySec } }), [audio])

  useEffect(() => {
    if (session.phase === 'answering') answeringSince.current = audio.currentTime
  }, [session.phase, audio])

  // 答对：短暂确认后自动下一题；答错：自动播放反馈重放（主 spec §6.4）
  const grade = session.lastGrade
  useEffect(() => {
    if (session.phase !== 'feedback' || !grade || !cur) return
    if (grade.correct) {
      const id = setTimeout(() => void runtime.dispatch({ type: 'next' }), CORRECT_ADVANCE_MS)
      return () => clearTimeout(id)
    }
    try {
      audio.stopAll()
      audio.play(cur.exercise.feedback.replay)
    } catch {
      // 音频未就绪时忽略
    }
  }, [session.phase, grade, cur, runtime, audio])

  const respond = useCallback(
    (r: Response) => {
      setLastResponse(r)
      const latencyMs = Math.max(0, (audio.currentTime - answeringSince.current) * 1000)
      void runtime.dispatch({ type: 'answer', response: r, latencyMs })
    },
    [audio, runtime],
  )

  const playTarget = useCallback(() => {
    if (!cur) return
    audio.stopAll()
    audio.play(cur.exercise.feedback.replay)
  }, [audio, cur])

  if (session.phase === 'idle') {
    return (
      <main className="page practice">
        <div className="overlay">
          <p>练习暂停了。</p>
          <button
            type="button"
            className="primary big"
            onClick={async () => {
              await audio.unlock()
              await runtime.dispatch({ type: 'start' })
            }}
          >
            继续
          </button>
        </div>
      </main>
    )
  }
  if (!cur) return <main className="page practice" />

  const ex = cur.exercise
  const total = session.plan.items.length
  const phase = session.phase === 'presenting' || session.phase === 'answering' ? session.phase : 'other'

  return (
    <main className="page practice">
      <header className="topbar">
        <span>第 {cur.planIndex + 1} / {total} 题</span>
        <button type="button" onClick={() => void runtime.dispatch({ type: 'endEarly' })}>结束本场</button>
      </header>
      <section className="prompt">
        <p className="prompt-text">{PROMPT_TEXT[ex.prompt]}</p>
        {ex.format.kind !== 'tap' && (
          <button
            type="button"
            disabled={session.phase !== 'answering'}
            onClick={() => {
              audio.stopAll()
              audio.play(ex.plan, { cutContextAtSec: ex.contentStartSec })
            }}
          >
            重听
          </button>
        )}
      </section>
      <section className="answer-zone">
        {session.phase === 'feedback' && grade ? (
          <FeedbackPanel
            exercise={ex}
            grade={grade}
            response={lastResponse}
            scheme={scheme}
            onReplay={() => { audio.stopAll(); audio.play(ex.feedback.replay) }}
            onSlow={() => { audio.stopAll(); audio.play(ex.feedback.slow) }}
            onNext={() => void runtime.dispatch({ type: 'next' })}
          />
        ) : (
          <AnswerArea
            key={`${session.day}:${session.sessionNo}:${cur.planIndex}:${ex.spec.seed}`}
            exercise={ex}
            scheme={scheme}
            phase={phase}
            playback={snap.playback}
            clock={clock}
            schedule={schedule}
            onPlayTarget={playTarget}
            onResponse={respond}
          />
        )}
      </section>
    </main>
  )
}
```

`src/ui/pages/Summary.tsx`：

```tsx
import { useRuntime, useSnapshot } from '../RuntimeContext'

const TRACK_NAME = { T: '音级', H: '和声', R: '节奏' } as const

export function Summary(props: { onHome: () => void }) {
  const { runtime, audio } = useRuntime()
  const snap = useSnapshot()
  const s = snap.session!
  const sum = s.summary!
  const isDrill = s.mode === 'drill'
  return (
    <main className="page summary">
      <h1>{isDrill ? '重练结束' : '今日总结'}</h1>
      {!isDrill && (
        <>
          <p>正确率 {Math.round(sum.accuracy * 100)}%（{sum.correct} / {sum.scored}）</p>
          <ul>
            {(['T', 'H', 'R'] as const).map((t) => (
              <li key={t}>{TRACK_NAME[t]}：{sum.byTrack[t]} 题</li>
            ))}
          </ul>
          {sum.gate.evaluated ? (
            <>
              <p>{sum.gate.blockingKeys === 0 ? '本阶段的掌握度已达标' : `本阶段还差 ${sum.gate.blockingKeys} 项`}</p>
              <p>实战关：{sum.gate.bossSatisfied ? '达标' : '未达标'}</p>
              {sum.gate.advancedTo && <p className="good">升入 {sum.gate.advancedTo}！</p>}
            </>
          ) : (
            <p>本场提前结束，不评估关卡。</p>
          )}
        </>
      )}
      <div className="row">
        {!isDrill && s.wrongThisSession.length > 0 && (
          <button
            type="button"
            onClick={async () => {
              await audio.unlock()
              await runtime.startDrill()
            }}
          >
            重练刚才错的这组
          </button>
        )}
        <button type="button" className="primary" onClick={props.onHome}>回到首页</button>
      </div>
    </main>
  )
}
```

`src/ui/pages/Settings.tsx`：

```tsx
import { useState } from 'react'
import type { DisplayScheme } from '../../music/display'
import { localDateString } from '../../session/time'
import { downloadText } from '../download'
import { useRuntime, useSnapshot } from '../RuntimeContext'

const SCHEMES: { id: DisplayScheme; name: string }[] = [
  { id: 'solfege', name: '唱名' },
  { id: 'numeric', name: '数字' },
  { id: 'degree', name: '级数' },
]

export function Settings(props: { onBack: () => void }) {
  const { runtime } = useRuntime()
  const snap = useSnapshot()
  const [msg, setMsg] = useState<string | null>(null)
  const scheme = snap.profile?.displayScheme ?? 'solfege'
  const today = () => localDateString(new Date())

  async function onImport(file: File | undefined) {
    if (!file) return
    try {
      await runtime.importBundle(await file.text())
      setMsg('导入成功')
    } catch (e) {
      setMsg(`导入失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <main className="page settings">
      <header className="topbar">
        <button type="button" onClick={props.onBack}>返回</button>
        <span>设置</span>
      </header>
      <fieldset>
        <legend>显示皮肤</legend>
        {SCHEMES.map((s) => (
          <label key={s.id}>
            <input type="radio" name="scheme" checked={scheme === s.id} onChange={() => void runtime.updateProfile({ displayScheme: s.id })} />
            {s.name}
          </label>
        ))}
      </fieldset>
      <section>
        <button type="button" onClick={async () => downloadText(`ear-tr-备份-${today()}.json`, await runtime.exportBundle())}>导出备份</button>
        <label className="file-btn">
          导入备份
          <input type="file" accept="application/json,.json" onChange={(e) => void onImport(e.target.files?.[0])} />
        </label>
        {msg && <p>{msg}</p>}
        {snap.lastBackup && (
          <button type="button" onClick={() => downloadText(`ear-tr-导入前自动备份-${today()}.json`, snap.lastBackup!)}>下载导入前的自动备份</button>
        )}
      </section>
    </main>
  )
}
```

`src/ui/pages/StorageProblem.tsx`：

```tsx
import { useState } from 'react'
import { downloadText } from '../download'
import type { BootResult } from '../platform'

export function StorageProblem(props: { result: Extract<BootResult, { kind: 'corrupt' }>; onRebuilt: (r: BootResult) => void }) {
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <main className="page storage-problem">
      <h1>本地数据出了问题</h1>
      <p>{props.result.message}</p>
      <p>请先下载一份损坏数据的副本，再重建。重建会清空本地进度。</p>
      <button type="button" onClick={() => { downloadText('ear-tr-损坏数据副本.json', props.result.rawDump); setSaved(true) }}>下载损坏数据副本</button>
      <button
        type="button"
        className="danger"
        disabled={!saved}
        onClick={async () => {
          try {
            props.onRebuilt(await props.result.rebuild())
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          }
        }}
      >
        重建
      </button>
      {error && <p className="error">{error}</p>}
    </main>
  )
}
```

`src/ui/Shell.tsx`：

```tsx
import { useEffect, useState } from 'react'
import type { SessionState } from '../session/types'
import { Home } from './pages/Home'
import { Practice } from './pages/Practice'
import { Settings } from './pages/Settings'
import { Summary } from './pages/Summary'
import { useRuntime, useSnapshot } from './RuntimeContext'

export function Shell(props: { storageWarning: string | null }) {
  const { runtime } = useRuntime()
  const snap = useSnapshot()
  const [settings, setSettings] = useState(false)
  const [dismissed, setDismissed] = useState<SessionState | null>(null)

  useEffect(() => {
    void runtime.ensureProfile()
  }, [runtime])

  const s = snap.session
  let page
  if (!snap.profile) page = <main className="page">加载中…</main>
  else if (settings) page = <Settings onBack={() => setSettings(false)} />
  else if (s && s.phase !== 'done') page = <Practice />
  else if (s && s.phase === 'done' && dismissed !== s) page = <Summary onHome={() => setDismissed(s)} />
  else page = <Home onOpenSettings={() => setSettings(true)} />

  return (
    <>
      {props.storageWarning && <div className="banner warn">{props.storageWarning}</div>}
      {snap.storageError && <div className="banner warn">{snap.storageError}</div>}
      {page}
    </>
  )
}
```

`src/ui/App.tsx`（整体替换）：

```tsx
import { useEffect, useState } from 'react'
import { DevHarness } from './DevHarness'
import { StorageProblem } from './pages/StorageProblem'
import { boot, type BootResult } from './platform'
import { RuntimeProvider } from './RuntimeContext'
import { Shell } from './Shell'

const isDev = () => location.hash === '#dev'

export function App() {
  const [result, setResult] = useState<BootResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isDev()) return
    boot().then(setResult, (e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  if (isDev()) return <DevHarness />
  if (error) return <main className="page"><p className="error">启动失败：{error}</p></main>
  if (!result) return <main className="page">加载中…</main>
  if (result.kind === 'corrupt') return <StorageProblem result={result} onRebuilt={setResult} />
  return (
    <RuntimeProvider runtime={result.runtime} audio={result.audio}>
      <Shell storageWarning={result.storageWarning} />
    </RuntimeProvider>
  )
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/ui && npx tsc --noEmit`
Expected: PASS。若首题不是选择题导致测试抛「首题应为选择题」，换 `setup` 的 `profileId`（seed 由它派生）直到首题为选择题，并保留全部断言。

- [ ] **Step 5: 提交**

```bash
git add src/ui/
git commit -m "feat(ui): 首页、练习页、今日总结、设置、存储问题页与路由" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 首次使用与分级测试

**Files:**
- Create: `src/ui/placementProbe.ts`、`src/ui/pages/Onboarding.tsx`
- Modify: `src/ui/Shell.tsx`（`profile.placement.done === false` 时渲染 `Onboarding`）
- Test: `src/ui/placementProbe.test.ts`、`src/ui/pages/onboarding.test.tsx`

**Interfaces:**
- Consumes: `initialPlacement`/`nextProbe`/`recordProbe`/`placementResult`/`PlacementState`（scheduling/placement）、`generate`/`grade`、`sessionSeed`、Task 4 的 `AnswerArea`、Task 6 的 `useRuntime`/`useSnapshot`
- Produces:
  - `export const PLACEMENT_DAY = -1`
  - `export function probeSpec(c: Curriculum, kpId: KnowledgePointId, seed: number): ExerciseSpec`（`modality: 'recognize'`、`contextLevel: 0`、`variationLevel: 0`、`difficultyStep: 0`、`segment: 'focus'`、`track` 取自 `c.knowledgePoints`）
  - `export function probeSeed(profileId: string, probeIndex: number): number`（= `sessionSeed(profileId, PLACEMENT_DAY, probeIndex)`）
  - `Onboarding()`：介绍页（约 6–9 个月、建议戴耳机、约 5 分钟分级测试）→「开始分级测试」/「跳过，从头开始」→ 逐题探针（播放后点「我听完了」进入作答；`AnswerArea`；`grade`；`recordProbe`）→ 结果页（「从 Pn（label）开始」、「音域测定将在后续版本加入」）→「开始练习」：`updateProfile({ phaseId, placement: { done: true, startPhase: phaseId } })`
  - 分级不写作答与掌握度

- [ ] **Step 1: 写失败的测试**

`src/ui/placementProbe.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { generate } from '../exercises/generate'
import { initialPlacement } from '../scheduling/placement'
import { sessionSeed } from '../session/time'
import { PLACEMENT_DAY, probeSeed, probeSpec } from './placementProbe'

const c = buildCurriculum()

describe('probeSpec（主 spec §7.7、P-3 spec §6.1）', () => {
  it('识别模态、最低语境与难度；每个探针都能出题', () => {
    for (const kp of initialPlacement(c).probes) {
      const spec = probeSpec(c, kp, 1)
      expect(spec).toMatchObject({ kpId: kp, modality: 'recognize', contextLevel: 0, variationLevel: 0, difficultyStep: 0, segment: 'focus' })
      expect(spec.track).toBe(c.knowledgePoints.get(kp)!.track)
      expect(() => generate(spec, c)).not.toThrow()
    }
  })
  it('种子由 profile 与探针序号确定性派生，与练习日不重叠', () => {
    expect(probeSeed('p', 3)).toBe(sessionSeed('p', PLACEMENT_DAY, 3))
    expect(PLACEMENT_DAY).toBeLessThan(0)
  })
})
```

`src/ui/pages/onboarding.test.tsx`：

```tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCurriculum } from '../../curriculum/curriculum'
import { generate } from '../../exercises/generate'
import type { PlaybackPlan } from '../../music/playback'
import { initialPlacement } from '../../scheduling/placement'
import { MemoryRepository } from '../../storage/memory'
import { labelFor } from '../labels'
import { boot, type LazyAudio } from '../platform'
import { probeSeed, probeSpec } from '../placementProbe'
import { RuntimeProvider } from '../RuntimeContext'
import { Shell } from '../Shell'

afterEach(cleanup)
const c = buildCurriculum()

function fakeAudio(): LazyAudio {
  return {
    ready: true,
    latencySec: 0,
    currentTime: 0,
    async unlock() {},
    play: (plan: PlaybackPlan) => ({ startSec: 0, endSec: plan.totalDurSec }),
    stopAll() {},
    onStateChange: () => () => {},
  }
}

async function setup() {
  const repo = new MemoryRepository()
  const audio = fakeAudio()
  const r = await boot({ openRepo: async () => repo, audio, timer: { after: () => () => {} }, now: () => new Date(2026, 9, 13, 9), randomId: () => 'p-new' })
  if (r.kind !== 'ready') throw new Error('boot 失败')
  render(<RuntimeProvider runtime={r.runtime} audio={audio}><Shell storageWarning={null} /></RuntimeProvider>)
  return { repo }
}

describe('首次使用', () => {
  it('新用户先看到周期说明与耳机建议；跳过 → 从 P1 开始，进入首页', async () => {
    const { repo } = await setup()
    expect(await screen.findByText(/6–9 个月/)).toBeTruthy()
    expect(screen.getByText(/耳机/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '跳过，从头开始' })) })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '开始练习' })) })
    expect((await repo.loadProfile())!.placement).toEqual({ done: true, startPhase: 'P1' })
    expect(await screen.findByRole('button', { name: '开始今天的练习' })).toBeTruthy()
  })

  it('分级：连错两题即结束，起点 P1，且不写任何作答', async () => {
    const { repo } = await setup()
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '开始分级测试' })) })
    const probes = initialPlacement(c).probes
    for (let i = 0; i < 2; i++) {
      const ex = generate(probeSpec(c, probes[i], probeSeed('p-new', i)), c)
      if (ex.format.kind !== 'choice' || ex.answer.kind !== 'choice') throw new Error('前两个探针应是选择题')
      const correct = ex.answer.id
      const wrong = ex.format.options.find((o) => o.id !== correct)!.id
      const ctx = { scheme: 'solfege' as const, mode: ex.resolved.key.mode, prompt: ex.prompt }
      await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '我听完了' })) })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: labelFor(wrong, ctx) })) })
    }
    expect(await screen.findByText(/从 P1/)).toBeTruthy()
    expect(await repo.countAttempts()).toBe(0)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/ui/placementProbe.test.ts src/ui/pages/onboarding.test.tsx`
Expected: FAIL —— 无法解析模块

- [ ] **Step 3: 写实现**

`src/ui/placementProbe.ts`：

```ts
import type { Curriculum } from '../curriculum/curriculum'
import type { KnowledgePointId } from '../curriculum/knowledgePoints'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'
import { sessionSeed } from '../session/time'

/** 分级测试用的「日」：负数，保证与练习日的 seed 不重叠 */
export const PLACEMENT_DAY = -1

/** 分级探针：识别模态、最强语境、无变异、最低档（P-3 spec §6.1） */
export function probeSpec(c: Curriculum, kpId: KnowledgePointId, seed: number): ExerciseSpec {
  const kp = c.knowledgePoints.get(kpId)
  if (!kp) throw new Error(`未知知识点 ${kpId}`)
  return { kpId, modality: 'recognize', track: kp.track, contextLevel: 0, variationLevel: 0, difficultyStep: 0, seed, segment: 'focus' }
}

export function probeSeed(profileId: string, probeIndex: number): number {
  return sessionSeed(profileId, PLACEMENT_DAY, probeIndex)
}
```

`src/ui/pages/Onboarding.tsx`：

```tsx
import { useCallback, useMemo, useState } from 'react'
import { buildCurriculum } from '../../curriculum/curriculum'
import type { PhaseId } from '../../curriculum/stages'
import { generate, grade, type Exercise, type Response } from '../../exercises/generate'
import { initialPlacement, nextProbe, placementResult, recordProbe, type PlacementState } from '../../scheduling/placement'
import { AnswerArea, type AnswerClock } from '../controls/AnswerArea'
import { PROMPT_TEXT } from '../labels'
import { probeSeed, probeSpec } from '../placementProbe'
import { useRuntime, useSnapshot } from '../RuntimeContext'

const curriculum = buildCurriculum()

const schedule = (seconds: number, fn: () => void) => {
  const id = setTimeout(fn, seconds * 1000)
  return () => clearTimeout(id)
}

type Step =
  | { kind: 'intro' }
  | { kind: 'probe'; state: PlacementState; exercise: Exercise; playback: { startSec: number; contentStartSec: number }; listening: boolean }
  | { kind: 'result'; phaseId: PhaseId }

export function Onboarding() {
  const { runtime, audio } = useRuntime()
  const snap = useSnapshot()
  const profileId = snap.profile!.id
  const scheme = snap.profile!.displayScheme
  const [step, setStep] = useState<Step>({ kind: 'intro' })
  const [error, setError] = useState<string | null>(null)
  const clock = useMemo<AnswerClock>(() => ({ now: () => audio.currentTime, get latencySec() { return audio.latencySec } }), [audio])

  const present = useCallback(
    (state: PlacementState): Step => {
      const kp = nextProbe(state)
      if (!kp) return { kind: 'result', phaseId: placementResult(curriculum, state) }
      const exercise = generate(probeSpec(curriculum, kp, probeSeed(profileId, state.results.length)), curriculum)
      audio.stopAll()
      const { startSec } = audio.play(exercise.plan, { cutContextAtSec: exercise.contentStartSec })
      return { kind: 'probe', state, exercise, playback: { startSec, contentStartSec: exercise.contentStartSec }, listening: true }
    },
    [audio, profileId],
  )

  const answer = useCallback(
    (r: Response) => {
      if (step.kind !== 'probe') return
      // 副作用（播放下一题）不放进 setState 的更新函数里：StrictMode 下更新函数可能执行两次
      setStep(present(recordProbe(step.state, grade(step.exercise, r).correct)))
    },
    [present, step],
  )

  const playTarget = useCallback(() => {
    if (step.kind !== 'probe') return
    audio.stopAll()
    audio.play(step.exercise.feedback.replay)
  }, [audio, step])

  async function start() {
    try {
      await audio.unlock()
      setStep(present(initialPlacement(curriculum)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (step.kind === 'intro') {
    return (
      <main className="page onboarding">
        <h1>欢迎</h1>
        <p>这套练习按三条线（音级、和声、节奏）循序渐进。每天约 25 分钟，完整走完通常需要 6–9 个月。</p>
        <p>建议戴耳机练习。</p>
        <p>先做一个约 5 分钟的分级测试，找到适合你的起点。</p>
        {error && <p className="error">{error}</p>}
        <button type="button" className="primary big" onClick={() => void start()}>开始分级测试</button>
        <button type="button" onClick={() => setStep({ kind: 'result', phaseId: 'P1' })}>跳过，从头开始</button>
      </main>
    )
  }

  if (step.kind === 'result') {
    const label = curriculum.phases.find((p) => p.id === step.phaseId)?.label ?? ''
    return (
      <main className="page onboarding">
        <h1>分级完成</h1>
        <p>从 {step.phaseId}（{label}）开始。</p>
        <p>音域测定将在后续版本加入。</p>
        <button
          type="button"
          className="primary big"
          onClick={() => void runtime.updateProfile({ phaseId: step.phaseId, placement: { done: true, startPhase: step.phaseId } })}
        >
          开始练习
        </button>
      </main>
    )
  }

  return (
    <main className="page practice">
      <header className="topbar"><span>分级测试 · 第 {step.state.results.length + 1} 题</span></header>
      <section className="prompt">
        <p className="prompt-text">{PROMPT_TEXT[step.exercise.prompt]}</p>
        {step.listening ? (
          <button type="button" onClick={() => setStep({ ...step, listening: false })}>我听完了</button>
        ) : (
          <button
            type="button"
            onClick={() => {
              audio.stopAll()
              audio.play(step.exercise.plan, { cutContextAtSec: step.exercise.contentStartSec })
            }}
          >
            重听
          </button>
        )}
      </section>
      <section className="answer-zone">
        <AnswerArea
          key={step.state.results.length}
          exercise={step.exercise}
          scheme={scheme}
          phase={step.listening ? 'presenting' : 'answering'}
          playback={step.playback}
          clock={clock}
          schedule={schedule}
          onPlayTarget={playTarget}
          onResponse={answer}
        />
      </section>
    </main>
  )
}
```

`src/ui/Shell.tsx`：加 `import { Onboarding } from './pages/Onboarding'`，并在 `if (!snap.profile)` 分支之后加：

```tsx
  else if (!snap.profile.placement.done) page = <Onboarding />
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/ui && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/ui/placementProbe.ts src/ui/placementProbe.test.ts src/ui/pages/Onboarding.tsx src/ui/pages/onboarding.test.tsx src/ui/Shell.tsx
git commit -m "feat(ui): 首次使用与分级测试" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 移动端整合——Wake Lock、中断监听、样式与入口

**Files:**
- Create: `src/ui/mobile.ts`、`src/ui/styles.css`
- Modify: `src/ui/pages/Practice.tsx`（接上两个 hook）、`src/main.tsx`（引入样式）、`index.html`（标题、主题色）
- Test: `src/ui/mobile.test.tsx`

**Interfaces:**
- Consumes: Task 6 的 `LazyAudio`
- Produces:
  - `export function useWakeLock(active: boolean): void`——`active` 时申请 `navigator.wakeLock.request('screen')`（不支持则静默跳过）；`active` 变 false 或卸载时释放；页面重新可见且仍 `active` 时重新申请
  - `export function useInterruptions(opts: { active: boolean; audio: Pick<LazyAudio, 'onStateChange'>; onInterrupt: () => void }): void`——`active` 时：`visibilitychange` 且 `document.visibilityState === 'hidden'`、或音频状态变为非 `running`，都调用 `onInterrupt`
  - 练习页：`presenting`/`answering`/`feedback` 时持有 Wake Lock；`presenting`/`answering` 时监听中断并派发 `interrupted`

- [ ] **Step 1: 写失败的测试**

`src/ui/mobile.test.tsx`：

```tsx
// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useInterruptions, useWakeLock } from './mobile'

afterEach(cleanup)

function setVisibility(v: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useWakeLock', () => {
  it('active 时申请；重新可见时再申请；不 active 时释放', async () => {
    const release = vi.fn(async () => {})
    const request = vi.fn(async () => ({ release }))
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
    function W(p: { on: boolean }) { useWakeLock(p.on); return null }
    const { rerender } = render(<W on />)
    await act(async () => {})
    expect(request).toHaveBeenCalledTimes(1)
    await act(async () => { setVisibility('hidden'); setVisibility('visible') })
    expect(request).toHaveBeenCalledTimes(2)
    rerender(<W on={false} />)
    await act(async () => {})
    expect(release).toHaveBeenCalled()
  })

  it('浏览器不支持时不报错', () => {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined })
    function W() { useWakeLock(true); return null }
    expect(() => render(<W />)).not.toThrow()
  })
})

describe('useInterruptions', () => {
  it('页面隐藏或音频被挂起时触发；不 active 时不触发', () => {
    const handlers: ((s: AudioContextState) => void)[] = []
    const audio = {
      onStateChange: (fn: (s: AudioContextState) => void) => {
        handlers.push(fn)
        return () => { handlers.splice(handlers.indexOf(fn), 1) }
      },
    }
    const onInterrupt = vi.fn()
    function I(p: { on: boolean }) { useInterruptions({ active: p.on, audio, onInterrupt }); return null }
    const { rerender } = render(<I on />)
    act(() => setVisibility('hidden'))
    expect(onInterrupt).toHaveBeenCalledTimes(1)
    act(() => handlers.forEach((h) => h('suspended')))
    expect(onInterrupt).toHaveBeenCalledTimes(2)
    act(() => handlers.forEach((h) => h('running')))
    expect(onInterrupt).toHaveBeenCalledTimes(2)
    rerender(<I on={false} />)
    act(() => setVisibility('hidden'))
    expect(onInterrupt).toHaveBeenCalledTimes(2)
    setVisibility('visible')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/ui/mobile.test.tsx`
Expected: FAIL —— 无法解析模块

- [ ] **Step 3: 写实现**

`src/ui/mobile.ts`：

```ts
import { useEffect, useRef } from 'react'
import type { LazyAudio } from './platform'

interface WakeLockSentinelLike {
  release(): Promise<void>
}

/** 练习中保持亮屏（P-3 spec §6.6）。不支持的浏览器静默跳过 */
export function useWakeLock(active: boolean): void {
  const sentinel = useRef<WakeLockSentinelLike | null>(null)
  useEffect(() => {
    const wl = (navigator as { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } }).wakeLock
    if (!active || !wl) return
    let alive = true
    const acquire = () => {
      wl.request('screen').then(
        (s) => {
          if (alive) sentinel.current = s
          else void s.release().catch(() => {})
        },
        () => {},
      )
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire()
    }
    acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      const s = sentinel.current
      sentinel.current = null
      if (s) void s.release().catch(() => {})
    }
  }, [active])
}

/** 页面隐藏或音频被系统挂起 → 中断（主 spec §11、P-3 spec §6.6） */
export function useInterruptions(opts: { active: boolean; audio: Pick<LazyAudio, 'onStateChange'>; onInterrupt: () => void }): void {
  const cb = useRef(opts.onInterrupt)
  cb.current = opts.onInterrupt
  const { active, audio } = opts
  useEffect(() => {
    if (!active) return
    const onVis = () => {
      if (document.visibilityState === 'hidden') cb.current()
    }
    document.addEventListener('visibilitychange', onVis)
    const off = audio.onStateChange((s) => {
      if (s !== 'running') cb.current()
    })
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      off()
    }
  }, [active, audio])
}
```

`src/ui/pages/Practice.tsx`：`import { useInterruptions, useWakeLock } from '../mobile'`；在 `answeringSince` 定义之后、任何提前 `return` 之前加入：

```tsx
  const live = session.phase === 'presenting' || session.phase === 'answering'
  useWakeLock(live || session.phase === 'feedback')
  useInterruptions({ active: live, audio, onInterrupt: () => void runtime.dispatch({ type: 'interrupted' }) })
```

`src/ui/styles.css`：

```css
:root {
  --bg: #fafaf7;
  --fg: #1d1d1b;
  --muted: #6b6b66;
  --accent: #2f6fde;
  --ok: #2e8b57;
  --bad: #c0392b;
  --warn-bg: #fff4d6;
  --card: #ffffff;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #151514; --fg: #ecebe6; --muted: #a3a29c; --card: #1f1f1d; --warn-bg: #3a3220; }
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--fg); font: 17px/1.5 system-ui, -apple-system, 'PingFang SC', 'Noto Sans SC', sans-serif; -webkit-tap-highlight-color: transparent; }
button { font: inherit; min-height: 44px; padding: 8px 14px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--fg) 20%, transparent); background: var(--card); color: var(--fg); }
button:disabled { opacity: 0.4; }
button.primary { background: var(--accent); color: #fff; border-color: transparent; }
button.danger { background: var(--bad); color: #fff; border-color: transparent; }
button.big { width: 100%; min-height: 56px; font-size: 1.1rem; }
.page { min-height: 100%; padding: 16px 16px calc(34vh + 16px); max-width: 640px; margin: 0 auto; }
.page.home, .page.summary, .page.settings, .page.onboarding, .page.storage-problem { padding-bottom: 24px; }
.topbar { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 16px; color: var(--muted); }
.banner.warn { background: var(--warn-bg); padding: 8px 16px; font-size: 0.9rem; }
.error { color: var(--bad); }
.good { color: var(--ok); font-weight: 600; }
.row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.prompt-text { font-size: 1.25rem; margin: 8px 0 12px; }
.answer-zone { position: fixed; left: 0; right: 0; bottom: 0; height: 33vh; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: var(--card); border-top: 1px solid color-mix(in srgb, var(--fg) 12%, transparent); overflow-y: auto; }
.choice-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(72px, 1fr)); gap: 8px; }
.answer-btn { min-height: 52px; font-size: 1.05rem; }
.slots { display: flex; gap: 6px; margin-bottom: 8px; }
.slot { flex: 1; min-height: 40px; display: grid; place-items: center; border-bottom: 2px solid var(--muted); }
.slot.filled { border-color: var(--accent); }
.tap-pad { width: 100%; height: calc(33vh - 72px); min-height: 120px; font-size: 1.2rem; touch-action: manipulation; user-select: none; }
.pattern, .targets { font-size: 1.4rem; text-align: center; margin: 0 0 8px; }
.feedback.ok p { color: var(--ok); font-weight: 600; }
.feedback.wrong p { color: var(--bad); }
.scale-bar { display: flex; gap: 4px; margin: 8px 0; }
.scale-cell { flex: 1; text-align: center; padding: 6px 0; border-radius: 6px; background: color-mix(in srgb, var(--fg) 6%, transparent); }
.scale-cell[data-mark='chosen'] { background: var(--bad); color: #fff; }
.scale-cell[data-mark='correct'] { background: var(--ok); color: #fff; }
.scale-cell[data-mark='both'] { background: var(--ok); color: #fff; outline: 2px solid var(--bad); }
.overlay { display: grid; gap: 12px; place-items: center; padding-top: 30vh; }
.home-actions { display: grid; gap: 12px; margin-top: 30vh; }
fieldset { border: none; padding: 0; margin: 0 0 16px; display: flex; gap: 12px; }
.file-btn { position: relative; display: inline-flex; align-items: center; min-height: 44px; padding: 8px 14px; border-radius: 10px; border: 1px dashed var(--muted); margin-left: 8px; }
.file-btn input { position: absolute; inset: 0; opacity: 0; }
```

`src/main.tsx` 顶部加 `import './ui/styles.css'`。

`index.html`：`<title>练耳</title>`；`<head>` 内加 `<meta name="theme-color" content="#2f6fde" />`。

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run && npx tsc --noEmit && npx vite build`
Expected: 全部 PASS；构建成功

- [ ] **Step 5: 提交**

```bash
git add src/ui/mobile.ts src/ui/mobile.test.tsx src/ui/styles.css src/ui/pages/Practice.tsx src/main.tsx index.html
git commit -m "feat(ui): 移动端整合——Wake Lock、中断监听、样式与入口" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 写回与真机验收清单

**Files:**
- Create: `docs/superpowers/plans/2026-10-13-p3b-device-acceptance.md`
- Modify: `docs/superpowers/specs/2026-08-24-ear-training-design.md`（FWD-5 状态、§15.1 状态）

- [ ] **Step 1: 写真机验收清单**

`docs/superpowers/plans/2026-10-13-p3b-device-acceptance.md`：

```markdown
# P-3b 真机验收清单（只有用户能做）

在电脑上运行 `npm run dev`，手机与电脑连同一 Wi‑Fi，用手机浏览器打开终端里显示的局域网地址（`server.host` 已开启）。

> 局域网 http 下练习本身可用；部分浏览器只在 HTTPS 下提供 Wake Lock，亮屏可能不保持。

## 1. 音色实听（主 spec §16.3）

打开 `<地址>/#dev`，戴耳机逐项确认：

- [ ] 主 spec §16.3 列出的十项，逐条打勾
- [ ] 「人声」与「弦乐」听得出区别（分不出就记下来，需改 `oscType`）
- [ ] 语境（终止式）末尾不拖尾进目标音（FWD-5）

## 2. 完整练一场

- [ ] 首次打开看到周期说明与耳机建议，做完分级测试，进入首页
- [ ] 练完一整场 25 分钟会话：选择、听写、唱（自评）、打拍四种控件都出现过且能用
- [ ] 答题按钮都在屏幕下 1/3，单手拇指够得到
- [ ] 答错时自动重放，「慢速再听」可用；音级题有音阶条
- [ ] 练习中屏幕不熄灭
- [ ] 今日总结的数字合理

## 3. 中断与续起

- [ ] 练到中途切到别的应用再回来：显示「继续」，点击后重出同一道题
- [ ] 练到中途关掉浏览器标签再打开：首页显示「继续今天的练习」，从中断处接着练

## 4. 导出与导入

- [ ] 设置 → 导出备份，得到 JSON 文件
- [ ] 再练几题后导入刚才的备份：进度回到导出时；可下载「导入前的自动备份」

## 结果

把未通过的项与现象记在这里，交回开发。
```

- [ ] **Step 2: 写回主 spec**

在 FWD-5 段落的「**修法**」那一行之后插入一行：

```
**状态（P-3b，已关闭）**：`AudioEngine.play` 的 `cutContextAtSec`（= `contentStartSec`）把本该在目标音前结束的语境声部的释音截到目标音起点；跨过该点的持续低音不受影响。music 层的 `GAP_SEC` 未动。
```

在 §15.1 末尾追加一行：

```
**状态（P-3b）**：显示层 `src/ui/labels.ts` 在小调中把 `le` 显示为 `si`（数字 `♯5`、级数 `♯^5`）；底层音级 id 不变。
```

- [ ] **Step 3: 完成检查**

```bash
npx vitest run
npx tsc --noEmit
npx vite build
grep -rn "Date.now" src/ui --include=*.ts --include=*.tsx | grep -v "\.test\." || echo "OK: 界面不用 Date.now"
grep -rln "audio/AudioEngine'\|storage/indexeddb'\|storage/memory'" src/ui --include=*.ts --include=*.tsx | grep -v "\.test\." | grep -v "src/ui/platform.ts" | grep -v "src/ui/DevHarness.tsx" || echo "OK: 只有组装点接触音频与存储实现"
grep -rn "Math.random\|Date.now\|window\.\|document\.\|indexedDB" src/session/ src/storage/ --include=*.ts | grep -v "\.test\.ts" | grep -v "src/storage/indexeddb.ts" || echo "OK: session / storage 核心零 IO"
```

Expected: 全部 PASS；构建成功；三条 grep 都输出 OK。

- [ ] **Step 4: 提交**

```bash
git add docs/superpowers/plans/2026-10-13-p3b-device-acceptance.md docs/superpowers/specs/2026-08-24-ear-training-design.md
git commit -m "docs: P-3b 写回（FWD-5、§15.1）与真机验收清单" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 完成标准

1. `npx vitest run` 全绿；`npx tsc --noEmit` 无输出；`npx vite build` 成功
2. 文案表覆盖测试通过：生成器可能产出的全部答案 id 都有文案；题干不含知识点名称
3. 四种作答控件、反馈面板、打拍换算、页面流程、首次使用、中断与亮屏都有组件测试
4. FWD-5 关闭；§15.1 语境拼写落地
5. 真机验收清单由用户完成后才合入 master

## 下一步

P-4 视唱闭环（音高检测替换自评）与 P-5 实战关（替换实战关替身）。
