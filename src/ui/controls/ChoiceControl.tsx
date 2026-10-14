export function ChoiceControl(props: { ids: string[]; label: (id: string) => string; enabled: boolean; onAnswer: (id: string) => void }) {
  return (
    <div className="choice-grid">
      {props.ids.map((id) => (
        <button key={id} type="button" className="answer-btn" disabled={!props.enabled} onClick={() => props.enabled && props.onAnswer(id)}>
          {props.label(id)}
        </button>
      ))}
    </div>
  )
}
