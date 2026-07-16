import { useEffect, useRef } from 'react'
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

const CONSTRAINT_TYPES = ['club', 'league', 'nationality', 'natLeague', 'natClub'] as const
type ConstraintType = (typeof CONSTRAINT_TYPES)[number]

const TYPE_LABELS: Record<ConstraintType, string> = {
  club: 'Club',
  league: 'League',
  nationality: 'Nationality',
  natLeague: 'Nationality + league',
  natClub: 'Nationality + club',
}

function isConstraintType(value: string): value is ConstraintType {
  return CONSTRAINT_TYPES.some((type) => type === value)
}

function rebuildLabel(c: Constraint): string {
  const type = c.type ?? ''
  if (type === 'club') return c.club ? `Played for ${c.club}` : c.label ?? 'Club'
  if (type === 'league') return c.leagueName ? `${c.leagueName}` : c.label ?? 'League'
  if (type === 'nationality') return c.nationality ?? c.label ?? 'Nationality'
  if (type === 'natLeague') {
    return `${c.nationality ?? '?'} in ${c.leagueName ?? '?'}`
  }
  if (type === 'natClub') {
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

  useEffect(() => {
    puzzleRef.current = p
  }, [p])

  function commit(next: Puzzle) {
    puzzleRef.current = next
    onChange(next)
  }

  function updateConstraint(idx: number, patch: Partial<Constraint>) {
    const current = puzzleRef.current
    const currentConstraints = current.constraints ?? []
    const currentLineup = current.optimalLineup ?? []
    const next = currentConstraints.map((x, i) => {
      if (i !== idx) return x
      const merged = { ...x, ...patch }
      return { ...merged, label: rebuildLabel(merged) }
    })
    // Keep optimal lineup constraint labels in sync when possible.
    const updated = next[idx]!
    const nextLineup = currentLineup.map((pick) =>
      pick.constraintId === updated.id
        ? { ...pick, constraintLabel: updated.label }
        : pick
    )
    commit({ ...current, constraints: next, optimalLineup: nextLineup })
  }

  function setConstraints(next: Constraint[]) {
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
    const currentType = currentConstraints[currentIndex]?.type
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
    })
  }

  function pickNationality(idx: number, name: string) {
    updateConstraint(idx, { nationality: name })
  }

  async function pickLineupPlayer(
    idx: number,
    hit: { id: string; name: string }
  ) {
    const slotId = puzzleRef.current.optimalLineup?.[idx]?.slotId
    let resolved = { id: hit.id, name: hit.name }
    try {
      const full = (await api.resolvePlayer(hit.id, 'card')) as typeof resolved
      resolved = { id: full.id || hit.id, name: full.name || hit.name }
    } catch {
      // search hit is enough
    }
    const current = puzzleRef.current
    const nextLineup = (current.optimalLineup ?? []).map((pick, i) =>
      (slotId ? pick.slotId === slotId : i === idx)
        ? { ...pick, playerId: resolved.id, playerName: resolved.name }
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
          <strong>{p.optimalScore ?? '—'}</strong>
        </div>
      </div>

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

      <section className="editor-clean-section">
        <header>
          <strong>Constraints ({constraints.length})</strong>
          <span className="muted tiny">Shown in this order</span>
        </header>
        {constraints.map((c, idx) => {
          const type = c.type ?? ''
          const needsClub = type === 'club' || type === 'natClub'
          const needsLeague = type === 'league' || type === 'natLeague'
          const needsNat = type === 'nationality' || type === 'natLeague' || type === 'natClub'
          return (
            <article key={c.id ?? idx} className="numbered-card">
              <div className="card-heading">
                <div>
                  <span className="editor-clean-number">Constraint {idx + 1}</span>
                  <strong>{c.label || 'Untitled constraint'}</strong>{' '}
                  <span className="muted tiny">{isConstraintType(type) ? TYPE_LABELS[type] : 'Custom'}</span>
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
                  value={isConstraintType(type) ? type : 'club'}
                  disabled={locked}
                  onChange={(e) => {
                    const nextType = e.target.value
                    if (!isConstraintType(nextType)) return
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
                  imageUrl={c.logoUrl}
                  disabled={locked}
                  onPickTeam={(hit) => pickClub(idx, hit)}
                />
              )}
              {needsLeague && (
                <EntityPicker
                  kind="league"
                  label="League"
                  valueLabel={c.leagueName ?? undefined}
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
      </section>

      <section className="editor-clean-section">
        <header>
          <strong>Best lineup</strong>
        </header>
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
                <p className="muted tiny">{pick.constraintLabel || 'No constraint label'}</p>
                <EntityPicker
                  key={`${pick.slotId ?? i}-${pick.playerId ?? ''}-${pick.playerName ?? ''}`}
                  kind="player"
                  label="Player"
                  valueLabel={pick.playerName || 'Unknown player'}
                  disabled={locked}
                  onPickPlayer={(hit) => pickLineupPlayer(i, hit)}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
