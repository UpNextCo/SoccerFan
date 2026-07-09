type Answer = {
  name: string
  aliases?: string[]
  rarity?: string
  [k: string]: unknown
}

type Hole = {
  holeNumber: number
  prompt: string
  par: number
  target?: number
  hints?: string[]
  answers: Answer[]
  [k: string]: unknown
}

type Puzzle = {
  holes: Hole[]
  totalPar?: number
  [k: string]: unknown
}

export function GolfEditor({
  puzzle,
  locked,
  onChange,
}: {
  puzzle: unknown
  locked: boolean
  onChange: (puzzle: Puzzle) => void
}) {
  const p = puzzle as Puzzle
  const holes = [...(p.holes ?? [])].sort((a, b) => a.holeNumber - b.holeNumber)

  function updateHole(n: number, patch: Partial<Hole>) {
    onChange({
      ...p,
      holes: holes.map((h) => (h.holeNumber === n ? { ...h, ...patch } : h)),
    })
  }

  function updateAnswer(n: number, idx: number, patch: Partial<Answer>) {
    const hole = holes.find((h) => h.holeNumber === n)!
    const answers = hole.answers.map((a, i) => (i === idx ? { ...a, ...patch } : a))
    updateHole(n, { answers })
  }

  function addAnswer(n: number) {
    const hole = holes.find((h) => h.holeNumber === n)!
    updateHole(n, { answers: [...hole.answers, { name: '', aliases: [], rarity: 'common' }] })
  }

  function removeAnswer(n: number, idx: number) {
    const hole = holes.find((h) => h.holeNumber === n)!
    updateHole(n, { answers: hole.answers.filter((_, i) => i !== idx) })
  }

  return (
    <div className="mode-editor">
      <p className="muted">
        {holes.length} holes · total par {p.totalPar ?? holes.reduce((s, h) => s + (h.par || 0), 0)}
      </p>
      {holes.map((h) => (
        <article key={h.holeNumber} className="q-card">
          <header>
            <strong>
              Hole {h.holeNumber} · par {h.par}
            </strong>
          </header>
          <label className="field">
            Prompt
            <textarea
              rows={2}
              value={h.prompt}
              disabled={locked}
              onChange={(e) => updateHole(h.holeNumber, { prompt: e.target.value })}
            />
          </label>
          <div className="row">
            <label className="field">
              Par
              <input
                type="number"
                value={h.par}
                disabled={locked}
                onChange={(e) => updateHole(h.holeNumber, { par: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              Target
              <input
                type="number"
                value={h.target ?? ''}
                disabled={locked}
                onChange={(e) =>
                  updateHole(h.holeNumber, {
                    target: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <label className="field">
            Hints (one per line)
            <textarea
              rows={2}
              value={(h.hints ?? []).join('\n')}
              disabled={locked}
              onChange={(e) =>
                updateHole(h.holeNumber, {
                  hints: e.target.value.split('\n').filter(Boolean),
                })
              }
            />
          </label>
          <fieldset disabled={locked} className="options">
            <legend>Answers</legend>
            {h.answers.map((ans, idx) => (
              <div key={idx} className="option-row stack">
                <div className="row">
                  <input
                    className="grow"
                    value={ans.name}
                    placeholder="Name"
                    onChange={(e) => updateAnswer(h.holeNumber, idx, { name: e.target.value })}
                  />
                  <input
                    value={ans.rarity ?? ''}
                    placeholder="rarity"
                    style={{ width: 100 }}
                    onChange={(e) => updateAnswer(h.holeNumber, idx, { rarity: e.target.value })}
                  />
                  <button type="button" className="ghost tiny-btn" onClick={() => removeAnswer(h.holeNumber, idx)}>
                    ×
                  </button>
                </div>
                <input
                  value={(ans.aliases ?? []).join(', ')}
                  placeholder="Aliases, comma-separated"
                  onChange={(e) =>
                    updateAnswer(h.holeNumber, idx, {
                      aliases: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
            ))}
            <button type="button" className="ghost" onClick={() => addAnswer(h.holeNumber)}>
              + Answer
            </button>
          </fieldset>
        </article>
      ))}
    </div>
  )
}
