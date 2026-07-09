type Cat = {
  id?: string
  title?: string
  label?: string
  matchingRule?: unknown
  iconType?: string
  [k: string]: unknown
}

type Player = {
  id?: string
  name?: string
  displayName?: string
  [k: string]: unknown
}

type Puzzle = {
  categories: Cat[]
  players: Player[]
  [k: string]: unknown
}

export function BingoEditor({
  puzzle,
  locked,
  onChange,
}: {
  puzzle: unknown
  locked: boolean
  onChange: (puzzle: Puzzle) => void
}) {
  const p = puzzle as Puzzle
  const categories = p.categories ?? []
  const players = p.players ?? []

  function updateCat(idx: number, patch: Partial<Cat>) {
    onChange({
      ...p,
      categories: categories.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    })
  }

  function updatePlayer(idx: number, patch: Partial<Player>) {
    onChange({
      ...p,
      players: players.map((pl, i) => (i === idx ? { ...pl, ...patch } : pl)),
    })
  }

  return (
    <div className="mode-editor">
      <section className="q-card">
        <header>
          <strong>Categories ({categories.length})</strong>
        </header>
        {categories.map((c, idx) => (
          <div key={c.id ?? idx} className="bingo-cat">
            <label className="field">
              Title
              <input
                value={(c.title as string) ?? (c.label as string) ?? ''}
                disabled={locked}
                onChange={(e) => updateCat(idx, { title: e.target.value, label: e.target.value })}
              />
            </label>
            <p className="muted tiny">
              {String(c.iconType ?? '')} · rule:{' '}
              <code>{JSON.stringify(c.matchingRule ?? null).slice(0, 80)}</code>
            </p>
            <label className="field">
              matchingRule (JSON — edit carefully)
              <textarea
                rows={2}
                disabled={locked}
                value={JSON.stringify(c.matchingRule ?? null, null, 0)}
                onChange={(e) => {
                  try {
                    updateCat(idx, { matchingRule: JSON.parse(e.target.value) })
                  } catch {
                    /* ignore while typing */
                  }
                }}
              />
            </label>
          </div>
        ))}
      </section>

      <section className="q-card">
        <header>
          <strong>Player pool ({players.length})</strong>
        </header>
        <div className="player-grid">
          {players.map((pl, idx) => (
            <label key={pl.id ?? idx} className="field compact">
              <input
                value={(pl.name as string) ?? (pl.displayName as string) ?? ''}
                disabled={locked}
                onChange={(e) => updatePlayer(idx, { name: e.target.value, displayName: e.target.value })}
              />
              <span className="muted tiny">{String(pl.id ?? '').slice(0, 8)}</span>
            </label>
          ))}
        </div>
      </section>
    </div>
  )
}
