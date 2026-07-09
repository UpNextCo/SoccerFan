import { useState } from 'react'

export function JsonFallbackEditor({
  puzzle,
  answer,
  locked,
  onChange,
}: {
  puzzle: unknown
  answer: unknown
  locked: boolean
  onChange: (puzzle: unknown, answer: unknown) => void
}) {
  const [pText, setPText] = useState(JSON.stringify(puzzle, null, 2))
  const [aText, setAText] = useState(JSON.stringify(answer, null, 2))
  const [err, setErr] = useState<string | null>(null)

  function apply() {
    try {
      onChange(JSON.parse(pText), JSON.parse(aText))
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Invalid JSON')
    }
  }

  return (
    <div className="mode-editor">
      <p className="muted">Raw JSON editor (no structured UI for this mode yet)</p>
      <label className="field">
        puzzle_json
        <textarea rows={16} value={pText} disabled={locked} onChange={(e) => setPText(e.target.value)} />
      </label>
      <label className="field">
        answer_json
        <textarea rows={10} value={aText} disabled={locked} onChange={(e) => setAText(e.target.value)} />
      </label>
      {err && <p className="error">{err}</p>}
      {!locked && (
        <button type="button" onClick={apply}>
          Apply JSON
        </button>
      )}
    </div>
  )
}
