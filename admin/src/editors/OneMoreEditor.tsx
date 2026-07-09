type Opt = {
  id: string
  name?: string
  value?: number
  nationality?: string
  [k: string]: unknown
}

type Round = {
  options: Opt[]
  [k: string]: unknown
}

type Puzzle = {
  rounds: Round[]
  [k: string]: unknown
}

type Answer = {
  valuesByRound?: Array<Record<string, number>>
  [k: string]: unknown
}

export function OneMoreEditor({
  puzzle,
  answer,
  locked,
  onChange,
}: {
  puzzle: unknown
  answer: unknown
  locked: boolean
  onChange: (puzzle: Puzzle, answer: Answer) => void
}) {
  const p = puzzle as Puzzle
  const a = (answer as Answer) ?? {}
  const rounds = p.rounds ?? []
  const valuesByRound: Array<Record<string, number>> =
    a.valuesByRound ?? rounds.map(() => ({} as Record<string, number>))

  function updateOpt(ri: number, oi: number, patch: Partial<Opt>) {
    const nextRounds = rounds.map((r, i) => {
      if (i !== ri) return r
      return {
        ...r,
        options: r.options.map((o, j) => (j === oi ? { ...o, ...patch } : o)),
      }
    })
    onChange({ ...p, rounds: nextRounds }, a)
  }

  function updateValue(ri: number, optId: string, value: number) {
    const next = valuesByRound.map((row, i) =>
      i === ri ? { ...row, [optId]: value } : row
    )
    const nextRounds = rounds.map((r, i) => {
      if (i !== ri) return r
      return {
        ...r,
        options: r.options.map((o) => (o.id === optId ? { ...o, value } : o)),
      }
    })
    onChange({ ...p, rounds: nextRounds }, { ...a, valuesByRound: next })
  }

  return (
    <div className="mode-editor">
      {rounds.map((r, ri) => (
        <article key={ri} className="q-card">
          <header>
            <strong>Round {ri + 1}</strong>
          </header>
          {r.options.map((o, oi) => {
            const row = valuesByRound[ri] ?? {}
            const hidden = row[o.id] ?? o.value ?? ''
            return (
              <div key={o.id} className="option-row">
                <input
                  className="grow"
                  value={o.name ?? ''}
                  disabled={locked}
                  onChange={(e) => updateOpt(ri, oi, { name: e.target.value })}
                />
                <input
                  type="number"
                  style={{ width: 90 }}
                  value={hidden}
                  disabled={locked}
                  title="Hidden value"
                  onChange={(e) => updateValue(ri, o.id, Number(e.target.value))}
                />
                <span className="muted tiny">{o.id}</span>
              </div>
            )
          })}
        </article>
      ))}
    </div>
  )
}
