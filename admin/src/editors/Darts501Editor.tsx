import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, type Darts501Pool, type Darts501PoolPlayer } from '../api'
import { EntityPicker } from '../components/EntityPicker'
import { nationalityFlag } from '../countryFlags'
import './game-editors.css'

type Puzzle = {
  formulaId?: string
  formulaLabel?: string
  nationality?: string | null
  leagueName?: string | null
  club?: string | null
  clubLeague?: string | null
  audience?: string
  formulaDetail?: string
  left?: string
  op?: '+' | '-'
  right?: string
  pool?: Darts501Pool
  [k: string]: unknown
}

type Answer = {
  formulaId?: string
  [k: string]: unknown
}

function poolFromPuzzle(p: Puzzle): Darts501Pool | null {
  if (p.pool?.kind) return p.pool
  if (p.nationality) return { kind: 'nationality', nationality: p.nationality }
  if (p.club) return { kind: 'club', club: p.club, leagueName: p.clubLeague ?? undefined }
  if (p.leagueName) return { kind: 'league', leagueId: 0, leagueName: p.leagueName }
  if (p.audience === 'International Players') return { kind: 'international' }
  return null
}

export function Darts501Editor({
  puzzle,
  answer,
  locked,
  onChange,
}: {
  puzzle: unknown
  answer: unknown
  locked: boolean
  onChange: (puzzle: Puzzle, answer: unknown) => void
}) {
  const p = puzzle as Puzzle
  const a = (answer && typeof answer === 'object' ? answer : {}) as Answer
  const optionsQuery = useQuery({
    queryKey: ['darts-501-options'],
    queryFn: api.darts501Options,
    staleTime: Infinity,
  })

  const pool = poolFromPuzzle(p)
  const left = p.left ?? ''
  const op = p.op === '-' ? '-' : p.op === '+' ? '+' : '+'
  const right = p.right ?? ''
  const kind = pool?.kind ?? ''

  const [players, setPlayers] = useState<Darts501PoolPlayer[]>([])
  const [quality, setQuality] = useState<{
    eligible: number
    valid: number
    high: number
    checkout: number
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function commit(next: Puzzle, formulaId?: string) {
    onChange(next, { ...a, formulaId: formulaId ?? next.formulaId ?? a.formulaId })
  }

  function applyPool(nextPool: Darts501Pool | null) {
    commit({ ...p, pool: nextPool ?? undefined })
  }

  async function recalculate() {
    let nextPool = poolFromPuzzle(p)
    if (nextPool?.kind === 'league' && !nextPool.leagueId && nextPool.leagueName) {
      const league = (optionsQuery.data?.leagues ?? []).find((row) => row.leagueName === nextPool?.leagueName)
      if (league) nextPool = { kind: 'league', leagueId: league.leagueId, leagueName: league.leagueName }
    }
    const canCompose = Boolean(left && right && nextPool && (nextPool.kind !== 'league' || nextPool.leagueId))
    if (!canCompose && !p.formulaId) {
      setError('Set a main constraint and both formula stats first.')
      return
    }
    if (nextPool?.kind === 'nationality' && !nextPool.nationality) {
      setError('Pick a nationality.')
      return
    }
    if (nextPool?.kind === 'club' && !nextPool.club) {
      setError('Pick a club.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const preview = await api.previewDarts501({
        formulaId: p.formulaId,
        left: left || undefined,
        op,
        right: right || undefined,
        pool: nextPool ?? undefined,
      })
      const savedPool = preview.pool ?? nextPool
      if (!locked) {
        commit(
          {
            ...p,
            formulaId: preview.formulaId,
            formulaLabel: preview.label,
            audience: preview.audience,
            formulaDetail: preview.formulaDetail,
            left: preview.left,
            op: preview.op,
            right: preview.right,
            pool: savedPool,
            nationality: savedPool?.kind === 'nationality' ? savedPool.nationality ?? null : null,
            leagueName: savedPool?.kind === 'league' ? savedPool.leagueName ?? null : null,
            leagueId: savedPool?.kind === 'league' ? savedPool.leagueId ?? null : null,
            club: savedPool?.kind === 'club' ? savedPool.club ?? null : null,
            clubLeague: savedPool?.kind === 'club' ? savedPool.leagueName ?? null : null,
            teamId: savedPool?.kind === 'club' ? savedPool.teamId ?? null : null,
          },
          preview.formulaId
        )
      }
      setPlayers(preview.players)
      setQuality(preview.quality)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not recalculate the player pool')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (optionsQuery.isLoading) return
    if (!p.formulaId && !p.left) return
    void recalculate()
    // First open only — later recalculates are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsQuery.isLoading])

  const nations = optionsQuery.data?.nations ?? []
  const leagues = optionsQuery.data?.leagues ?? []
  const metrics = optionsQuery.data?.metrics ?? []
  const extraNation =
    pool?.kind === 'nationality' &&
    pool.nationality &&
    !nations.some((row) => row.nationality === pool.nationality)
      ? pool.nationality
      : null

  return (
    <div className="mode-editor">
      <div className="editor-clean-summary">
        <div>
          <span className="muted tiny">Pool</span>
          <strong>{p.audience || 'Not set'}</strong>
        </div>
        <div>
          <span className="muted tiny">Formula</span>
          <strong>{p.formulaDetail || p.formulaLabel || 'Not set'}</strong>
        </div>
        <div>
          <span className="muted tiny">Valid throws</span>
          <strong>{quality ? quality.valid : '—'}</strong>
        </div>
      </div>

      <div className="editor-clean-section">
        <header>
          <div>
            <strong>Main constraint</strong>
            <p className="muted tiny">Who can be named. Shown as the big badge in the game.</p>
          </div>
        </header>
        <label className="field">
          Constraint
          <select
            value={kind}
            disabled={locked}
            onChange={(event) => {
              const next = event.target.value
              if (next === 'nationality') applyPool({ kind: 'nationality', nationality: pool?.kind === 'nationality' ? pool.nationality : nations[0]?.nationality })
              else if (next === 'league') applyPool({ kind: 'league', leagueId: leagues[0]?.leagueId ?? 39, leagueName: leagues[0]?.leagueName ?? 'Premier League' })
              else if (next === 'club') applyPool({ kind: 'club', club: pool?.kind === 'club' ? pool.club : undefined, teamId: pool?.kind === 'club' ? pool.teamId : undefined, leagueName: 'Premier League' })
              else if (next === 'international') applyPool({ kind: 'international' })
              else applyPool(null)
            }}
          >
            <option value="">Choose a constraint</option>
            <option value="nationality">Nationality</option>
            <option value="league">League</option>
            <option value="club">Club</option>
            <option value="international">International players</option>
          </select>
        </label>
        {kind === 'nationality' && (
          <label className="field">
            Nationality
            <select
              value={pool?.kind === 'nationality' ? pool.nationality ?? '' : ''}
              disabled={locked}
              onChange={(event) => applyPool({ kind: 'nationality', nationality: event.target.value })}
            >
              <option value="">Choose a nationality</option>
              {extraNation && <option value={extraNation}>{extraNation}</option>}
              {nations.map((row) => (
                <option key={row.nationality} value={row.nationality}>
                  {row.audience}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'league' && (
          <label className="field">
            League
            <select
              value={pool?.kind === 'league' ? String(pool.leagueId || pool.leagueName) : ''}
              disabled={locked}
              onChange={(event) => {
                const league = leagues.find((row) => String(row.leagueId) === event.target.value)
                if (league) applyPool({ kind: 'league', leagueId: league.leagueId, leagueName: league.leagueName })
              }}
            >
              <option value="">Choose a league</option>
              {leagues.map((row) => (
                <option key={row.leagueId} value={String(row.leagueId)}>
                  {row.leagueName} Players
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'club' && (
          <EntityPicker
            kind="team"
            label="Club"
            valueLabel={pool?.kind === 'club' ? pool.club : undefined}
            disabled={locked}
            onPickTeam={(hit) => {
              const league = leagues.find((row) => row.leagueId === hit.leagueId)
              applyPool({
                kind: 'club',
                club: hit.name,
                teamId: hit.id,
                leagueName: league?.leagueName ?? 'Premier League',
              })
            }}
          />
        )}
      </div>

      <div className="editor-clean-section">
        <header>
          <div>
            <strong>Formula</strong>
            <p className="muted tiny">The score thrown for each named player.</p>
          </div>
        </header>
        <div className="row">
          <label className="field">
            Left stat
            <select
              value={left}
              disabled={locked}
              onChange={(event) => commit({ ...p, left: event.target.value })}
            >
              <option value="">Choose a stat</option>
              {metrics.map((metric) => (
                <option key={metric.id} value={metric.id}>
                  {metric.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Operator
            <select
              value={op}
              disabled={locked}
              onChange={(event) => commit({ ...p, op: event.target.value === '-' ? '-' : '+' })}
            >
              <option value="+">+</option>
              <option value="-">−</option>
            </select>
          </label>
          <label className="field">
            Right stat
            <select
              value={right}
              disabled={locked}
              onChange={(event) => commit({ ...p, right: event.target.value })}
            >
              <option value="">Choose a stat</option>
              {metrics.map((metric) => (
                <option key={`r-${metric.id}`} value={metric.id}>
                  {metric.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="button-row">
          <button type="button" disabled={busy} onClick={() => void recalculate()}>
            {busy ? 'Recalculating…' : 'Recalculate player pool'}
          </button>
        </div>
        {error && <p className="error-box">{error}</p>}
        {quality && (
          <p className="muted tiny">
            {quality.eligible} in pool · {quality.valid} valid darts scores · {quality.high} of 100+ · {quality.checkout} checkout-range
          </p>
        )}
      </div>

      <div className="editor-clean-section by-pool-section">
        <header>
          <div>
            <strong>Player pool</strong>
            <p className="muted tiny">
              {busy
                ? 'Recalculating…'
                : players.length === 0
                  ? 'Press Recalculate player pool to list who matches.'
                  : `Top ${players.length} scores. Busts sit at the top with --.`}
            </p>
          </div>
        </header>
        {players.length === 0 && !busy ? null : (
          <div className={`by-pool-grid${busy ? ' busy' : ''}`}>
            {players.map((player) => {
              const meta = [
                player.nationality
                  ? `${nationalityFlag(player.nationality)} ${player.nationality}`
                  : undefined,
                player.club,
              ].filter((value): value is string => Boolean(value))
              return (
                <article key={player.id} className="by-pool-card">
                  {player.headshotUrl ? (
                    <img src={player.headshotUrl} alt="" />
                  ) : (
                    <span className="by-pool-placeholder" />
                  )}
                  <div>
                    <strong>{player.name}</strong>
                    <span className="muted tiny">{meta.join(' · ') || '—'}</span>
                  </div>
                  <b className={player.bust ? 'd501-score invalid' : 'd501-score'}>
                    {player.bust ? `${player.score} --` : `${player.score}`}
                  </b>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
