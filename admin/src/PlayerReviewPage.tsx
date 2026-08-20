import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  api,
  type PlayerDossier,
  type PlayerReviewCounts,
  type PlayerReviewPool,
  type PlayerReviewStatus,
} from './api'
import { EntityPicker } from './components/EntityPicker'
import { nationalityFlag } from './countryFlags'
import './player-review.css'

function formatMoney(value: number | null | undefined): string {
  if (value == null) return '—'
  if (Math.abs(value) >= 1_000_000) return `€${(value / 1_000_000).toFixed(1)}m`
  if (Math.abs(value) >= 1_000) return `€${Math.round(value / 1_000)}k`
  return `€${value}`
}

function seasonRange(from: number, to: number | null | undefined): string {
  if (to == null) return `${from}–present`
  if (to === from) return String(from)
  return `${from}–${to}`
}

function daysToAge(days: number | null | undefined): string {
  if (days == null) return '—'
  return `${(days / 365.25).toFixed(1)} yrs`
}

function Empty({ label }: { label: string }) {
  return <p className="muted tiny">{label}</p>
}

function StatGrid({ items }: { items: Array<[string, string | number | null | undefined]> }) {
  return (
    <dl className="review-stat-grid">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value == null || value === '' ? '—' : value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function PlayerReviewPage() {
  const [pool, setPool] = useState<PlayerReviewPool>('unreviewed')
  const [dossier, setDossier] = useState<PlayerDossier | null>(null)
  const [counts, setCounts] = useState<PlayerReviewCounts | null>(null)
  const [seen, setSeen] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const applyPayload = useCallback((payload: { dossier: PlayerDossier | null; counts: PlayerReviewCounts }) => {
    setDossier(payload.dossier)
    setCounts(payload.counts)
    setNote(payload.dossier?.review.note ?? '')
    if (payload.dossier) {
      setSeen((current) =>
        current.includes(payload.dossier!.id) ? current : [...current.slice(-40), payload.dossier!.id]
      )
    }
  }, [])

  const loadRandom = useCallback(
    async (nextPool = pool, extraExclude: string[] = []) => {
      setBusy(true)
      setError(null)
      setMessage(null)
      try {
        const payload = await api.getRandomPlayerReview(nextPool, [...seen, ...extraExclude])
        applyPayload(payload)
        if (!payload.dossier) {
          setMessage(
            nextPool === 'unreviewed'
              ? 'No unreviewed famous players left in this pool.'
              : 'No players in this filter.'
          )
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load a player.')
      } finally {
        setBusy(false)
      }
    },
    [applyPayload, pool, seen]
  )

  useEffect(() => {
    void loadRandom()
    // First paint only — later loads are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadPlayer(id: string) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      applyPayload(await api.getPlayerReview(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load that player.')
    } finally {
      setBusy(false)
    }
  }

  async function review(status: Exclude<PlayerReviewStatus, 'pending'>) {
    if (!dossier) return
    if (status === 'flagged' && !note.trim()) {
      setError('Add a short note when flagging — what looks wrong?')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await api.setPlayerReview(dossier.id, { status, note: note.trim() || null })
      setMessage(status === 'approved' ? `Approved ${dossier.name}.` : `Flagged ${dossier.name}.`)
      await loadRandom(pool, [dossier.id])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the review.')
      setBusy(false)
    }
  }

  const status = dossier?.review.status ?? 'pending'

  return (
    <div className="player-review-page">
      <header className="board-heading">
        <div>
          <p className="eyebrow">Quiz Ops</p>
          <h1>Player data review</h1>
          <p className="muted">
            Check a random well-known player (fame tier 4+) the same way the games do: clubs
            only, no national sides mixed in. Approve it or flag what’s wrong.
          </p>
        </div>
        {counts && (
          <p className="review-counts muted tiny">
            {counts.unreviewed.toLocaleString()} unreviewed · {counts.approved.toLocaleString()} approved ·{' '}
            {counts.flagged.toLocaleString()} flagged
            <span className="review-counts-pool"> · {counts.poolSize.toLocaleString()} in famous pool</span>
          </p>
        )}
      </header>

      <section className="review-toolbar player-review-card">
        <label className="review-pool">
          Pool
          <select
            value={pool}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value as PlayerReviewPool
              setPool(next)
              void loadRandom(next)
            }}
          >
            <option value="unreviewed">Unreviewed</option>
            <option value="flagged">Flagged</option>
            <option value="approved">Approved</option>
            <option value="any">Any well-known player</option>
          </select>
        </label>
        <EntityPicker
          kind="player"
          label="Jump to player"
          valueLabel={dossier?.name}
          imageUrl={dossier?.headshotUrl}
          nationality={dossier?.nationality}
          disabled={busy}
          placeholder="Search player…"
          onPickPlayer={(hit) => void loadPlayer(hit.id)}
        />
        <button type="button" className="ghost" disabled={busy} onClick={() => void loadRandom()}>
          {busy ? 'Loading…' : 'Skip / next random'}
        </button>
      </section>

      {message && <p className="player-photos-banner success">{message}</p>}
      {error && <p className="player-photos-banner error">{error}</p>}
      {busy && !dossier && <p className="muted">Loading a random player…</p>}

      {dossier && (
        <>
          <section className="player-review-card review-hero">
            <div className="review-hero-photo">
              {dossier.headshotUrl ? (
                <img src={dossier.headshotUrl} alt="" />
              ) : (
                <div className="player-photo-empty">No photo</div>
              )}
            </div>
            <div className="review-hero-meta">
              <div className="review-hero-title">
                <h2>{dossier.name}</h2>
                <span className={`review-status ${status}`}>{status}</span>
              </div>
              <p className="muted">
                {[
                  dossier.currentClub,
                  dossier.nationality
                    ? `${nationalityFlag(dossier.nationality)} ${dossier.nationality}`
                    : null,
                  dossier.position,
                  dossier.subPosition,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <StatGrid
                items={[
                  ['Birth date', dossier.birthDate],
                  ['Age (stored)', dossier.age],
                  ['League', dossier.currentLeague],
                  ['Shirt', dossier.shirtNumber],
                  ['Foot', dossier.foot],
                  ['Tier', dossier.marketValueTier],
                  ['Value', formatMoney(dossier.marketValueEur)],
                  ['Peak value', formatMoney(dossier.peakMarketValueEur)],
                  ['Record fee', formatMoney(dossier.recordFeeEur)],
                  ['Aliases', dossier.aliases.join(', ') || '—'],
                  ['API-Football', dossier.apiFootballId],
                  ['Transfermarkt', dossier.tmPlayerId],
                  ['External id', dossier.externalId],
                  ['Positions', dossier.subPositions.join(', ') || '—'],
                ]}
              />
              {dossier.review.reviewedBy && (
                <p className="muted tiny">
                  Last review: {dossier.review.reviewedBy}
                  {dossier.review.reviewedAt ? ` · ${dossier.review.reviewedAt.slice(0, 10)}` : ''}
                </p>
              )}
            </div>
          </section>

          <section className="player-review-card">
            <h3>What the games use</h3>
            <p className="muted tiny">
              Same definitions as Draft / Target Man / Club Chain: club count drops youth sides,
              career apps are big-5 + CL + EL, career goals are Transfermarkt club total + trusted
              international goals.
            </p>
            <StatGrid
              items={[
                ['Clubs', dossier.gameUsage.clubCount],
                ['Career apps', dossier.gameUsage.careerApps],
                ['Career goals', dossier.gameUsage.careerGoals],
                ['Intl caps', dossier.gameUsage.intlCaps],
                ['Intl goals', dossier.gameUsage.intlGoals],
                ['Counted trophies', dossier.gameUsage.trophies],
              ]}
            />
          </section>

          <section className="player-review-card review-actions">
            <label>
              Flag note
              <textarea
                value={note}
                disabled={busy}
                rows={2}
                placeholder="What’s wrong? (required to flag)"
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <div className="review-action-buttons">
              <button type="button" className="approve-button" disabled={busy} onClick={() => void review('approved')}>
                Approve
              </button>
              <button type="button" className="danger" disabled={busy} onClick={() => void review('flagged')}>
                Flag
              </button>
              <button type="button" className="ghost" disabled={busy} onClick={() => void loadRandom(pool, [dossier.id])}>
                Skip
              </button>
            </div>
          </section>

          <Section title={`Club career (${dossier.career.length})`}>
            <p className="muted tiny">Club Chain / LMS filter — national sides are not clubs.</p>
            {dossier.career.length === 0 ? (
              <Empty label="No club career rows." />
            ) : (
              <CareerList spells={dossier.career} />
            )}
          </Section>

          {dossier.internationalCareer.length > 0 && (
            <Section title={`International career (${dossier.internationalCareer.length})`}>
              <p className="muted tiny">Stored on the player, but games never treat these as clubs.</p>
              <CareerList spells={dossier.internationalCareer} />
            </Section>
          )}

          <Section title="Club stats totals">
            <StatGrid
              items={[
                ['Appearances', dossier.statTotals.appearances],
                ['Minutes', dossier.statTotals.minutes],
                ['Goals', dossier.statTotals.goals],
                ['Assists', dossier.statTotals.assists],
                ['Yellows', dossier.statTotals.yellowCards],
                ['Reds', dossier.statTotals.redCards],
              ]}
            />
          </Section>

          <Section title={`By club competition (${dossier.leagueTotals.length})`}>
            {dossier.leagueTotals.length === 0 ? (
              <Empty label="No club player_stats rows." />
            ) : (
              <div className="review-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Competition</th>
                      <th>Apps</th>
                      <th>Mins</th>
                      <th>Goals</th>
                      <th>Assists</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dossier.leagueTotals.map((row) => (
                      <tr key={`${row.leagueId}-${row.leagueName}`}>
                        <td>{row.leagueName}</td>
                        <td>{row.appearances}</td>
                        <td>{row.minutes}</td>
                        <td>{row.goals}</td>
                        <td>{row.assists}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title={`Club season stats (${dossier.stats.length})`}>
            {dossier.stats.length === 0 ? (
              <Empty label="No club season rows." />
            ) : (
              <div className="review-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Season</th>
                      <th>Team</th>
                      <th>Competition</th>
                      <th>Apps</th>
                      <th>Mins</th>
                      <th>G</th>
                      <th>A</th>
                      <th>Y</th>
                      <th>R</th>
                      <th>CS</th>
                      <th>Saves</th>
                      <th>Fouls</th>
                      <th>Tackles</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dossier.stats.map((row, index) => (
                      <tr key={`${row.season}-${row.leagueId}-${row.teamId}-${index}`}>
                        <td>{row.season}</td>
                        <td>{row.teamName || '—'}</td>
                        <td>{row.leagueName}</td>
                        <td>{row.appearances}</td>
                        <td>{row.minutes}</td>
                        <td>{row.goals}</td>
                        <td>{row.assists}</td>
                        <td>{row.yellowCards}</td>
                        <td>{row.redCards}</td>
                        <td>{row.cleanSheets ?? '—'}</td>
                        <td>{row.saves ?? '—'}</td>
                        <td>{row.foulsCommitted ?? '—'}</td>
                        <td>{row.tackles ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {dossier.internationalStats.length > 0 && (
            <Section title={`International stats (${dossier.internationalStats.length})`}>
              <p className="muted tiny">
                World Cup / Euro / AFCON / Copa América and national-side rows. Games never count
                these as club appearances.
              </p>
              <div className="review-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Season</th>
                      <th>Team</th>
                      <th>Competition</th>
                      <th>Apps</th>
                      <th>G</th>
                      <th>A</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dossier.internationalStats.map((row, index) => (
                      <tr key={`${row.season}-${row.leagueId}-${row.teamId}-${index}`}>
                        <td>{row.season}</td>
                        <td>{row.teamName || '—'}</td>
                        <td>{row.leagueName}</td>
                        <td>{row.appearances}</td>
                        <td>{row.goals}</td>
                        <td>{row.assists}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          <Section title="Extra / Transfermarkt totals">
            {!dossier.extra ? (
              <Empty label="No player_extra_stats row." />
            ) : (
              <StatGrid
                items={[
                  ['Used intl caps', dossier.gameUsage.intlCaps],
                  ['Used intl goals', dossier.gameUsage.intlGoals],
                  ['Used career goals', dossier.gameUsage.careerGoals],
                  ['TM career goals', dossier.extra.tmCareerGoals],
                  ['TM career apps', dossier.extra.tmCareerApps],
                  ['TM intl caps', dossier.extra.tmIntlCaps],
                  ['TM intl goals', dossier.extra.tmIntlGoals],
                  ['Raw wiki caps', dossier.extra.intlCaps],
                  ['Raw wiki goals', dossier.extra.intlGoals],
                  ['Hat-tricks', dossier.extra.careerHattricks],
                  ['Penalty goals', dossier.extra.penaltyGoals],
                  ['FBref penalties', dossier.extra.fbrefPenalties],
                  ['PL penalties', dossier.extra.plPenalties],
                  ['La Liga penalties', dossier.extra.laligaPenalties],
                  ['Serie A penalties', dossier.extra.serieaPenalties],
                  ['Bundesliga penalties', dossier.extra.bundesligaPenalties],
                  ['Ligue 1 penalties', dossier.extra.ligue1Penalties],
                  ['Weak-foot goals', dossier.extra.weakFootGoals],
                  ['Goals before 21', dossier.extra.goalsBefore21],
                  ['UCL KO goals', dossier.extra.uclKnockoutGoals],
                  ['UCL goals vs English', dossier.extra.uclGoalsVsEnglish],
                  ['UCL reds', dossier.extra.uclRedCards],
                  ['Debut age', daysToAge(dossier.extra.debutAgeDays)],
                  ['First goal age', daysToAge(dossier.extra.firstGoalAgeDays)],
                  ['Verified club count', dossier.extra.verifiedClubCount],
                ]}
              />
            )}
          </Section>

          <Section title={`Transfers (${dossier.transfers.length})`}>
            {dossier.transfers.length === 0 ? (
              <Empty label="No transfer rows." />
            ) : (
              <div className="review-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>From</th>
                      <th>To</th>
                      <th>Type</th>
                      <th>Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dossier.transfers.map((row, index) => (
                      <tr key={`${row.transferDate}-${row.fromTeamId}-${row.toTeamId}-${index}`}>
                        <td>{row.transferDate || '—'}</td>
                        <td>{row.fromTeamName || '—'}</td>
                        <td>{row.toTeamName || '—'}</td>
                        <td>{row.transferType}</td>
                        <td>{row.feeRaw || (row.feeEurM ? `€${row.feeEurM}m` : '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title={`Managers (${dossier.managers.length})`}>
            {dossier.managers.length === 0 ? (
              <Empty label="No overlapping curated manager tenures." />
            ) : (
              <ul className="review-simple-list">
                {dossier.managers.map((row) => (
                  <li key={`${row.manager}-${row.club}-${row.seasonFrom}`}>
                    <strong>{row.manager}</strong>
                    <span className="muted">
                      {row.club} · {seasonRange(row.seasonFrom, row.seasonTo)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title={`Club trophies counted in games (${dossier.honours.filter((row) => row.usedInTrophyRankings).length})`}
          >
            {dossier.honours.filter((row) => row.usedInTrophyRankings).length === 0 ? (
              <Empty label="No Premier League / UCL / FA Cup-style winners." />
            ) : (
              <HonourList honours={dossier.honours.filter((row) => row.usedInTrophyRankings)} />
            )}
          </Section>

          {dossier.honours.some((row) => !row.usedInTrophyRankings) && (
            <Section
              title={`Other honours (${dossier.honours.filter((row) => !row.usedInTrophyRankings).length})`}
            >
              <p className="muted tiny">
                Super Cups, Community Shield, international trophies, runners-up — stored, but not
                in the career-trophies ranking.
              </p>
              <HonourList honours={dossier.honours.filter((row) => !row.usedInTrophyRankings)} />
            </Section>
          )}

          <Section title={`Awards (${dossier.awards.length})`}>
            {dossier.awards.length === 0 ? (
              <Empty label="No individual awards." />
            ) : (
              <ul className="review-simple-list">
                {dossier.awards.map((row, index) => (
                  <li key={`${row.award}-${row.year}-${row.placement}-${index}`}>
                    <strong>{row.award}</strong>
                    <span className="muted">
                      {row.year} · {row.placement}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={`Major finals (${dossier.finals.length})`}>
            {dossier.finals.length === 0 ? (
              <Empty label="No CL / World Cup / Euro final rows." />
            ) : (
              <div className="review-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Competition</th>
                      <th>Team</th>
                      <th>Started</th>
                      <th>Mins</th>
                      <th>Goals</th>
                      <th>Won</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dossier.finals.map((row, index) => (
                      <tr key={`${row.competition}-${row.season}-${row.team}-${index}`}>
                        <td>{row.season}</td>
                        <td>{row.competition}</td>
                        <td>{row.team}</td>
                        <td>{row.started ? 'Yes' : 'No'}</td>
                        <td>{row.minutes}</td>
                        <td>{row.goals}</td>
                        <td>{row.won ? 'Yes' : 'No'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title={`World Cup squads (${dossier.wcSquads.length})`}>
            {dossier.wcSquads.length === 0 ? (
              <Empty label="No World Cup squad rows." />
            ) : (
              <ul className="review-simple-list">
                {dossier.wcSquads.map((row) => (
                  <li key={`${row.year}-${row.country}`}>
                    <strong>
                      {row.year} {row.country}
                    </strong>
                    <span className="muted">
                      {row.position}
                      {row.shirtNumber != null ? ` #${row.shirtNumber}` : ''}
                      {row.club ? ` · ${row.club}` : ''}
                      {row.caps != null ? ` · ${row.caps} caps` : ''}
                      {row.isCaptain ? ' · captain' : ''}
                      {row.coach ? ` · ${row.coach}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={`World Cup match events (${dossier.wcEvents.length})`}>
            {dossier.wcEvents.length === 0 ? (
              <Empty label="No World Cup match events." />
            ) : (
              <div className="review-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Stage</th>
                      <th>Match</th>
                      <th>Type</th>
                      <th>Min</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dossier.wcEvents.map((row, index) => (
                      <tr key={`${row.year}-${row.stage}-${row.type}-${row.minute}-${index}`}>
                        <td>{row.year}</td>
                        <td>{row.stage}</td>
                        <td>
                          {row.team} vs {row.opponent}
                        </td>
                        <td>
                          {row.type}
                          {row.role === 'assist' ? ' (assist)' : ''}
                        </td>
                        <td>{row.minute ?? '—'}</td>
                        <td>{row.detail || row.assistPlayerName || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title={`Memorable WC clues (${dossier.wcMemorable.length})`}>
            {dossier.wcMemorable.length === 0 ? (
              <Empty label="No memorable World Cup clues." />
            ) : (
              <ul className="review-simple-list">
                {dossier.wcMemorable.map((row) => (
                  <li key={`${row.year}-${row.clue}`}>
                    <strong>{row.year}</strong>
                    <span className="muted">
                      {row.clue} · {row.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  )
}

function CareerList({ spells }: { spells: PlayerDossier['career'] }) {
  return (
    <ul className="review-career">
      {spells.map((spell) => (
        <li key={`${spell.teamId}-${spell.seasonFrom}`}>
          <img src={spell.badgeUrl} alt="" />
          <span>
            <strong>{spell.teamName}</strong>
            <span className="muted tiny">{seasonRange(spell.seasonFrom, spell.seasonTo)}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function HonourList({ honours }: { honours: PlayerDossier['honours'] }) {
  return (
    <ul className="review-simple-list">
      {honours.map((row, index) => (
        <li key={`${row.competition}-${row.season}-${row.placement}-${index}`}>
          <strong>{row.competition}</strong>
          <span className="muted">
            {row.season} · {row.placement}
            {row.country ? ` · ${row.country}` : ''}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="player-review-card">
      <h3>{title}</h3>
      {children}
    </section>
  )
}
