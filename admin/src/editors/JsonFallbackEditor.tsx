import { useEffect, useState } from 'react'
import './game-editors.css'

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

  useEffect(() => {
    setPText(JSON.stringify(puzzle, null, 2))
    setAText(JSON.stringify(answer, null, 2))
    setErr(null)
  }, [puzzle, answer])

  function format() {
    try {
      setPText(JSON.stringify(JSON.parse(pText), null, 2))
      setAText(JSON.stringify(JSON.parse(aText), null, 2))
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Invalid JSON')
    }
  }

  function reset() {
    setPText(JSON.stringify(puzzle, null, 2))
    setAText(JSON.stringify(answer, null, 2))
    setErr(null)
  }

  function validate(nextPuzzleText: string, nextAnswerText: string) {
    try {
      JSON.parse(nextPuzzleText)
      JSON.parse(nextAnswerText)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Invalid JSON')
    }
  }

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
      <div className="q-card">
        <header>
          <div>
            <strong>JSON fallback editor</strong>
            <p className="muted tiny">No structured editor is available for this mode.</p>
          </div>
        </header>
        <details className="advanced-panel" open>
          <summary>Advanced · raw puzzle data</summary>
          <label className="field">
            puzzle_json
            <textarea
              rows={16}
              value={pText}
              disabled={locked}
              aria-invalid={err ? true : undefined}
              onChange={(e) => {
                setPText(e.target.value)
                validate(e.target.value, aText)
              }}
            />
          </label>
          <label className="field">
            answer_json
            <textarea
              rows={10}
              value={aText}
              disabled={locked}
              aria-invalid={err ? true : undefined}
              onChange={(e) => {
                setAText(e.target.value)
                validate(pText, e.target.value)
              }}
            />
          </label>
          {err && <p className="error-box">Parse error: {err}</p>}
          <div className="json-actions">
            <button type="button" disabled={locked} onClick={apply}>Apply JSON</button>
            <button type="button" className="ghost" disabled={locked} onClick={format}>Format</button>
            <button type="button" className="ghost" disabled={locked} onClick={reset}>Reset</button>
          </div>
        </details>
      </div>
    </div>
  )
}
