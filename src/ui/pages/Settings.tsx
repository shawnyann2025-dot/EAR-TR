import { useState } from 'react'
import type { DisplayScheme } from '../../music/display'
import { localDateString } from '../../session/time'
import { downloadText } from '../download'
import { midiName, RangeTest } from './RangeTest'
import { useRuntime, useSnapshot } from '../RuntimeContext'

const SCHEMES: { id: DisplayScheme; name: string }[] = [
  { id: 'solfege', name: '唱名' },
  { id: 'numeric', name: '数字' },
  { id: 'degree', name: '级数' },
]

export function Settings(props: { onBack: () => void }) {
  const { runtime } = useRuntime()
  const snap = useSnapshot()
  const [msg, setMsg] = useState<string | null>(null)
  const [retest, setRetest] = useState(false)
  const scheme = snap.profile?.displayScheme ?? 'solfege'
  const today = () => localDateString(new Date())

  async function guard(fn: () => Promise<unknown>) {
    try {
      await fn()
    } catch (e) {
      setMsg(`操作失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function onImport(file: File | undefined) {
    if (!file) return
    try {
      await runtime.importBundle(await file.text())
      setMsg('导入成功')
    } catch (e) {
      setMsg(`导入失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (retest) return <RangeTest onDone={() => setRetest(false)} />

  return (
    <main className="page settings">
      <header className="topbar">
        <button type="button" onClick={props.onBack}>返回</button>
        <span>设置</span>
      </header>
      <fieldset>
        <legend>显示皮肤</legend>
        {SCHEMES.map((s) => (
          <label key={s.id}>
            <input type="radio" name="scheme" checked={scheme === s.id} onChange={() => void guard(() => runtime.updateProfile({ displayScheme: s.id }))} />
            {s.name}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>唱题判定</legend>
        <label>
          <input type="radio" name="singMode" checked={(snap.profile?.singMode ?? 'detect') === 'detect'} onChange={() => void guard(() => runtime.updateProfile({ singMode: 'detect', micFallbackReason: undefined }))} />
          音高检测
        </label>
        <label>
          <input type="radio" name="singMode" checked={snap.profile?.singMode === 'self'} onChange={() => void guard(() => runtime.updateProfile({ singMode: 'self' }))} />
          自评
        </label>
      </fieldset>
      {snap.profile?.micFallbackReason && (
        <p className="small">{snap.profile.micFallbackReason === 'denied' ? '之前没有麦克风权限，已改为自评。允许权限后可切回音高检测。' : '此浏览器不支持收音，已改为自评。'}</p>
      )}
      <section>
        <p>音域：{snap.profile?.vocalRange ? `${midiName(snap.profile.vocalRange.lowMidi)} – ${midiName(snap.profile.vocalRange.highMidi)}` : '未设置'}</p>
        <button type="button" onClick={() => setRetest(true)}>重新测定</button>
      </section>
      <section>
        <button type="button" onClick={() => void guard(async () => downloadText(`ear-tr-备份-${today()}.json`, await runtime.exportBundle()))}>导出备份</button>
        <label className="file-btn">
          导入备份
          <input type="file" accept="application/json,.json" onChange={(e) => {
              const input = e.target
              const file = input.files?.[0]
              void onImport(file).finally(() => { input.value = '' })
            }} />
        </label>
        {msg && <p>{msg}</p>}
        {snap.lastBackup && (
          <button type="button" onClick={() => downloadText(`ear-tr-导入前自动备份-${today()}.json`, snap.lastBackup!)}>下载导入前的自动备份</button>
        )}
      </section>
    </main>
  )
}
