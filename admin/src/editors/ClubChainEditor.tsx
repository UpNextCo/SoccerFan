type PlayerRef = {
  id: string
  name: string
  [k: string]: unknown
}

type Puzzle = {
  start: PlayerRef
  target: PlayerRef
  maxMoves?: number
  shortestPathLength?: number
  difficulty?: string
  [k: string]: unknown
}

type Answer = {
  shortestPathPlayerIds?: string[]
  shortestPathLength?: number
  [k: string]: unknown
}

export function ClubChainEditor({
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
  const pathIds = a.shortestPathPlayerIds ?? []

  return (
    <div className="mode-editor">
      <div className="q-card">
        <div className="row">
          <label className="field">
            Start player
            <input
              value={p.start?.name ?? ''}
              disabled={locked}
              onChange={(e) =>
                onChange({ ...p, start: { ...p.start, name: e.target.value } }, a)
              }
            />
            <span className="muted tiny">{p.start?.id}</span>
          </label>
          <label className="field">
            Target player
            <input
              value={p.target?.name ?? ''}
              disabled={locked}
              onChange={(e) =>
                onChange({ ...p, target: { ...p.target, name: e.target.value } }, a)
              }
            />
            <span className="muted tiny">{p.target?.id}</span>
          </label>
        </div>
        <div className="row">
          <label className="field">
            Max moves
            <input
              type="number"
              value={p.maxMoves ?? ''}
              disabled={locked}
              onChange={(e) => onChange({ ...p, maxMoves: Number(e.target.value) }, a)}
            />
          </label>
          <p className="muted">
            Difficulty {p.difficulty ?? '?'} · par {p.shortestPathLength ?? '?'}
          </p>
        </div>
      </div>

      <section className="q-card">
        <header>
          <strong>Shortest path player IDs (answer_json)</strong>
        </header>
        {pathIds.length === 0 ? (
          <p className="muted">No path stored</p>
        ) : (
          <ol className="lineup">
            {pathIds.map((id, i) => (
              <li key={i}>
                <code>{id}</code>
              </li>
            ))}
          </ol>
        )}
        <label className="field">
          shortestPathPlayerIds (JSON array)
          <textarea
            rows={6}
            disabled={locked}
            value={JSON.stringify(pathIds, null, 2)}
            onChange={(e) => {
              try {
                const ids = JSON.parse(e.target.value) as string[]
                onChange(p, {
                  ...a,
                  shortestPathPlayerIds: ids,
                  shortestPathLength: ids.length > 0 ? ids.length - 1 : a.shortestPathLength,
                })
              } catch {
                /* ignore */
              }
            }}
          />
        </label>
      </section>
    </div>
  )
}
