type Constraint = {
  id?: string
  label?: string
  [k: string]: unknown
}

type LineupPick = {
  position?: string
  constraintLabel?: string
  playerName?: string
  statValue?: number
  [k: string]: unknown
}

type Puzzle = {
  category?: { title?: string; id?: string; [k: string]: unknown }
  formationId?: string
  constraints?: Constraint[]
  optimalScore?: number
  optimalLineup?: LineupPick[]
  [k: string]: unknown
}

export function DraftEditor({
  puzzle,
  locked,
  onChange,
}: {
  puzzle: unknown
  locked: boolean
  onChange: (puzzle: Puzzle) => void
}) {
  const p = puzzle as Puzzle
  const constraints = p.constraints ?? []
  const lineup = p.optimalLineup ?? []

  return (
    <div className="mode-editor">
      <div className="q-card">
        <label className="field">
          Category title
          <input
            value={p.category?.title ?? ''}
            disabled={locked}
            onChange={(e) =>
              onChange({
                ...p,
                category: { ...(p.category ?? {}), title: e.target.value },
              })
            }
          />
        </label>
        <div className="row">
          <label className="field">
            Formation
            <input
              value={p.formationId ?? ''}
              disabled={locked}
              onChange={(e) => onChange({ ...p, formationId: e.target.value })}
            />
          </label>
          <label className="field">
            Optimal score
            <input
              type="number"
              value={p.optimalScore ?? ''}
              disabled={locked}
              onChange={(e) => onChange({ ...p, optimalScore: Number(e.target.value) })}
            />
          </label>
        </div>
      </div>

      <section className="q-card">
        <header>
          <strong>Constraints ({constraints.length})</strong>
        </header>
        {constraints.map((c, idx) => (
          <label key={c.id ?? idx} className="field">
            <input
              value={(c.label as string) ?? ''}
              disabled={locked}
              onChange={(e) => {
                const next = constraints.map((x, i) =>
                  i === idx ? { ...x, label: e.target.value } : x
                )
                onChange({ ...p, constraints: next })
              }}
            />
          </label>
        ))}
      </section>

      <section className="q-card">
        <header>
          <strong>Optimal lineup (QA)</strong>
        </header>
        <ul className="lineup">
          {lineup.map((pick, i) => (
            <li key={i}>
              <strong>{pick.position}</strong> · {pick.constraintLabel} → {pick.playerName} (
              {pick.statValue})
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
