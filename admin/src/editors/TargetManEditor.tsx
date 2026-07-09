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

  return (
    <div className="mode-editor">
      <div className="q-card">
        <label className="field">
          Title
          <input
            value={p.title ?? ''}
            disabled={locked}
            onChange={(e) => onChange({ ...p, title: e.target.value }, answer)}
          />
        </label>
        <label className="field">
          Category label
          <input
            value={p.categoryLabel ?? p.label ?? ''}
            disabled={locked}
            onChange={(e) =>
              onChange({ ...p, categoryLabel: e.target.value, label: e.target.value }, answer)
            }
          />
        </label>
        <div className="row">
          <label className="field">
            Target
            <input
              type="number"
              value={p.target ?? ''}
              disabled={locked}
              onChange={(e) => onChange({ ...p, target: Number(e.target.value) }, answer)}
            />
          </label>
          <label className="field">
            Unit
            <input
              value={p.unit ?? ''}
              disabled={locked}
              onChange={(e) => onChange({ ...p, unit: e.target.value || null }, answer)}
            />
          </label>
        </div>
        <div className="row">
          <label className="field">
            Value noun
            <input
              value={p.valueNoun ?? ''}
              disabled={locked}
              onChange={(e) => onChange({ ...p, valueNoun: e.target.value }, answer)}
            />
          </label>
          <label className="field">
            Off noun
            <input
              value={p.offNoun ?? ''}
              disabled={locked}
              onChange={(e) => onChange({ ...p, offNoun: e.target.value }, answer)}
            />
          </label>
        </div>
        <label className="field">
          Answer JSON
          <textarea
            rows={6}
            disabled={locked}
            value={JSON.stringify(answer ?? null, null, 2)}
            onChange={(e) => {
              try {
                onChange(p, JSON.parse(e.target.value))
              } catch {
                /* ignore */
              }
            }}
          />
        </label>
      </div>
    </div>
  )
}
