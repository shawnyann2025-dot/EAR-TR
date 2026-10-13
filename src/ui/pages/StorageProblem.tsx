import { useState } from 'react'
import { downloadText } from '../download'
import type { BootResult } from '../platform'

export function StorageProblem(props: { result: Extract<BootResult, { kind: 'corrupt' }>; onRebuilt: (r: BootResult) => void }) {
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <main className="page storage-problem">
      <h1>本地数据出了问题</h1>
      <p>{props.result.message}</p>
      <p>请先下载一份损坏数据的副本，并确认文件已经保存好，再重建。重建会清空本地进度，之后无法找回。</p>
      <button type="button" onClick={() => { downloadText('ear-tr-损坏数据副本.json', props.result.rawDump); setSaved(true) }}>下载损坏数据副本</button>
      <button
        type="button"
        className="danger"
        disabled={!saved}
        onClick={async () => {
          try {
            props.onRebuilt(await props.result.rebuild())
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          }
        }}
      >
        我已保存副本，重建
      </button>
      {error && <p className="error">{error}</p>}
    </main>
  )
}
