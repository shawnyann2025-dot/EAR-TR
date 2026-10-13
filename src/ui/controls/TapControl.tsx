export function TapControl(props: { patternText: string | null; enabled: boolean; tapCount: number; onTap: () => void }) {
  return (
    <div className="tap">
      {props.patternText && <p className="pattern">{props.patternText}</p>}
      <button
        type="button"
        className="tap-pad"
        disabled={!props.enabled}
        onPointerDown={(e) => { e.preventDefault(); if (props.enabled) props.onTap() }}
      >
        点击（{props.tapCount}）
      </button>
    </div>
  )
}
