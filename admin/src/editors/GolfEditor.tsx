import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { EntityPicker } from '../components/EntityPicker'
import './game-editors.css'

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

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const

function normalizeHoles(holes: Hole[]): Hole[] {
  return holes.map((hole, index) => ({ ...hole, holeNumber: index + 1 }))
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
  const puzzleRef = useRef(p)
  const [activeIndex, setActiveIndex] = useState(0)
  const activeHole = holes[Math.min(activeIndex, Math.max(holes.length - 1, 0))]
  const computedPar = holes.reduce((sum, hole) => sum + (Number.isFinite(hole.par) ? hole.par : 0), 0)

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(holes.length - 1, 0)))
  }, [holes.length])

  useEffect(() => {
    puzzleRef.current = p
  }, [p])

  function commitHoles(nextHoles: Hole[]) {
    const normalized = normalizeHoles(nextHoles)
    const nextPuzzle = {
      ...puzzleRef.current,
      holes: normalized,
      totalPar: normalized.reduce(
        (sum, hole) => sum + (Number.isFinite(hole.par) ? hole.par : 0),
        0
      ),
    }
    puzzleRef.current = nextPuzzle
    onChange(nextPuzzle)
  }

  function updateHole(n: number, patch: Partial<Hole>) {
    commitHoles(
      (puzzleRef.current.holes ?? []).map((h) =>
        h.holeNumber === n ? { ...h, ...patch } : h
      )
    )
  }

  function updateAnswer(n: number, idx: number, patch: Partial<Answer>) {
    const hole = puzzleRef.current.holes.find((h) => h.holeNumber === n)
    if (!hole) return
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
    const hole = puzzleRef.current.holes.find((h) => h.holeNumber === n)
    if (!hole?.answers[idx]) return
    const prev = hole.answers[idx]!
    updateAnswer(n, idx, {
      id: resolved.id,
      name: resolved.name,
      aliases: resolved.aliases,
      rarity: prev.rarity ?? 'common',
    })
  }

  function addAnswer(n: number) {
    const hole = puzzleRef.current.holes.find((h) => h.holeNumber === n)
    if (!hole) return
    updateHole(n, { answers: [...hole.answers, { name: '', aliases: [], rarity: 'common' }] })
  }

  function removeAnswer(n: number, idx: number) {
    const hole = puzzleRef.current.holes.find((h) => h.holeNumber === n)
    if (!hole) return
    updateHole(n, { answers: hole.answers.filter((_, i) => i !== idx) })
  }

  function addHole() {
    commitHoles([
      ...holes,
      {
        holeNumber: holes.length + 1,
        prompt: '',
        par: 3,
        hints: [],
        answers: [],
      },
    ])
    setActiveIndex(holes.length)
  }

  function removeHole() {
    if (!activeHole || holes.length <= 1) return
    commitHoles(holes.filter((hole) => hole.holeNumber !== activeHole.holeNumber))
    setActiveIndex((index) => Math.max(0, index - 1))
  }

  function moveHole(offset: -1 | 1) {
    const targetIndex = activeIndex + offset
    if (!activeHole || targetIndex < 0 || targetIndex >= holes.length) return
    const next = [...holes]
    ;[next[activeIndex], next[targetIndex]] = [next[targetIndex]!, next[activeIndex]!]
    commitHoles(next)
    setActiveIndex(targetIndex)
  }

  function addHint() {
    if (!activeHole) return
    updateHole(activeHole.holeNumber, { hints: [...(activeHole.hints ?? []), 'New hint'] })
  }

  return (
    <div className="mode-editor">
      <div className="editor-summary">
        <div>
          <span className="muted tiny">Course</span>
          <strong>{holes.length} holes</strong>
        </div>
        <div>
          <span className="muted tiny">Total par</span>
          <strong>{computedPar}</strong>
        </div>
        <div>
          <span className="muted tiny">Stored total</span>
          <strong>{p.totalPar ?? 'Not set'}</strong>
        </div>
      </div>

      {holes.length === 0 ? (
        <div className="warning-box">
          This course has no holes. Add a hole before saving.
          <div className="editor-toolbar">
            <button type="button" disabled={locked} onClick={addHole}>+ Add first hole</button>
          </div>
        </div>
      ) : (
        <>
          <nav className="hole-nav" aria-label="Golf holes">
            <button
              type="button"
              className="ghost"
              disabled={activeIndex === 0}
              onClick={() => setActiveIndex((index) => index - 1)}
            >
              ← Previous
            </button>
            <div className="hole-tabs">
              {holes.map((hole, index) => (
                <button
                  key={hole.holeNumber}
                  type="button"
                  className={`ghost hole-tab${index === activeIndex ? ' active' : ''}`}
                  onClick={() => setActiveIndex(index)}
                >
                  {hole.holeNumber}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="ghost"
              disabled={activeIndex === holes.length - 1}
              onClick={() => setActiveIndex((index) => index + 1)}
            >
              Next →
            </button>
          </nav>

          {activeHole && (
        <article key={activeHole.holeNumber} className="q-card">
          <header>
            <strong>
              Hole {activeHole.holeNumber} · par {activeHole.par}
            </strong>
            <div className="button-row">
              <button type="button" className="ghost tiny-btn" disabled={locked || activeIndex === 0} onClick={() => moveHole(-1)}>← Move</button>
              <button type="button" className="ghost tiny-btn" disabled={locked || activeIndex === holes.length - 1} onClick={() => moveHole(1)}>Move →</button>
              <button type="button" className="ghost tiny-btn" disabled={locked || holes.length <= 1} onClick={removeHole}>Remove hole</button>
            </div>
          </header>
          {holes.length <= 1 && (
            <p className="warning-box">A course must keep at least one hole; removal is disabled.</p>
          )}
          <label className="field">
            Prompt
            <textarea
              rows={2}
              value={activeHole.prompt}
              disabled={locked}
              onChange={(e) => updateHole(activeHole.holeNumber, { prompt: e.target.value })}
            />
          </label>
          <div className="row">
            <label className="field">
              Par
              <input
                type="number"
                value={activeHole.par}
                disabled={locked}
                min={1}
                onChange={(e) => updateHole(activeHole.holeNumber, { par: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              Target
              <input
                type="number"
                value={activeHole.target ?? ''}
                disabled={locked}
                onChange={(e) =>
                  updateHole(activeHole.holeNumber, {
                    target: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <div className="field">
            <span>Hint chips</span>
            <div className="chip-list">
              {(activeHole.hints ?? []).map((hint, index) => (
                <span className="hint-chip" key={`${index}-${hint}`}>
                  {hint || 'Empty hint'}
                  <button
                    type="button"
                    disabled={locked}
                    aria-label={`Remove hint ${index + 1}`}
                    onClick={() =>
                      updateHole(activeHole.holeNumber, {
                        hints: (activeHole.hints ?? []).filter((_, i) => i !== index),
                      })
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
              <button type="button" className="ghost tiny-btn" disabled={locked} onClick={addHint}>+ Hint</button>
            </div>
          </div>
          <label className="field">
            Hints (one per line)
            <textarea
              rows={3}
              value={(activeHole.hints ?? []).join('\n')}
              disabled={locked}
              onChange={(e) =>
                updateHole(activeHole.holeNumber, {
                  hints: e.target.value.split('\n'),
                })
              }
            />
          </label>
          <fieldset disabled={locked} className="options">
            <legend>Answers (search player to set id + aliases)</legend>
            {activeHole.answers.length === 0 && (
              <p className="warning-box">This hole has no accepted answers.</p>
            )}
            {activeHole.answers.map((ans, idx) => (
              <div key={ans.id ?? idx} className="answer-card option-row stack">
                <div className="row">
                  <EntityPicker
                    key={`${ans.id ?? idx}-${ans.name}`}
                    kind="player"
                    valueLabel={ans.name || undefined}
                    disabled={locked}
                    onPickPlayer={(hit) => pickAnswer(activeHole.holeNumber, idx, hit)}
                  />
                  <select
                    value={RARITIES.includes(ans.rarity as (typeof RARITIES)[number]) ? ans.rarity : 'common'}
                    disabled={locked}
                    aria-label={`Answer ${idx + 1} rarity`}
                    onChange={(e) => updateAnswer(activeHole.holeNumber, idx, { rarity: e.target.value })}
                  >
                    {RARITIES.map((rarity) => <option key={rarity} value={rarity}>{rarity}</option>)}
                  </select>
                  <button
                    type="button"
                    className="ghost tiny-btn"
                    disabled={locked}
                    onClick={() => removeAnswer(activeHole.holeNumber, idx)}
                  >
                    ×
                  </button>
                </div>
                <input
                  value={(ans.aliases ?? []).join(', ')}
                  placeholder="Aliases, comma-separated"
                  disabled={locked}
                  onChange={(e) =>
                    updateAnswer(activeHole.holeNumber, idx, {
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
            <button type="button" className="ghost" disabled={locked} onClick={() => addAnswer(activeHole.holeNumber)}>
              + Answer
            </button>
          </fieldset>
        </article>
          )}
          <div className="editor-toolbar">
            <span className="muted tiny">Hole order and numbering stay synchronized.</span>
            <button type="button" disabled={locked} onClick={addHole}>+ Add hole</button>
          </div>
        </>
      )}
    </div>
  )
}
