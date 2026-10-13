import { useEffect, useRef, useState } from 'react'
import { VOICE_PRESETS, type VocalRange, type VoicePreset } from '../../pitch/range'
import { pickHeldNote, validateRange } from '../../pitch/rangeTest'
import { useRuntime } from '../RuntimeContext'

export const HOLD_SEC = 4

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
export function midiName(m: number): string {
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`
}

type Step =
  | { kind: 'intro' }
  | { kind: 'presets' }
  | { kind: 'opening' }
  | { kind: 'calibrating' }
  | { kind: 'hold'; which: 'low' | 'high'; low: number | null }
  | { kind: 'result'; range: VocalRange }
  | { kind: 'invalid'; reason: string }

const PRESET_ORDER: VoicePreset[] = ['bass', 'tenor', 'alto', 'soprano']

export function RangeTest(props: { onDone?: () => void }) {
  const { runtime, audio, mic } = useRuntime()
  const [step, setStep] = useState<Step>({ kind: 'intro' })
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 当前这一次 mic.start() 的 promise；stop() 必须等它落定后才可调用 */
  const startP = useRef<Promise<void> | null>(null)
  /** 已发起 start 且尚未 stop（卸载时据此收尾） */
  const holding = useRef(false)
  const finishing = useRef(false)
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      if (holding.current && startP.current) {
        holding.current = false
        // 卸载于收音中：等 start 落定再停（start 被拒则无需 stop）
        void startP.current.then(() => mic.stop()).then(() => {}, () => {})
      }
    },
    [mic],
  )

  async function save(vocalRange: VocalRange | null) {
    try {
      await runtime.updateProfile({ vocalRange })
      props.onDone?.()
    } catch (e) {
      setError(msg(e))
    }
  }

  async function startHold(which: 'low' | 'high', low: number | null) {
    setStep({ kind: 'hold', which, low })
    finishing.current = false
    const p = mic.start(() => {})
    startP.current = p
    holding.current = true
    try {
      await p
      timer.current = setTimeout(() => void finishHold(which, low), HOLD_SEC * 1000)
    } catch (e) {
      holding.current = false
      setError(msg(e))
      setStep({ kind: 'intro' })
    }
  }

  async function finishHold(which: 'low' | 'high', low: number | null) {
    if (finishing.current) return
    finishing.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    try {
      // 顺序约定：start 落定后才能 stop；start 被拒时 startHold 已处理，这里直接返回
      try {
        await startP.current
      } catch {
        return
      }
      holding.current = false
      const note = pickHeldNote(await mic.stop())
      if (which === 'low') {
        await startHold('high', note)
        return
      }
      const check = validateRange(low, note)
      setStep(check.ok ? { kind: 'result', range: check.range } : { kind: 'invalid', reason: check.reason })
    } catch (e) {
      setError(msg(e))
      setStep({ kind: 'intro' })
    }
  }

  async function begin() {
    setError(null)
    try {
      await audio.unlock()
      setStep({ kind: 'opening' })
      await mic.ensure({ onCalibrating: () => setStep({ kind: 'calibrating' }) })
      await startHold('low', null)
    } catch (e) {
      setError(msg(e))
      setStep({ kind: 'intro' })
    }
  }

  const errorLine = error && <p className="error">{error}</p>

  switch (step.kind) {
    case 'intro':
      return (
        <main className="page onboarding">
          <h1>测一下你的音域</h1>
          <p>测一下你的音域，唱题会落在你唱得舒服的地方。需要麦克风，约 30 秒。</p>
          {errorLine}
          <button type="button" className="primary big" onClick={() => void begin()}>开始测定</button>
          <button type="button" onClick={() => setStep({ kind: 'presets' })}>选声部</button>
          <button type="button" onClick={() => void save(null)}>跳过，以后再测</button>
        </main>
      )
    case 'presets':
      return (
        <main className="page onboarding">
          <h1>选一个最接近你的声部</h1>
          {errorLine}
          <div className="row">
            {PRESET_ORDER.map((p) => (
              <button key={p} type="button" onClick={() => void save({ lowMidi: VOICE_PRESETS[p].lowMidi, highMidi: VOICE_PRESETS[p].highMidi })}>
                {VOICE_PRESETS[p].label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setStep({ kind: 'intro' })}>返回</button>
        </main>
      )
    case 'opening':
      return (
        <main className="page onboarding">
          <p>请在弹窗中允许使用麦克风…</p>
        </main>
      )
    case 'calibrating':
      return (
        <main className="page onboarding">
          <p>请保持安静 3 秒，正在校准环境噪声…</p>
        </main>
      )
    case 'hold':
      return (
        <main className="page onboarding">
          <h1>{step.which === 'low' ? '唱一个你舒服的最低音并保持' : '再唱一个你舒服的最高音并保持'}</h1>
          <p>用「啊」唱，保持 2 秒左右。</p>
          <button type="button" className="primary big" onClick={() => void finishHold(step.which, step.low)}>唱好了</button>
        </main>
      )
    case 'result':
      return (
        <main className="page onboarding">
          <h1>你的音域：{midiName(step.range.lowMidi)} – {midiName(step.range.highMidi)}</h1>
          {errorLine}
          <button type="button" className="primary big" onClick={() => void save(step.range)}>保存</button>
          <button type="button" onClick={() => void begin()}>重新测定</button>
        </main>
      )
    case 'invalid':
      return (
        <main className="page onboarding">
          <p className="error">{step.reason}</p>
          <button type="button" className="primary big" onClick={() => void begin()}>重新测定</button>
          <button type="button" onClick={() => setStep({ kind: 'presets' })}>选声部</button>
        </main>
      )
  }
}
