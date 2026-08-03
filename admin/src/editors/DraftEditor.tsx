import { useEffect, useRef, useState } from 'react'
import { api, type AdminLeagueHit, type AdminTeamHit } from '../api'
import { EntityPicker } from '../components/EntityPicker'
import './game-editors.css'

type Constraint = {
  id?: string
  type?: string
  label?: string
  club?: string | null
  teamId?: number | null
  logoUrl?: string | null
  leagueId?: number | null
  leagueName?: string | null
  nationality?: string | null
  [k: string]: unknown
}

type LineupPick = {
  slotId?: string
  position?: string
  constraintId?: string
  constraintLabel?: string
  playerName?: string
  playerId?: string
  headshotUrl?: string | null
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

// Canonical types match the generator / iOS (`nat_league`, `nat_club`). Also accept
// legacy camelCase from older admin saves when reading.
const CONSTRAINT_TYPES = ['club', 'league', 'nationality', 'nat_league', 'nat_club'] as const
type ConstraintType = (typeof CONSTRAINT_TYPES)[number]

const TYPE_LABELS: Record<ConstraintType, string> = {
  club: 'Club',
  league: 'League',
  nationality: 'Nationality',
  nat_league: 'Nationality + league',
  nat_club: 'Nationality + club',
}

function normalizeConstraintType(value: string | undefined | null): ConstraintType | null {
  if (!value) return null
  if (value === 'natLeague') return 'nat_league'
  if (value === 'natClub') return 'nat_club'
  return CONSTRAINT_TYPES.some((type) => type === value) ? (value as ConstraintType) : null
}

const LEAGUE_LOGO_CDN = 'https://media.api-sports.io/football/leagues'

function leagueBadgeUrl(leagueId: number | null | undefined): string | undefined {
  return typeof leagueId === 'number' ? `${LEAGUE_LOGO_CDN}/${leagueId}.png` : undefined
}

/** Club crest or league badge for EntityPicker thumbs. */
function constraintImageUrl(c: Constraint): string | undefined {
  const type = normalizeConstraintType(c.type)
  if (type === 'league' || type === 'nat_league') {
    return c.logoUrl ?? leagueBadgeUrl(c.leagueId) ?? undefined
  }
  if (type === 'club' || type === 'nat_club') {
    return c.logoUrl ?? undefined
  }
  return undefined
}

const POSITION_COMPATIBILITY: Record<string, readonly string[]> = {
  Goalkeeper: ['Goalkeeper'],
  'Centre-Back': ['Centre-Back'],
  'Left-Back': ['Left-Back'],
  'Right-Back': ['Right-Back'],
  'Defensive Midfield': ['Defensive Midfield', 'Central Midfield'],
  'Central Midfield': ['Central Midfield', 'Defensive Midfield', 'Attacking Midfield'],
  'Attacking Midfield': ['Attacking Midfield', 'Central Midfield', 'Second Striker'],
  'Left Midfield': ['Left Midfield', 'Left Winger'],
  'Right Midfield': ['Right Midfield', 'Right Winger'],
  'Left Winger': ['Left Winger', 'Left Midfield'],
  'Right Winger': ['Right Winger', 'Right Midfield'],
  'Centre-Forward': ['Centre-Forward', 'Second Striker'],
  'Second Striker': ['Second Striker', 'Centre-Forward', 'Attacking Midfield'],
}

function additionalPositions(position?: string): string[] {
  if (!position) return []
  return [...(POSITION_COMPATIBILITY[position] ?? [position])].filter((candidate) => candidate !== position)
}

function rebuildLabel(c: Constraint): string {
  const type = normalizeConstraintType(c.type) ?? c.type ?? ''
  if (type === 'club') return c.club ? `Played for ${c.club}` : c.label ?? 'Club'
  if (type === 'league') return c.leagueName ? `${c.leagueName}` : c.label ?? 'League'
  if (type === 'nationality') return c.nationality ?? c.label ?? 'Nationality'
  if (type === 'nat_league') {
    return `${c.nationality ?? '?'} · ${c.leagueName ?? '?'}`
  }
  if (type === 'nat_club') {
    return `${c.nationality ?? '?'} · ${c.club ?? '?'}`
  }
  return c.label ?? type
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
  const puzzleRef = useRef(p)
  const recomputeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recomputeSeq = useRef(0)
  const [recomputing, setRecomputing] = useState(false)
  const [recomputeError, setRecomputeError] = useState<string | null>(null)

  useEffect(() => {
    puzzleRef.current = p
  }, [p])

  useEffect(() => {
    return () => {
      if (recomputeTimer.current) clearTimeout(recomputeTimer.current)
    }
  }, [])

  function commit(next: Puzzle) {
    puzzleRef.current = next
    onChange(next)
  }

  async function refreshOptimalLineup() {
    if (locked) return
    const seq = ++recomputeSeq.current
    setRecomputing(true)
    setRecomputeError(null)
    try {
      const { puzzleJson } = await api.recomputeDraftOptimal(puzzleRef.current)
      if (seq !== recomputeSeq.current) return
      const next = puzzleJson as Puzzle
      commit({
        ...puzzleRef.current,
        constraints: next.constraints ?? puzzleRef.current.constraints,
        optimalScore: next.optimalScore,
        optimalLineup: next.optimalLineup,
      })
    } catch (err) {
      if (seq !== recomputeSeq.current) return
      setRecomputeError(err instanceof Error ? err.message : 'Could not recompute best lineup')
    } finally {
      if (seq === recomputeSeq.current) setRecomputing(false)
    }
  }

  function scheduleOptimalRefresh() {
    if (locked) return
    if (recomputeTimer.current) clearTimeout(recomputeTimer.current)
    recomputeTimer.current = setTimeout(() => {
      void refreshOptimalLineup()
    }, 450)
  }

  function updateConstraint(idx: number, patch: Partial<Constraint>, opts?: { refreshOptimal?: boolean }) {
    const current = puzzleRef.current
    const currentConstraints = current.constraints ?? []
    const currentLineup = current.optimalLineup ?? []
    const next = currentConstraints.map((x, i) => {
      if (i !== idx) return x
      const merged = { ...x, ...patch }
      const normalized = normalizeConstraintType(String(merged.type ?? ''))
      if (normalized) merged.type = normalized
      return { ...merged, label: rebuildLabel(merged) }
    })
    // Keep optimal lineup constraint labels in sync until the solver replaces the XI.
    const updated = next[idx]!
    const nextLineup = currentLineup.map((pick) =>
      pick.constraintId === updated.id
        ? { ...pick, constraintLabel: updated.label }
        : pick
    )
    commit({ ...current, constraints: next, optimalLineup: nextLineup })
    if (opts?.refreshOptimal !== false) scheduleOptimalRefresh()
  }

  function setConstraints(next: Constraint[], opts?: { refreshOptimal?: boolean }) {
    const current = puzzleRef.current
    const labels = new Map(next.map((constraint) => [constraint.id, constraint.label]))
    commit({
      ...current,
      constraints: next,
      optimalLineup: (current.optimalLineup ?? []).map((pick) => ({
        ...pick,
        constraintLabel: pick.constraintId
          ? labels.get(pick.constraintId) ?? pick.constraintLabel
          : pick.constraintLabel,
      })),
    })
    if (opts?.refreshOptimal !== false) scheduleOptimalRefresh()
  }

  function moveConstraint(idx: number, offset: -1 | 1) {
    const currentConstraints = puzzleRef.current.constraints ?? []
    const target = idx + offset
    if (target < 0 || target >= currentConstraints.length) return
    const next = [...currentConstraints]
    ;[next[idx], next[target]] = [next[target]!, next[idx]!]
    setConstraints(next)
  }

  async function pickClub(idx: number, hit: AdminTeamHit) {
    const constraintId = puzzleRef.current.constraints?.[idx]?.id
    const team = await api.resolveTeam(hit.id)
    const currentConstraints = puzzleRef.current.constraints ?? []
    const currentIndex = constraintId
      ? currentConstraints.findIndex((constraint) => constraint.id === constraintId)
      : idx
    if (currentIndex < 0) return
    const currentType = normalizeConstraintType(currentConstraints[currentIndex]?.type)
    updateConstraint(currentIndex, {
      club: team.name,
      teamId: team.id,
      logoUrl: team.logoUrl,
      leagueId: currentType === 'club' ? team.leagueId : currentConstraints[currentIndex]?.leagueId,
      leagueName:
        currentType === 'club' ? team.leagueName : currentConstraints[currentIndex]?.leagueName,
    })
  }

  function pickLeague(idx: number, league: AdminLeagueHit) {
    updateConstraint(idx, {
      leagueId: league.id,
      leagueName: league.name,
      // For league / nat_league chips, logoUrl is the league badge (not a club crest).
      logoUrl: league.logoUrl || leagueBadgeUrl(league.id) || null,
      teamId: null,
    })
  }

  function pickNationality(idx: number, name: string) {
    updateConstraint(idx, { nationality: name })
  }

  async function pickLineupPlayer(
    idx: number,
    hit: { id: string; name: string; headshotUrl?: string }
  ) {
    const slotId = puzzleRef.current.optimalLineup?.[idx]?.slotId
    let resolved: { id: string; name: string; headshotUrl?: string | null } = {
      id: hit.id,
      name: hit.name,
      headshotUrl: hit.headshotUrl,
    }
    try {
      const full = (await api.resolvePlayer(hit.id, 'card')) as {
        id?: string
        name?: string
        headshotUrl?: string | null
      }
      resolved = {
        id: full.id || hit.id,
        name: full.name || hit.name,
        headshotUrl: full.headshotUrl ?? hit.headshotUrl,
      }
    } catch {
      // search hit is enough
    }
    const current = puzzleRef.current
    const nextLineup = (current.optimalLineup ?? []).map((pick, i) =>
      (slotId ? pick.slotId === slotId : i === idx)
        ? {
            ...pick,
            playerId: resolved.id,
            playerName: resolved.name,
            headshotUrl: resolved.headshotUrl,
          }
        : pick
    )
    commit({ ...current, optimalLineup: nextLineup })
  }

  return (
    <div className="mode-editor">
      <div className="editor-clean-summary">
        <div>
          <span className="muted tiny">Draft overview</span>
          <strong>{p.category?.title || 'Untitled category'}</strong>
        </div>
        <div>
          <span className="muted tiny">Formation</span>
          <strong>{p.formationId || 'Not set'}</strong>
        </div>
        <div>
          <span className="muted tiny">Constraints</span>
          <strong>{constraints.length}</strong>
        </div>
        <div>
          <span className="muted tiny">Best score</span>
          <strong>{recomputing ? '…' : p.optimalScore ?? '—'}</strong>
        </div>
      </div>
      {recomputeError && (
        <p className="muted tiny" style={{ color: '#b42318' }}>
          Best lineup: {recomputeError}
        </p>
      )}
      {recomputing && !recomputeError && (
        <p className="muted tiny">Updating best lineup from the current constraints…</p>
      )}

      <div className="editor-clean-section">
        <header>
          <strong>Draft setup</strong>
          <span className="muted tiny">Set the category, formation and best score</span>
        </header>
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
            Best score
            <input
              type="number"
              value={p.optimalScore ?? ''}
              disabled={locked}
              onChange={(e) => onChange({ ...p, optimalScore: Number(e.target.value) })}
            />
          </label>
        </div>
      </div>

      <details className="editor-clean-section editor-disclosure">
        <summary>
          <strong>Constraints</strong>
          <span className="muted tiny">{constraints.length} rules</span>
        </summary>
        <div className="editor-disclosure-content">
        {constraints.map((c, idx) => {
          const type = normalizeConstraintType(c.type)
          const needsClub = type === 'club' || type === 'nat_club'
          const needsLeague = type === 'league' || type === 'nat_league'
          const needsNat = type === 'nationality' || type === 'nat_league' || type === 'nat_club'
          return (
            <article key={c.id ?? idx} className="numbered-card">
              <div className="card-heading">
                <div>
                  <span className="editor-clean-number">Constraint {idx + 1}</span>
                  <strong>{c.label || 'Untitled constraint'}</strong>{' '}
                  <span className="muted tiny">{type ? TYPE_LABELS[type] : 'Custom'}</span>
                </div>
                <div className="button-row">
                  <button
                    type="button"
                    className="ghost tiny-btn"
                    disabled={locked || idx === 0}
                    onClick={() => moveConstraint(idx, -1)}
                    aria-label={`Move constraint ${idx + 1} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="ghost tiny-btn"
                    disabled={locked || idx === constraints.length - 1}
                    onClick={() => moveConstraint(idx, 1)}
                    aria-label={`Move constraint ${idx + 1} down`}
                  >
                    ↓
                  </button>
                </div>
              </div>
              <label className="field compact">
                Constraint type
                <select
                  value={type ?? 'club'}
                  disabled={locked}
                  onChange={(e) => {
                    const nextType = normalizeConstraintType(e.target.value)
                    if (!nextType) return
                    updateConstraint(idx, {
                      type: nextType,
                      label: TYPE_LABELS[nextType],
                      club: null,
                      teamId: null,
                      logoUrl: null,
                      leagueId: null,
                      leagueName: null,
                      nationality: null,
                    })
                  }}
                >
                  {CONSTRAINT_TYPES.map((constraintType) => (
                    <option key={constraintType} value={constraintType}>
                      {TYPE_LABELS[constraintType]}
                    </option>
                  ))}
                </select>
              </label>
              {needsNat && (
                <EntityPicker
                  kind="nationality"
                  label="Nationality"
                  valueLabel={c.nationality ?? undefined}
                  disabled={locked}
                  onPickNationality={(hit) => pickNationality(idx, hit.name)}
                />
              )}
              {needsClub && (
                <EntityPicker
                  kind="team"
                  label="Club"
                  valueLabel={c.club ?? undefined}
                  imageUrl={constraintImageUrl(c)}
                  disabled={locked}
                  onPickTeam={(hit) => pickClub(idx, hit)}
                />
              )}
              {needsLeague && (
                <EntityPicker
                  kind="league"
                  label="League"
                  valueLabel={c.leagueName ?? undefined}
                  imageUrl={constraintImageUrl(c)}
                  disabled={locked}
                  onPickLeague={(hit) => pickLeague(idx, hit)}
                />
              )}
              {!needsClub && !needsLeague && !needsNat && (
                <label className="field">
                  Label
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
              )}
            </article>
          )
        })}
        <p className="muted tiny">
          Constraint count is fixed because it must match formation slots and the optimal lineup.
        </p>
        </div>
      </details>

      <details className="editor-clean-section editor-disclosure">
        <summary>
          <strong>Best lineup</strong>
          <span className="muted tiny">
            {recomputing ? 'recomputing…' : `${lineup.length} players`}
          </span>
        </summary>
        <div className="editor-disclosure-content">
        {lineup.length === 0 ? (
          <p className="muted">No best lineup has been saved.</p>
        ) : (
          <div className="lineup-pitch">
            {lineup.map((pick, i) => (
              <div key={pick.slotId ?? i} className="lineup-slot">
                <div className="card-heading">
                  <span className="position-badge">{pick.position || `Slot ${i + 1}`}</span>
                  <strong>{pick.statValue ?? '—'} pts</strong>
                </div>
                {additionalPositions(pick.position).length > 0 && (
                  <p className="muted tiny">
                    Also accepts {additionalPositions(pick.position).join(' or ')}
                  </p>
                )}
                <p className="muted tiny">{pick.constraintLabel || 'No constraint label'}</p>
                <EntityPicker
                  key={`${pick.slotId ?? i}-${pick.playerId ?? ''}-${pick.playerName ?? ''}-${pick.headshotUrl ?? ''}`}
                  kind="player"
                  label="Player"
                  valueLabel={pick.playerName || 'Unknown player'}
                  imageUrl={pick.headshotUrl}
                  disabled={locked}
                  onPickPlayer={(hit) => pickLineupPlayer(i, hit)}
                />
              </div>
            ))}
          </div>
        )}
        </div>
      </details>
    </div>
  )
}
