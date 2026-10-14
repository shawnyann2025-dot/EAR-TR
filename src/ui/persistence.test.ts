import { describe, expect, it, vi } from 'vitest'
import { PERSIST_TEXT, persistenceState, requestPersistence } from './persistence'

describe('持久化存储（P-6 spec §3.4）', () => {
  it('请求一次；失败不抛错；API 不存在时静默', async () => {
    const persist = vi.fn(async () => true)
    await requestPersistence({ persist })
    expect(persist).toHaveBeenCalledTimes(1)
    await expect(requestPersistence({ persist: async () => { throw new Error('x') } })).resolves.toBeUndefined()
    await expect(requestPersistence(undefined)).resolves.toBeUndefined()
  })
  it('三种状态', async () => {
    expect(await persistenceState({ persisted: async () => true })).toBe('persisted')
    expect(await persistenceState({ persisted: async () => false })).toBe('notPersisted')
    expect(await persistenceState(undefined)).toBe('unsupported')
    expect(await persistenceState({ persisted: async () => { throw new Error('x') } })).toBe('unsupported')
  })
  it('文案', () => {
    expect(PERSIST_TEXT).toEqual({
      persisted: '存储：已持久化',
      notPersisted: '存储：未持久化（系统空间紧张时可能被清理，请定期导出备份）',
      unsupported: '浏览器不支持持久化，请定期导出备份',
    })
  })
})
