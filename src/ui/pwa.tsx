import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'

export const UPDATE_CHECK_MS = 60 * 60 * 1000

export interface UpdatePort {
  readonly needRefresh: boolean
  subscribe(fn: () => void): () => void
  apply(): Promise<void>
}

export type RegisterSW = (opts: {
  onNeedRefresh?: () => void
  onRegisteredSW?: (url: string, r: ServiceWorkerRegistration | undefined) => void
}) => (reload?: boolean) => Promise<void>

export const NO_UPDATES: UpdatePort = { needRefresh: false, subscribe: () => () => {}, apply: async () => {} }

/** 包装 vite-plugin-pwa 的 registerSW：新版本就绪时置 needRefresh；apply 激活新 SW 并刷新（P-6 spec §3.3） */
export function createUpdatePort(
  register: RegisterSW,
  env: { setInterval: typeof setInterval; document: Pick<Document, 'addEventListener' | 'visibilityState'> } = { setInterval, document },
): UpdatePort {
  let need = false
  const subs = new Set<() => void>()
  const updateSW = register({
    onNeedRefresh() {
      need = true
      subs.forEach((f) => f())
    },
    onRegisteredSW(_url, r) {
      if (!r) return
      const check = () => void r.update().catch(() => {})
      env.setInterval(check, UPDATE_CHECK_MS)
      env.document.addEventListener('visibilitychange', () => {
        if (env.document.visibilityState === 'visible') check()
      })
    },
  })
  return {
    get needRefresh() {
      return need
    },
    subscribe(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    apply: () => updateSW(true),
  }
}

const UpdateCtx = createContext<UpdatePort>(NO_UPDATES)

export function UpdateProvider(props: { port: UpdatePort; children: ReactNode }) {
  return <UpdateCtx.Provider value={props.port}>{props.children}</UpdateCtx.Provider>
}

export function useUpdatePort(): UpdatePort {
  return useContext(UpdateCtx)
}

export function useNeedRefresh(): boolean {
  const port = useUpdatePort()
  return useSyncExternalStore((fn) => port.subscribe(fn), () => port.needRefresh)
}
