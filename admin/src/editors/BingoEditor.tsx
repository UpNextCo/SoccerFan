import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type AdminTeamHit } from '../api'
import { EntityPicker } from '../components/EntityPicker'
import { nationalityFlag } from '../countryFlags'
import './bingo-lms.css'

type Cat = {
  id?: string
  title?: string
  label?: string
  type?: string
  matchingRule?: string
  iconType?: string
  iconValue?: string
  logoUrl?: string | null
  logo2Url?: string | null
  flag?: string
  [k: string]: unknown
}

type Player = {
  id?: string
  name?: string
  displayName?: string
  headshotUrl?: string | null
  nationality?: string
  position?: string
  clubs?: string[]
  leagues?: string[]
  trophies?: string[]
  awards?: string[]
  stats?: Record<string, number>
  premierLeagueApps?: number | null
  topLeagueGoals?: number | null
  topLeagueApps?: number | null
  [k: string]: unknown
}

type Puzzle = {
  categories: Cat[]
  players: Player[]
  [k: string]: unknown
}

const CATEGORY_NAMES: Record<string, string> = {
  nationality: 'Nationality',
  playedForClub: 'Played for club',
  nationClub: 'Nation + club',
  clubCombo: 'Club combination',
  wonCompetition: 'Competition winner',
  award: 'Award winner',
  statThreshold: 'Stat threshold',
}

function categoryName(category: Cat): string {
  return CATEGORY_NAMES[category.type ?? ''] ?? 'Custom category'
}

function norm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const CLUB_ALIASES: Record<string, string> = {
  'inter milan': 'inter',
  internazionale: 'inter',
  'internazionale milano': 'inter',
  'fc internazionale milano': 'inter',
  'ac milan': 'milan',
  milan: 'milan',
  'bayern munich': 'bayern munchen',
  'bayern munich fc': 'bayern munchen',
  'atletico madrid': 'atletico madrid',
  'atletico de madrid': 'atletico madrid',
  'paris saint germain': 'paris saint germain',
  'paris saint germain fc': 'paris saint germain',
  'paris sg': 'paris saint germain',
  psg: 'paris saint germain',
  'tottenham hotspur': 'tottenham',
  spurs: 'tottenham',
  'manchester utd': 'manchester united',
  'man utd': 'manchester united',
  'man united': 'manchester united',
  'man city': 'manchester city',
  'borussia dortmund': 'borussia dortmund',
  dortmund: 'borussia dortmund',
  bvb: 'borussia dortmund',
  'bayer leverkusen': 'bayer leverkusen',
  leverkusen: 'bayer leverkusen',
  'rb leipzig': 'rb leipzig',
  leipzig: 'rb leipzig',
  'sporting lisbon': 'sporting cp',
  'fc porto': 'porto',
  'fc barcelona': 'barcelona',
  'real madrid cf': 'real madrid',
  'juventus fc': 'juventus',
  'as roma': 'roma',
  'ssc napoli': 'napoli',
  'athletic bilbao': 'athletic club',
  'ath bilbao': 'athletic club',
}

function clubKey(raw: string): string {
  const base = norm(raw)
    .replace(/\bfc\b/g, '')
    .replace(/\bcf\b/g, '')
    .replace(/\bsc\b/g, '')
    .replace(/\bac\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return CLUB_ALIASES[base] ?? base
}

function hasClub(player: Player, club: string): boolean {
  const target = clubKey(club)
  return Boolean(target) && (player.clubs ?? []).some((name) => clubKey(name) === target)
}

function playerMatchesCategory(player: Player, category: Cat): boolean {
  const rule = String(category.matchingRule ?? '')
  switch (category.type) {
    case 'nationality':
      return norm(player.nationality ?? '') === norm(rule)
    case 'playedForClub':
      return hasClub(player, rule)
    case 'nationClub': {
      const [nation, club] = rule.split('|')
      return norm(player.nationality ?? '') === norm(nation ?? '') && hasClub(player, club ?? '')
    }
    case 'clubCombo': {
      const [a, b] = rule.split('|')
      return hasClub(player, a ?? '') && hasClub(player, b ?? '')
    }
    case 'wonCompetition':
      return (player.trophies ?? []).some((trophy) => norm(trophy) === norm(rule))
    case 'award':
      return (player.awards ?? []).some((award) => norm(award) === norm(rule))
    case 'statThreshold': {
      const [key, thresholdText] = rule.split('>=')
      const threshold = Number(thresholdText) || 0
      const stats = player.stats ?? {}
      const value =
        stats[key ?? ''] ??
        (key === 'pl_apps' ? player.premierLeagueApps : undefined) ??
        (key === 'top_goals' ? player.topLeagueGoals : undefined) ??
        (key === 'top_apps' ? player.topLeagueApps : undefined) ??
        0
      return Number(value) >= threshold
    }
    default:
      return false
  }
}

function matchReason(player: Player, category: Cat): string {
  const rule = String(category.matchingRule ?? '')
  switch (category.type) {
    case 'nationality':
      return player.nationality || rule
    case 'playedForClub':
      return player.clubs?.find((club) => clubKey(club) === clubKey(rule)) || rule
    case 'nationClub': {
      const [, club] = rule.split('|')
      const matchedClub = player.clubs?.find((name) => clubKey(name) === clubKey(club ?? '')) || club
      return [player.nationality, matchedClub].filter(Boolean).join(' · ')
    }
    case 'clubCombo': {
      const [a, b] = rule.split('|')
      const first = player.clubs?.find((name) => clubKey(name) === clubKey(a ?? '')) || a
      const second = player.clubs?.find((name) => clubKey(name) === clubKey(b ?? '')) || b
      return [first, second].filter(Boolean).join(' + ')
    }
    case 'wonCompetition':
    case 'award':
      return rule
    case 'statThreshold': {
      const [key, thresholdText] = rule.split('>=')
      const stats = player.stats ?? {}
      const value =
        stats[key ?? ''] ??
        (key === 'pl_apps' ? player.premierLeagueApps : undefined) ??
        (key === 'top_goals' ? player.topLeagueGoals : undefined) ??
        (key === 'top_apps' ? player.topLeagueApps : undefined)
      return value == null ? rule.replace('>=', ' ≥ ') : `${key} ${value} (needs ≥ ${thresholdText})`
    }
    default:
      return 'Matches this square'
  }
}

function playerLabel(player: Player): string {
  return player.name || player.displayName || 'Unknown player'
}

function ruleSummary(category: Cat): string {
  const rule = String(category.matchingRule ?? '')
  const [first, second] = rule.split('|')
  switch (category.type) {
    case 'nationality':
      return `Players representing ${rule || 'a nationality'}`
    case 'playedForClub':
      return `Players who played for ${rule || 'this club'}`
    case 'nationClub':
      return `${first || 'Nationality'} players who played for ${second || 'club'}`
    case 'clubCombo':
      return `Players who represented both ${first || 'club A'} and ${second || 'club B'}`
    case 'wonCompetition':
      return `Players who won ${rule || 'this competition'}`
    case 'award':
      return `Players who received ${rule || 'this award'}`
    case 'statThreshold':
      return rule ? `Players meeting ${rule.replace('>=', ' ≥ ')}` : 'Players meeting this stat'
    default:
      return 'Custom matching criteria'
  }
}

function categoryIcon(category: Cat) {
  if (category.logoUrl) {
    return (
      <span className="bingo-preview-logos">
        <img src={category.logoUrl} alt="" />
        {category.logo2Url && <img src={category.logo2Url} alt="" />}
      </span>
    )
  }
  if (category.flag || category.type === 'nationality') {
    const nationality = category.flag || String(category.matchingRule ?? '')
    return <span className="bingo-preview-flag">{nationalityFlag(nationality)}</span>
  }
  if (category.iconType === 'trophy' || category.type === 'wonCompetition') {
    return <span className="bingo-preview-fallback">🏆</span>
  }
  if (category.iconType === 'award' || category.type === 'award') {
    return <span className="bingo-preview-fallback">🏅</span>
  }
  // Show the full label (e.g. "100+", "€80M"). Truncating to 2 chars made "100+" render as "10".
  const label = String(category.iconValue ?? '●').trim() || '●'
  return <span className="bingo-preview-fallback">{label}</span>
}

export function BingoEditor({
  puzzle,
  locked,
  onChange,
}: {
  puzzle: unknown
  locked: boolean
  onChange: (puzzle: Puzzle) => void
}) {
  const p = puzzle as Puzzle
  const categories = p.categories ?? []
  const players = useMemo(() => p.players ?? [], [p.players])
  const latestRef = useRef(p)
  const [activeCategoryIndex, setActiveCategoryIndex] = useState(0)
  const [poolError, setPoolError] = useState<{ message: string; existingIndex?: number } | null>(null)
  const duplicatePlayerGroups = useMemo(() => {
    const byId = new Map<string, { name: string; indices: number[] }>()
    players.forEach((player, index) => {
      if (!player.id) return
      const existing = byId.get(player.id) ?? {
        name: player.name || player.displayName || 'Unknown player',
        indices: [],
      }
      existing.indices.push(index)
      byId.set(player.id, existing)
    })
    return [...byId.entries()]
      .filter(([, group]) => group.indices.length > 1)
      .map(([id, group]) => ({ id, ...group }))
  }, [players])
  const duplicateIndices = useMemo(
    () => new Set(duplicatePlayerGroups.flatMap((group) => group.indices)),
    [duplicatePlayerGroups]
  )
  const matchersByCategory = useMemo(
    () =>
      categories.map((category) =>
        players
          .map((player, index) => ({ player, index }))
          .filter(({ player }) => playerMatchesCategory(player, category))
      ),
    [categories, players]
  )
  const activeMatchers = matchersByCategory[activeCategoryIndex] ?? []
  const matcherIndices = useMemo(
    () => new Set(activeMatchers.map((entry) => entry.index)),
    [activeMatchers]
  )
  useEffect(() => {
    latestRef.current = p
  }, [p])
  useEffect(() => {
    setActiveCategoryIndex((index) => Math.min(index, Math.max(0, categories.length - 1)))
  }, [categories.length])

  function commit(next: Puzzle) {
    latestRef.current = next
    onChange(next)
  }

  function updateCat(idx: number, patch: Partial<Cat>) {
    const current = latestRef.current
    commit({
      ...current,
      categories: (current.categories ?? []).map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    })
  }

  function replacePlayer(idx: number, next: Player) {
    const current = latestRef.current
    commit({
      ...current,
      players: (current.players ?? []).map((pl, i) => (i === idx ? next : pl)),
    })
  }

  function moveCategory(idx: number, direction: -1 | 1) {
    const current = latestRef.current
    const nextIdx = idx + direction
    if (nextIdx < 0 || nextIdx >= current.categories.length) return
    const next = [...current.categories]
    ;[next[idx], next[nextIdx]] = [next[nextIdx]!, next[idx]!]
    commit({ ...current, categories: next })
    setActiveCategoryIndex(nextIdx)
  }

  async function pickPoolPlayer(
    idx: number,
    hit: { id: string; name: string; nationality?: string; headshotUrl?: string }
  ) {
    const duplicateIndex = latestRef.current.players.findIndex(
      (player, playerIndex) => playerIndex !== idx && player.id === hit.id
    )
    if (duplicateIndex >= 0) {
      setPoolError({
        message: `${hit.name} is already in pool position ${duplicateIndex + 1}. Choose a different player or swap that existing copy first.`,
        existingIndex: duplicateIndex,
      })
      return
    }
    setPoolError(null)
    // Optimistic UI update so the thumb changes immediately.
    const currentPlayer = latestRef.current.players[idx]
    replacePlayer(idx, {
      ...currentPlayer,
      id: hit.id,
      name: hit.name,
      nationality: hit.nationality,
      headshotUrl: hit.headshotUrl ?? null,
    })
    try {
      const resolved = (await api.resolvePlayer(hit.id, 'bingo')) as Player
      replacePlayer(idx, resolved)
    } catch {
      // keep optimistic row
    }
  }

  async function pickClubRule(idx: number, hit: AdminTeamHit, slot: 'primary' | 'secondary' = 'primary') {
    const team = await api.resolveTeam(hit.id)
    const cat = latestRef.current.categories[idx]!
    const type = cat.type ?? ''

    if (type === 'playedForClub' || cat.iconType === 'clubBadge') {
      updateCat(idx, {
        title: `Played for ${team.name}`,
        matchingRule: team.name,
        iconValue: `${team.name}|${team.leagueName ?? 'Premier League'}`,
        logoUrl: team.logoUrl,
      })
      return
    }

    if (type === 'nationClub' || cat.iconType === 'nationClub') {
      const nation = cat.flag || String(cat.matchingRule ?? '').split('|')[0] || ''
      const rule = `${nation}|${team.name}`
      updateCat(idx, {
        matchingRule: rule,
        iconValue: `${team.name}|${team.leagueName ?? 'Premier League'}`,
        logoUrl: team.logoUrl,
        title: cat.title?.includes('|') ? cat.title : `${nation} · ${team.name}`,
      })
      return
    }

    if (type === 'clubCombo' || cat.iconType === 'clubCombo') {
      const [a, b] = String(cat.matchingRule ?? '').split('|')
      if (slot === 'primary') {
        const nextA = team.name
        const nextB = b || a || ''
        updateCat(idx, {
          matchingRule: `${nextA}|${nextB}`,
          iconValue: `${nextA}|${nextB}`,
          title: `${nextA} & ${nextB}`,
          logoUrl: team.logoUrl,
        })
      } else {
        const nextA = a || team.name
        const nextB = team.name
        updateCat(idx, {
          matchingRule: `${nextA}|${nextB}`,
          iconValue: `${nextA}|${nextB}`,
          title: `${nextA} & ${nextB}`,
          logo2Url: team.logoUrl,
        })
      }
    }
  }

  async function pickNationality(idx: number, name: string) {
    const cat = latestRef.current.categories[idx]!
    const type = cat.type ?? ''
    if (type === 'nationality' || cat.iconType === 'flag') {
      updateCat(idx, {
        title: name,
        matchingRule: name,
        iconValue: name,
        flag: name,
      })
      return
    }
    if (type === 'nationClub' || cat.iconType === 'nationClub') {
      const club = String(cat.matchingRule ?? '').split('|')[1] || ''
      updateCat(idx, {
        matchingRule: `${name}|${club}`,
        flag: name,
        title: `${name} · ${club}`,
      })
    }
  }

  return (
    <div className="mode-editor">
      <section className="editor-clean-section">
        <header className="editor-section-header">
          <div>
            <strong>Categories ({categories.length})</strong>
            <p className="muted tiny">Select a square to see and swap the pool players it uses.</p>
          </div>
        </header>
        <div className="bingo-board-preview" aria-label="Category board preview">
          {categories.map((category, idx) => {
            const matcherCount = matchersByCategory[idx]?.length ?? 0
            return (
              <button
                type="button"
                key={`preview-${category.id ?? idx}`}
                className={`bingo-preview-tile${idx === activeCategoryIndex ? ' selected' : ''}${matcherCount === 0 ? ' empty' : ''}`}
                onClick={() => setActiveCategoryIndex(idx)}
                aria-pressed={idx === activeCategoryIndex}
              >
                {categoryIcon(category)}
                <span>{category.title || category.label || `Category ${idx + 1}`}</span>
                <span className={`bingo-preview-count${matcherCount === 0 ? ' empty' : matcherCount < 3 ? ' thin' : ''}`}>
                  {matcherCount} player{matcherCount === 1 ? '' : 's'}
                </span>
              </button>
            )
          })}
        </div>
        {categories.map((c, idx) => {
          const type = c.type ?? ''
          const isClub =
            type === 'playedForClub' ||
            type === 'nationClub' ||
            type === 'clubCombo' ||
            c.iconType === 'clubBadge' ||
            c.iconType === 'nationClub' ||
            c.iconType === 'clubCombo'
          const isNat =
            type === 'nationality' ||
            type === 'nationClub' ||
            c.iconType === 'flag' ||
            c.iconType === 'nationClub'
          const ruleParts = String(c.matchingRule ?? '').split('|')
          const squarePlayers = matchersByCategory[idx] ?? []

          return (
            <article
              key={c.id ?? idx}
              className={`bingo-cat bingo-category-card${idx === activeCategoryIndex ? ' active' : ''}`}
            >
              <div className="bingo-category-heading">
                <div className="bingo-category-heading-copy">
                  <span className="editor-clean-number">Category {idx + 1}</span>
                  <strong>{c.title || c.label || `Category ${idx + 1}`}</strong>
                  <div className="bingo-category-summary">
                    <span className="muted tiny">{categoryName(c)} · {ruleSummary(c)}</span>
                  </div>
                </div>
                <div className="editor-icon-actions">
                  <button type="button" className="ghost tiny-btn" disabled={locked || idx === 0} onClick={() => moveCategory(idx, -1)} aria-label={`Move category ${idx + 1} up`}>↑</button>
                  <button type="button" className="ghost tiny-btn" disabled={locked || idx === categories.length - 1} onClick={() => moveCategory(idx, 1)} aria-label={`Move category ${idx + 1} down`}>↓</button>
                </div>
              </div>
              <label className="field">
                Category name
                <input
                  value={(c.title as string) ?? (c.label as string) ?? ''}
                  disabled={locked}
                  onChange={(e) => updateCat(idx, { title: e.target.value, label: e.target.value })}
                />
              </label>

              {isNat && (
                <EntityPicker
                  kind="nationality"
                  label="Nationality"
                  valueLabel={
                    type === 'nationality'
                      ? String(c.matchingRule ?? '')
                      : ruleParts[0] || c.flag || undefined
                  }
                  disabled={locked}
                  onPickNationality={(hit) => pickNationality(idx, hit.name)}
                />
              )}

              {isClub && type !== 'clubCombo' && c.iconType !== 'clubCombo' && (
                <EntityPicker
                  kind="team"
                  label="Club"
                  valueLabel={
                    type === 'playedForClub'
                      ? String(c.matchingRule ?? '')
                      : ruleParts[1] || undefined
                  }
                  imageUrl={c.logoUrl}
                  disabled={locked}
                  onPickTeam={(hit) => pickClubRule(idx, hit, 'primary')}
                />
              )}

              {(type === 'clubCombo' || c.iconType === 'clubCombo') && (
                <div className="row">
                  <EntityPicker
                    kind="team"
                    label="Club A"
                    valueLabel={ruleParts[0] || undefined}
                    imageUrl={c.logoUrl}
                    disabled={locked}
                    onPickTeam={(hit) => pickClubRule(idx, hit, 'primary')}
                  />
                  <EntityPicker
                    kind="team"
                    label="Club B"
                    valueLabel={ruleParts[1] || undefined}
                    imageUrl={c.logo2Url}
                    disabled={locked}
                    onPickTeam={(hit) => pickClubRule(idx, hit, 'secondary')}
                  />
                </div>
              )}

              {!isClub && !isNat && <p className="muted tiny">This category uses custom matching criteria.</p>}
              <div className="bingo-square-players">
                <header className="bingo-square-players-header">
                  <div>
                    <strong>Players on this square</strong>
                    <p className="muted tiny">
                      {squarePlayers.length} in the pool
                      {squarePlayers.length === 0
                        ? ' · changing the rule above will pick a different set'
                        : squarePlayers.length < 3
                          ? ' · thin (need 3+)'
                          : ''}
                    </p>
                  </div>
                </header>
                {squarePlayers.length === 0 ? (
                  <p className="editor-inline-warning">
                    No pool players match this square. Change the rule above or swap someone into the
                    player pool.
                  </p>
                ) : (
                  <div className="bingo-square-player-list">
                    {squarePlayers.map(({ player, index }) => (
                      <article
                        key={`${player.id ?? index}-${index}`}
                        className={`bingo-square-player${duplicateIndices.has(index) ? ' duplicate' : ''}`}
                      >
                        <div className="bingo-player-title">
                          {player.headshotUrl ? (
                            <img src={player.headshotUrl} alt="" />
                          ) : (
                            <span className="bingo-player-placeholder" />
                          )}
                          <div>
                            <strong>{playerLabel(player)}</strong>
                            <span className="muted tiny">
                              {matchReason(player, c)}
                              {player.position ? ` · ${player.position}` : ''}
                            </span>
                          </div>
                        </div>
                        <EntityPicker
                          kind="player"
                          label="Swap player"
                          valueLabel={playerLabel(player)}
                          imageUrl={player.headshotUrl}
                          nationality={player.nationality}
                          disabled={locked}
                          onPickPlayer={(hit) => pickPoolPlayer(index, hit)}
                        />
                      </article>
                    ))}
                  </div>
                )}
              </div>
              <details className="editor-advanced">
                <summary>Advanced</summary>
                <div className="advanced-grid">
                  <label className="field">Category key<input value={c.id ?? ''} disabled={locked} onChange={(e) => updateCat(idx, { id: e.target.value })} /></label>
                  <label className="field">Category style<input value={type} disabled={locked} onChange={(e) => updateCat(idx, { type: e.target.value })} /></label>
                  <label className="field">Icon style<input value={c.iconType ?? ''} disabled={locked} onChange={(e) => updateCat(idx, { iconType: e.target.value })} /></label>
                  <label className="field">Icon detail<input value={c.iconValue ?? ''} disabled={locked} onChange={(e) => updateCat(idx, { iconValue: e.target.value })} /></label>
                  {!isClub && !isNat && <label className="field">Matching criteria<input value={String(c.matchingRule ?? '')} disabled={locked} onChange={(e) => updateCat(idx, { matchingRule: e.target.value })} /></label>}
                </div>
              </details>
            </article>
          )
        })}
      </section>

      <details
        className="editor-clean-section player-pool-panel"
        open={duplicatePlayerGroups.length > 0 ? true : undefined}
      >
        <summary>
          Player pool
          <span className="muted tiny">
            {players.length} players · {activeMatchers.length} on the selected square
          </span>
        </summary>
        {duplicatePlayerGroups.length > 0 && (
          <div className="error-box bingo-duplicate-summary" role="alert">
            <strong>
              {duplicatePlayerGroups.length} duplicate player
              {duplicatePlayerGroups.length === 1 ? '' : 's'} to fix
            </strong>
            <ul>
              {duplicatePlayerGroups.map((group) => (
                <li key={group.id}>
                  {group.name} appears in pool positions{' '}
                  {group.indices.map((index) => index + 1).join(', ')}
                </li>
              ))}
            </ul>
          </div>
        )}
        {poolError && (
          <div className="error-box bingo-pool-selection-error" role="alert">
            <span>{poolError.message}</span>
            {poolError.existingIndex !== undefined && (
              <button
                type="button"
                className="quiet-button"
                onClick={() =>
                  document
                    .getElementById(`bingo-player-${poolError.existingIndex}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
              >
                Show existing player
              </button>
            )}
          </div>
        )}
        <div className="bingo-player-grid player-pool-content">
          {players.map((pl, idx) => {
            const metadata = [
              pl.position,
              pl.nationality ? `${nationalityFlag(pl.nationality)} ${pl.nationality}` : undefined,
              pl.clubs?.length ? `${pl.clubs.length} clubs` : undefined,
              pl.leagues?.length ? `${pl.leagues.length} leagues` : undefined,
            ].filter((value): value is string => Boolean(value))
            return (
              <article
                id={`bingo-player-${idx}`}
                key={`${pl.id ?? idx}-${pl.headshotUrl ?? ''}-${pl.name ?? ''}`}
                className={`bingo-player-card${duplicateIndices.has(idx) ? ' duplicate' : ''}${matcherIndices.has(idx) ? ' matches-square' : ''}`}
              >
                <div className="bingo-player-title">
                  {pl.headshotUrl ? <img src={pl.headshotUrl} alt="" /> : <span className="bingo-player-placeholder" />}
                  <div>
                    <strong>{pl.name || pl.displayName || 'Unknown player'}</strong>
                    <span className="muted tiny">{metadata.join(' · ') || 'Details unavailable'}</span>
                    {matcherIndices.has(idx) && (
                      <span className="bingo-square-match-label">On selected square</span>
                    )}
                    {duplicateIndices.has(idx) && (
                      <span className="bingo-duplicate-label">
                        Duplicate · pool position {idx + 1}
                      </span>
                    )}
                  </div>
                </div>
                <EntityPicker
                  kind="player"
                  label="Swap player"
                  valueLabel={(pl.name as string) ?? (pl.displayName as string) ?? undefined}
                  imageUrl={pl.headshotUrl}
                  nationality={pl.nationality}
                  disabled={locked}
                  onPickPlayer={(hit) => pickPoolPlayer(idx, hit)}
                />
              </article>
            )
          })}
        </div>
      </details>
    </div>
  )
}
