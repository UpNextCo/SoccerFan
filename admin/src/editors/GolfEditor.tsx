import { api } from '../api'
import { EntityPicker } from '../components/EntityPicker'

type Answer = {
  id?: string
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

  async function pickAnswer(
    n: number,
    idx: number,
    hit: { id: string; name: string }
  ) {
    let resolved = { id: hit.id, name: hit.name, aliases: [] as string[] }
    try {
      const full = (await api.resolvePlayer(hit.id, 'golf')) as typeof resolved
      resolved = {
        id: full.id || hit.id,
        name: full.name || hit.name,
        aliases: full.aliases ?? [],
      }
    } catch {
      // search hit is enough
    }
    const hole = holes.find((h) => h.holeNumber === n)!
    const prev = hole.answers[idx]!
    updateAnswer(n, idx, {
      id: resolved.id,
      name: resolved.name,
      aliases: resolved.aliases,
      rarity: prev.rarity ?? 'common',
    })
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
            <legend>Answers (search player to set id + aliases)</legend>
            {h.answers.map((ans, idx) => (
              <div key={ans.id ?? idx} className="option-row stack">
                <div className="row">
                  <EntityPicker
                    key={`${ans.id ?? idx}-${ans.name}`}
                    kind="player"
                    valueLabel={ans.name || undefined}
                    disabled={locked}
                    onPickPlayer={(hit) => pickAnswer(h.holeNumber, idx, hit)}
                  />
                  <input
                    value={ans.rarity ?? ''}
                    placeholder="rarity"
                    style={{ width: 100 }}
                    disabled={locked}
                    onChange={(e) => updateAnswer(h.holeNumber, idx, { rarity: e.target.value })}
                  />
                  <button
                    type="button"
                    className="ghost tiny-btn"
                    disabled={locked}
                    onClick={() => removeAnswer(h.holeNumber, idx)}
                  >
                    ×
                  </button>
                </div>
                <input
                  value={(ans.aliases ?? []).join(', ')}
                  placeholder="Aliases, comma-separated"
                  disabled={locked}
                  onChange={(e) =>
                    updateAnswer(h.holeNumber, idx, {
                      aliases: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
                {ans.id && <span className="muted tiny">{ans.id}</span>}
              </div>
            ))}
            <button type="button" className="ghost" disabled={locked} onClick={() => addAnswer(h.holeNumber)}>
              + Answer
            </button>
          </fieldset>
        </article>
      ))}
    </div>
  )
}
