import { useState } from 'react'

export function SequenceControl(props: { length: number; alphabet: string[]; label: (id: string) => string; enabled: boolean; onSubmit: (ids: string[]) => void }) {
  const [slots, setSlots] = useState<string[]>([])
  const full = slots.length === props.length
  return (
    <div className="sequence">
      <div className="slots" aria-label="作答槽">
        {Array.from({ length: props.length }, (_, i) => (
          <span key={i} className={`slot${slots[i] ? ' filled' : ''}`}>{slots[i] ? props.label(slots[i]) : '·'}</span>
        ))}
      </div>
      <div className="choice-grid">
        {props.alphabet.map((id) => (
          <button key={id} type="button" className="answer-btn" disabled={!props.enabled || full} onClick={() => setSlots((s) => (s.length < props.length ? [...s, id] : s))}>
            {props.label(id)}
          </button>
        ))}
      </div>
      <div className="row">
        <button type="button" disabled={!props.enabled || slots.length === 0} onClick={() => setSlots((s) => s.slice(0, -1))}>删除</button>
        <button type="button" className="primary" disabled={!props.enabled || !full} onClick={() => props.onSubmit(slots)}>提交</button>
      </div>
    </div>
  )
}
