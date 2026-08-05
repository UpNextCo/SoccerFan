import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { EntityPicker } from '../components/EntityPicker'
import './game-editors.css'
import './club-chain-editor.css'

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

type PathPlayer = {
  id: string
  name: string
  headshotUrl?: string
}

const EMPTY_ANSWER: Answer = {}
/** Keep in sync with backend clubChainGenerator EXTRA_MOVES. */
const EXTRA_MOVES = 4

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
  const a = (answer as Answer | null) ?? EMPTY_ANSWER
  const pathIds = a.shortestPathPlayerIds ?? []
  const pathKey = pathIds.join('|')
  const [pathPlayers, setPathPlayers] = useState<Record<string, PathPlayer>>({})
  const [recomputing, setRecomputing] = useState(false)
  const [recomputeError, setRecomputeError] = useState<string | null>(null)
  const latestRef = useRef({ p, a })
  const recomputeSeq = useRef(0)

  useEffect(() => {
    latestRef.current = { p, a }
  }, [p, a])

  function commit(nextPuzzle: Puzzle, nextAnswer: Answer) {
    latestRef.current = { p: nextPuzzle, a: nextAnswer }
    onChange(nextPuzzle, nextAnswer)
  }

  async function recomputeBestPath(startId: string, targetId: string) {
    if (!startId || !targetId || startId === targetId) return
    const seq = ++recomputeSeq.current
    setRecomputing(true)
    setRecomputeError(null)
    try {
      const path = await api.recomputeClubChain({
        startPlayerId: startId,
        targetPlayerId: targetId,
      })
      if (seq !== recomputeSeq.current) return
      const { p: currentPuzzle, a: currentAnswer } = latestRef.current
      commit(
        {
          ...currentPuzzle,
          shortestPathLength: path.shortestPathLength,
          maxMoves: path.shortestPathLength + EXTRA_MOVES,
        },
        {
          ...currentAnswer,
          shortestPathPlayerIds: path.shortestPathPlayerIds,
          shortestPathLength: path.shortestPathLength,
        }
      )
    } catch (err) {
      if (seq !== recomputeSeq.current) return
      // Keep endpoints honest even when the graph has no path — clear the middle steps.
      const { p: currentPuzzle, a: currentAnswer } = latestRef.current
      if (currentPuzzle.start?.id && currentPuzzle.target?.id) {
        commit(
          { ...currentPuzzle, shortestPathLength: 1 },
          {
            ...currentAnswer,
            shortestPathPlayerIds: [currentPuzzle.start.id, currentPuzzle.target.id],
            shortestPathLength: 1,
          }
        )
      }
      setRecomputeError(
        err instanceof Error ? err.message : 'Could not recompute best solution for these endpoints'
      )
    } finally {
      if (seq === recomputeSeq.current) setRecomputing(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    const idsToResolve = pathKey ? pathKey.split('|').filter(Boolean) : []
    if (idsToResolve.length === 0) return

    const known: Record<string, PathPlayer> = {}
    if (p.start?.id) {
      known[p.start.id] = {
        id: p.start.id,
        name: p.start.name,
        headshotUrl: p.start.headshotUrl,
      }
    }
    if (p.target?.id) {
      known[p.target.id] = {
        id: p.target.id,
        name: p.target.name,
        headshotUrl: p.target.headshotUrl,
      }
    }
    setPathPlayers((current) => ({ ...current, ...known }))

    const unresolvedIds = idsToResolve.filter((id) => !known[id]?.headshotUrl)
    if (unresolvedIds.length === 0) return

    void Promise.all(
      unresolvedIds.map(async (id) => {
        try {
          const player = (await api.resolvePlayer(id, 'card')) as {
            id?: string
            name?: string
            headshotUrl?: string
          }
          return [
            id,
            {
              id,
              name: player.name || known[id]?.name || 'Unknown player',
              headshotUrl: player.headshotUrl,
            },
          ] as const
        } catch {
          return [id, { id, name: known[id]?.name || 'Unknown player' }] as const
        }
      })
    ).then((entries) => {
      if (!cancelled) {
        setPathPlayers((current) => ({ ...current, ...Object.fromEntries(entries) }))
      }
    })
    return () => {
      cancelled = true
    }
  }, [pathKey, p.start?.id, p.start?.headshotUrl, p.start?.name, p.target?.id, p.target?.headshotUrl, p.target?.name])

  function commitPath(nextPath: string[]) {
    const { p: currentPuzzle, a: currentAnswer } = latestRef.current
    const length = Math.max(0, nextPath.length - 1)
    commit(
      { ...currentPuzzle, shortestPathLength: length },
      { ...currentAnswer, shortestPathPlayerIds: nextPath, shortestPathLength: length }
    )
  }

  async function pickEndpoint(
    which: 'start' | 'target',
    hit: { id: string; name: string; club?: string; nationality?: string; position?: string; headshotUrl?: string }
  ) {
    let resolved: PlayerRef = {
      id: hit.id,
      name: hit.name,
      club: hit.club,
      nationality: hit.nationality,
      position: hit.position,
      headshotUrl: hit.headshotUrl,
    }
    try {
      const full = (await api.resolvePlayer(hit.id, 'card')) as PlayerRef
      resolved = {
        id: full.id || hit.id,
        name: full.name || hit.name,
        club: full.club ?? hit.club,
        nationality: full.nationality ?? hit.nationality,
        position: full.position ?? hit.position,
        headshotUrl: full.headshotUrl ?? hit.headshotUrl,
      }
    } catch {
      // search hit is enough
    }
    const nextCard: PlayerRef = {
      id: resolved.id,
      name: resolved.name,
      club: resolved.club,
      nationality: resolved.nationality,
      position: resolved.position,
      headshotUrl: resolved.headshotUrl,
    }
    const { p: currentPuzzle, a: currentAnswer } = latestRef.current
    const nextPuzzle = { ...currentPuzzle, [which]: nextCard }
    setPathPlayers((current) => ({
      ...current,
      [resolved.id]: {
        id: resolved.id,
        name: resolved.name,
        headshotUrl: resolved.headshotUrl,
      },
    }))
    // Commit endpoint change immediately, then rebuild the shortest-path example.
    commit(nextPuzzle, currentAnswer)
    const startId = which === 'start' ? resolved.id : nextPuzzle.start?.id
    const targetId = which === 'target' ? resolved.id : nextPuzzle.target?.id
    if (startId && targetId && startId !== targetId) {
      await recomputeBestPath(startId, targetId)
    } else {
      setRecomputeError('Start and target must be different players.')
    }
  }

  async function pickPathPlayer(
    idx: number,
    hit: { id: string; name: string; headshotUrl?: string }
  ) {
    let resolved = {
      id: hit.id,
      name: hit.name,
      headshotUrl: hit.headshotUrl,
    }
    try {
      const full = (await api.resolvePlayer(hit.id, 'card')) as {
        id?: string
        name?: string
        headshotUrl?: string
      }
      resolved = {
        id: full.id || hit.id,
        name: full.name || hit.name,
        headshotUrl: full.headshotUrl ?? hit.headshotUrl,
      }
    } catch {
      // Search result still provides a valid local reference.
    }
    const currentPath = latestRef.current.a.shortestPathPlayerIds ?? []
    const nextPath = currentPath.map((id, i) => (i === idx ? resolved.id : id))
    setPathPlayers((current) => ({ ...current, [resolved.id]: resolved }))
    commitPath(nextPath)
  }

  function addPathStep() {
    if (!p.start?.id || !p.target?.id) return
    const basePath = pathIds.length >= 2 ? pathIds : [p.start.id, p.target.id]
    commitPath([...basePath.slice(0, -1), '', basePath[basePath.length - 1]!])
  }

  function removePathStep(idx: number) {
    if (idx <= 0 || idx >= pathIds.length - 1) return
    commitPath(pathIds.filter((_, index) => index !== idx))
  }

  function movePathStep(idx: number, offset: -1 | 1) {
    const target = idx + offset
    if (idx <= 0 || idx >= pathIds.length - 1 || target <= 0 || target >= pathIds.length - 1) {
      return
    }
    const nextPath = [...pathIds]
    ;[nextPath[idx], nextPath[target]] = [nextPath[target]!, nextPath[idx]!]
    commitPath(nextPath)
  }

  function pathLabel(id: string, index: number): string {
    if (index === 0) return p.start?.name || pathPlayers[id]?.name || 'Start'
    if (index === pathIds.length - 1) return p.target?.name || pathPlayers[id]?.name || 'Target'
    return pathPlayers[id]?.name || 'Unknown player'
  }

  function pathImage(id: string, index: number): string | undefined {
    if (index === 0) return p.start?.headshotUrl ?? pathPlayers[id]?.headshotUrl
    if (index === pathIds.length - 1) return p.target?.headshotUrl ?? pathPlayers[id]?.headshotUrl
    return pathPlayers[id]?.headshotUrl
  }

  const warnings: string[] = []
  if (pathIds.length < 2) warnings.push('The solution needs a start and target player.')
  if (pathIds.some((id) => !id)) warnings.push('One or more path steps has no player selected.')
  if (pathIds.length >= 1 && p.start?.id && pathIds[0] !== p.start.id) {
    warnings.push('The first path player does not match the selected start player.')
  }
  if (pathIds.length >= 2 && p.target?.id && pathIds[pathIds.length - 1] !== p.target.id) {
    warnings.push('The last path player does not match the selected target player.')
  }
  if (p.shortestPathLength !== Math.max(0, pathIds.length - 1)) {
    warnings.push('Puzzle path length is out of sync; editing the path will synchronize it.')
  }
  if (a.shortestPathLength !== Math.max(0, pathIds.length - 1)) {
    warnings.push('Answer path length is out of sync; editing the path will synchronize it.')
  }

  return (
    <div className="mode-editor club-chain-editor">
      <div className="editor-clean-section">
        <header>
          <strong>Chain endpoints</strong>
          <span className="muted tiny">Choose the fixed start and target players</span>
        </header>
        <div className="club-chain-endpoints">
          <div className="club-chain-endpoint">
            <EntityPicker
              key={`start-${p.start?.id}-${p.start?.headshotUrl ?? ''}`}
              kind="player"
              label="Start player"
              valueLabel={p.start?.name}
              imageUrl={p.start?.headshotUrl}
              nationality={p.start?.nationality}
              disabled={locked}
              onPickPlayer={(hit) => pickEndpoint('start', hit)}
            />
            <p className="muted tiny">
              {[p.start?.club, p.start?.nationality, p.start?.position].filter(Boolean).join(' · ') || 'No player details'}
            </p>
          </div>
          <div className="club-chain-endpoint">
            <EntityPicker
              key={`target-${p.target?.id}-${p.target?.headshotUrl ?? ''}`}
              kind="player"
              label="Target player"
              valueLabel={p.target?.name}
              imageUrl={p.target?.headshotUrl}
              nationality={p.target?.nationality}
              disabled={locked}
              onPickPlayer={(hit) => pickEndpoint('target', hit)}
            />
            <p className="muted tiny">
              {[p.target?.club, p.target?.nationality, p.target?.position].filter(Boolean).join(' · ') || 'No player details'}
            </p>
          </div>
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
            Difficulty {p.difficulty ?? '?'} · fastest path{' '}
            {p.shortestPathLength == null
              ? '?'
              : Math.max(0, p.shortestPathLength - 1)}
          </p>
        </div>
      </div>

      <section className="editor-clean-section">
        <header>
          <strong>Best solution</strong>
          <span className="muted tiny">
            {Math.max(0, pathIds.length - 2)} player
            {Math.max(0, pathIds.length - 2) === 1 ? '' : 's'} to enter ·{' '}
            {Math.max(0, pathIds.length - 1)} connections
          </span>
        </header>
        {warnings.map((warning) => (
          <p className="warning-box" key={warning}>{warning}</p>
        ))}
        {pathIds.length === 0 ? (
          <p className="muted">No solution yet. Add a step to start with the selected players.</p>
        ) : (
          <div className="club-chain-path">
            {pathIds.map((id, i) => (
              <div
                key={`${i}-${id}`}
                className={`club-chain-step${i === 0 || i === pathIds.length - 1 ? ' endpoint' : ''}`}
              >
                <div className="card-heading">
                  <strong>{i === 0 ? 'Start' : i === pathIds.length - 1 ? 'Target' : `Player ${i}`}</strong>
                  {i > 0 && i < pathIds.length - 1 && (
                    <div className="button-row">
                      <button type="button" className="ghost tiny-btn" disabled={locked || i === 1} onClick={() => movePathStep(i, -1)} aria-label={`Move player ${i} earlier`} title="Move earlier">←</button>
                      <button type="button" className="ghost tiny-btn" disabled={locked || i === pathIds.length - 2} onClick={() => movePathStep(i, 1)} aria-label={`Move player ${i} later`} title="Move later">→</button>
                      <button type="button" className="ghost tiny-btn" disabled={locked} onClick={() => removePathStep(i)} aria-label={`Remove player ${i} from path`} title="Remove player">×</button>
                    </div>
                  )}
                </div>
                <EntityPicker
                  key={`${i}-${id}-${pathImage(id, i) ?? ''}-${pathLabel(id, i)}`}
                  kind="player"
                  valueLabel={pathLabel(id, i)}
                  imageUrl={pathImage(id, i)}
                  disabled={locked || i === 0 || i === pathIds.length - 1}
                  placeholder={i === 0 || i === pathIds.length - 1 ? undefined : 'Search path player…'}
                  onPickPlayer={(hit) => pickPathPlayer(i, hit)}
                />
              </div>
            ))}
          </div>
        )}
        {recomputing && (
          <p className="muted tiny">Recomputing best solution for these endpoints…</p>
        )}
        {recomputeError && (
          <p className="warning-box">{recomputeError}</p>
        )}
        <div className="editor-toolbar">
          <span className="muted tiny">
            Changing start/target rebuilds this path automatically.
          </span>
          <div className="button-row">
            <button
              type="button"
              className="ghost"
              disabled={locked || recomputing || !p.start?.id || !p.target?.id}
              onClick={() => {
                if (p.start?.id && p.target?.id) void recomputeBestPath(p.start.id, p.target.id)
              }}
            >
              {recomputing ? 'Recomputing…' : 'Recompute best path'}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={locked || !p.start?.id || !p.target?.id}
              onClick={addPathStep}
            >
              + Add path step
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
