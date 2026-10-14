export type PersistState = 'persisted' | 'notPersisted' | 'unsupported'

export const PERSIST_TEXT: Record<PersistState, string> = {
  persisted: '存储：已持久化',
  notPersisted: '存储：未持久化（系统空间紧张时可能被清理，请定期导出备份）',
  unsupported: '浏览器不支持持久化，请定期导出备份',
}

const browserStorage = (): StorageManager | undefined => (typeof navigator === 'undefined' ? undefined : navigator.storage)

/** 请系统别清理本站数据（iOS 尤其需要）；结果不影响启动 */
export async function requestPersistence(storage: Pick<StorageManager, 'persist'> | undefined = browserStorage()): Promise<void> {
  try {
    await storage?.persist?.()
  } catch {
    // 忽略：持久化只是降低被清理的概率
  }
}

export async function persistenceState(storage: Pick<StorageManager, 'persisted'> | undefined = browserStorage()): Promise<PersistState> {
  try {
    if (!storage?.persisted) return 'unsupported'
    return (await storage.persisted()) ? 'persisted' : 'notPersisted'
  } catch {
    return 'unsupported'
  }
}
