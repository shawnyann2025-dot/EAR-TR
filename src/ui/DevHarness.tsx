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
