import { useState } from 'react'

/** 唱模态自评（主 spec §12）：先听目标，再判断自己唱对没有 */
export function PitchControl(props: { targetsText: string | null; enabled: boolean; onPlayTarget: () => void; onAssess: (correct: boolean) => void }) {
  const [heard, setHeard] = useState(false)
  const canAssess = props.enabled && heard
  return (
    <div className="pitch">
      {props.targetsText && <p className="targets">{props.targetsText}</p>}
      <button type="button" disabled={!props.enabled} onClick={() => { setHeard(true); props.onPlayTarget() }}>听目标</button>
      <div className="row">
        <button type="button" className="answer-btn" disabled={!canAssess} onClick={() => canAssess && props.onAssess(true)}>唱对了</button>
        <button type="button" className="answer-btn" disabled={!canAssess} onClick={() => canAssess && props.onAssess(false)}>没唱对</button>
      </div>
    </div>
  )
}
