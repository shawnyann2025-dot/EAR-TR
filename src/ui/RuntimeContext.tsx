import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import type { Runtime, RuntimeSnapshot } from '../runtime/runtime'
import type { LazyAudio } from './platform'
import type { SingMic } from './singMic'

interface Ctx {
  runtime: Runtime
  audio: LazyAudio
  mic: SingMic
}

const RuntimeCtx = createContext<Ctx | null>(null)

export function RuntimeProvider(props: { runtime: Runtime; audio: LazyAudio; mic: SingMic; children: ReactNode }) {
  const { runtime, audio, mic } = props
  const value = useMemo(() => ({ runtime, audio, mic }), [runtime, audio, mic])
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
