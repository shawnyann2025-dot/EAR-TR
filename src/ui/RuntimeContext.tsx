import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Runtime, RuntimeSnapshot } from '../runtime/runtime'
import type { LazyAudio } from './platform'
import type { SingMic } from './singMic'

interface Ctx {
  runtime: Runtime
  audio: LazyAudio
  mic: SingMic
  /** 跨页面保留的提示（如麦克风回落）；在 Shell 里显示，点「知道了」消除 */
  notices: string[]
  pushNotice(msg: string): void
  dismissNotice(i: number): void
}

const RuntimeCtx = createContext<Ctx | null>(null)

export function RuntimeProvider(props: { runtime: Runtime; audio: LazyAudio; mic: SingMic; children: ReactNode }) {
  const { runtime, audio, mic } = props
  const [notices, setNotices] = useState<string[]>([])
  const pushNotice = useCallback((msg: string) => setNotices((n) => (n.includes(msg) ? n : [...n, msg])), [])
  const dismissNotice = useCallback((i: number) => setNotices((n) => n.filter((_, j) => j !== i)), [])
  const value = useMemo(() => ({ runtime, audio, mic, notices, pushNotice, dismissNotice }), [runtime, audio, mic, notices, pushNotice, dismissNotice])
  return <RuntimeCtx.Provider value={value}>{props.children}</RuntimeCtx.Provider>
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
