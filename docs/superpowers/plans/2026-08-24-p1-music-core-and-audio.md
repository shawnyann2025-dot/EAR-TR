# P-1 音乐内核与音频引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立纯函数音乐领域模型与 Web Audio 播放层，产出一个可在手机上打开的验证页面，能听到带 L0–L4 调性语境、4 种合成音色、随机调的真实音级题。

**Architecture:** `src/music/` 全部是零 IO 的纯函数，产出声明式 `PlaybackPlan`；`src/audio/` 只负责把 `PlaybackPlan` 翻译成 Web Audio 节点，不含任何乐理知识。两者之间唯一的契约是 `PlaybackPlan` 类型。调度与执行分离，使全部乐理逻辑可在 Node 环境下单测。

**Tech Stack:** TypeScript (strict) + Vite + React + Vitest + 原生 Web Audio API

**Spec:** `docs/superpowers/specs/2026-08-24-ear-training-design.md`

## Global Constraints

以下要求适用于本计划的每一个任务，逐条抄自 spec：

- **底层统一使用首调音级（movable do），小调采用 la 基唱名**（spec §4.1）。任何地方不得出现固定调音名作为训练目标。
- **`src/music/` 零 IO、纯函数**（spec §3.2）。不得 import 任何浏览器 API、不得读写存储、不得使用 `Math.random()`、不得使用 `Date.now()`。
- **所有随机必须来自显式传入的 seeded RNG**，同一 seed 必须产生同一结果（spec §3.2「Generator 必须确定性」）。
- **所有时间判定使用 `audioContext.currentTime`，绝不使用 `Date.now()`**（spec §11）。
- **音色全部由 Web Audio 合成，不引入任何外部音频资源文件**（spec §6.2、§8.4）。
- **不使用 Tone.js**（spec §3.4：避免调度黑盒，节奏轨需要对时钟的完全控制）。
- **TypeScript `strict: true`**。
- `PlaybackPlan` 是 `music/` 与 `audio/` 之间唯一的数据契约（spec §4.2）。`music/` 不得知道 Web Audio 存在；`audio/` 不得包含乐理。

**关于 git：** Task 1 会执行 `git init`。此目录当前不是 git 仓库，而本计划每个任务以提交结尾。

---

### Task 1: 项目脚手架与第一个纯函数

建立可运行的 Vite + React + TS + Vitest 环境，并用一个真实的音乐函数（MIDI 转频率）验证测试链路通畅。脚手架不单独成任务——它的存在意义就是让这个函数能被测到。

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`
- Create: `src/main.tsx`, `src/ui/App.tsx`
- Create: `src/music/pitch.ts`
- Test: `src/music/pitch.test.ts`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: `midiToFreq(midi: number): number` — 后续所有音频事件构建依赖它

- [ ] **Step 1: 初始化仓库与依赖**

```bash
git init
npm init -y
npm install react react-dom
npm install -D vite @vitejs/plugin-react typescript @types/react @types/react-dom vitest jsdom
```

- [ ] **Step 2: 写配置文件**

`.gitignore`：

```
node_modules/
dist/
*.local
.DS_Store
```

`tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src", "vite.config.ts"]
}
```

`vite.config.ts`：

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { host: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
```

`server.host: true` 是必须的——没有它，手机连不到局域网里的 dev server，本计划的最终验证步骤就无法执行。

`index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>练耳 · 开发验证</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

在 `package.json` 的 `"scripts"` 中加入：

```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 3: 写最小 React 入口**

`src/main.tsx`：

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`src/ui/App.tsx`：

```tsx
export function App() {
  return <main>练耳 · 开发验证页</main>
}
```

- [ ] **Step 4: 写失败的测试**

`src/music/pitch.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { midiToFreq } from './pitch'

describe('midiToFreq', () => {
  it('把 A4 (MIDI 69) 映射到 440 Hz', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6)
  })

  it('低八度频率减半', () => {
    expect(midiToFreq(57)).toBeCloseTo(220, 6)
  })

  it('高八度频率加倍', () => {
    expect(midiToFreq(81)).toBeCloseTo(880, 6)
  })

  it('相邻半音之比为 2^(1/12)', () => {
    expect(midiToFreq(61) / midiToFreq(60)).toBeCloseTo(Math.pow(2, 1 / 12), 10)
  })
})
```

- [ ] **Step 5: 运行测试，确认失败**

Run: `npx vitest run src/music/pitch.test.ts`
Expected: FAIL — 无法解析模块 `./pitch`

- [ ] **Step 6: 写实现**

`src/music/pitch.ts`：

```ts
/** MIDI 音高编号转频率（Hz）。A4 = MIDI 69 = 440 Hz，十二平均律。 */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}
```

- [ ] **Step 7: 运行测试，确认通过**

Run: `npx vitest run src/music/pitch.test.ts`
Expected: PASS，4 个测试全绿

- [ ] **Step 8: 确认类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无输出（无错误）

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "chore: 项目脚手架与 midiToFreq"
```

---

### Task 2: 确定性随机数发生器

spec §3.2 要求所有生成器确定性可复现。这必须在任何生成逻辑之前就位，否则后面会到处混进 `Math.random()`。

**Files:**
- Create: `src/music/rng.ts`
- Test: `src/music/rng.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `interface Rng { next(): number; int(maxExclusive: number): number; pick<T>(items: readonly T[]): T }`
  - `makeRng(seed: number): Rng`

- [ ] **Step 1: 写失败的测试**

`src/music/rng.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { makeRng } from './rng'

describe('makeRng', () => {
  it('同一 seed 产生完全相同的序列', () => {
    const a = makeRng(12345)
    const b = makeRng(12345)
    const seqA = Array.from({ length: 50 }, () => a.next())
    const seqB = Array.from({ length: 50 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('不同 seed 产生不同的序列', () => {
    const a = makeRng(1)
    const b = makeRng(2)
    expect(a.next()).not.toBe(b.next())
  })

  it('next() 落在 [0, 1) 区间内', () => {
    const rng = makeRng(999)
    for (let i = 0; i < 1000; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('int(n) 落在 [0, n) 且能取到全部取值', () => {
    const rng = makeRng(7)
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(5)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(5)
      seen.add(v)
    }
    expect(seen.size).toBe(5)
  })

  it('pick 从数组中取元素', () => {
    const rng = makeRng(42)
    const items = ['a', 'b', 'c'] as const
    for (let i = 0; i < 100; i++) {
      expect(items).toContain(rng.pick(items))
    }
  })

  it('解构出来的方法仍然工作（不依赖 this）', () => {
    const { int } = makeRng(3)
    expect(() => int(4)).not.toThrow()
  })
})
```

最后一个测试不是凑数——`makeRng` 返回的对象会被到处解构使用，用 `this` 写的方法会在解构后崩溃。

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/music/rng.test.ts`
Expected: FAIL — 无法解析模块 `./rng`

- [ ] **Step 3: 写实现**

`src/music/rng.ts`：

```ts
export interface Rng {
  /** 返回 [0, 1) 区间内的浮点数 */
  next(): number
  /** 返回 [0, maxExclusive) 区间内的整数 */
  int(maxExclusive: number): number
  /** 从数组中等概率取一个元素 */
  pick<T>(items: readonly T[]): T
}

/**
 * mulberry32。选它是因为实现短、无外部依赖、分布对本用途足够好，
 * 且状态只有一个 32 位整数——便于日后把 RNG 状态一并存进 SessionRecord。
 */
export function makeRng(seed: number): Rng {
  let state = seed >>> 0

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive)

  const pick = <T,>(items: readonly T[]): T => items[int(items.length)]

  return { next, int, pick }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/music/rng.test.ts`
Expected: PASS，6 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(music): 确定性随机数发生器"
```

---

### Task 3: 调与音级

首调音级体系的核心。小调用 la 基意味着 `do` 落在关系大调主音上——这是整个体系里最容易写错的一处。

**Files:**
- Create: `src/music/key.ts`
- Test: `src/music/key.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type PitchClass = number`（0–11，0 = C）
  - `type Mode = 'major' | 'minor'`
  - `interface Key { tonic: PitchClass; mode: Mode }`
  - `const SCALE_DEGREES: readonly ScaleDegree[]`
  - `type ScaleDegree = 'do'|'ra'|'re'|'me'|'mi'|'fa'|'fi'|'sol'|'le'|'la'|'te'|'ti'`
  - `const DEGREE_SEMITONES: Record<ScaleDegree, number>`
  - `doReference(key: Key): PitchClass`
  - `degreeToPitchClass(degree: ScaleDegree, key: Key): PitchClass`
  - `tonicDegree(key: Key): ScaleDegree`
  - `const MAJOR_SCALE_DEGREES: readonly ScaleDegree[]`
  - `const NATURAL_MINOR_DEGREES: readonly ScaleDegree[]`

- [ ] **Step 1: 写失败的测试**

`src/music/key.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  DEGREE_SEMITONES,
  SCALE_DEGREES,
  degreeToPitchClass,
  doReference,
  tonicDegree,
  type Key,
} from './key'

const C_MAJOR: Key = { tonic: 0, mode: 'major' }
const A_MINOR: Key = { tonic: 9, mode: 'minor' }
const E_MAJOR: Key = { tonic: 4, mode: 'major' }
const F_SHARP_MINOR: Key = { tonic: 6, mode: 'minor' }

describe('SCALE_DEGREES', () => {
  it('恰好覆盖 12 个音类，每个半音一个名字', () => {
    expect(SCALE_DEGREES).toHaveLength(12)
    const semitones = SCALE_DEGREES.map((d) => DEGREE_SEMITONES[d])
    expect([...semitones].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ])
  })
})

describe('doReference', () => {
  it('大调的 do 就是主音', () => {
    expect(doReference(C_MAJOR)).toBe(0)
    expect(doReference(E_MAJOR)).toBe(4)
  })

  it('小调用 la 基：do 落在关系大调主音上（主音上方小三度）', () => {
    // A 小调的关系大调是 C 大调，故 do = C = 0
    expect(doReference(A_MINOR)).toBe(0)
    // 升 F 小调的关系大调是 A 大调，故 do = A = 9
    expect(doReference(F_SHARP_MINOR)).toBe(9)
  })
})

describe('degreeToPitchClass', () => {
  it('C 大调：do=C, mi=E, sol=G, ti=B', () => {
    expect(degreeToPitchClass('do', C_MAJOR)).toBe(0)
    expect(degreeToPitchClass('mi', C_MAJOR)).toBe(4)
    expect(degreeToPitchClass('sol', C_MAJOR)).toBe(7)
    expect(degreeToPitchClass('ti', C_MAJOR)).toBe(11)
  })

  it('A 小调：la=A（主音）, do=C, mi=E', () => {
    expect(degreeToPitchClass('la', A_MINOR)).toBe(9)
    expect(degreeToPitchClass('do', A_MINOR)).toBe(0)
    expect(degreeToPitchClass('mi', A_MINOR)).toBe(4)
  })

  it('E 大调：sol=B, fa=A', () => {
    expect(degreeToPitchClass('sol', E_MAJOR)).toBe(11)
    expect(degreeToPitchClass('fa', E_MAJOR)).toBe(9)
  })

  it('结果始终落在 0–11', () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const mode of ['major', 'minor'] as const) {
        for (const degree of SCALE_DEGREES) {
          const pc = degreeToPitchClass(degree, { tonic, mode })
          expect(pc).toBeGreaterThanOrEqual(0)
          expect(pc).toBeLessThan(12)
        }
      }
    }
  })

  it('任意调下，12 个音级映射到 12 个互不相同的音类（属性测试）', () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const mode of ['major', 'minor'] as const) {
        const pcs = SCALE_DEGREES.map((d) => degreeToPitchClass(d, { tonic, mode }))
        expect(new Set(pcs).size).toBe(12)
      }
    }
  })
})

describe('tonicDegree', () => {
  it('大调主音是 do，小调主音是 la', () => {
    expect(tonicDegree(C_MAJOR)).toBe('do')
    expect(tonicDegree(A_MINOR)).toBe('la')
  })

  it('主音音级解析回该调的主音音类（属性测试）', () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const mode of ['major', 'minor'] as const) {
        const key: Key = { tonic, mode }
        expect(degreeToPitchClass(tonicDegree(key), key)).toBe(tonic)
      }
    }
  })
})
```

最后那个属性测试是本任务的核心保障：它同时验证 `doReference` 的小三度偏移与 `tonicDegree` 的一致性。任一处写错，它都会红。

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/music/key.test.ts`
Expected: FAIL — 无法解析模块 `./key`

- [ ] **Step 3: 写实现**

`src/music/key.ts`：

```ts
/** 音类，0–11，0 = C */
export type PitchClass = number

export type Mode = 'major' | 'minor'

export interface Key {
  tonic: PitchClass
  mode: Mode
}

/**
 * 首调音级名。12 个音类各一名。
 *
 * 注意：本枚举不处理语境相关拼写（半音 8 上行传统上称 si、下行称 le，
 * 此处统一为 le）。这是有意的——底层需要一个稳定的 key 供掌握度模型使用。
 * 显示层的语境相关拼写见 spec §15.1，在 T6 进入课程前解决。
 */
export const SCALE_DEGREES = [
  'do', 'ra', 're', 'me', 'mi', 'fa',
  'fi', 'sol', 'le', 'la', 'te', 'ti',
] as const

export type ScaleDegree = (typeof SCALE_DEGREES)[number]

/** 各音级相对 do 的半音数 */
export const DEGREE_SEMITONES: Record<ScaleDegree, number> = {
  do: 0, ra: 1, re: 2, me: 3, mi: 4, fa: 5,
  fi: 6, sol: 7, le: 8, la: 9, te: 10, ti: 11,
}

/** 大调音阶的七个音级 */
export const MAJOR_SCALE_DEGREES = [
  'do', 're', 'mi', 'fa', 'sol', 'la', 'ti',
] as const satisfies readonly ScaleDegree[]

/** 自然小调音阶的七个音级（la 基） */
export const NATURAL_MINOR_DEGREES = [
  'la', 'ti', 'do', 're', 'mi', 'fa', 'sol',
] as const satisfies readonly ScaleDegree[]

/**
 * 'do' 在该调中对应的音类。
 *
 * 大调：do 即主音。
 * 小调：采用 la 基唱名，主音是 la，故 do 落在主音上方小三度
 *       （即关系大调的主音）。
 */
export function doReference(key: Key): PitchClass {
  return key.mode === 'major' ? key.tonic : (key.tonic + 3) % 12
}

/** 某音级在该调中对应的音类 */
export function degreeToPitchClass(degree: ScaleDegree, key: Key): PitchClass {
  return (doReference(key) + DEGREE_SEMITONES[degree]) % 12
}

/** 该调主音对应的音级名 */
export function tonicDegree(key: Key): ScaleDegree {
  return key.mode === 'major' ? 'do' : 'la'
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/music/key.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(music): 调与首调音级，小调用 la 基"
```

---

### Task 4: 音级到 MIDI 的落位

音级只是音类，要发声必须落到具体八度。这一层决定「同一个音级在哪个音区响」，是 spec §6.2 音区变异轴的基础。

**Files:**
- Create: `src/music/register.ts`
- Test: `src/music/register.test.ts`

**Interfaces:**
- Consumes: `key.ts` 的 `Key`, `ScaleDegree`, `DEGREE_SEMITONES`, `doReference`, `tonicDegree`
- Produces:
  - `doMidiForKey(key: Key, centerMidi: number): number`
  - `degreeToMidi(degree: ScaleDegree, doMidi: number): number`
  - `tonicMidi(key: Key, doMidi: number): number`

- [ ] **Step 1: 写失败的测试**

`src/music/register.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { doMidiForKey, degreeToMidi, tonicMidi } from './register'
import { degreeToPitchClass, SCALE_DEGREES, type Key } from './key'

const C_MAJOR: Key = { tonic: 0, mode: 'major' }
const A_MINOR: Key = { tonic: 9, mode: 'minor' }

describe('doMidiForKey', () => {
  it('C 大调、中心 60 → do 落在 MIDI 60', () => {
    expect(doMidiForKey(C_MAJOR, 60)).toBe(60)
  })

  it('A 小调、中心 60 → do 是 C，落在 MIDI 60', () => {
    expect(doMidiForKey(A_MINOR, 60)).toBe(60)
  })

  it('落位的音类始终等于该调的 do', () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const mode of ['major', 'minor'] as const) {
        const key: Key = { tonic, mode }
        const midi = doMidiForKey(key, 60)
        expect(((midi % 12) + 12) % 12).toBe(degreeToPitchClass('do', key))
      }
    }
  })

  it('落位始终在中心音的半个八度以内', () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const center of [48, 60, 72]) {
        const midi = doMidiForKey({ tonic, mode: 'major' }, center)
        expect(Math.abs(midi - center)).toBeLessThanOrEqual(6)
      }
    }
  })
})

describe('degreeToMidi', () => {
  it('C 大调 do=60 时，mi=64、sol=67、ti=71', () => {
    expect(degreeToMidi('mi', 60)).toBe(64)
    expect(degreeToMidi('sol', 60)).toBe(67)
    expect(degreeToMidi('ti', 60)).toBe(71)
  })

  it('产出的 MIDI 音类与 degreeToPitchClass 一致（属性测试）', () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const mode of ['major', 'minor'] as const) {
        const key: Key = { tonic, mode }
        const doMidi = doMidiForKey(key, 60)
        for (const degree of SCALE_DEGREES) {
          const midi = degreeToMidi(degree, doMidi)
          expect(midi % 12).toBe(degreeToPitchClass(degree, key))
        }
      }
    }
  })
})

describe('tonicMidi', () => {
  it('大调主音等于 do', () => {
    expect(tonicMidi(C_MAJOR, 60)).toBe(60)
  })

  it('A 小调、do=60 时主音 la = MIDI 69', () => {
    expect(tonicMidi(A_MINOR, 60)).toBe(69)
  })
})
```

「落位始终在中心音半个八度以内」这条约束保证音区随机化时不会意外把某些调甩到极端音区。

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/music/register.test.ts`
Expected: FAIL — 无法解析模块 `./register`

- [ ] **Step 3: 写实现**

`src/music/register.ts`：

```ts
import {
  DEGREE_SEMITONES,
  doReference,
  tonicDegree,
  type Key,
  type ScaleDegree,
} from './key'

/**
 * 为某调选定 'do' 的具体 MIDI 落位：取离 centerMidi 最近的那个八度。
 * 这样换调时音区不会漂移，音区变异由 centerMidi 单独控制。
 */
export function doMidiForKey(key: Key, centerMidi: number): number {
  const pc = doReference(key)
  return Math.round((centerMidi - pc) / 12) * 12 + pc
}

/** 给定 'do' 的 MIDI 落位，求某音级的 MIDI */
export function degreeToMidi(degree: ScaleDegree, doMidi: number): number {
  return doMidi + DEGREE_SEMITONES[degree]
}

/** 给定 'do' 的 MIDI 落位，求该调主音的 MIDI */
export function tonicMidi(key: Key, doMidi: number): number {
  return degreeToMidi(tonicDegree(key), doMidi)
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/music/register.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(music): 音级到 MIDI 的八度落位"
```

---

### Task 5: 显示皮肤

spec §4.1 要求唱名/简谱/级数三种显示皮肤，底层同为一个 `ScaleDegree`。

**Files:**
- Create: `src/music/display.ts`
- Test: `src/music/display.test.ts`

**Interfaces:**
- Consumes: `key.ts` 的 `ScaleDegree`, `SCALE_DEGREES`
- Produces:
  - `type DisplayScheme = 'solfege' | 'numeric' | 'degree'`
  - `displayDegree(degree: ScaleDegree, scheme: DisplayScheme): string`

- [ ] **Step 1: 写失败的测试**

`src/music/display.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { displayDegree, type DisplayScheme } from './display'
import { SCALE_DEGREES } from './key'

const SCHEMES: DisplayScheme[] = ['solfege', 'numeric', 'degree']

describe('displayDegree', () => {
  it('唱名皮肤直接返回音级名', () => {
    expect(displayDegree('do', 'solfege')).toBe('do')
    expect(displayDegree('sol', 'solfege')).toBe('sol')
    expect(displayDegree('te', 'solfege')).toBe('te')
  })

  it('简谱皮肤用数字，变化音带升降号', () => {
    expect(displayDegree('do', 'numeric')).toBe('1')
    expect(displayDegree('mi', 'numeric')).toBe('3')
    expect(displayDegree('ti', 'numeric')).toBe('7')
    expect(displayDegree('te', 'numeric')).toBe('♭7')
    expect(displayDegree('fi', 'numeric')).toBe('♯4')
  })

  it('级数皮肤带脱字符前缀', () => {
    expect(displayDegree('do', 'degree')).toBe('^1')
    expect(displayDegree('la', 'degree')).toBe('^6')
    expect(displayDegree('me', 'degree')).toBe('♭^3')
  })

  it('每种皮肤下 12 个音级都有非空且互不相同的显示串', () => {
    for (const scheme of SCHEMES) {
      const labels = SCALE_DEGREES.map((d) => displayDegree(d, scheme))
      labels.forEach((l) => expect(l.length).toBeGreaterThan(0))
      expect(new Set(labels).size).toBe(12)
    }
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/music/display.test.ts`
Expected: FAIL — 无法解析模块 `./display`

- [ ] **Step 3: 写实现**

`src/music/display.ts`：

```ts
import type { ScaleDegree } from './key'

export type DisplayScheme = 'solfege' | 'numeric' | 'degree'

const NUMERIC: Record<ScaleDegree, string> = {
  do: '1', ra: '♭2', re: '2', me: '♭3', mi: '3', fa: '4',
  fi: '♯4', sol: '5', le: '♭6', la: '6', te: '♭7', ti: '7',
}

const DEGREE: Record<ScaleDegree, string> = {
  do: '^1', ra: '♭^2', re: '^2', me: '♭^3', mi: '^3', fa: '^4',
  fi: '♯^4', sol: '^5', le: '♭^6', la: '^6', te: '♭^7', ti: '^7',
}

/** 把音级渲染成当前皮肤下的显示字符串。切皮肤不影响任何逻辑与进度数据。 */
export function displayDegree(degree: ScaleDegree, scheme: DisplayScheme): string {
  switch (scheme) {
    case 'solfege':
      return degree
    case 'numeric':
      return NUMERIC[degree]
    case 'degree':
      return DEGREE[degree]
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/music/display.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(music): 唱名/简谱/级数三种显示皮肤"
```

---

### Task 6: 和弦

和弦以「根音音级 + 品质 + 转位」表达，全部相对 do。这样同一个 `Chord` 在任何调里都成立，与 spec §6.2 的换调变异轴天然兼容。

**Files:**
- Create: `src/music/chord.ts`
- Test: `src/music/chord.test.ts`

**Interfaces:**
- Consumes: `key.ts` 的 `Key`, `ScaleDegree`；`register.ts` 的 `degreeToMidi`
- Produces:
  - `type ChordQuality = 'maj'|'min'|'dim'|'aug'|'dom7'|'maj7'|'min7'|'halfDim7'`
  - `const QUALITY_INTERVALS: Record<ChordQuality, readonly number[]>`
  - `interface Chord { rootDegree: ScaleDegree; quality: ChordQuality; inversion: number }`
  - `chordToMidi(chord: Chord, doMidi: number): number[]`
  - `diatonicChord(key: Key, step: number, inversion?: number): Chord`

- [ ] **Step 1: 写失败的测试**

`src/music/chord.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { QUALITY_INTERVALS, chordToMidi, diatonicChord, type Chord } from './chord'
import type { Key } from './key'

const C_MAJOR: Key = { tonic: 0, mode: 'major' }
const A_MINOR: Key = { tonic: 9, mode: 'minor' }

describe('chordToMidi', () => {
  it('do 上的大三和弦、do=60 → [60, 64, 67]', () => {
    const chord: Chord = { rootDegree: 'do', quality: 'maj', inversion: 0 }
    expect(chordToMidi(chord, 60)).toEqual([60, 64, 67])
  })

  it('la 上的小三和弦、do=60 → [69, 72, 76]', () => {
    const chord: Chord = { rootDegree: 'la', quality: 'min', inversion: 0 }
    expect(chordToMidi(chord, 60)).toEqual([69, 72, 76])
  })

  it('sol 上的属七和弦 → [67, 71, 74, 77]', () => {
    const chord: Chord = { rootDegree: 'sol', quality: 'dom7', inversion: 0 }
    expect(chordToMidi(chord, 60)).toEqual([67, 71, 74, 77])
  })

  it('第一转位把根音升八度移到顶部', () => {
    const chord: Chord = { rootDegree: 'do', quality: 'maj', inversion: 1 }
    expect(chordToMidi(chord, 60)).toEqual([64, 67, 72])
  })

  it('第二转位再移一个', () => {
    const chord: Chord = { rootDegree: 'do', quality: 'maj', inversion: 2 }
    expect(chordToMidi(chord, 60)).toEqual([67, 72, 76])
  })

  it('转位不改变音类集合（属性测试）', () => {
    const base: Chord = { rootDegree: 'fa', quality: 'maj7', inversion: 0 }
    const pcs = (ms: number[]) => new Set(ms.map((m) => ((m % 12) + 12) % 12))
    const expected = pcs(chordToMidi(base, 60))
    for (const inversion of [1, 2, 3]) {
      expect(pcs(chordToMidi({ ...base, inversion }, 60))).toEqual(expected)
    }
  })

  it('音符始终按音高升序排列（属性测试）', () => {
    for (const quality of Object.keys(QUALITY_INTERVALS) as (keyof typeof QUALITY_INTERVALS)[]) {
      for (let inversion = 0; inversion < 4; inversion++) {
        const notes = chordToMidi({ rootDegree: 'do', quality, inversion }, 60)
        const sorted = [...notes].sort((a, b) => a - b)
        expect(notes).toEqual(sorted)
      }
    }
  })
})

describe('diatonicChord', () => {
  it('C 大调级数：I 大、ii 小、V 大、vii 减', () => {
    expect(diatonicChord(C_MAJOR, 1)).toEqual({ rootDegree: 'do', quality: 'maj', inversion: 0 })
    expect(diatonicChord(C_MAJOR, 2)).toEqual({ rootDegree: 're', quality: 'min', inversion: 0 })
    expect(diatonicChord(C_MAJOR, 5)).toEqual({ rootDegree: 'sol', quality: 'maj', inversion: 0 })
    expect(diatonicChord(C_MAJOR, 7)).toEqual({ rootDegree: 'ti', quality: 'dim', inversion: 0 })
  })

  it('A 小调级数（la 基）：i 小、III 大、iv 小、VI 大', () => {
    expect(diatonicChord(A_MINOR, 1)).toEqual({ rootDegree: 'la', quality: 'min', inversion: 0 })
    expect(diatonicChord(A_MINOR, 3)).toEqual({ rootDegree: 'do', quality: 'maj', inversion: 0 })
    expect(diatonicChord(A_MINOR, 4)).toEqual({ rootDegree: 're', quality: 'min', inversion: 0 })
    expect(diatonicChord(A_MINOR, 6)).toEqual({ rootDegree: 'fa', quality: 'maj', inversion: 0 })
  })

  it('小调 I 级的根音解析回该调主音', () => {
    const chord = diatonicChord(A_MINOR, 1)
    expect(chordToMidi(chord, 60)[0] % 12).toBe(9)
  })

  it('转位参数被透传', () => {
    expect(diatonicChord(C_MAJOR, 4, 1).inversion).toBe(1)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/music/chord.test.ts`
Expected: FAIL — 无法解析模块 `./chord`

- [ ] **Step 3: 写实现**

`src/music/chord.ts`：

```ts
import type { Key, ScaleDegree } from './key'
import { degreeToMidi } from './register'

export type ChordQuality =
  | 'maj' | 'min' | 'dim' | 'aug'
  | 'dom7' | 'maj7' | 'min7' | 'halfDim7'

/** 各品质自根音起的半音间隔 */
export const QUALITY_INTERVALS: Record<ChordQuality, readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  halfDim7: [0, 3, 6, 10],
}

export interface Chord {
  rootDegree: ScaleDegree
  quality: ChordQuality
  /** 转位数。0 = 原位。超过音数会取模。 */
  inversion: number
}

/** 大调各级的根音音级与品质（相对 do 表达） */
const MAJOR_DIATONIC: Record<number, { rootDegree: ScaleDegree; quality: ChordQuality }> = {
  1: { rootDegree: 'do', quality: 'maj' },
  2: { rootDegree: 're', quality: 'min' },
  3: { rootDegree: 'mi', quality: 'min' },
  4: { rootDegree: 'fa', quality: 'maj' },
  5: { rootDegree: 'sol', quality: 'maj' },
  6: { rootDegree: 'la', quality: 'min' },
  7: { rootDegree: 'ti', quality: 'dim' },
}

/** 自然小调各级（la 基，故根音音级相对 do 表达时从 la 起算） */
const MINOR_DIATONIC: Record<number, { rootDegree: ScaleDegree; quality: ChordQuality }> = {
  1: { rootDegree: 'la', quality: 'min' },
  2: { rootDegree: 'ti', quality: 'dim' },
  3: { rootDegree: 'do', quality: 'maj' },
  4: { rootDegree: 're', quality: 'min' },
  5: { rootDegree: 'mi', quality: 'min' },
  6: { rootDegree: 'fa', quality: 'maj' },
  7: { rootDegree: 'sol', quality: 'maj' },
}

/** 求该调第 step 级（1–7）的自然音和弦 */
export function diatonicChord(key: Key, step: number, inversion = 0): Chord {
  const table = key.mode === 'major' ? MAJOR_DIATONIC : MINOR_DIATONIC
  const entry = table[step]
  if (!entry) throw new Error(`级数必须在 1–7 之间，收到 ${step}`)
  return { ...entry, inversion }
}

/** 把和弦落到具体 MIDI 音高，返回升序数组 */
export function chordToMidi(chord: Chord, doMidi: number): number[] {
  const root = degreeToMidi(chord.rootDegree, doMidi)
  const intervals = QUALITY_INTERVALS[chord.quality]
  let notes = intervals.map((i) => root + i)
  const rotations = ((chord.inversion % notes.length) + notes.length) % notes.length
  for (let i = 0; i < rotations; i++) {
    notes = [...notes.slice(1), notes[0] + 12]
  }
  return notes
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/music/chord.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(music): 和弦、品质、转位与自然音级数"
```

---

### Task 7: 节奏型展开

节奏以拍为单位声明，展开时才乘以速度换成秒。分离这两者是为了让同一个节奏型能在任意速度下复用（spec §6.2 速度变异轴）。

**Files:**
- Create: `src/music/rhythm.ts`
- Test: `src/music/rhythm.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `interface Meter { beatsPerBar: number; beatUnit: 4 | 8 }`
  - `interface RhythmEvent { onsetBeats: number; durBeats: number; accent: boolean }`
  - `interface RhythmPattern { meter: Meter; bars: number; events: RhythmEvent[] }`
  - `beatsToSeconds(beats: number, bpm: number): number`
  - `interface TimedOnset { atSec: number; durSec: number; accent: boolean }`
  - `expandRhythm(pattern: RhythmPattern, bpm: number, startSec: number): TimedOnset[]`
  - `rhythmDurationSec(pattern: RhythmPattern, bpm: number): number`

- [ ] **Step 1: 写失败的测试**

`src/music/rhythm.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  beatsToSeconds,
  expandRhythm,
  rhythmDurationSec,
  type RhythmPattern,
} from './rhythm'

const FOUR_FOUR = { beatsPerBar: 4, beatUnit: 4 } as const

const QUARTERS: RhythmPattern = {
  meter: FOUR_FOUR,
  bars: 1,
  events: [
    { onsetBeats: 0, durBeats: 1, accent: true },
    { onsetBeats: 1, durBeats: 1, accent: false },
    { onsetBeats: 2, durBeats: 1, accent: false },
    { onsetBeats: 3, durBeats: 1, accent: false },
  ],
}

describe('beatsToSeconds', () => {
  it('120 BPM 下一拍是 0.5 秒', () => {
    expect(beatsToSeconds(1, 120)).toBeCloseTo(0.5, 10)
  })

  it('60 BPM 下四拍是 4 秒', () => {
    expect(beatsToSeconds(4, 60)).toBeCloseTo(4, 10)
  })
})

describe('expandRhythm', () => {
  it('120 BPM、起点 0：四个四分音符落在 0/0.5/1.0/1.5 秒', () => {
    const onsets = expandRhythm(QUARTERS, 120, 0)
    expect(onsets.map((o) => o.atSec)).toEqual([0, 0.5, 1, 1.5])
    expect(onsets.every((o) => o.durSec === 0.5)).toBe(true)
  })

  it('起点偏移原样加到每个事件上', () => {
    const onsets = expandRhythm(QUARTERS, 120, 2)
    expect(onsets.map((o) => o.atSec)).toEqual([2, 2.5, 3, 3.5])
  })

  it('保留重音标记', () => {
    const onsets = expandRhythm(QUARTERS, 120, 0)
    expect(onsets.map((o) => o.accent)).toEqual([true, false, false, false])
  })

  it('速度翻倍则全部时值减半（属性测试）', () => {
    const slow = expandRhythm(QUARTERS, 60, 0)
    const fast = expandRhythm(QUARTERS, 120, 0)
    slow.forEach((s, i) => {
      expect(fast[i].atSec).toBeCloseTo(s.atSec / 2, 10)
      expect(fast[i].durSec).toBeCloseTo(s.durSec / 2, 10)
    })
  })

  it('切分节奏的起点保持非整数拍位', () => {
    const synco: RhythmPattern = {
      meter: FOUR_FOUR,
      bars: 1,
      events: [
        { onsetBeats: 0, durBeats: 0.5, accent: true },
        { onsetBeats: 0.5, durBeats: 1, accent: true },
        { onsetBeats: 1.5, durBeats: 0.5, accent: false },
      ],
    }
    const onsets = expandRhythm(synco, 120, 0)
    expect(onsets.map((o) => o.atSec)).toEqual([0, 0.25, 0.75])
  })
})

describe('rhythmDurationSec', () => {
  it('时长按小节数与拍号算，而非按最后一个音符', () => {
    const sparse: RhythmPattern = {
      meter: FOUR_FOUR,
      bars: 2,
      events: [{ onsetBeats: 0, durBeats: 1, accent: true }],
    }
    // 2 小节 × 4 拍 × 0.5 秒
    expect(rhythmDurationSec(sparse, 120)).toBeCloseTo(4, 10)
  })
})
```

`rhythmDurationSec` 按小节算而不是按最后一个音符结束——否则以休止收尾的节奏型会被截短，语境 drone 也会跟着提前结束。

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/music/rhythm.test.ts`
Expected: FAIL — 无法解析模块 `./rhythm`

- [ ] **Step 3: 写实现**

`src/music/rhythm.ts`：

```ts
export interface Meter {
  beatsPerBar: number
  /** 以几分音符为一拍。4 = 四分音符，8 = 八分音符（复合拍） */
  beatUnit: 4 | 8
}

export interface RhythmEvent {
  /** 相对节奏型起点的拍位 */
  onsetBeats: number
  durBeats: number
  accent: boolean
}

export interface RhythmPattern {
  meter: Meter
  bars: number
  events: RhythmEvent[]
}

export interface TimedOnset {
  atSec: number
  durSec: number
  accent: boolean
}

/** bpm 定义为「每分钟多少个 meter.beatUnit 拍」 */
export function beatsToSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm
}

/** 把节奏型按给定速度展开成绝对时间事件 */
export function expandRhythm(
  pattern: RhythmPattern,
  bpm: number,
  startSec: number,
): TimedOnset[] {
  return pattern.events.map((e) => ({
    atSec: startSec + beatsToSeconds(e.onsetBeats, bpm),
    durSec: beatsToSeconds(e.durBeats, bpm),
    accent: e.accent,
  }))
}

/**
 * 节奏型的总时长，按小节数与拍号计算——不按最后一个音符的结束时间。
 * 否则以休止收尾的节奏型会被截短，覆盖其上的语境 drone 也会提前结束。
 */
export function rhythmDurationSec(pattern: RhythmPattern, bpm: number): number {
  return beatsToSeconds(pattern.bars * pattern.meter.beatsPerBar, bpm)
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/music/rhythm.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(music): 节奏型与按速度展开"
```

---

### Task 8: PlaybackPlan

`music/` 与 `audio/` 之间唯一的数据契约（spec §3.2、§4.2）。声明式，不含任何 Web Audio 概念。

**Files:**
- Create: `src/music/playback.ts`
- Test: `src/music/playback.test.ts`

**Interfaces:**
- Consumes: `pitch.ts` 的 `midiToFreq`
- Produces:
  - `type TimbreId = 'piano' | 'strings' | 'voice' | 'electronic'`
  - `interface PlaybackEvent { atSec: number; freqHz: number; durSec: number; timbreId: TimbreId; gain: number }`
  - `interface PlaybackPlan { events: PlaybackEvent[]; totalDurSec: number }`
  - `interface NoteSpec { midi: number; atSec: number; durSec: number; gain?: number }`
  - `notesToPlan(notes: NoteSpec[], timbreId: TimbreId): PlaybackPlan`
  - `mergePlans(...plans: PlaybackPlan[]): PlaybackPlan`
  - `emptyPlan(): PlaybackPlan`

`TimbreId` 定义在这里而非 `audio/`，因为 `PlaybackPlan` 需要引用它，而 `music/` 不得依赖 `audio/`。`audio/` 再据此提供具体合成参数。

- [ ] **Step 1: 写失败的测试**

`src/music/playback.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { emptyPlan, mergePlans, notesToPlan } from './playback'
import { midiToFreq } from './pitch'

describe('notesToPlan', () => {
  it('把音符转成事件，频率由 MIDI 换算', () => {
    const plan = notesToPlan([{ midi: 69, atSec: 0, durSec: 1 }], 'piano')
    expect(plan.events).toHaveLength(1)
    expect(plan.events[0].freqHz).toBeCloseTo(440, 6)
    expect(plan.events[0].timbreId).toBe('piano')
  })

  it('gain 缺省为 1', () => {
    const plan = notesToPlan([{ midi: 60, atSec: 0, durSec: 1 }], 'voice')
    expect(plan.events[0].gain).toBe(1)
  })

  it('显式 gain 被保留', () => {
    const plan = notesToPlan([{ midi: 60, atSec: 0, durSec: 1, gain: 0.3 }], 'voice')
    expect(plan.events[0].gain).toBe(0.3)
  })

  it('totalDurSec 是最后一个事件的结束时间', () => {
    const plan = notesToPlan(
      [
        { midi: 60, atSec: 0, durSec: 1 },
        { midi: 64, atSec: 2, durSec: 0.5 },
      ],
      'piano',
    )
    expect(plan.totalDurSec).toBeCloseTo(2.5, 10)
  })

  it('totalDurSec 取所有事件结束时间的最大值，与顺序无关', () => {
    const plan = notesToPlan(
      [
        { midi: 60, atSec: 0, durSec: 5 },
        { midi: 64, atSec: 1, durSec: 0.5 },
      ],
      'piano',
    )
    expect(plan.totalDurSec).toBeCloseTo(5, 10)
  })

  it('空数组产出空计划', () => {
    expect(notesToPlan([], 'piano')).toEqual({ events: [], totalDurSec: 0 })
  })
})

describe('mergePlans', () => {
  it('合并事件并按 atSec 升序排列', () => {
    const a = notesToPlan([{ midi: 60, atSec: 1, durSec: 1 }], 'piano')
    const b = notesToPlan([{ midi: 67, atSec: 0, durSec: 1 }], 'strings')
    const merged = mergePlans(a, b)
    expect(merged.events.map((e) => e.atSec)).toEqual([0, 1])
    expect(merged.events[0].timbreId).toBe('strings')
  })

  it('totalDurSec 取各计划的最大值', () => {
    const a = notesToPlan([{ midi: 60, atSec: 0, durSec: 1 }], 'piano')
    const b = notesToPlan([{ midi: 67, atSec: 0, durSec: 3 }], 'strings')
    expect(mergePlans(a, b).totalDurSec).toBeCloseTo(3, 10)
  })

  it('合并保留全部事件（属性测试）', () => {
    const a = notesToPlan(
      [
        { midi: 60, atSec: 0, durSec: 1 },
        { midi: 62, atSec: 1, durSec: 1 },
      ],
      'piano',
    )
    const b = notesToPlan([{ midi: 67, atSec: 0.5, durSec: 1 }], 'voice')
    expect(mergePlans(a, b).events).toHaveLength(3)
  })

  it('无参数时返回空计划', () => {
    expect(mergePlans()).toEqual({ events: [], totalDurSec: 0 })
  })

  it('不修改输入计划', () => {
    const a = notesToPlan([{ midi: 60, atSec: 0, durSec: 1 }], 'piano')
    const before = a.events.length
    mergePlans(a, emptyPlan())
    expect(a.events).toHaveLength(before)
  })
})
```

「不修改输入计划」这条要测——语境引擎会把语境计划和题目计划合并，如果 `mergePlans` 就地修改，重放同一道题会累积出重复音符。

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/music/playback.test.ts`
Expected: FAIL — 无法解析模块 `./playback`

- [ ] **Step 3: 写实现**

`src/music/playback.ts`：

```ts
import { midiToFreq } from './pitch'

/**
 * 音色标识。定义在 music/ 是因为 PlaybackPlan 需要引用它，
 * 而 music/ 不得依赖 audio/。具体合成参数由 audio/timbres.ts 提供。
 */
export type TimbreId = 'piano' | 'strings' | 'voice' | 'electronic'

export interface PlaybackEvent {
  atSec: number
  freqHz: number
  durSec: number
  timbreId: TimbreId
  gain: number
}

/**
 * music/ 与 audio/ 之间唯一的数据契约。
 * 声明式：描述「什么时刻、什么频率、什么音色、多长、多响」，不含任何播放机制。
 */
export interface PlaybackPlan {
  events: PlaybackEvent[]
  totalDurSec: number
}

export interface NoteSpec {
  midi: number
  atSec: number
  durSec: number
  gain?: number
}

export function emptyPlan(): PlaybackPlan {
  return { events: [], totalDurSec: 0 }
}

export function notesToPlan(notes: NoteSpec[], timbreId: TimbreId): PlaybackPlan {
  const events: PlaybackEvent[] = notes.map((n) => ({
    atSec: n.atSec,
    freqHz: midiToFreq(n.midi),
    durSec: n.durSec,
    timbreId,
    gain: n.gain ?? 1,
  }))
  return { events, totalDurSec: endOf(events) }
}

/** 合并多个计划。返回新对象，不修改任何输入。 */
export function mergePlans(...plans: PlaybackPlan[]): PlaybackPlan {
  const events = plans
    .flatMap((p) => p.events)
    .slice()
    .sort((a, b) => a.atSec - b.atSec)
  return { events, totalDurSec: endOf(events) }
}

function endOf(events: readonly PlaybackEvent[]): number {
  return events.reduce((max, e) => Math.max(max, e.atSec + e.durSec), 0)
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/music/playback.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(music): PlaybackPlan 数据契约"
```

---

### Task 9: 调性语境引擎

spec §6.1，本程序最重要的难度阶梯。L0–L4 五级语境强度。

**Files:**
- Create: `src/music/tonalContext.ts`
- Test: `src/music/tonalContext.test.ts`

**Interfaces:**
- Consumes: `key.ts` 的 `Key`；`chord.ts` 的 `Chord`, `chordToMidi`；`register.ts` 的 `tonicMidi`；`playback.ts` 的 `PlaybackPlan`, `TimbreId`, `notesToPlan`, `mergePlans`
- Produces:
  - `type ContextLevel = 0 | 1 | 2 | 3 | 4`
  - `interface TonalContextParams { key: Key; level: ContextLevel; timbreId: TimbreId; doMidi: number; itemDurSec: number }`
  - `interface TonalContextResult { plan: PlaybackPlan; leadInSec: number }`
  - `buildTonalContext(params: TonalContextParams): TonalContextResult`
  - `cadenceChords(key: Key): Chord[]`

- [ ] **Step 1: 写失败的测试**

`src/music/tonalContext.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildTonalContext, cadenceChords, type ContextLevel } from './tonalContext'
import { chordToMidi } from './chord'
import type { Key } from './key'

const C_MAJOR: Key = { tonic: 0, mode: 'major' }
const A_MINOR: Key = { tonic: 9, mode: 'minor' }

const base = { timbreId: 'piano', doMidi: 60, itemDurSec: 4 } as const

describe('cadenceChords', () => {
  it('大调用 ii–V–I', () => {
    const chords = cadenceChords(C_MAJOR)
    expect(chords.map((c) => c.rootDegree)).toEqual(['re', 'sol', 'do'])
    expect(chords.map((c) => c.quality)).toEqual(['min', 'maj', 'maj'])
  })

  it('小调用 iv–V–i，且 V 为大三（和声小调的升 7 级）', () => {
    const chords = cadenceChords(A_MINOR)
    expect(chords.map((c) => c.rootDegree)).toEqual(['re', 'mi', 'la'])
    expect(chords.map((c) => c.quality)).toEqual(['min', 'maj', 'min'])
  })

  it('小调终止式的 V 含升 7 级（G♯ = 音类 8）', () => {
    const v = cadenceChords(A_MINOR)[1]
    const pcs = chordToMidi(v, 60).map((m) => ((m % 12) + 12) % 12)
    expect(pcs).toContain(8)
  })

  it('终止式最后一个和弦落在主音上', () => {
    for (const key of [C_MAJOR, A_MINOR]) {
      const last = cadenceChords(key)
      const rootPc = chordToMidi(last[last.length - 1], 60)[0] % 12
      expect(rootPc).toBe(key.tonic)
    }
  })
})

describe('buildTonalContext', () => {
  it('L0 播三个和弦，leadIn 最长', () => {
    const r = buildTonalContext({ ...base, key: C_MAJOR, level: 0 })
    // 三个三和弦，每个 3 个音
    expect(r.plan.events).toHaveLength(9)
    expect(r.leadInSec).toBeGreaterThan(1.5)
  })

  it('L1 只播两个和弦，leadIn 短于 L0', () => {
    const l0 = buildTonalContext({ ...base, key: C_MAJOR, level: 0 })
    const l1 = buildTonalContext({ ...base, key: C_MAJOR, level: 1 })
    expect(l1.plan.events).toHaveLength(6)
    expect(l1.leadInSec).toBeLessThan(l0.leadInSec)
  })

  it('L2 是单个持续低音，覆盖整道题', () => {
    const r = buildTonalContext({ ...base, key: C_MAJOR, level: 2 })
    expect(r.plan.events).toHaveLength(1)
    expect(r.plan.events[0].durSec).toBeGreaterThanOrEqual(base.itemDurSec)
  })

  it('L3 只在开头给一次主音，且远短于题目时长', () => {
    const r = buildTonalContext({ ...base, key: C_MAJOR, level: 3 })
    expect(r.plan.events).toHaveLength(1)
    expect(r.plan.events[0].durSec).toBeLessThan(base.itemDurSec / 2)
  })

  it('L4 的低音在题目中途撤走', () => {
    const r = buildTonalContext({ ...base, key: C_MAJOR, level: 4 })
    expect(r.plan.events).toHaveLength(1)
    const endSec = r.plan.events[0].atSec + r.plan.events[0].durSec
    const itemEndSec = r.leadInSec + base.itemDurSec
    expect(endSec).toBeGreaterThan(r.leadInSec)
    expect(endSec).toBeLessThan(itemEndSec)
  })

  it('语境提供的音类数量随等级单调不增（属性测试）', () => {
    const levels: ContextLevel[] = [0, 1, 2, 3, 4]
    const counts = levels.map((level) => {
      const r = buildTonalContext({ ...base, key: C_MAJOR, level })
      const pcs = new Set(
        r.plan.events.map((e) => {
          const midi = Math.round(69 + 12 * Math.log2(e.freqHz / 440))
          return ((midi % 12) + 12) % 12
        }),
      )
      return pcs.size
    })
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1])
    }
  })

  it('L4 的低音短于 L2 的低音（同一题目时长下）', () => {
    const l2 = buildTonalContext({ ...base, key: C_MAJOR, level: 2 })
    const l4 = buildTonalContext({ ...base, key: C_MAJOR, level: 4 })
    expect(l4.plan.events[0].durSec).toBeLessThan(l2.plan.events[0].durSec)
  })

  it('所有语境的第一个事件都在 leadIn 之前开始（属性测试）', () => {
    const levels: ContextLevel[] = [0, 1, 2, 3, 4]
    for (const level of levels) {
      for (const key of [C_MAJOR, A_MINOR]) {
        const r = buildTonalContext({ ...base, key, level })
        expect(r.plan.events[0].atSec).toBeLessThan(r.leadInSec)
      }
    }
  })

  it('L2–L4 的低音音高就是该调主音（属性测试）', () => {
    const levels: ContextLevel[] = [2, 3, 4]
    for (const level of levels) {
      for (const key of [C_MAJOR, A_MINOR]) {
        const r = buildTonalContext({ ...base, key, level })
        // 由频率反解 MIDI
        const midi = Math.round(69 + 12 * Math.log2(r.plan.events[0].freqHz / 440))
        expect(((midi % 12) + 12) % 12).toBe(key.tonic)
      }
    }
  })

  it('语境时长随题目时长伸缩（L2）', () => {
    const short = buildTonalContext({ ...base, key: C_MAJOR, level: 2, itemDurSec: 2 })
    const long = buildTonalContext({ ...base, key: C_MAJOR, level: 2, itemDurSec: 8 })
    expect(long.plan.events[0].durSec).toBeGreaterThan(short.plan.events[0].durSec)
  })
})
```

「音类数量单调不增」这条属性测试锁住了整条难度阶梯的方向性。用音类数量而非 `leadInSec` 作为指标是有意的：`leadInSec` 并不单调（L3 要给主音留出发声时间，故其 leadIn 反而长于 L2 的 drone），但**语境提供的调性信息量**确实单调递减——L0 给出 7 个音类，L1 给 5 个，L2–L4 只给主音一个。这才是「语境强度」的真实含义。

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/music/tonalContext.test.ts`
Expected: FAIL — 无法解析模块 `./tonalContext`

- [ ] **Step 3: 写实现**

`src/music/tonalContext.ts`：

```ts
import { chordToMidi, type Chord } from './chord'
import type { Key } from './key'
import {
  mergePlans,
  notesToPlan,
  type PlaybackPlan,
  type TimbreId,
} from './playback'
import { tonicMidi } from './register'

/** 语境强度。spec §6.1：L0 最强（完整终止式）→ L4 最弱（中途撤走）。 */
export type ContextLevel = 0 | 1 | 2 | 3 | 4

export interface TonalContextParams {
  key: Key
  level: ContextLevel
  timbreId: TimbreId
  /** 'do' 的 MIDI 落位 */
  doMidi: number
  /** 题目内容本身的时长，语境需据此伸缩 */
  itemDurSec: number
}

export interface TonalContextResult {
  plan: PlaybackPlan
  /** 从计划起点到题目内容应当开始的时刻 */
  leadInSec: number
}

const CHORD_DUR_SEC = 0.55
const GAP_SEC = 0.35
const DRONE_LEAD_SEC = 0.5
const TONIC_BLIP_DUR_SEC = 0.7
const TONIC_BLIP_LEAD_SEC = 1.0
/** L4：低音覆盖题目的前 40% 后撤走 */
const L4_COVERAGE = 0.4
const CONTEXT_GAIN = 0.5
const DRONE_GAIN = 0.35

/**
 * 该调的终止式。
 * 大调用 ii–V–I。小调用 iv–V–i，其中 V 强制为大三——自然小调的 v 是小三，
 * 缺少导音就建立不起调中心，这正是终止式存在的意义。
 */
export function cadenceChords(key: Key): Chord[] {
  if (key.mode === 'major') {
    return [
      { rootDegree: 're', quality: 'min', inversion: 0 },
      { rootDegree: 'sol', quality: 'maj', inversion: 0 },
      { rootDegree: 'do', quality: 'maj', inversion: 0 },
    ]
  }
  return [
    { rootDegree: 're', quality: 'min', inversion: 0 },
    { rootDegree: 'mi', quality: 'maj', inversion: 0 },
    { rootDegree: 'la', quality: 'min', inversion: 0 },
  ]
}

export function buildTonalContext(params: TonalContextParams): TonalContextResult {
  const { key, level, timbreId, doMidi, itemDurSec } = params

  switch (level) {
    case 0:
      return buildCadence(cadenceChords(key), doMidi, timbreId)
    case 1:
      return buildCadence(cadenceChords(key).slice(1), doMidi, timbreId)
    case 2:
      return buildDrone(key, doMidi, timbreId, DRONE_LEAD_SEC + itemDurSec)
    case 3:
      return buildBlip(key, doMidi, timbreId)
    case 4:
      return buildDrone(
        key,
        doMidi,
        timbreId,
        DRONE_LEAD_SEC + itemDurSec * L4_COVERAGE,
      )
  }
}

function buildCadence(
  chords: Chord[],
  doMidi: number,
  timbreId: TimbreId,
): TonalContextResult {
  const plans = chords.map((chord, i) => {
    const atSec = i * CHORD_DUR_SEC
    const notes = chordToMidi(chord, doMidi).map((midi) => ({
      midi,
      atSec,
      durSec: CHORD_DUR_SEC,
      gain: CONTEXT_GAIN,
    }))
    return notesToPlan(notes, timbreId)
  })
  return {
    plan: mergePlans(...plans),
    leadInSec: chords.length * CHORD_DUR_SEC + GAP_SEC,
  }
}

function buildDrone(
  key: Key,
  doMidi: number,
  timbreId: TimbreId,
  durSec: number,
): TonalContextResult {
  // 降一个八度，让低音托住而不与题目音高打架
  const midi = tonicMidi(key, doMidi) - 12
  return {
    plan: notesToPlan([{ midi, atSec: 0, durSec, gain: DRONE_GAIN }], timbreId),
    leadInSec: DRONE_LEAD_SEC,
  }
}

function buildBlip(key: Key, doMidi: number, timbreId: TimbreId): TonalContextResult {
  const midi = tonicMidi(key, doMidi) - 12
  return {
    plan: notesToPlan(
      [{ midi, atSec: 0, durSec: TONIC_BLIP_DUR_SEC, gain: DRONE_GAIN }],
      timbreId,
    ),
    leadInSec: TONIC_BLIP_LEAD_SEC,
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/music/tonalContext.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(music): 调性语境引擎 L0–L4"
```

---

### Task 10: 音色库

spec §6.2 要求 ≥4 种可区分音色，全部合成，零外部资源。音色定义是纯数据，故仍可单测。

**Files:**
- Create: `src/audio/timbres.ts`
- Test: `src/audio/timbres.test.ts`

**Interfaces:**
- Consumes: `music/playback.ts` 的 `TimbreId`
- Produces:
  - `interface Partial { ratio: number; gain: number }`
  - `interface Envelope { attackSec: number; decaySec: number; sustain: number; releaseSec: number }`
  - `interface TimbreDef { id: TimbreId; partials: Partial[]; env: Envelope; oscType: OscillatorType }`
  - `const TIMBRES: Record<TimbreId, TimbreDef>`
  - `const TIMBRE_IDS: readonly TimbreId[]`

- [ ] **Step 1: 写失败的测试**

`src/audio/timbres.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { TIMBRES, TIMBRE_IDS } from './timbres'

describe('TIMBRES', () => {
  it('提供至少 4 种音色', () => {
    expect(TIMBRE_IDS.length).toBeGreaterThanOrEqual(4)
  })

  it('每个 id 与它的 key 一致', () => {
    for (const id of TIMBRE_IDS) {
      expect(TIMBRES[id].id).toBe(id)
    }
  })

  it('每种音色至少有一个分音，且基频分音存在', () => {
    for (const id of TIMBRE_IDS) {
      const { partials } = TIMBRES[id]
      expect(partials.length).toBeGreaterThan(0)
      expect(partials.some((p) => p.ratio === 1)).toBe(true)
    }
  })

  it('分音增益之和不超过 1，避免叠加后削波', () => {
    for (const id of TIMBRE_IDS) {
      const sum = TIMBRES[id].partials.reduce((s, p) => s + p.gain, 0)
      expect(sum).toBeLessThanOrEqual(1)
    }
  })

  it('包络参数全部非负，sustain 在 0–1 之间', () => {
    for (const id of TIMBRE_IDS) {
      const { env } = TIMBRES[id]
      expect(env.attackSec).toBeGreaterThanOrEqual(0)
      expect(env.decaySec).toBeGreaterThanOrEqual(0)
      expect(env.releaseSec).toBeGreaterThanOrEqual(0)
      expect(env.sustain).toBeGreaterThanOrEqual(0)
      expect(env.sustain).toBeLessThanOrEqual(1)
    }
  })

  it('钢琴类起音快、延音低；弦乐类起音慢、延音高', () => {
    expect(TIMBRES.piano.env.attackSec).toBeLessThan(TIMBRES.strings.env.attackSec)
    expect(TIMBRES.piano.env.sustain).toBeLessThan(TIMBRES.strings.env.sustain)
  })

  it('四种音色的分音结构互不相同（否则变异轴无效）', () => {
    const signatures = TIMBRE_IDS.map((id) =>
      JSON.stringify(TIMBRES[id].partials),
    )
    expect(new Set(signatures).size).toBe(TIMBRE_IDS.length)
  })
})
```

最后一条不是形式主义：音色是 spec §6.2 的一个变异轴，如果四种音色实际听起来一样，这个轴就是假的，抗特异性训练也就落空了。

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/audio/timbres.test.ts`
Expected: FAIL — 无法解析模块 `./timbres`

- [ ] **Step 3: 写实现**

`src/audio/timbres.ts`：

```ts
import type { TimbreId } from '../music/playback'

export interface Partial {
  /** 相对基频的倍数 */
  ratio: number
  gain: number
}

export interface Envelope {
  attackSec: number
  decaySec: number
  /** 衰减后维持的电平，0–1 */
  sustain: number
  releaseSec: number
}

export interface TimbreDef {
  id: TimbreId
  partials: Partial[]
  env: Envelope
  oscType: OscillatorType
}

export const TIMBRE_IDS: readonly TimbreId[] = [
  'piano',
  'strings',
  'voice',
  'electronic',
]

/**
 * 加法合成音色。全部由振荡器叠加而成，无外部音频资源（spec §6.2）。
 * 分音增益之和 ≤ 1，避免叠加削波。
 */
export const TIMBRES: Record<TimbreId, TimbreDef> = {
  // 起音快、无延音、泛音随次数快速衰减
  piano: {
    id: 'piano',
    oscType: 'sine',
    partials: [
      { ratio: 1, gain: 0.5 },
      { ratio: 2, gain: 0.22 },
      { ratio: 3, gain: 0.12 },
      { ratio: 4, gain: 0.06 },
    ],
    env: { attackSec: 0.004, decaySec: 1.6, sustain: 0.02, releaseSec: 0.3 },
  },
  // 起音慢、延音高、奇偶泛音都在
  strings: {
    id: 'strings',
    oscType: 'sine',
    partials: [
      { ratio: 1, gain: 0.42 },
      { ratio: 2, gain: 0.2 },
      { ratio: 3, gain: 0.16 },
      { ratio: 4, gain: 0.1 },
      { ratio: 5, gain: 0.06 },
    ],
    env: { attackSec: 0.16, decaySec: 0.3, sustain: 0.75, releaseSec: 0.45 },
  },
  // 低次泛音重、高次弱，中等起音
  voice: {
    id: 'voice',
    oscType: 'sine',
    partials: [
      { ratio: 1, gain: 0.55 },
      { ratio: 2, gain: 0.24 },
      { ratio: 3, gain: 0.13 },
      { ratio: 5, gain: 0.05 },
    ],
    env: { attackSec: 0.07, decaySec: 0.2, sustain: 0.6, releaseSec: 0.25 },
  },
  // 方波基底 + 少量高次，听感明显偏电子
  electronic: {
    id: 'electronic',
    oscType: 'square',
    partials: [
      { ratio: 1, gain: 0.34 },
      { ratio: 2, gain: 0.16 },
      { ratio: 6, gain: 0.08 },
    ],
    env: { attackSec: 0.01, decaySec: 0.12, sustain: 0.5, releaseSec: 0.12 },
  },
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/audio/timbres.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(audio): 四种合成音色定义"
```

---

### Task 11: PlaybackPlan 到声部的纯函数转换

把「计划 → 该创建哪些振荡器、各自何时开何时关」这一步抽成纯函数，使播放调度逻辑不依赖浏览器即可单测。Web Audio 节点创建留给下一个任务。

**Files:**
- Create: `src/audio/voices.ts`
- Test: `src/audio/voices.test.ts`

**Interfaces:**
- Consumes: `music/playback.ts` 的 `PlaybackPlan`；`audio/timbres.ts` 的 `TimbreDef`, `TIMBRES`
- Produces:
  - `interface Voice { startSec: number; stopSec: number; freqHz: number; gain: number; timbre: TimbreDef }`
  - `planToVoices(plan: PlaybackPlan, startSec: number): Voice[]`
  - `planEndSec(plan: PlaybackPlan, startSec: number): number`

- [ ] **Step 1: 写失败的测试**

`src/audio/voices.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { planEndSec, planToVoices } from './voices'
import { notesToPlan } from '../music/playback'
import { TIMBRES } from './timbres'

const PLAN = notesToPlan(
  [
    { midi: 60, atSec: 0, durSec: 1 },
    { midi: 64, atSec: 1, durSec: 0.5 },
  ],
  'piano',
)

describe('planToVoices', () => {
  it('每个事件产生一个声部', () => {
    expect(planToVoices(PLAN, 0)).toHaveLength(2)
  })

  it('起点偏移加到每个声部上', () => {
    const voices = planToVoices(PLAN, 10)
    expect(voices[0].startSec).toBeCloseTo(10, 10)
    expect(voices[1].startSec).toBeCloseTo(11, 10)
  })

  it('stopSec 在事件时值之外还留出释音时间', () => {
    const voices = planToVoices(PLAN, 0)
    const release = TIMBRES.piano.env.releaseSec
    expect(voices[0].stopSec).toBeCloseTo(1 + release, 10)
  })

  it('声部携带对应的音色定义', () => {
    expect(planToVoices(PLAN, 0)[0].timbre).toBe(TIMBRES.piano)
  })

  it('频率与增益原样透传', () => {
    const plan = notesToPlan([{ midi: 69, atSec: 0, durSec: 1, gain: 0.4 }], 'voice')
    const v = planToVoices(plan, 0)[0]
    expect(v.freqHz).toBeCloseTo(440, 6)
    expect(v.gain).toBe(0.4)
  })

  it('stopSec 始终晚于 startSec（属性测试）', () => {
    for (const timbreId of ['piano', 'strings', 'voice', 'electronic'] as const) {
      const plan = notesToPlan([{ midi: 60, atSec: 0, durSec: 0.01 }], timbreId)
      const v = planToVoices(plan, 0)[0]
      expect(v.stopSec).toBeGreaterThan(v.startSec)
    }
  })

  it('空计划产生零个声部', () => {
    expect(planToVoices({ events: [], totalDurSec: 0 }, 0)).toEqual([])
  })
})

describe('planEndSec', () => {
  it('返回最晚声部的停止时刻', () => {
    const end = planEndSec(PLAN, 0)
    expect(end).toBeCloseTo(1.5 + TIMBRES.piano.env.releaseSec, 10)
  })

  it('空计划的结束时刻等于起点', () => {
    expect(planEndSec({ events: [], totalDurSec: 0 }, 5)).toBe(5)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/audio/voices.test.ts`
Expected: FAIL — 无法解析模块 `./voices`

- [ ] **Step 3: 写实现**

`src/audio/voices.ts`：

```ts
import type { PlaybackPlan } from '../music/playback'
import { TIMBRES, type TimbreDef } from './timbres'

export interface Voice {
  startSec: number
  /** 振荡器停止时刻，已含释音尾巴 */
  stopSec: number
  freqHz: number
  gain: number
  timbre: TimbreDef
}

/**
 * 把计划翻译成待创建的声部。纯函数——不触碰任何 Web Audio API，
 * 因此播放调度逻辑可以在 Node 下完整单测。
 */
export function planToVoices(plan: PlaybackPlan, startSec: number): Voice[] {
  return plan.events.map((e) => {
    const timbre = TIMBRES[e.timbreId]
    return {
      startSec: startSec + e.atSec,
      stopSec: startSec + e.atSec + e.durSec + timbre.env.releaseSec,
      freqHz: e.freqHz,
      gain: e.gain,
      timbre,
    }
  })
}

/** 整个计划实际发完声的时刻（含释音） */
export function planEndSec(plan: PlaybackPlan, startSec: number): number {
  return planToVoices(plan, startSec).reduce(
    (max, v) => Math.max(max, v.stopSec),
    startSec,
  )
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/audio/voices.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(audio): PlaybackPlan 到声部的纯函数转换"
```

---

### Task 12: AudioEngine

唯一接触 Web Audio API 的地方。它不懂乐理，只执行声部清单。

**Files:**
- Create: `src/audio/AudioEngine.ts`
- Test: `src/audio/AudioEngine.test.ts`

**Interfaces:**
- Consumes: `audio/voices.ts` 的 `planToVoices`, `planEndSec`, `Voice`；`music/playback.ts` 的 `PlaybackPlan`
- Produces:
  - `class AudioEngine`
    - `constructor(ctx: AudioContext)`
    - `get currentTime(): number`
    - `resume(): Promise<void>`
    - `play(plan: PlaybackPlan, delaySec?: number): { startSec: number; endSec: number }`
    - `stopAll(): void`
    - `dispose(): void`
  - `createAudioEngine(): AudioEngine`

- [ ] **Step 1: 写失败的测试**

`src/audio/AudioEngine.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine } from './AudioEngine'
import { notesToPlan } from '../music/playback'

/** 记录所有创建过的节点与调用，供断言用 */
function makeFakeContext() {
  const created = { oscillators: [] as any[], gains: [] as any[] }
  let now = 0

  const makeParam = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  })

  const ctx = {
    state: 'running' as AudioContextState,
    get currentTime() {
      return now
    },
    destination: { name: 'destination' },
    resume: vi.fn(async () => {
      ctx.state = 'running'
    }),
    close: vi.fn(async () => {}),
    createOscillator: vi.fn(() => {
      const osc = {
        type: 'sine' as OscillatorType,
        frequency: makeParam(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as null | (() => void),
      }
      created.oscillators.push(osc)
      return osc
    }),
    createGain: vi.fn(() => {
      const gain = {
        gain: makeParam(),
        connect: vi.fn(),
        disconnect: vi.fn(),
      }
      created.gains.push(gain)
      return gain
    }),
  }

  return { ctx: ctx as unknown as AudioContext, created, setNow: (t: number) => (now = t) }
}

describe('AudioEngine', () => {
  let fake: ReturnType<typeof makeFakeContext>
  let engine: AudioEngine

  beforeEach(() => {
    fake = makeFakeContext()
    engine = new AudioEngine(fake.ctx)
  })

  it('currentTime 取自 AudioContext，而非 Date.now()', () => {
    fake.setNow(12.5)
    expect(engine.currentTime).toBe(12.5)
  })

  it('为每个分音创建一个振荡器', () => {
    // piano 有 4 个分音，两个音符 → 8 个振荡器
    const plan = notesToPlan(
      [
        { midi: 60, atSec: 0, durSec: 1 },
        { midi: 64, atSec: 1, durSec: 1 },
      ],
      'piano',
    )
    engine.play(plan)
    expect(fake.created.oscillators).toHaveLength(8)
  })

  it('振荡器的启停时刻基于 AudioContext 时钟加上延迟', () => {
    fake.setNow(100)
    const plan = notesToPlan([{ midi: 60, atSec: 0, durSec: 1 }], 'electronic')
    const { startSec } = engine.play(plan, 0.2)
    expect(startSec).toBeCloseTo(100.2, 6)
    for (const osc of fake.created.oscillators) {
      expect(osc.start).toHaveBeenCalledWith(expect.closeTo(100.2, 6))
    }
  })

  it('分音频率是基频的对应倍数', () => {
    const plan = notesToPlan([{ midi: 69, atSec: 0, durSec: 1 }], 'electronic')
    engine.play(plan)
    // electronic 的分音倍数是 1、2、6
    const freqs = fake.created.oscillators.map(
      (o: any) => o.frequency.setValueAtTime.mock.calls[0][0],
    )
    expect(freqs[0]).toBeCloseTo(440, 4)
    expect(freqs[1]).toBeCloseTo(880, 4)
    expect(freqs[2]).toBeCloseTo(2640, 4)
  })

  it('返回的 endSec 覆盖整个计划含释音', () => {
    fake.setNow(0)
    const plan = notesToPlan([{ midi: 60, atSec: 0, durSec: 1 }], 'piano')
    const { endSec } = engine.play(plan, 0)
    expect(endSec).toBeGreaterThan(1)
  })

  it('stopAll 断开所有已创建节点', () => {
    const plan = notesToPlan([{ midi: 60, atSec: 0, durSec: 1 }], 'voice')
    engine.play(plan)
    engine.stopAll()
    for (const osc of fake.created.oscillators) {
      expect(osc.disconnect).toHaveBeenCalled()
    }
  })

  it('stopAll 后再 play 仍然工作', () => {
    const plan = notesToPlan([{ midi: 60, atSec: 0, durSec: 1 }], 'voice')
    engine.play(plan)
    engine.stopAll()
    const before = fake.created.oscillators.length
    engine.play(plan)
    expect(fake.created.oscillators.length).toBeGreaterThan(before)
  })

  it('resume 在 context 挂起时调用 ctx.resume', async () => {
    ;(fake.ctx as any).state = 'suspended'
    await engine.resume()
    expect(fake.ctx.resume).toHaveBeenCalled()
  })

  it('播放空计划不创建任何节点也不抛错', () => {
    expect(() => engine.play({ events: [], totalDurSec: 0 })).not.toThrow()
    expect(fake.created.oscillators).toHaveLength(0)
  })
})
```

用假 `AudioContext` 而不是真的：本任务要验证的是**调度正确性**（时刻、频率、节点数量），这些用真 context 反而测不了。实际听感由 Task 13 的人工验证覆盖。

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/audio/AudioEngine.test.ts`
Expected: FAIL — 无法解析模块 `./AudioEngine`

- [ ] **Step 3: 写实现**

`src/audio/AudioEngine.ts`：

```ts
import type { PlaybackPlan } from '../music/playback'
import { planEndSec, planToVoices, type Voice } from './voices'

/** 总输出衰减，避免多声部叠加削波 */
const MASTER_GAIN = 0.6
const DEFAULT_DELAY_SEC = 0.12

/**
 * 唯一接触 Web Audio API 的地方。它不懂乐理，只执行 PlaybackPlan。
 * 所有时刻均基于 ctx.currentTime——绝不使用 Date.now()（spec §11）。
 */
export class AudioEngine {
  private active: { disconnect(): void }[] = []

  constructor(private readonly ctx: AudioContext) {}

  get currentTime(): number {
    return this.ctx.currentTime
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') {
      await this.ctx.resume()
    }
  }

  play(
    plan: PlaybackPlan,
    delaySec: number = DEFAULT_DELAY_SEC,
  ): { startSec: number; endSec: number } {
    const startSec = this.ctx.currentTime + delaySec
    for (const voice of planToVoices(plan, startSec)) {
      this.spawn(voice)
    }
    return { startSec, endSec: planEndSec(plan, startSec) }
  }

  stopAll(): void {
    for (const node of this.active) {
      try {
        node.disconnect()
      } catch {
        // 节点可能已自行结束并断开，忽略
      }
    }
    this.active = []
  }

  dispose(): void {
    this.stopAll()
    void this.ctx.close()
  }

  private spawn(voice: Voice): void {
    const { env } = voice.timbre
    const amp = this.ctx.createGain()
    amp.connect(this.ctx.destination)
    this.active.push(amp)

    const peak = voice.gain * MASTER_GAIN
    const sustainLevel = peak * env.sustain
    const attackEnd = voice.startSec + env.attackSec
    const decayEnd = attackEnd + env.decaySec
    const releaseStart = Math.max(voice.stopSec - env.releaseSec, decayEnd)

    amp.gain.setValueAtTime(0, voice.startSec)
    amp.gain.linearRampToValueAtTime(peak, attackEnd)
    amp.gain.linearRampToValueAtTime(sustainLevel, decayEnd)
    amp.gain.setValueAtTime(sustainLevel, releaseStart)
    amp.gain.linearRampToValueAtTime(0, voice.stopSec)

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
      osc.onended = () => {
        try {
          osc.disconnect()
          partialGain.disconnect()
        } catch {
          // 已断开，忽略
        }
      }
    }
  }
}

/**
 * 创建引擎。必须在用户手势的调用栈内调用——iOS Safari 要求
 * AudioContext 由用户手势启动（spec §11）。
 */
export function createAudioEngine(): AudioEngine {
  const Ctor: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!Ctor) {
    throw new Error('此浏览器不支持 Web Audio，无法播放。')
  }
  return new AudioEngine(new Ctor())
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/audio/AudioEngine.test.ts`
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
git commit -m "feat(audio): Web Audio 播放引擎"
```

---

### Task 13: 手机验证页

本计划的验收物。把前面所有东西接起来：随机调、随机音色、L0–L4 五级语境、一个真实音级题。**目的是用耳朵判断「这套合成音在手机上到底能不能听」**——这是 P-1 存在的理由。

**Files:**
- Create: `src/dev/buildDegreeProbe.ts`
- Create: `src/ui/DevHarness.tsx`
- Modify: `src/ui/App.tsx`
- Test: `src/dev/buildDegreeProbe.test.ts`

**Interfaces:**
- Consumes: 前十二个任务的全部产物
- Produces:
  - `interface DegreeProbe { plan: PlaybackPlan; key: Key; degree: ScaleDegree; timbreId: TimbreId; level: ContextLevel }`
  - `buildDegreeProbe(seed: number, level: ContextLevel): DegreeProbe`

- [ ] **Step 1: 写失败的测试**

`src/dev/buildDegreeProbe.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildDegreeProbe } from './buildDegreeProbe'
import { MAJOR_SCALE_DEGREES, degreeToPitchClass } from '../music/key'
import type { ContextLevel } from '../music/tonalContext'

const LEVELS: ContextLevel[] = [0, 1, 2, 3, 4]

describe('buildDegreeProbe', () => {
  it('同一 seed 与等级产出完全相同的题目', () => {
    const a = buildDegreeProbe(777, 0)
    const b = buildDegreeProbe(777, 0)
    expect(a).toEqual(b)
  })

  it('不同 seed 通常产出不同的题目', () => {
    const probes = Array.from({ length: 20 }, (_, i) => buildDegreeProbe(i, 0))
    const signatures = probes.map((p) => `${p.key.tonic}-${p.degree}-${p.timbreId}`)
    expect(new Set(signatures).size).toBeGreaterThan(1)
  })

  it('目标音级取自大调音阶', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(MAJOR_SCALE_DEGREES).toContain(buildDegreeProbe(seed, 0).degree)
    }
  })

  it('计划中含语境事件与目标音事件', () => {
    for (const level of LEVELS) {
      const probe = buildDegreeProbe(1, level)
      expect(probe.plan.events.length).toBeGreaterThan(1)
    }
  })

  it('目标音是计划中最后发声的那个音，且音高对应该音级', () => {
    for (let seed = 0; seed < 30; seed++) {
      const probe = buildDegreeProbe(seed, 3)
      const last = probe.plan.events[probe.plan.events.length - 1]
      const midi = Math.round(69 + 12 * Math.log2(last.freqHz / 440))
      expect(((midi % 12) + 12) % 12).toBe(
        degreeToPitchClass(probe.degree, probe.key),
      )
    }
  })

  it('遍历足够多的 seed 能覆盖全部 12 个调', () => {
    const tonics = new Set(
      Array.from({ length: 400 }, (_, i) => buildDegreeProbe(i, 0).key.tonic),
    )
    expect(tonics.size).toBe(12)
  })

  it('遍历足够多的 seed 能覆盖全部 4 种音色', () => {
    const timbres = new Set(
      Array.from({ length: 400 }, (_, i) => buildDegreeProbe(i, 0).timbreId),
    )
    expect(timbres.size).toBe(4)
  })
})
```

「目标音是最后发声的那个音」这条测试锁住了 `leadInSec` 的接法——如果语境的 leadIn 算错，目标音会和语境重叠或提前，这条就会红。

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/dev/buildDegreeProbe.test.ts`
Expected: FAIL — 无法解析模块 `./buildDegreeProbe`

- [ ] **Step 3: 写实现**

`src/dev/buildDegreeProbe.ts`：

```ts
import {
  MAJOR_SCALE_DEGREES,
  type Key,
  type ScaleDegree,
} from '../music/key'
import {
  mergePlans,
  notesToPlan,
  type PlaybackPlan,
  type TimbreId,
} from '../music/playback'
import { makeRng } from '../music/rng'
import { degreeToMidi, doMidiForKey } from '../music/register'
import { buildTonalContext, type ContextLevel } from '../music/tonalContext'
import { TIMBRE_IDS } from '../audio/timbres'

export interface DegreeProbe {
  plan: PlaybackPlan
  key: Key
  degree: ScaleDegree
  timbreId: TimbreId
  level: ContextLevel
}

const TARGET_DUR_SEC = 1.2
const CENTER_MIDI = 60

/**
 * 开发验证用的音级题：建立调性语境，然后播一个目标音级。
 * 正式的题目生成器在 P-2 计划里实现，这里只为了能用耳朵验收音频层。
 */
export function buildDegreeProbe(seed: number, level: ContextLevel): DegreeProbe {
  const rng = makeRng(seed)

  const key: Key = { tonic: rng.int(12), mode: 'major' }
  const timbreId = rng.pick(TIMBRE_IDS)
  const degree = rng.pick(MAJOR_SCALE_DEGREES)

  const doMidi = doMidiForKey(key, CENTER_MIDI)
  const context = buildTonalContext({
    key,
    level,
    timbreId,
    doMidi,
    itemDurSec: TARGET_DUR_SEC,
  })

  const target = notesToPlan(
    [
      {
        midi: degreeToMidi(degree, doMidi),
        atSec: context.leadInSec,
        durSec: TARGET_DUR_SEC,
      },
    ],
    timbreId,
  )

  return { plan: mergePlans(context.plan, target), key, degree, timbreId, level }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/dev/buildDegreeProbe.test.ts`
Expected: PASS，全部通过

- [ ] **Step 5: 写验证页面**

`src/ui/DevHarness.tsx`：

```tsx
import { useRef, useState, type CSSProperties } from 'react'
import { AudioEngine, createAudioEngine } from '../audio/AudioEngine'
import { buildDegreeProbe, type DegreeProbe } from '../dev/buildDegreeProbe'
import { displayDegree, type DisplayScheme } from '../music/display'
import type { ContextLevel } from '../music/tonalContext'

const LEVELS: ContextLevel[] = [0, 1, 2, 3, 4]
const SCHEMES: DisplayScheme[] = ['solfege', 'numeric', 'degree']
const PITCH_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

export function DevHarness() {
  const engineRef = useRef<AudioEngine | null>(null)
  const [level, setLevel] = useState<ContextLevel>(0)
  const [scheme, setScheme] = useState<DisplayScheme>('solfege')
  const [seed, setSeed] = useState(1)
  const [probe, setProbe] = useState<DegreeProbe | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // AudioContext 必须在用户手势的调用栈内创建（spec §11 · iOS）
  async function ensureEngine(): Promise<AudioEngine | null> {
    try {
      if (!engineRef.current) engineRef.current = createAudioEngine()
      await engineRef.current.resume()
      return engineRef.current
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    }
  }

  async function playNext() {
    const engine = await ensureEngine()
    if (!engine) return
    const next = buildDegreeProbe(seed, level)
    engine.stopAll()
    engine.play(next.plan)
    setProbe(next)
    setRevealed(false)
    setSeed((s) => s + 1)
  }

  async function replay() {
    const engine = await ensureEngine()
    if (!engine || !probe) return
    engine.stopAll()
    engine.play(probe.plan)
  }

  return (
    <main style={styles.page}>
      <h1 style={styles.title}>音频层验证</h1>

      {error && <p style={styles.error}>{error}</p>}

      <section style={styles.row}>
        <span style={styles.label}>语境</span>
        {LEVELS.map((l) => (
          <button
            key={l}
            onClick={() => setLevel(l)}
            style={l === level ? styles.chipOn : styles.chip}
          >
            L{l}
          </button>
        ))}
      </section>

      <section style={styles.row}>
        <span style={styles.label}>皮肤</span>
        {SCHEMES.map((s) => (
          <button
            key={s}
            onClick={() => setScheme(s)}
            style={s === scheme ? styles.chipOn : styles.chip}
          >
            {s}
          </button>
        ))}
      </section>

      <section style={styles.readout}>
        {probe ? (
          <>
            <p style={styles.meta}>
              {PITCH_NAMES[probe.key.tonic]} 大调 · {probe.timbreId} · L{probe.level}
            </p>
            <p style={styles.answer}>
              {revealed ? displayDegree(probe.degree, scheme) : '？'}
            </p>
          </>
        ) : (
          <p style={styles.meta}>点下面的按钮开始</p>
        )}
      </section>

      <section style={styles.controls}>
        <button style={styles.primary} onClick={playNext}>
          下一题
        </button>
        <button style={styles.secondary} onClick={replay} disabled={!probe}>
          重放
        </button>
        <button
          style={styles.secondary}
          onClick={() => setRevealed(true)}
          disabled={!probe || revealed}
        >
          看答案
        </button>
      </section>
    </main>
  )
}

// 按钮集中在下方，符合 spec §11 单手可达
const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    padding: '24px 16px calc(24px + env(safe-area-inset-bottom))',
    fontFamily: 'system-ui, sans-serif',
    background: '#111',
    color: '#eee',
    boxSizing: 'border-box',
  },
  title: { fontSize: 18, margin: 0, opacity: 0.7, fontWeight: 500 },
  error: { color: '#ff8080', fontSize: 14, margin: 0 },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  label: { fontSize: 13, opacity: 0.6, minWidth: 32 },
  chip: {
    padding: '8px 14px',
    borderRadius: 999,
    border: '1px solid #444',
    background: 'transparent',
    color: '#ccc',
    fontSize: 14,
  },
  chipOn: {
    padding: '8px 14px',
    borderRadius: 999,
    border: '1px solid #6cf',
    background: '#6cf',
    color: '#012',
    fontSize: 14,
    fontWeight: 600,
  },
  readout: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  meta: { fontSize: 14, opacity: 0.55, margin: 0 },
  answer: { fontSize: 64, margin: 0, fontWeight: 300, letterSpacing: 2 },
  controls: { display: 'flex', gap: 10 },
  primary: {
    flex: 2,
    padding: '18px 0',
    borderRadius: 14,
    border: 'none',
    background: '#6cf',
    color: '#012',
    fontSize: 17,
    fontWeight: 600,
  },
  secondary: {
    flex: 1,
    padding: '18px 0',
    borderRadius: 14,
    border: '1px solid #444',
    background: 'transparent',
    color: '#ccc',
    fontSize: 15,
  },
}
```

`src/ui/App.tsx` 改为：

```tsx
import { DevHarness } from './DevHarness'

export function App() {
  return <DevHarness />
}
```

- [ ] **Step 6: 运行全部测试与类型检查**

```bash
npx vitest run
npx tsc --noEmit
```

Expected: 全部 PASS，tsc 无输出

- [ ] **Step 7: 在手机上实听验证**

```bash
npm run dev
```

终端会打印一个 `Network:` 开头的局域网地址。**用手机浏览器打开那个地址**（手机与电脑需在同一 Wi-Fi），戴上耳机，逐项确认：

1. 点「下一题」能听到声音，无爆音、无削波
2. L0：能听清 ii–V–I 终止式，之后目标音清晰可辨
3. L1：终止式变短，仍能建立调感
4. L2：低音持续贯穿整题
5. L3：开头一声主音后消失，目标音在静默中出现
6. L4：低音在题目中途撤走
7. 切换若干题，确认四种音色听感确实不同（这是 spec §6.2 的一个变异轴，若听不出区别，该轴无效）
8. 连点「下一题」十余次，确认调在变化
9. 切换三种显示皮肤，确认「看答案」显示相应记法
10. 按住手机音量键调到日常音量，确认低音 drone 不会盖住目标音

**若第 7 或第 10 项不通过，不要继续 P-2。** 回到 `src/audio/timbres.ts` 调整分音与包络，或在 `src/music/tonalContext.ts` 调整 `DRONE_GAIN` / `CONTEXT_GAIN`，直到听感可接受。P-1 的全部意义就在这一步。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat(dev): 手机音频验证页"
```

---

## 完成标准

P-1 完成的判据：

1. `npx vitest run` 全绿
2. `npx tsc --noEmit` 无输出
3. 手机上打开验证页，Task 13 Step 7 的十项人工验证全部通过
4. `src/music/` 下没有任何一处 import 浏览器 API、`Math.random()` 或 `Date.now()`

第 4 条可用以下命令自查：

```bash
grep -rn "Math.random\|Date.now\|window\.\|document\." src/music/ || echo "OK: music/ 保持纯净"
```

## 交付物

- `src/music/`：纯函数音乐领域模型（音高、随机、调与音级、音区落位、显示皮肤、和弦、节奏、PlaybackPlan、调性语境引擎）
- `src/audio/`：音色定义、声部转换、Web Audio 播放引擎
- `src/dev/` + `src/ui/DevHarness.tsx`：手机验证页
- 完整的单元测试与属性测试覆盖

## 下一步

P-2「掌握度模型 + 调度器 + 课程数据」。它消费本计划产出的 `music/` 全部类型，并新增 `scheduling/` 与 `curriculum/`，以虚拟学习者仿真作为验收物。
