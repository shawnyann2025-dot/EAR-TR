import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { repositoryContract } from './contract'
import { openIndexedDbRepository } from './indexeddb'
import { SCHEMA_VERSION, StorageCorruptError } from './types'

let n = 0
const fresh = () => ({ factory: new IDBFactory(), name: `test-${n++}` })

repositoryContract('IndexedDB 实现', async (opts) => openIndexedDbRepository({ ...fresh(), ...opts }))

describe('IndexedDB：持久化与损坏', () => {
  it('关闭后重新打开，数据还在', async () => {
    const env = fresh()
    const a = await openIndexedDbRepository(env)
    await a.saveProfile({ id: 'p', createdAtLocalDate: '2026-10-13', phaseId: 'P2', displayScheme: 'numeric', placement: { done: true, startPhase: 'P2' }, schemaVersion: SCHEMA_VERSION })
    const b = await openIndexedDbRepository(env)
    expect((await b.loadProfile())?.phaseId).toBe('P2')
  })

  it('数据库版本高于本程序：抛 StorageCorruptError，且带原始数据', async () => {
    const env = fresh()
    await new Promise<void>((resolve, reject) => {
      const req = env.factory.open(env.name, SCHEMA_VERSION + 5)
      req.onupgradeneeded = () => req.result.createObjectStore('profile')
      req.onsuccess = () => { req.result.close(); resolve() }
      req.onerror = () => reject(req.error)
    })
    await expect(openIndexedDbRepository(env)).rejects.toBeInstanceOf(StorageCorruptError)
  })

  it('Profile 记录结构不对：抛 StorageCorruptError，rawDump 里能看到原记录', async () => {
    const env = fresh()
    await openIndexedDbRepository(env)
    await new Promise<void>((resolve, reject) => {
      const req = env.factory.open(env.name, SCHEMA_VERSION)
      req.onsuccess = () => {
        const tx = req.result.transaction('profile', 'readwrite')
        tx.objectStore('profile').put({ broken: true }, 'profile')
        tx.oncomplete = () => { req.result.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
    const err = await openIndexedDbRepository(env).catch((e) => e)
    expect(err).toBeInstanceOf(StorageCorruptError)
    expect((err as StorageCorruptError).rawDump).toContain('broken')
  })
})
