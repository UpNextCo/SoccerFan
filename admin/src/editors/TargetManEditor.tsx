import { useEffect, useState } from 'react'
import './game-editors.css'

type Puzzle = {
  categoryLabel?: string
  label?: string
  title?: string
  target?: number
  unit?: string | null
  valueNoun?: string
  offNoun?: string
  categoryId?: string
  [k: string]: unknown
}

type TargetFields = {
  categoryId?: string
  target?: number
  [k: string]: unknown
}

type TargetAnswer = {
  modeId?: string
  answer?: TargetFields
  categoryId?: string
  target?: number
  [k: string]: unknown
}

export function TargetManEditor({
  puzzle,
  answer,
  locked,
  onChange,
}: {
  puzzle: unknown
  answer: unknown
  locked: boolean
  onChange: (puzzle: Puzzle, answer: unknown) => void
}) {
  const p = puzzle as Puzzle
  const a = (answer && typeof answer === 'object' ? answer : {}) as TargetAnswer
  const categoryTitle = p.categoryLabel ?? p.title ?? p.label ?? ''
  const [rawText, setRawText] = useState(() => JSON.stringify(answer ?? null, null, 2))
  const [rawError, setRawError] = useState<string | null>(null)

  useEffect(() => {
    setRawText(JSON.stringify(answer ?? null, null, 2))
    setRawError(null)
  }, [answer])

  function synchronizedAnswer(nextPuzzle: Puzzle): TargetAnswer {
    const categoryId = nextPuzzle.categoryId ?? ''
    const target = nextPuzzle.target ?? 0
    if (a.answer || a.modeId === 'target_man') {
      return {
        ...a,
        modeId: 'target_man',
        answer: { ...(a.answer ?? {}), categoryId, target },
      }
    }
    return { ...a, categoryId, target }
  }

  function updatePuzzle(patch: Partial<Puzzle>) {
    const nextPuzzle = { ...p, ...patch }
    onChange(nextPuzzle, synchronizedAnswer(nextPuzzle))
  }

  function applyRaw() {
    try {
      onChange(p, JSON.parse(rawText) as unknown)
      setRawError(null)
    } catch (error) {
      setRawError(error instanceof Error ? error.message : 'Invalid JSON')
    }
  }

  return (
    <div className="mode-editor">
      <div className="editor-summary">
        <div>
          <span className="muted tiny">Category</span>
          <strong>{categoryTitle || 'Unlabelled'}</strong>
        </div>
        <div>
          <span className="muted tiny">Category ID</span>
          <strong>{p.categoryId || 'Not set'}</strong>
        </div>
        <div>
          <span className="muted tiny">Target</span>
          <strong>{p.target ?? '—'} {p.valueNoun ?? ''}</strong>
        </div>
      </div>
      <div className="q-card">
        <header>
          <strong>Target Man setup</strong>
          <span className="muted tiny">Structured fields update answer JSON automatically</span>
        </header>
        <label className="field">
          Title / category label
          <input
            value={categoryTitle}
            disabled={locked}
            onChange={(e) =>
              updatePuzzle({
                title: e.target.value,
                categoryLabel: e.target.value,
                label: e.target.value,
              })
            }
          />
        </label>
        <div className="row">
          <label className="field">
            Category ID
            <input
              value={p.categoryId ?? ''}
              disabled={locked}
              placeholder="e.g. pl_goals"
              onChange={(e) => updatePuzzle({ categoryId: e.target.value })}
            />
          </label>
        </div>
        <div className="row">
          <label className="field">
            Target
            <input
              type="number"
              value={p.target ?? ''}
              disabled={locked}
              onChange={(e) => updatePuzzle({ target: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            Unit
            <input
              value={p.unit ?? ''}
              disabled={locked}
              onChange={(e) => updatePuzzle({ unit: e.target.value || null })}
            />
          </label>
        </div>
        <div className="row">
          <label className="field">
            Value noun
            <input
              value={p.valueNoun ?? ''}
              disabled={locked}
              onChange={(e) => updatePuzzle({ valueNoun: e.target.value })}
            />
          </label>
          <label className="field">
            Off noun
            <input
              value={p.offNoun ?? ''}
              disabled={locked}
              onChange={(e) => updatePuzzle({ offNoun: e.target.value })}
            />
          </label>
        </div>
        <div className="editor-summary">
          <div>
            <span className="muted tiny">Synchronized answer category</span>
            <strong>{a.answer?.categoryId ?? a.categoryId ?? 'Not set'}</strong>
          </div>
          <div>
            <span className="muted tiny">Synchronized answer target</span>
            <strong>{a.answer?.target ?? a.target ?? 'Not set'}</strong>
          </div>
        </div>

        <details className="advanced-panel">
          <summary>Advanced · raw answer JSON</summary>
          <p className="muted tiny">
            Use this only for fields not represented above. Invalid JSON is never applied.
          </p>
          <textarea
            rows={9}
            disabled={locked}
            value={rawText}
            aria-invalid={rawError ? true : undefined}
            onChange={(e) => {
              setRawText(e.target.value)
              try {
                JSON.parse(e.target.value)
                setRawError(null)
              } catch (error) {
                setRawError(error instanceof Error ? error.message : 'Invalid JSON')
              }
            }}
          />
          {rawError && <p className="error-box">Parse error: {rawError}</p>}
          <div className="json-actions">
            <button type="button" disabled={locked || Boolean(rawError)} onClick={applyRaw}>
              Apply answer JSON
            </button>
            <button
              type="button"
              className="ghost"
              disabled={locked}
              onClick={() => {
                setRawText(JSON.stringify(answer ?? null, null, 2))
                setRawError(null)
              }}
            >
              Reset
            </button>
          </div>
        </details>
      </div>
    </div>
  )
}
