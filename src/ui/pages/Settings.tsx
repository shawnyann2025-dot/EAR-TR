import { useState } from 'react'
import type { DisplayScheme } from '../../music/display'
import { localDateString } from '../../session/time'
import { downloadText } from '../download'
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
  const scheme = snap.profile?.displayScheme ?? 'solfege'
  const today = () => localDateString(new Date())

  async function onImport(file: File | undefined) {
    if (!file) return
    try {
      await runtime.importBundle(await file.text())
      setMsg('导入成功')
    } catch (e) {
      setMsg(`导入失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

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
            <input type="radio" name="scheme" checked={scheme === s.id} onChange={() => void runtime.updateProfile({ displayScheme: s.id })} />
            {s.name}
          </label>
        ))}
      </fieldset>
      <section>
        <button type="button" onClick={async () => downloadText(`ear-tr-备份-${today()}.json`, await runtime.exportBundle())}>导出备份</button>
        <label className="file-btn">
          导入备份
          <input type="file" accept="application/json,.json" onChange={(e) => void onImport(e.target.files?.[0])} />
        </label>
        {msg && <p>{msg}</p>}
        {snap.lastBackup && (
          <button type="button" onClick={() => downloadText(`ear-tr-导入前自动备份-${today()}.json`, snap.lastBackup!)}>下载导入前的自动备份</button>
        )}
      </section>
    </main>
  )
}
