import { api } from '../api'
import { EntityPicker } from '../components/EntityPicker'

type PlayerRef = {
  id: string
  name: string
  club?: string
  nationality?: string
  position?: string
  headshotUrl?: string
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

  async function pickEndpoint(which: 'start' | 'target', playerId: string) {
    const resolved = (await api.resolvePlayer(playerId, 'card')) as PlayerRef
    const nextCard: PlayerRef = {
      id: resolved.id,
      name: resolved.name,
      club: resolved.club,
      nationality: resolved.nationality,
      position: resolved.position,
      headshotUrl: resolved.headshotUrl,
    }
    const nextPuzzle = { ...p, [which]: nextCard }
    // Keep answer path endpoints in sync when start/target change.
    let nextAns = a
    if (pathIds.length >= 2) {
      const nextPath = [...pathIds]
      if (which === 'start') nextPath[0] = resolved.id
      if (which === 'target') nextPath[nextPath.length - 1] = resolved.id
      nextAns = { ...a, shortestPathPlayerIds: nextPath }
    }
    onChange(nextPuzzle, nextAns)
  }

  async function pickPathPlayer(idx: number, playerId: string) {
    const resolved = (await api.resolvePlayer(playerId, 'card')) as { id: string; name: string }
    const nextPath = pathIds.map((id, i) => (i === idx ? resolved.id : id))
    onChange(p, {
      ...a,
      shortestPathPlayerIds: nextPath,
      shortestPathLength: nextPath.length > 0 ? nextPath.length - 1 : a.shortestPathLength,
    })
  }

  return (
    <div className="mode-editor">
      <div className="q-card">
        <div className="row">
          <EntityPicker
            kind="player"
            label="Start player"
            valueLabel={p.start?.name}
            imageUrl={p.start?.headshotUrl}
            disabled={locked}
            onPickPlayer={(hit) => pickEndpoint('start', hit.id)}
          />
          <EntityPicker
            kind="player"
            label="Target player"
            valueLabel={p.target?.name}
            imageUrl={p.target?.headshotUrl}
            disabled={locked}
            onPickPlayer={(hit) => pickEndpoint('target', hit.id)}
          />
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
          <strong>Shortest path (answer_json)</strong>
        </header>
        {pathIds.length === 0 ? (
          <p className="muted">No path stored</p>
        ) : (
          <div className="stack-gap">
            {pathIds.map((id, i) => (
              <EntityPicker
                key={`${i}-${id}`}
                kind="player"
                label={i === 0 ? 'Start' : i === pathIds.length - 1 ? 'Target' : `Step ${i}`}
                valueLabel={id}
                disabled={locked}
                onPickPlayer={(hit) => pickPathPlayer(i, hit.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
