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
