import { api, type AdminLeagueHit, type AdminTeamHit } from '../api'
import { EntityPicker } from '../components/EntityPicker'

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

  function updateConstraint(idx: number, patch: Partial<Constraint>) {
    const next = constraints.map((x, i) => {
      if (i !== idx) return x
      const merged = { ...x, ...patch }
      return { ...merged, label: rebuildLabel(merged) }
    })
    // Keep optimal lineup constraint labels in sync when possible.
    const updated = next[idx]!
    const nextLineup = lineup.map((pick) =>
      pick.constraintId === updated.id
        ? { ...pick, constraintLabel: updated.label }
        : pick
    )
    onChange({ ...p, constraints: next, optimalLineup: nextLineup })
  }

  async function pickClub(idx: number, hit: AdminTeamHit) {
    const team = await api.resolveTeam(hit.id)
    updateConstraint(idx, {
      club: team.name,
      teamId: team.id,
      logoUrl: team.logoUrl,
      leagueId: constraints[idx]?.type === 'club' ? team.leagueId : constraints[idx]?.leagueId,
      leagueName:
        constraints[idx]?.type === 'club' ? team.leagueName : constraints[idx]?.leagueName,
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
    let resolved = { id: hit.id, name: hit.name }
    try {
      const full = (await api.resolvePlayer(hit.id, 'card')) as typeof resolved
      resolved = { id: full.id || hit.id, name: full.name || hit.name }
    } catch {
      // search hit is enough
    }
    const nextLineup = lineup.map((pick, i) =>
      i === idx ? { ...pick, playerId: resolved.id, playerName: resolved.name } : pick
    )
    onChange({ ...p, optimalLineup: nextLineup })
  }

  return (
    <div className="mode-editor">
      <div className="q-card">
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
            Optimal score
            <input
              type="number"
              value={p.optimalScore ?? ''}
              disabled={locked}
              onChange={(e) => onChange({ ...p, optimalScore: Number(e.target.value) })}
            />
          </label>
        </div>
      </div>

      <section className="q-card">
        <header>
          <strong>Constraints ({constraints.length})</strong>
        </header>
        {constraints.map((c, idx) => {
          const type = c.type ?? ''
          const needsClub = type === 'club' || type === 'natClub'
          const needsLeague = type === 'league' || type === 'natLeague'
          const needsNat = type === 'nationality' || type === 'natLeague' || type === 'natClub'
          return (
            <div key={c.id ?? idx} className="bingo-cat">
              <p>
                <strong>{c.label}</strong>{' '}
                <span className="muted tiny">{type}</span>
              </p>
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
            </div>
          )
        })}
      </section>

      <section className="q-card">
        <header>
          <strong>Optimal lineup (QA)</strong>
        </header>
        {lineup.map((pick, i) => (
          <div key={pick.slotId ?? i} className="option-row stack">
            <p className="muted tiny">
              {pick.position} · {pick.constraintLabel} · score {pick.statValue}
            </p>
            <EntityPicker
              key={`${pick.slotId ?? i}-${pick.playerId ?? ''}-${pick.playerName ?? ''}`}
              kind="player"
              valueLabel={pick.playerName}
              disabled={locked}
              onPickPlayer={(hit) => pickLineupPlayer(i, hit)}
            />
          </div>
        ))}
      </section>
    </div>
  )
}
