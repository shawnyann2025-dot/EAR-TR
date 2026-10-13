import { useState } from 'react'
import { useRuntime, useSnapshot } from '../RuntimeContext'

const TRACK_NAME = { T: '音级', H: '和声', R: '节奏' } as const

export function Summary(props: { onHome: () => void }) {
  const { runtime, audio } = useRuntime()
  const snap = useSnapshot()
  const [error, setError] = useState<string | null>(null)
  const s = snap.session!
  const sum = s.summary!
  const isDrill = s.mode === 'drill'
  return (
    <main className="page summary">
      <h1>{isDrill ? '重练结束' : '今日总结'}</h1>
      {!isDrill && (
        <>
          <p>正确率 {Math.round(sum.accuracy * 100)}%（{sum.correct} / {sum.scored}）</p>
          <ul>
            {(['T', 'H', 'R'] as const).map((t) => (
              <li key={t}>{TRACK_NAME[t]}：{sum.byTrack[t]} 题</li>
            ))}
          </ul>
          {sum.gate.evaluated ? (
            <>
              <p>{sum.gate.blockingKeys === 0 ? '本阶段的掌握度已达标' : `本阶段还差 ${sum.gate.blockingKeys} 项`}</p>
              <p>实战关：{sum.gate.bossSatisfied ? '达标' : '未达标'}</p>
              {sum.gate.advancedTo && <p className="good">升入 {sum.gate.advancedTo}！</p>}
            </>
          ) : (
            <p>本场提前结束，不评估关卡。</p>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row">
        {!isDrill && s.wrongThisSession.length > 0 && (
          <button
            type="button"
            onClick={async () => {
              try {
                await audio.unlock()
                await runtime.startDrill()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            重练刚才错的这组
          </button>
        )}
        <button type="button" className="primary" onClick={props.onHome}>回到首页</button>
      </div>
    </main>
  )
}
